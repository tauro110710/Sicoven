'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { partitionAuditEvents, copyAuditEvents } = require('./tenant-audit-migration.cjs');

function event(id, eventType, details, createdAt = '2026-11-08T10:00:00.000Z') {
  return { id, event_type: eventType, details_json: JSON.stringify(details), created_at: createdAt };
}

test('partitions only events with an exact companyId and preserves original rows', () => {
  const a = event(1, 'sale_posted', { companyId: 'company-a', saleId: 'sale-1' });
  const b = event(2, 'purchase_posted', { companyId: 'company-b', purchaseId: 'purchase-1' });
  const global = event(3, 'license_activated', { installationId: 'local' });
  const unknown = event(4, 'legacy_event', { companyId: 'company-removed' });
  const malformed = { id: 5, event_type: 'broken', details_json: '{bad json', created_at: '2026-11-08' };

  const result = partitionAuditEvents([a, b, global, unknown, malformed], ['company-a', 'company-b']);

  assert.deepEqual(result.byCompany.get('company-a'), [a]);
  assert.deepEqual(result.byCompany.get('company-b'), [b]);
  assert.deepEqual(result.controlEvents, [global, unknown, malformed]);
  assert.deepEqual(result.unresolvedEvents, [
    { id: 4, reason: 'UNKNOWN_COMPANY', companyId: 'company-removed' },
    { id: 5, reason: 'INVALID_DETAILS_JSON' }
  ]);
  assert.deepEqual(result.counts, {
    total: 5, assigned: 2, retainedInControl: 3, unresolved: 2
  });
});

test('does not guess ownership from nested fields or similarly named values', () => {
  const rows = [
    event(1, 'nested', { metadata: { companyId: 'company-a' } }),
    event(2, 'text', { description: 'company-a' }),
    event(3, 'array', [{ companyId: 'company-a' }])
  ];
  const result = partitionAuditEvents(rows, ['company-a']);
  assert.equal(result.byCompany.get('company-a').length, 0);
  assert.deepEqual(result.controlEvents, rows);
  assert.equal(result.unresolvedEvents.length, 0);
});

test('rejects duplicate, missing, or invalid audit IDs before any copy', () => {
  assert.throws(() => partitionAuditEvents([event(1, 'one', {}), event(1, 'two', {})], ['company-a']), /duplicado/i);
  assert.throws(() => partitionAuditEvents([event(0, 'zero', {})], ['company-a']), /ID inválido/i);
  assert.throws(() => partitionAuditEvents([], []), /lista de empresas/i);
});

test('copies audit IDs and timestamps without rewriting their payload', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL)');
  const rows = [event(17, 'posted', { companyId: 'company-a', amount: 25 }, '2024-02-03T04:05:06.000Z')];
  assert.equal(copyAuditEvents(db, rows), 1);
  assert.deepEqual(db.prepare('SELECT id,event_type,details_json,created_at FROM audit_events').all(), rows);
  db.close();
});

test('copy is atomic and rolls back when a destination already contains an ID', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL)');
  db.prepare('INSERT INTO audit_events VALUES(?,?,?,?)').run(2, 'existing', '{}', '2026-01-01');
  assert.throws(() => copyAuditEvents(db, [
    event(1, 'new', {}),
    event(2, 'duplicate', {})
  ]));
  assert.deepEqual(db.prepare('SELECT id,event_type FROM audit_events ORDER BY id').all(), [
    { id: 2, event_type: 'existing' }
  ]);
  db.close();
});
