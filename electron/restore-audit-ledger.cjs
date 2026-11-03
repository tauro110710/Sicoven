'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = 'restore-audit-ledger.jsonl';
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

function ledgerPath(userDataDir) {
  const root = path.resolve(userDataDir);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('La carpeta de datos no es segura.');
  return path.join(root, FILE);
}

function readRecords(file) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LEDGER_BYTES) {
    throw new Error('El ledger de auditoría no es un archivo regular válido o excede su límite.');
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (raw && !raw.endsWith('\n')) throw new Error('El ledger de auditoría termina con un registro incompleto.');
  return raw.split('\n').filter(Boolean).map((line) => {
    if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) throw new Error('Un registro del ledger excede el tamaño permitido.');
    const record = JSON.parse(line);
    validateRecord(record);
    return record;
  });
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      record.version !== 1 || !UUID.test(record.operationId) ||
      !['RESTORE_COMMITTED', 'RESTORE_ROLLED_BACK'].includes(record.outcome) ||
      typeof record.actor !== 'string' || !record.actor.trim() || record.actor.length > 120 ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
      !HASH.test(record.databaseSha256) ||
      !Number.isSafeInteger(record.documentCount) || record.documentCount < 0) {
    throw new Error('El ledger contiene un registro de auditoría inválido.');
  }
  return record;
}

function appendRestoreOutcome({ userDataDir, operationId, actor, outcome, databaseSha256, documentCount }) {
  const file = ledgerPath(userDataDir);
  const record = validateRecord({
    version: 1, operationId, actor: String(actor || '').trim(), outcome,
    databaseSha256, documentCount, createdAt: new Date().toISOString()
  });
  const records = readRecords(file);
  const existing = records.find(item => item.operationId === record.operationId && item.outcome === record.outcome);
  if (existing) return { ok: true, duplicate: true, record: existing };
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(record) + '\n', 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, duplicate: false, record };
}

function reconcileRestoreAudit({ db, userDataDir }) {
  if (!db?.open) throw new Error('SQLite debe estar abierta para reconciliar la auditoría.');
  const records = readRecords(ledgerPath(userDataDir));
  const insert = db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)');
  const exists = db.prepare("SELECT 1 AS found FROM audit_events WHERE event_type=? AND json_extract(details_json,'$.operationId')=? LIMIT 1");
  let inserted = 0;
  db.transaction(() => {
    for (const record of records) {
      const eventType = record.outcome === 'RESTORE_COMMITTED' ? 'accounting_backup_restored' : 'accounting_backup_restore_rolled_back';
      if (exists.get(eventType, record.operationId)) continue;
      insert.run(eventType, JSON.stringify({
        actor: record.actor, operationId: record.operationId, databaseSha256: record.databaseSha256,
        documentCount: record.documentCount, outcome: record.outcome, ledgerCreatedAt: record.createdAt
      }));
      inserted++;
    }
  })();
  return { ok: true, records: records.length, inserted };
}

module.exports = { FILE, appendRestoreOutcome, reconcileRestoreAudit, readRecords, validateRecord };
