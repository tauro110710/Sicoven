'use strict';

/**
 * Restore Win32/Chromium input focus to an Electron BrowserWindow and its
 * webContents after a native OS dialog (file picker, save dialog, message box)
 * closes, preventing the renderer from remaining unfocused on Windows.
 */
function restoreWindowFocus(targetWindow, BrowserWindowClass) {
  let win = targetWindow || null;
  if (!win && BrowserWindowClass && typeof BrowserWindowClass.getAllWindows === 'function') {
    win = BrowserWindowClass.getAllWindows().find(item => item && typeof item.isDestroyed === 'function' && !item.isDestroyed()) || null;
  }
  if (!win) return false;
  if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return false;
  try {
    if (typeof win.isMinimized === 'function' && win.isMinimized() && typeof win.restore === 'function') {
      win.restore();
    }
    if (typeof win.focus === 'function') {
      win.focus();
    }
    if (win.webContents && typeof win.webContents.isDestroyed === 'function' ? !win.webContents.isDestroyed() : Boolean(win.webContents)) {
      if (typeof win.webContents.focus === 'function') {
        win.webContents.focus();
      }
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { restoreWindowFocus };
