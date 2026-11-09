'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createTenantRuntime } = require('./tenant-runtime.cjs');
const { exportCompanyData } = require('./company-data-export.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-company-export-'));
  const controlDb = new Database(path.join(root, 'sicoven.sqlite'));
  const runtime = createTenantRuntime({ controlDb, userDataDir: root, Database, assertSqliteIntegrity });
  const company = { id: 'handover-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const other = { id: 'handover-b', name: 'Empresa B', rif: 'J-87654321-0' };
  t.after(() => {
    try { runtime.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, runtime, company, other };
}

test('exports selected company as a verified standalone SQLite package with its documents', async t => {
  const { root, runtime, company, other } = fixture(t);
  await runtime.createCompany(company);
  await runtime.createCompany(other);
  const db = runtime.getCompanyDatabase(company.id);
  const storageDir = path.join(root, 'companies', company.id, 'supporting-documents');
  fs.mkdirSync(storageDir);
  const storageKey = '123e4567-e89b-42d3-a456-426614174000.pdf';
  const bytes = Buffer.from('%PDF-1.4 company A document');
  fs.writeFileSync(path.join(storageDir, storageKey), bytes);
  db.prepare('INSERT INTO supporting_documents(id,company_id,entity_type,entity_id,document_type,title,description,original_file_name,mime_type,extension,storage_key,sha256,byte_size,uploaded_by_user_id,uploaded_by_username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('doc-a', company.id, 'JOURNAL_ENTRY', 'entry-a', 'INVOICE', 'Factura A', null, 'factura.pdf', 'application/pdf', '.pdf', storageKey, require('node:crypto').createHash('sha256').update(bytes).digest('hex'), bytes.length, null, 'contador', new Date().toISOString());
  const destination = path.join(root, 'entrega-sqlite');
  const result = await exportCompanyData({ db, company, userDataDir: root, destination, format: 'sqlite' });
  assert.equal(result.ok, true);
  const exported = new Database(path.join(destination, 'accounting.sqlite'), { readonly: true });
  try {
    const identity = exported.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
    assert.equal(identity.meta_value, company.id);
    const snapshot = JSON.parse(exported.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(snapshot.companies.length, 1);
    assert.equal(snapshot.companies[0].id, company.id);
  } finally { exported.close(); }
  assert.equal(fs.readFileSync(path.join(destination, 'documents', storageKey)).toString(), bytes.toString());
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
  assert.equal(manifest.company.id, company.id);
  assert.equal(manifest.documents.length, 1);
});

test('exports JSON with only the selected company and attached document bytes', async t => {
  const { root, runtime, company, other } = fixture(t);
  await runtime.createCompany(company);
  await runtime.createCompany(other);
  const db = runtime.getCompanyDatabase(company.id);
  const storageDir = path.join(root, 'companies', company.id, 'supporting-documents');
  fs.mkdirSync(storageDir);
  const storageKey = '123e4567-e89b-42d3-a456-426614174001.pdf';
  const bytes = Buffer.from('%PDF-1.4 company A JSON document');
  fs.writeFileSync(path.join(storageDir, storageKey), bytes);
  db.prepare('INSERT INTO supporting_documents(id,company_id,entity_type,entity_id,document_type,title,description,original_file_name,mime_type,extension,storage_key,sha256,byte_size,uploaded_by_user_id,uploaded_by_username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('doc-json-a', company.id, 'JOURNAL_ENTRY', 'entry-a', 'INVOICE', 'Factura A', null, 'factura.pdf', 'application/pdf', '.pdf', storageKey, require('node:crypto').createHash('sha256').update(bytes).digest('hex'), bytes.length, null, 'contador', new Date().toISOString());
  const destination = path.join(root, 'entrega.json');
  const result = await exportCompanyData({ db, company, userDataDir: root, destination, format: 'json' });
  assert.equal(result.ok, true);
  const payload = JSON.parse(fs.readFileSync(destination, 'utf8'));
  assert.equal(payload.company.id, company.id);
  assert.deepEqual(payload.accountingSnapshot.companies.map(item => item.id), [company.id]);
  assert.equal(payload.supportingDocuments.length, 1);
  assert.equal(Buffer.from(payload.supportingDocuments[0].contentBase64, 'base64').toString(), bytes.toString());
});

test('refuses company handover when any tenant table contains another company data', async t => {
  const { root, runtime, company } = fixture(t);
  await runtime.createCompany(company);
  const db = runtime.getCompanyDatabase(company.id);
  db.exec('CREATE TABLE export_isolation_probe (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, payload TEXT NOT NULL)');
  db.prepare('INSERT INTO export_isolation_probe(id,company_id,payload) VALUES(?,?,?)')
    .run('foreign-row', 'another-company', 'must-not-leak');
  const destination = path.join(root, 'must-not-export.json');
  await assert.rejects(
    exportCompanyData({ db, company, userDataDir: root, destination, format: 'json' }),
    /pertenecientes a otra empresa/
  );
  assert.equal(fs.existsSync(destination), false);
});
