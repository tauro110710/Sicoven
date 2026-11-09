import assert from 'node:assert/strict';
import test from 'node:test';
import { installNonBlockingAlerts } from './safeAlert';

type ClickListener = (event: Event) => void;

class FakeElement {
  id = '';
  className = '';
  textContent: string | null = null;
  type = '';
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  clickListener: ClickListener | null = null;

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.clickListener = typeof listener === 'function'
      ? listener
      : event => listener.handleEvent(event);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }

  click(): void {
    this.clickListener?.({} as Event);
  }
}

class FakeDocument {
  body = new FakeElement();

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
