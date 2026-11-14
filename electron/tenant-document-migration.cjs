'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function assertNoSymlinkPath(trustedRoot, target, label) {
  const root = path.resolve(trustedRoot);
  const destination = path.resolve(target);
  const relative = path.relative(root, destination);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(label + ' intenta salir de la carpeta local autorizada.');
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('La carpeta raíz de datos de SICOVEN no es un directorio local seguro.');
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(label + ' contiene un directorio intermedio que no es seguro.');
    }
  }
  return destination;
}

function assertSafeDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(label + ' no es un directorio local seguro.');
  }
}

function ensureSafeDirectory(directory, label) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  assertSafeDirectory(directory, label);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function validateStorageKey(value) {
  const key = String(value || '');
  if (!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(key)) {
    throw new Error('Un documento contiene una clave de almacenamiento no válida; se bloqueó la copia.');
  }
  return key;
}

function copyCompanyDocumentFiles({ documents, sourceRoot, destinationRoot, trustedRoot = path.dirname(path.resolve(sourceRoot)) }) {
  if (!Array.isArray(documents)) throw new TypeError('Se requiere la lista de documentos de la empresa.');
  if (!sourceRoot || !destinationRoot || !path.isAbsolute(sourceRoot) || !path.isAbsolute(destinationRoot)) {
    throw new TypeError('Las rutas de documentos deben ser absolutas.');
  }
  const source = assertNoSymlinkPath(trustedRoot, sourceRoot, 'El almacén legado de documentos');
  const destination = assertNoSymlinkPath(trustedRoot, destinationRoot, 'El almacén de documentos de la empresa');
  ensureSafeDirectory(source, 'El almacén legado de documentos');
  ensureSafeDirectory(destination, 'El almacén de documentos de la empresa');
  assertNoSymlinkPath(trustedRoot, source, 'El almacén legado de documentos');
  assertNoSymlinkPath(trustedRoot, destination, 'El almacén de documentos de la empresa');

  const keys = new Set();
  const created = [];
  let totalBytes = 0;
  try {
    for (const document of documents) {
      const key = validateStorageKey(document?.storage_key);
      if (keys.has(key)) throw new Error('La migración contiene claves de documentos duplicadas.');
      keys.add(key);
      const sourcePath = path.resolve(source, key);
      const destinationPath = path.resolve(destination, key);
      if (path.dirname(sourcePath) !== source || path.dirname(destinationPath) !== destination) {
        throw new Error('La ruta de un documento intenta salir del almacén autorizado.');
      }
      const sourceStat = fs.lstatSync(sourcePath);
      if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
        throw new Error('Un documento legado no es un archivo regular; se bloqueó la migración.');
      }
      const expectedSize = Number(document.byte_size);
      const expectedHash = String(document.sha256 || '').toLowerCase();
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 ||
          !/^[a-f0-9]{64}$/.test(expectedHash) ||
          sourceStat.size !== expectedSize || sha256File(sourcePath) !== expectedHash) {
        throw new Error('El tamaño o SHA-256 de un documento legado no coincide con su registro. No se copió el archivo.');
      }
      const contents = fs.readFileSync(sourcePath);
      const destinationFd = fs.openSync(destinationPath, 'wx', 0o600);
      created.push(destinationPath);
      try {
        fs.writeFileSync(destinationFd, contents);
        fs.fsyncSync(destinationFd);
      } finally {
        fs.closeSync(destinationFd);
      }
      const copiedStat = fs.lstatSync(destinationPath);
      if (copiedStat.isSymbolicLink() || !copiedStat.isFile() ||
          copiedStat.size !== expectedSize || sha256File(destinationPath) !== expectedHash) {
        throw new Error('La verificación posterior a la copia de un documento falló.');
      }
      totalBytes += expectedSize;
    }
  } catch (error) {
    for (const filePath of created.reverse()) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    throw error;
  }

  return Object.freeze({ copiedFiles: created.length, totalBytes });
}

module.exports = { copyCompanyDocumentFiles, validateStorageKey, assertNoSymlinkPath };
