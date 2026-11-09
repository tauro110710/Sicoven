'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  GLOBAL_REFERENCE_TABLES, COMPANY_TABLES, CHILD_TABLES, copyCompanyRelationalData
} = require('./tenant-relational-migration.cjs');

function createSchema(db) {
  db.exec('PRAGMA foreign_keys=ON');
  for (const table of GLOBAL_REFERENCE_TABLES) {
    if (table === 'inflation_index_sources') db.exec('CREATE TABLE inflation_index_sources(id TEXT PRIMARY KEY)');
    else if (table === 'inflation_index_series') db.exec('CREATE TABLE inflation_index_series(id TEXT PRIMARY KEY, source_id TEXT REFERENCES inflation_index_sources(id))');
    else if (table === 'inflation_index_observations') db.exec('CREATE TABLE inflation_index_observations(id TEXT PRIMARY KEY, series_id TEXT REFERENCES inflation_index_series(id))');
    else db.exec('CREATE TABLE inflation_index_approvals(id TEXT PRIMARY KEY, series_id TEXT REFERENCES inflation_index_series(id))');
  }
  for (const item of COMPANY_TABLES) {
    const parent = item.table;
    if (parent === 'accounting_correction_cases') db.exec('CREATE TABLE accounting_correction_cases(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
    else if (parent === 'inflation_classification_decisions') db.exec('CREATE TABLE inflation_classification_decisions(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
    else if (parent === 'inflation_source_dossiers') db.exec('CREATE TABLE inflation_source_dossiers(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
    else if (parent === 'supporting_documents') db.exec('CREATE TABLE supporting_documents(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
    else if (parent === 'vat_fiscal_incidents') db.exec('CREATE TABLE vat_fiscal_incidents(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
    else db.exec('CREATE TABLE "' + parent + '"(id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
  }
  for (const item of CHILD_TABLES) {
    db.exec('CREATE TABLE "' + item.table + '"(id TEXT PRIMARY KEY, "' + item.foreignKey + '" TEXT NOT NULL REFERENCES "' +
      item.parentTable + '"("' + item.parentId + '"), payload TEXT)');
  }
}

function insert(db, table, values) {
  const columns = Object.keys(values);
  db.prepare('INSERT INTO "' + table + '" (' + columns.map(x => '"' + x + '"').join(',') +
    ') VALUES (' + columns.map(() => '?').join(',') + ')').run(...columns.map(x => values[x]));
}

test('copies global references and only the selected company relational rows', () => {
  const source = new Database(':memory:');
  const target = new Database(':memory:');
  createSchema(source);
  createSchema(target);

  insert(source, 'inflation_index_sources', { id: 'source-1' });
  insert(source, 'inflation_index_series', { id: 'series-1', source_id: 'source-1' });
  insert(source, 'inflation_index_observations', { id: 'obs-1', series_id: 'series-1' });
  insert(source, 'inflation_index_approvals', { id: 'approval-1', series_id: 'series-1' });

  for (const item of COMPANY_TABLES) {
    insert(source, item.table, { id: item.table + '-a', company_id: 'company-a' });
    insert(source, item.table, { id: item.table + '-b', company_id: 'company-b' });
  }
  for (const item of CHILD_TABLES) {
    insert(source, item.table, { id: item.table + '-a', [item.foreignKey]: item.parentTable + '-a', payload: 'preserved' });
    insert(source, item.table, { id: item.table + '-b', [item.foreignKey]: item.parentTable + '-b', payload: 'other-company' });
  }

  const result = copyCompanyRelationalData(source, target, 'company-a');
  assert.equal(result.companyId, 'company-a');
  assert.equal(result.totalRows, GLOBAL_REFERENCE_TABLES.length + COMPANY_TABLES.length + CHILD_TABLES.length);
  for (const item of GLOBAL_REFERENCE_TABLES) {
    assert.equal(target.prepare('SELECT COUNT(*) AS count FROM "' + item + '"').get().count, 1);
  }
  for (const item of COMPANY_TABLES) {
    const rows = target.prepare('SELECT company_id FROM "' + item.table + '"').all();
    assert.deepEqual(rows, [{ company_id: 'company-a' }]);
  }
  for (const item of CHILD_TABLES) {
    const rows = target.prepare('SELECT payload FROM "' + item.table + '"').all();
    assert.deepEqual(rows, [{ payload: 'preserved' }]);
  }
  assert.deepEqual(target.pragma('foreign_key_check'), []);
  source.close();
  target.close();
});

test('rolls back all copied relational rows if a destination conflict occurs', () => {
  const source = new Database(':memory:');
  const target = new Database(':memory:');
  createSchema(source);
  createSchema(target);
  insert(source, 'inflation_index_sources', { id: 'source-1' });
  insert(target, 'inflation_index_sources', { id: 'source-1' });
  assert.throws(() => copyCompanyRelationalData(source, target, 'company-a'));
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM inflation_index_sources').get().count, 1);
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM inflation_index_series').get().count, 0);
  source.close();
  target.close();
});

test('rejects a missing relational table rather than silently omitting history', () => {
  const source = new Database(':memory:');
  const target = new Database(':memory:');
  createSchema(source);
  createSchema(target);
  source.exec('DROP TABLE supporting_document_events');
  assert.throws(() => copyCompanyRelationalData(source, target, 'company-a'), /no contiene la tabla requerida/i);
  source.close();
  target.close();
});
