'use strict';

const crypto = require('node:crypto');

function registerPersistenceFlushIpc({
  ipcMain,
  licenseView,
  getActiveSession,
  getWindow,
  timeoutMs = 15000
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.on !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      typeof getWindow !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('No se pudo registrar el puente de confirmación de persistencia.');
  }

  const pending = new Map();

  const onAcknowledgement = (event, acknowledgement) => {
    const requestId = String(acknowledgement?.requestId || '');
    const request = pending.get(requestId);
    if (!request || request.sender !== event.sender) return;

    pending.delete(requestId);
    clearTimeout(request.timer);
    if (acknowledgement?.ok === true) {
      request.resolve({ ok: true });
    } else {
      const message = String(acknowledgement?.message || 'El renderer no pudo confirmar el vaciado de la cola SQLite.');
      request.reject(new Error(message.slice(0, 500)));
    }
  };

  ipcMain.on('sicoven:persistence-flush-ack', onAcknowledgement);
  ipcMain.handle('sicoven:persistence-flush', async (event, token) => {
    const licensing = licenseView();
    if (!licensing?.authorized) throw new Error(licensing?.message || 'Licencia no autorizada.');
    if (!getActiveSession(token)) throw new Error('Sesión no válida para confirmar la persistencia local.');

    const window = getWindow(event.sender);
    if (!window || window.isDestroyed?.() || event.sender.isDestroyed?.()) {
      throw new Error('La ventana de SICOVEN no está disponible para confirmar la persistencia.');
    }

    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('SICOVEN no recibió confirmación del renderer; se canceló el cambio para proteger los datos.'));
      }, timeoutMs);
      pending.set(requestId, { sender: event.sender, resolve, reject, timer });
      try {
        event.sender.send('sicoven:persistence-flush-request', { requestId });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(error instanceof Error ? error : new Error('No se pudo solicitar la confirmación de persistencia.'));
      }
    });
  });

  return Object.freeze({
    dispose() {
      ipcMain.removeListener?.('sicoven:persistence-flush-ack', onAcknowledgement);
      ipcMain.removeHandler?.('sicoven:persistence-flush');
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Se cerró el puente de persistencia antes de recibir confirmación.'));
      }
      pending.clear();
    },
    getPendingCount: () => pending.size
  });
}

module.exports = { registerPersistenceFlushIpc };
