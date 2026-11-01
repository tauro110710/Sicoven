'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const JOURNAL_FORMAT = 'SICOVEN_RESTORE_JOURNAL_V1';
const MAX_JOURNAL_BYTES = 64 * 1024;
const STATES = new Set([
  'prepared', 'rollback_ready', 'installing', 'installed',
  'committed', 'rolling_back', 'rolled_back'
]);
const TRANSITIONS = {
  prepared: new Set(['rollback_ready', 'rolled_back']),
  rollback_ready: new Set(['installing', 'rolled_back']),
  installing: new Set(['installed', 'rolling_back']),
  installed: new Set(['committed', 'rolling_back']),
  committed: new Set(),
  rolling_back: new Set(['rolled_back']),
  rolled_back: new Set()
};

function assertSafeDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('El directorio del journal debe ser real y no puede ser un enlace.');
  }
}

function validateJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.format !== JOURNAL_FORMAT || value.version !== 1 ||
      typeof value.operationId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(value.operationId) ||
      !STATES.has(value.state) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) ||
      !value.hashes || typeof value.hashes !== 'object' || Array.isArray(value.hashes)) {
    throw new Error('El journal de restauración está corrupto o no es compatible.');
  }
  for (const key of ['sourceDatabase', 'stagedDatabase']) {
    if (typeof value.hashes[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value.hashes[key])) {
      throw new Error('El journal contiene huellas de base de datos inválidas.');
    }
  }
  if (value.hashes.rollbackDatabase !== null &&
      (typeof value.hashes.rollbackDatabase !== 'string' || !/^[a-f0-9]{64}$/.test(value.hashes.rollbackDatabase))) {
    throw new Error('El journal contiene una huella de retorno inválida.');
  }
  if (typeof value.lastStep !== 'string' || value.lastStep.length > 80) {
    throw new Error('El journal contiene un paso inválido.');
  }
  return value;
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = fs.openSync(directory, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Algunos sistemas de archivos Windows no permiten fsync de directorios.
    // La escritura del archivo sigue siendo fsync antes del rename.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function writeAtomic(file, value) {
  const directory = path.dirname(file);
  assertSafeDirectory(directory);
  const temporary = file + '.tmp-' + crypto.randomUUID();
  const payload = JSON.stringify(value, null, 2);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, payload, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    syncDirectory(directory);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

function lstatIfExists(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readJournal(file) {
  const directory = path.dirname(file);
  assertSafeDirectory(directory);
  const stat = lstatIfExists(file);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('El journal no puede ser un enlace ni un elemento especial.');
  if (stat.size > MAX_JOURNAL_BYTES) throw new Error('El journal excede el tamaño máximo permitido.');
  return validateJournal(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function createJournal({ journalPath, sourceDatabaseSha256, stagedDatabaseSha256 }) {
  if (lstatIfExists(journalPath)) throw new Error('Ya existe una operación de restauración pendiente.');
  const now = new Date().toISOString();
  const journal = {
    format: JOURNAL_FORMAT,
    version: 1,
    operationId: crypto.randomUUID(),
    state: 'prepared',
    createdAt: now,
    updatedAt: now,
    hashes: {
      sourceDatabase: sourceDatabaseSha256,
      stagedDatabase: stagedDatabaseSha256,
      rollbackDatabase: null
    },
    lastStep: 'staging_verified'
  };
  validateJournal(journal);
  writeAtomic(journalPath, journal);
  return journal;
}

function transitionJournal({ journalPath, expectedState, nextState, lastStep, rollbackDatabaseSha256 = undefined }) {
  if (!STATES.has(nextState) || typeof lastStep !== 'string' || lastStep.length > 80) {
    throw new Error('La transición solicitada no es válida.');
  }
  const journal = readJournal(journalPath);
  if (!journal) throw new Error('No existe una operación de restauración pendiente.');
  if (journal.state !== expectedState) throw new Error('El estado del journal cambió; se cancela la transición.');
  if (!TRANSITIONS[journal.state].has(nextState)) {
    throw new Error('Transición de restauración no permitida: ' + journal.state + ' → ' + nextState);
  }
  if (nextState === 'rollback_ready') {
    if (typeof rollbackDatabaseSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(rollbackDatabaseSha256)) {
      throw new Error('Se requiere la huella verificada de la base de retorno.');
    }
    journal.hashes.rollbackDatabase = rollbackDatabaseSha256;
  }
  journal.state = nextState;
  journal.lastStep = lastStep;
  journal.updatedAt = new Date().toISOString();
  validateJournal(journal);
  writeAtomic(journalPath, journal);
  return journal;
}

module.exports = {
  JOURNAL_FORMAT,
  createJournal,
  readJournal,
  transitionJournal,
  validateJournal
};
