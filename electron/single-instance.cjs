'use strict';

function acquireSingleInstance(app, onSecondInstance = () => {}) {
  if (!app || typeof app.requestSingleInstanceLock !== 'function' || typeof app.on !== 'function') {
    throw new TypeError('Se requiere una instancia válida de Electron app.');
  }
  const acquired = app.requestSingleInstanceLock();
  if (!acquired) return false;
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    onSecondInstance({ commandLine, workingDirectory });
  });
  return true;
}

module.exports = { acquireSingleInstance };
