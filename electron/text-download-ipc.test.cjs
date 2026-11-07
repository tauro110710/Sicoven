const test = require('node:test');
const assert = require('node:assert/strict');
const { registerTextDownloadHandler } = require('./text-download-ipc.cjs');

function setup(options = {}) {
  let handler;
  const writes = [];
  const shown = [];
  let dialogOptions;
  const senderUrl = options.senderUrl || 'file:///C:/SICOVEN/index.html';
  const saveResult = options.saveResult || { canceled: false, filePath: 'C:/Users/Test/Documents/retenciones.txt' };
  const ipcMain = { handle: (channel, callback) => { assert.equal(channel, 'sicoven:text-save'); handler = callback; } };
  const BrowserWindow = { fromWebContents: sender => ({ sender }) };
  const dialog = { showSaveDialog: async (window, opts) => { assert.ok(window.sender); dialogOptions = opts; return saveResult; } };
  const app = { getPath: name => { assert.equal(name, 'documents'); return 'C:/Users/Test/Documents'; } };
  const fs = { promises: { writeFile: async (filePath, buffer) => writes.push({ filePath, bytes: Buffer.from(buffer) }) } };
  const shell = { showItemInFolder: filePath => shown.push(filePath) };
  const prepareTextDownload = input => ({ fileName: input.fileName, extension: 'txt', filterName: 'Archivo de texto', buffer: Buffer.from(input.content, 'utf8') });
  registerTextDownloadHandler({ ipcMain, BrowserWindow, dialog, app, fs, shell, prepareTextDownload });
  return { invoke: input => handler({ sender: { getURL: () => senderUrl } }, input), writes, shown, getDialogOptions: () => dialogOptions };
}

test('guarda el contenido exacto y muestra la carpeta', async () => {
  const ctx = setup();
  const payload = 'RIF;Monto\\nJ-123;25,00';
  const result = await ctx.invoke({ fileName: 'retenciones.txt', content: payload });
  assert.deepEqual(result, { ok: true, filePath: 'C:/Users/Test/Documents/retenciones.txt', bytes: Buffer.byteLength(payload) });
  assert.equal(ctx.writes.length, 1);
  assert.equal(ctx.writes[0].bytes.toString('utf8'), payload);
  assert.deepEqual(ctx.shown, ['C:/Users/Test/Documents/retenciones.txt']);
  assert.deepEqual(ctx.getDialogOptions().filters, [{ name: 'Archivo de texto', extensions: ['txt'] }]);
});

test('cancelar no escribe ni abre archivos', async () => {
  const ctx = setup({ saveResult: { canceled: true } });
  assert.deepEqual(await ctx.invoke({ fileName: 'retenciones.txt', content: 'datos' }), { ok: false, canceled: true });
  assert.equal(ctx.writes.length, 0);
  assert.equal(ctx.shown.length, 0);
});

test('rechaza orígenes externos antes de abrir el diálogo', async () => {
  const ctx = setup({ senderUrl: 'https://example.com' });
  await assert.rejects(ctx.invoke({ fileName: 'retenciones.txt', content: 'datos' }), /Origen no autorizado/);
  assert.equal(ctx.writes.length, 0);
  assert.equal(ctx.shown.length, 0);
});
