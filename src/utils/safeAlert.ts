const ALERT_LAYER_ID = 'sicoven-alert-layer';
const DIALOG_LAYER_ID = 'sicoven-dialog-layer';
const MAX_VISIBLE_ALERTS = 4;

type AlertWindow = Pick<Window, 'alert'> & Partial<Pick<Window, 'confirm' | 'prompt'>>;
type AlertDocument = Pick<Document, 'getElementById' | 'createElement' | 'body'> & {
  activeElement?: unknown;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => void;
};

export interface NonBlockingConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warning' | 'danger' | 'neutral';
}

export interface NonBlockingPromptOptions {
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

let dialogQueue: Promise<unknown> = Promise.resolve();

function enqueueDialog<T>(task: () => Promise<T>): Promise<T> {
  const next = dialogQueue.then(task, task);
  dialogQueue = next.then(() => undefined, () => undefined);
  return next;
}

function getOrCreateDialogLayer(targetDocument: AlertDocument): HTMLElement | null {
  if (!targetDocument.body) return null;
  let layer = targetDocument.getElementById(DIALOG_LAYER_ID) as HTMLElement | null;
  if (!layer) {
    layer = targetDocument.createElement('div');
    layer.id = DIALOG_LAYER_ID;
    layer.className = 'sicoven-dialog-layer';
    targetDocument.body.appendChild(layer);
  }
  return layer;
}

function splitTitleAndBody(rawMessage: string, explicitTitle?: string, fallbackTitle = 'Confirmación'): { title: string; body: string } {
  if (explicitTitle?.trim()) {
    return { title: explicitTitle.trim(), body: rawMessage };
  }
  const normalized = String(rawMessage ?? '').replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  if (lines.length >= 2 && lines[0].trim().length > 0 && lines[0].trim().length <= 80 && lines[1].trim() === '') {
    return {
      title: lines[0].trim(),
      body: lines.slice(2).join('\n').trim()
    };
  }
  return { title: fallbackTitle, body: normalized };
}

function restorePreviousFocus(previousFocused: unknown): void {
  if (!previousFocused || typeof previousFocused !== 'object') return;
  const candidate = previousFocused as { isConnected?: boolean; focus?: (options?: FocusOptions) => void };
  if (candidate.isConnected === false) return;
  if (typeof candidate.focus === 'function') {
    try {
      candidate.focus({ preventScroll: true });
    } catch {
      try {
        candidate.focus();
      } catch {
        // Ignore focus restoration errors on detached elements.
      }
    }
  }
}

/**
 * Accessible, non-blocking in-app replacement for Chromium's native window.confirm().
 * Never calls Win32/Chromium synchronous modal dialogs, preserving text-entry focus
 * across Electron BrowserWindow controls on Windows.
 */
export function requestNonBlockingConfirm(
  message: string,
  options: NonBlockingConfirmOptions = {},
  targetDocument: AlertDocument | undefined = typeof document !== 'undefined' ? document : undefined
): Promise<boolean> {
  if (!targetDocument) return Promise.resolve(false);
  return enqueueDialog(() => new Promise<boolean>(resolve => {
    const layer = getOrCreateDialogLayer(targetDocument);
    if (!layer) {
      resolve(false);
      return;
    }

    const previousFocused = targetDocument.activeElement;
    const { title, body } = splitTitleAndBody(message, options.title, 'Confirmar acción');
    const tone = options.tone || (/borrado|reset|eliminar|definitivamente/i.test(message) ? 'danger' : 'warning');

    const backdrop = targetDocument.createElement('div');
    backdrop.className = 'sicoven-dialog-backdrop';
    backdrop.setAttribute('data-sicoven-dialog', 'confirm');

    const card = targetDocument.createElement('section');
    card.className = `sicoven-dialog-card sicoven-dialog-card--${tone}`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const titleId = 'sicoven-dialog-title-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    const bodyId = 'sicoven-dialog-body-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    card.setAttribute('aria-labelledby', titleId);
    card.setAttribute('aria-describedby', bodyId);

    const header = targetDocument.createElement('div');
    header.className = 'sicoven-dialog-header';
    const heading = targetDocument.createElement('h2');
    heading.id = titleId;
    heading.className = 'sicoven-dialog-title';
    heading.textContent = title;
    header.appendChild(heading);

    const content = targetDocument.createElement('p');
    content.id = bodyId;
    content.className = 'sicoven-dialog-message';
    content.textContent = body;

    const actions = targetDocument.createElement('div');
    actions.className = 'sicoven-dialog-actions';

    const cancelButton = targetDocument.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'sicoven-dialog-cancel';
    cancelButton.textContent = options.cancelLabel || 'Cancelar';

    const confirmButton = targetDocument.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = `sicoven-dialog-confirm sicoven-dialog-confirm--${tone}`;
    confirmButton.textContent = options.confirmLabel || 'Confirmar';

    let settled = false;
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault?.();
        keyboardEvent.stopPropagation?.();
        finish(false);
      }
    };

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      targetDocument.removeEventListener?.('keydown', onKeyDown, true);
      backdrop.remove();
      if (layer.children && layer.children.length === 0) {
        layer.remove();
      }
      restorePreviousFocus(previousFocused);
      resolve(result);
    };

    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    backdrop.addEventListener('click', event => {
      if (event && event.target === backdrop) finish(false);
    });
    targetDocument.addEventListener?.('keydown', onKeyDown, true);

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    card.appendChild(header);
    card.appendChild(content);
    card.appendChild(actions);
    backdrop.appendChild(card);
    layer.appendChild(backdrop);

    const focusTarget = () => {
      if (typeof cancelButton.focus === 'function') {
        cancelButton.focus();
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusTarget);
    } else {
      focusTarget();
    }
  }));
}

/**
 * Accessible, non-blocking in-app replacement for Chromium's native window.prompt().
 */
export function requestNonBlockingPrompt(
  message: string,
  options: NonBlockingPromptOptions = {},
  targetDocument: AlertDocument | undefined = typeof document !== 'undefined' ? document : undefined
): Promise<string | null> {
  if (!targetDocument) return Promise.resolve(null);
  return enqueueDialog(() => new Promise<string | null>(resolve => {
    const layer = getOrCreateDialogLayer(targetDocument);
    if (!layer) {
      resolve(null);
      return;
    }

    const previousFocused = targetDocument.activeElement;
    const { title, body } = splitTitleAndBody(message, options.title, 'Ingresar información');

    const backdrop = targetDocument.createElement('div');
    backdrop.className = 'sicoven-dialog-backdrop';
    backdrop.setAttribute('data-sicoven-dialog', 'prompt');

    const card = targetDocument.createElement('section');
    card.className = 'sicoven-dialog-card sicoven-dialog-card--neutral';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const titleId = 'sicoven-prompt-title-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    const bodyId = 'sicoven-prompt-body-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
    card.setAttribute('aria-labelledby', titleId);
    card.setAttribute('aria-describedby', bodyId);

    const header = targetDocument.createElement('div');
    header.className = 'sicoven-dialog-header';
    const heading = targetDocument.createElement('h2');
    heading.id = titleId;
    heading.className = 'sicoven-dialog-title';
    heading.textContent = title;
    header.appendChild(heading);

    const form = targetDocument.createElement('form') as HTMLFormElement;
    form.className = 'sicoven-dialog-form';

    const content = targetDocument.createElement('p');
    content.id = bodyId;
    content.className = 'sicoven-dialog-message';
    content.textContent = body;

    const input = targetDocument.createElement('input') as HTMLInputElement;
    input.type = 'text';
    input.className = 'sicoven-dialog-input';
    input.value = options.defaultValue ?? '';
    if (options.placeholder) input.setAttribute('placeholder', options.placeholder);

    const actions = targetDocument.createElement('div');
    actions.className = 'sicoven-dialog-actions';

    const cancelButton = targetDocument.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'sicoven-dialog-cancel';
    cancelButton.textContent = options.cancelLabel || 'Cancelar';

    const confirmButton = targetDocument.createElement('button');
    confirmButton.type = 'submit';
    confirmButton.className = 'sicoven-dialog-confirm sicoven-dialog-confirm--neutral';
    confirmButton.textContent = options.confirmLabel || 'Aceptar';

    let settled = false;
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault?.();
        keyboardEvent.stopPropagation?.();
        finish(null);
      }
    };

    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      targetDocument.removeEventListener?.('keydown', onKeyDown, true);
      backdrop.remove();
      if (layer.children && layer.children.length === 0) {
        layer.remove();
      }
      restorePreviousFocus(previousFocused);
      resolve(result);
    };

    form.addEventListener('submit', event => {
      event?.preventDefault?.();
      finish(input.value);
    });
    cancelButton.addEventListener('click', () => finish(null));
    backdrop.addEventListener('click', event => {
      if (event && event.target === backdrop) finish(null);
    });
    targetDocument.addEventListener?.('keydown', onKeyDown, true);

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    form.appendChild(content);
    form.appendChild(input);
    form.appendChild(actions);
    card.appendChild(header);
    card.appendChild(form);
    backdrop.appendChild(card);
    layer.appendChild(backdrop);

    const focusInput = () => {
      if (typeof input.focus === 'function') {
        input.focus();
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusInput);
    } else {
      focusInput();
    }
  }));
}

/**
 * Replace Chromium's blocking JavaScript alert/confirm/prompt dialogs with
 * non-blocking in-app UI so Electron/Windows never loses text-entry focus.
 */
export function installNonBlockingAlerts(
  targetWindow: AlertWindow = window,
  targetDocument: AlertDocument = document
): () => void {
  const originalAlert = targetWindow.alert;
  const hasConfirm = typeof targetWindow.confirm === 'function';
  const originalConfirm = targetWindow.confirm;
  const hasPrompt = typeof targetWindow.prompt === 'function';
  const originalPrompt = targetWindow.prompt;

  let layer = targetDocument.getElementById(ALERT_LAYER_ID) as HTMLElement | null;
  const ownsLayer = !layer;

  if (!layer) {
    layer = targetDocument.createElement('div');
    layer.id = ALERT_LAYER_ID;
    layer.className = 'sicoven-alert-layer';
    layer.setAttribute('aria-live', 'assertive');
    layer.setAttribute('aria-relevant', 'additions');
    targetDocument.body.appendChild(layer);
  }

  targetWindow.alert = (message?: unknown) => {
    const card = targetDocument.createElement('section');
    card.className = 'sicoven-alert-card';
    card.setAttribute('role', 'alert');

    const content = targetDocument.createElement('p');
    content.className = 'sicoven-alert-message';
    content.textContent = String(message ?? '');

    const dismiss = targetDocument.createElement('button');
    dismiss.className = 'sicoven-alert-dismiss';
    dismiss.type = 'button';
    dismiss.textContent = 'Cerrar aviso';
    dismiss.setAttribute('aria-label', 'Cerrar aviso');
    dismiss.addEventListener('click', () => card.remove());

    card.appendChild(content);
    card.appendChild(dismiss);
    layer?.appendChild(card);

    while (layer && layer.children.length > MAX_VISIBLE_ALERTS) {
      layer.firstElementChild?.remove();
    }
    // Deliberately do not call focus(): keyboard and pointer focus remain with
    // the form control the accountant was using.
  };

  if (hasConfirm) {
    targetWindow.confirm = (message?: string) => {
      console.warn('[SICOVEN] Se bloqueó window.confirm nativo para proteger la edición de campos:', message);
      targetWindow.alert('Acción cancelada: esta confirmación debe abrirse mediante el diálogo seguro interno de SICOVEN.');
      return false;
    };
  }

  if (hasPrompt) {
    targetWindow.prompt = (message?: string) => {
      console.warn('[SICOVEN] Se bloqueó window.prompt nativo para proteger la edición de campos:', message);
      targetWindow.alert('Entrada cancelada: esta solicitud debe abrirse mediante el diálogo seguro interno de SICOVEN.');
      return null;
    };
  }

  return () => {
    targetWindow.alert = originalAlert;
    if (hasConfirm) targetWindow.confirm = originalConfirm;
    if (hasPrompt) targetWindow.prompt = originalPrompt;
    if (ownsLayer) layer?.remove();
  };
}
