'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isTrustedNavigation(candidate, options = {}) {
  const isPackaged = options.isPackaged === true;
  try {
    const url = new URL(String(candidate));
    if (isPackaged) {
      if (url.protocol !== 'file:' || !options.entryPath) return false;
      return path.resolve(fileURLToPath(url)) === path.resolve(options.entryPath);
    }
    const expectedOrigin = String(options.devServerOrigin || 'http://localhost:3000');
    return url.origin === expectedOrigin;
  } catch {
    return false;
  }
}

module.exports = { isTrustedNavigation };
