import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  installNonBlockingAlerts,
  requestNonBlockingConfirm,
  requestNonBlockingPrompt
} from './safeAlert';

type DomListener = (event: Event) => void;

class FakeElement {
  id = '';
  className = '';
  textContent: string | null = null;
  type = '';
  value = '';
  isConnected = true;
  focusedCount = 0;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, DomListener[]>();

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const fn: DomListener = typeof listener === 'function'
      ? listener
      : event => listener.handleEvent(event);
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const list = this.listeners.get(type) || [];
    for (const listener of [...list]) {
      listener({ target: this, preventDefault: () => undefined, stopPropagation: () => undefined, ...event } as unknown as Event);
    }
  }

  remove(): void {
    this.isConnected = false;
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }

  click(): void {
    this.dispatch('click');
  }

  focus(): void {
    this.focusedCount += 1;
  }
}

class FakeDocument {
  body = new FakeElement();
  activeElement: FakeElement | null = null;
  listeners = new Map<string, DomListener[]>();

  createElement(_tag: string): FakeElement {
    return new FakeElement();
  }

  getElementById(id: string): FakeElement | null {
    const visit = (node: FakeElement): FakeElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this.body);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const fn: DomListener = typeof listener === 'function'
      ? listener
      : event => listener.handleEvent(event);
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter(item => item !== listener));
  }

  dispatch(type: string, event: Record<string, unknown>): void {
    const list = this.listeners.get(type) || [];
    for (const listener of [...list]) {
      listener({ preventDefault: () => undefined, stopPropagation: () => undefined, ...event } as unknown as Event);
    }
  }
}

function findByClass(root: FakeElement, classFragment: string): FakeElement[] {
  const results: FakeElement[] = [];
  const visit = (node: FakeElement) => {
    if (node.className.split(/\s+/).includes(classFragment)) results.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return results;
}

test('alert displays a dismissible notice without invoking the blocking native alert', () => {
  let nativeAlertCalls = 0;
  const originalAlert = (_message?: unknown) => { nativeAlertCalls += 1; };
  const targetWindow = { alert: originalAlert } as Pick<Window, 'alert'>;
  const targetDocument = new FakeDocument();

  const restore = installNonBlockingAlerts(
    targetWindow,
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );

  targetWindow.alert('Completa los datos obligatorios.');
  const layer = targetDocument.getElementById('sicoven-alert-layer');
  assert.ok(layer);
  assert.equal(layer.children.length, 1);
  assert.equal(layer.children[0].attributes.get('role'), 'alert');
  assert.equal(layer.children[0].children[0].textContent, 'Completa los datos obligatorios.');
  assert.equal(layer.children[0].children[1].textContent, 'Cerrar aviso');
  assert.equal(nativeAlertCalls, 0);

  layer.children[0].children[1].click();
  assert.equal(layer.children.length, 0);

  restore();
  assert.equal(targetWindow.alert, originalAlert);
  targetWindow.alert('Restaurado');
  assert.equal(nativeAlertCalls, 1);
});

test('only the four most recent notices remain visible', () => {
  const targetWindow = { alert: (_message?: unknown) => undefined } as Pick<Window, 'alert'>;
  const targetDocument = new FakeDocument();
  const restore = installNonBlockingAlerts(
    targetWindow,
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );

  for (let index = 1; index <= 5; index += 1) targetWindow.alert('Aviso ' + index);
  const layer = targetDocument.getElementById('sicoven-alert-layer');
  assert.ok(layer);
  assert.equal(layer.children.length, 4);
  assert.equal(layer.children[0].children[0].textContent, 'Aviso 2');
  assert.equal(layer.children[3].children[0].textContent, 'Aviso 5');

  restore();
});

test('installNonBlockingAlerts blocks synchronous window.confirm and window.prompt fallback calls', () => {
  let nativeConfirmCalls = 0;
  let nativePromptCalls = 0;
  const originalConfirm = (_message?: string) => { nativeConfirmCalls += 1; return true; };
  const originalPrompt = (_message?: string) => { nativePromptCalls += 1; return 'ok'; };
  const targetWindow = {
    alert: (_message?: unknown) => undefined,
    confirm: originalConfirm,
    prompt: originalPrompt
  };
  const targetDocument = new FakeDocument();

  const restore = installNonBlockingAlerts(
    targetWindow,
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );

  assert.equal(targetWindow.confirm('Confirmar'), false);
  assert.equal(targetWindow.prompt('Motivo'), null);
  assert.equal(nativeConfirmCalls, 0);
  assert.equal(nativePromptCalls, 0);

  restore();
  assert.equal(targetWindow.confirm, originalConfirm);
  assert.equal(targetWindow.prompt, originalPrompt);
});

test('requestNonBlockingConfirm resolves true/false, removes backdrop, and restores focus', async () => {
  const targetDocument = new FakeDocument();
  const triggerInput = new FakeElement();
  targetDocument.body.appendChild(triggerInput);
  targetDocument.activeElement = triggerInput;

  const confirmPromise = requestNonBlockingConfirm(
    'RECTIFICACIÓN DE IDENTIDAD DE LA EMPRESA\n\n¿Desea continuar?',
    {},
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );

  await Promise.resolve();
  const layer = targetDocument.getElementById('sicoven-dialog-layer');
  assert.ok(layer);
  assert.equal(layer.children.length, 1);
  const title = findByClass(layer, 'sicoven-dialog-title')[0];
  assert.equal(title.textContent, 'RECTIFICACIÓN DE IDENTIDAD DE LA EMPRESA');

  const confirmBtn = findByClass(layer, 'sicoven-dialog-confirm')[0];
  confirmBtn.click();
  assert.equal(await confirmPromise, true);
  assert.equal(targetDocument.getElementById('sicoven-dialog-layer'), null);
  assert.equal(triggerInput.focusedCount, 1);

  const cancelPromise = requestNonBlockingConfirm(
    '¿Desea cancelar?',
    {},
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );
  await Promise.resolve();
  const layerAfter = targetDocument.getElementById('sicoven-dialog-layer')!;
  const cancelBtn = findByClass(layerAfter, 'sicoven-dialog-cancel')[0];
  cancelBtn.click();
  assert.equal(await cancelPromise, false);
  assert.equal(targetDocument.getElementById('sicoven-dialog-layer'), null);
});

test('requestNonBlockingConfirm cancels on Escape and cleans up DOM', async () => {
  const targetDocument = new FakeDocument();
  const promise = requestNonBlockingConfirm(
    'Confirmación de prueba',
    {},
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );
  await Promise.resolve();
  assert.ok(targetDocument.getElementById('sicoven-dialog-layer'));
  targetDocument.dispatch('keydown', { key: 'Escape' });
  assert.equal(await promise, false);
  assert.equal(targetDocument.getElementById('sicoven-dialog-layer'), null);
});

test('requestNonBlockingPrompt returns submitted text or null on cancel and restores focus', async () => {
  const targetDocument = new FakeDocument();
  const previousControl = new FakeElement();
  targetDocument.body.appendChild(previousControl);
  targetDocument.activeElement = previousControl;

  const submitPromise = requestNonBlockingPrompt(
    'Indica el motivo de reversión del pago.',
    { defaultValue: 'Error de monto' },
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );

  await Promise.resolve();
  const layer = targetDocument.getElementById('sicoven-dialog-layer')!;
  const input = findByClass(layer, 'sicoven-dialog-input')[0];
  assert.equal(input.value, 'Error de monto');
  assert.equal(input.focusedCount, 1);
  input.value = 'Ajuste verificado en banco';
  const form = findByClass(layer, 'sicoven-dialog-form')[0];
  form.dispatch('submit');

  assert.equal(await submitPromise, 'Ajuste verificado en banco');
  assert.equal(targetDocument.getElementById('sicoven-dialog-layer'), null);
  assert.equal(previousControl.focusedCount, 1);

  const cancelPromise = requestNonBlockingPrompt(
    'Motivo',
    {},
    targetDocument as unknown as Pick<Document, 'getElementById' | 'createElement' | 'body'>
  );
  await Promise.resolve();
  const cancelLayer = targetDocument.getElementById('sicoven-dialog-layer')!;
  findByClass(cancelLayer, 'sicoven-dialog-cancel')[0].click();
  assert.equal(await cancelPromise, null);
  assert.equal(targetDocument.getElementById('sicoven-dialog-layer'), null);
});

test('renderer components contain no raw native window.confirm or window.prompt calls', () => {
  const srcRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const offending: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') && full !== path.join(srcRoot, 'utils', 'safeAlert.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        if (/\b(?:window\.)?(?:confirm|prompt)\s*\(/.test(content) && !full.endsWith('InventoryMovementImport.tsx')) {
          offending.push(path.relative(srcRoot, full));
        }
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offending, []);
});
