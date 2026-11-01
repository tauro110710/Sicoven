'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTreeManifest, validateManifest, verifyTreeManifest } = require('./restore-tree-manifest.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tree-manifest-'));
  return { root, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('creates deterministic manifest including empty directories and file hashes', async () => {
  const h = fixture();
  try {
    fs.mkdirSync(path.join(h.root, 'docs', 'empty'), { recursive: true });
    fs.writeFileSync(path.join(h.root, 'docs', 'ledger.txt'), 'SICOVEN');
    const first = await createTreeManifest(h.root);
    const second = await createTreeManifest(h.root);
    assert.deepEqual(first, second);
    assert.equal(first.fileCount, 1);
    assert.equal(first.entryCount, 3);
    assert.equal(first.totalBytes, 7);
    assert.equal(first.entries.find(entry => entry.path === 'docs/ledger.txt').sha256.length, 64);
    assert.equal((await verifyTreeManifest(h.root, first)).totalBytes, 7);
  } finally { h.close(); }
});

test('rejects altered, missing, or extra files during verification', async () => {
  const h = fixture();
  try {
    fs.writeFileSync(path.join(h.root, 'a.txt'), 'original');
    const manifest = await createTreeManifest(h.root);
    fs.writeFileSync(path.join(h.root, 'a.txt'), 'altered');
    await assert.rejects(() => verifyTreeManifest(h.root, manifest), /no coincide/);
    fs.unlinkSync(path.join(h.root, 'a.txt'));
    await assert.rejects(() => verifyTreeManifest(h.root, manifest), /no coincide/);
    fs.writeFileSync(path.join(h.root, 'extra.txt'), 'extra');
    await assert.rejects(() => verifyTreeManifest(h.root, manifest), /no coincide/);
  } finally { h.close(); }
});

test('rejects symlinks and special path names', async () => {
  const h = fixture();
  try {
    fs.writeFileSync(path.join(h.root, 'target.txt'), 'x');
    fs.symlinkSync(path.join(h.root, 'target.txt'), path.join(h.root, 'linked.txt'));
    await assert.rejects(() => createTreeManifest(h.root), /no admite enlaces/);
    assert.throws(() => validateManifest({
      format: 'SICOVEN_TREE_MANIFEST_V1', entryCount: 1, fileCount: 0, totalBytes: 0,
      entries: [{ path: '../escape', type: 'directory' }]
    }), /ruta relativa inválida|segmento de ruta/);
  } finally { h.close(); }
});

test('rejects malformed manifests, duplicate paths, and inconsistent totals', () => {
  const validShape = { format: 'SICOVEN_TREE_MANIFEST_V1', entryCount: 1, fileCount: 0, totalBytes: 0,
    entries: [{ path: 'folder', type: 'directory' }] };
  assert.equal(validateManifest(validShape), validShape);
  assert.throws(() => validateManifest({ ...validShape, entries: [...validShape.entries, ...validShape.entries], entryCount: 2 }), /duplicadas/);
  assert.throws(() => validateManifest({ ...validShape, totalBytes: 1 }), /totales/);
});
