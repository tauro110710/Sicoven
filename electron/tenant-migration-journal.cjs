'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JOURNAL_FILE = 'tenant-migration-journal.json';
const PHASES = Object.freeze([
  'PREPARED', 'STAGING', 'VALIDATING', 'REGISTERING', 'COMMITTED',
  'ROLLBACK_REQUIRED', 'ROLLED_BACK', 'FAILED'
]);
const TRANSITIONS = Object.freeze({
  PREPARED: ['STAGING', 'ROLLBACK_REQUIRED', 'FAILED'],
  STAGING: ['VALIDATING', 'ROLLBACK_REQUIRED', 'FAILED'],
  VALIDATING: ['REGISTERING', 'ROLLBACK_REQUIRED', 'FAILED'],
  REGISTERING: ['COMMITTED', 'ROLLBACK_REQUIRED', 'FAILED'],
  COMMITTED: [],
  ROLLBACK_REQUIRED: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: [],
  FAILED: ['ROLLBACK_REQUIRED']
});

function assertSafeDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('La carpeta del journal de migración no es un directorio local seguro.');
  }
}

function validateJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.version !== 1 || typeof value.migrationId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(value.migrationId) ||
      !PHASES.includes(value.phase) || typeof value.createdAt !== 'string' ||
      typeof value.updatedAt !== 'string' || !Array.isArray(value.companyIds) ||
      value.companyIds.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(value.companyIds).size !== value.companyIds.length ||
      !Array.isArray(value.completedCompanyIds) ||
      value.completedCompanyIds.some(id => !value.companyIds.includes(id)) ||
      typeof value.sourceBackupPath !== 'string' || !path.isAbsolute(value.sourceBackupPath) ||
      typeof value.sourceBackupSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sourceBackupSha256)) {
    throw new Error('El journal de migración está incompleto o no cumple el esquema esperado.');
  }
  return value;
}

function createTenantMigrationJournal({ userDataDir, now = () => new Date().toISOString(), id = () => crypto.randomUUID() }) {
  if (!userDataDir || !path.isAbsolute(userDataDir)) {
    throw new TypeError('La carpeta de datos local debe ser una ruta absoluta.');
  }
  const root = path.join(path.resolve(userDataDir), 'tenant-migration');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertSafeDirectory(root);
  const journalPath = path.join(root, JOURNAL_FILE);

  function read() {
    if (!fs.existsSync(journalPath)) return null;
    const stat = fs.lstatSync(journalPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('El journal de migración no es un archivo regular seguro.');
    }
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(journalPath, 'utf8')); }
    catch { throw new Error('El journal de migración está dañado; se requiere recuperación manual sin borrar datos.'); }
    return Object.freeze({ ...validateJournal(parsed) });
  }

  function writeAtomic(value) {
    validateJournal(value);
    const temporaryPath = path.join(root, JOURNAL_FILE + '.' + id() + '.tmp');
    const fd = fs.openSync(temporaryPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.renameSync(temporaryPath, journalPath);
      try {
        const directoryFd = fs.openSync(root, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } catch (error) {
        if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error?.code)) throw error;
      }
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch {}
      throw error;
    }
  }

  function create({ companyIds, sourceBackupPath, sourceBackupSha256 }) {
    if (read()) throw new Error('Ya existe un journal de migración. Debe recuperarse o cerrarse antes de iniciar otra migración.');
    const timestamp = now();
    const journal = validateJournal({
      version: 1,
      migrationId: id(),
      phase: 'PREPARED',
      createdAt: timestamp,
      updatedAt: timestamp,
      companyIds: [...companyIds],
      completedCompanyIds: [],
      sourceBackupPath: path.resolve(sourceBackupPath || ''),
      sourceBackupSha256: String(sourceBackupSha256 || '').toLowerCase(),
      lastError: null
    });
    writeAtomic(journal);
    return read();
  }

  function advance(expectedPhase, nextPhase, patch = {}) {
    const current = read();
    if (!current) throw new Error('No existe un journal de migración activo.');
    if (current.phase !== expectedPhase) {
      throw new Error('El journal cambió de fase; se rechazó una transición basada en un estado obsoleto.');
    }
    if (!TRANSITIONS[current.phase]?.includes(nextPhase)) {
      throw new Error('La transición de migración solicitada no está permitida.');
    }
    const next = validateJournal({
      ...current,
      ...patch,
      migrationId: current.migrationId,
      version: current.version,
      phase: nextPhase,
      updatedAt: now()
    });
    writeAtomic(next);
    return read();
  }

  function markCompanyCompleted(companyId) {
    const current = read();
    if (!current || !['STAGING', 'VALIDATING'].includes(current.phase)) {
      throw new Error('Solo se pueden registrar empresas copiadas durante staging o validación.');
    }
    if (!current.companyIds.includes(companyId)) {
      throw new Error('La empresa no pertenece a esta migración.');
    }
    if (current.completedCompanyIds.includes(companyId)) return current;
    const completedCompanyIds = [...current.completedCompanyIds, companyId];
    writeAtomic(validateJournal({ ...current, completedCompanyIds, updatedAt: now() }));
    return read();
  }

  return Object.freeze({ path: journalPath, read, create, advance, markCompanyCompleted });
}

module.exports = { JOURNAL_FILE, PHASES, TRANSITIONS, createTenantMigrationJournal, validateJournal };
