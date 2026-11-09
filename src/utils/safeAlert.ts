const ALERT_LAYER_ID = 'sicoven-alert-layer';
const MAX_VISIBLE_ALERTS = 4;

type AlertWindow = Pick<Window, 'alert'>;
type AlertDocument = Pick<Document, 'getElementById' | 'createElement' | 'body'>;

/**
 * Replace Chromium's blocking JavaScript alert with an accessible, non-blocking
 * in-app notice. The notice never takes focus or covers the rest of the window,
 * so accountants can correct the form immediately after a validation message.
 */
export function installNonBlockingAlerts(
  targetWindow: AlertWindow = window,
  targetDocument: AlertDocument = document
): () => void {
  const originalAlert = targetWindow.alert;
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

  return () => {
    targetWindow.alert = originalAlert;
    if (ownsLayer) layer?.remove();
  };
}
