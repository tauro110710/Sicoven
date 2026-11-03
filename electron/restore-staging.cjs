'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifyBackupDirectory } = require('./backup-restore.cjs');

function lstatIfExists(target) {
  try { return fs.lstatSync(target); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertRealDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(label + ' debe ser un directorio real sin enlaces.');
  }
}

function copyRegularTree(source, destination, destinationAlreadyCreated = false) {
  assertRealDirectory(source, 'El paquete de respaldo');
  if (!destinationAlreadyCreated) fs.mkdirSync(destination, { recursive: false });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error('El staging no admite enlaces simbólicos.');
    if (entry.isDirectory()) {
      copyRegularTree(from, to);
      continue;
    }
    if (!entry.isFile()) throw new Error('El staging contiene un elemento especial no admitido.');
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    const fd = fs.openSync(to, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}

function createRestoreStaging({ backupDirectory, userDataDir, operationId = crypto.randomUUID() }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error('El identificador de operación no es un UUID v4 válido.');
  }
  const backupRoot = path.resolve(backupDirectory);
  const userDataRoot = path.resolve(userDataDir);
  assertRealDirectory(backupRoot, 'El paquete de respaldo');
  assertRealDirectory(userDataRoot, 'La carpeta de datos de SICOVEN');
  const verifiedSource = verifyBackupDirectory(backupRoot);
  const stagingParent = path.join(userDataRoot, 'restore-staging');
  if (!lstatIfExists(stagingParent)) {
    try { fs.mkdirSync(stagingParent, { recursive: false }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  assertRealDirectory(stagingParent, 'La carpeta de staging');
  const operationDirectory = path.join(stagingParent, operationId);
  if (lstatIfExists(operationDirectory)) {
    throw new Error('Ya existe el staging para esta operación.');
  }

  let operationDirectoryCreated = false;
  try {
    // mkdir exclusivo: una ruta preexistente, incluso un symlink colgante,
    // nunca se considera propiedad de esta operación ni se limpia al fallar.
    fs.mkdirSync(operationDirectory, { recursive: false });
    operationDirectoryCreated = true;
    copyRegularTree(backupRoot, operationDirectory, true);
    const verifiedCopy = verifyBackupDirectory(operationDirectory);
    if (verifiedCopy.databaseSha256 !== verifiedSource.databaseSha256 ||
        verifiedCopy.documentCount !== verifiedSource.documentCount) {
      throw new Error('El staging no coincide con el paquete de origen.');
    }
    return {
      ok: true,
      operationId,
      stagingDirectory: operationDirectory,
      databaseSha256: verifiedCopy.databaseSha256,
      documentCount: verifiedCopy.documentCount
    };
  } catch (error) {
    if (operationDirectoryCreated) {
      try {
        fs.rmSync(operationDirectory, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new Error('Falló la preparación del staging y no se pudo limpiar: ' + cleanupError.message);
      }
    }
    throw error;
  }
}

module.exports = { createRestoreStaging };
