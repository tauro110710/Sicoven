const path = require('node:path');

function registerTextDownloadHandler({ ipcMain, BrowserWindow, dialog, app, fs, shell, prepareTextDownload }) {
  ipcMain.handle('sicoven:text-save', async (event, input) => {
    const senderUrl = event.sender.getURL();
    if (!senderUrl.startsWith('file://') && !senderUrl.startsWith('http://localhost:') && !senderUrl.startsWith('http://127.0.0.1:')) {
      throw new Error('Origen no autorizado para guardar archivos.');
    }
    const prepared = prepareTextDownload(input);
    const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Guardar archivo de SICOVEN',
      defaultPath: path.join(app.getPath('documents'), prepared.fileName),
      filters: [{ name: prepared.filterName, extensions: [prepared.extension] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(result.filePath, prepared.buffer);
    shell.showItemInFolder(result.filePath);
    return { ok: true, filePath: result.filePath, bytes: prepared.buffer.length };
  });
}

module.exports = { registerTextDownloadHandler };
