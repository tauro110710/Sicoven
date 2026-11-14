'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { copyCompanyDocumentFiles } = require('./tenant-document-migration.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-document-migration-'));
  const sourceRoot = path.join(root, 'legacy');
  const destinationRoot = path.join(root, 'company-documents');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(destinationRoot);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, sourceRoot, destinationRoot };
}

function addDocument(sourceRoot, storageKey, content) {
  const filePath = path.join(sourceRoot, storageKey);
  fs.writeFileSync(filePath, content);
  return {
    storage_key: storageKey,
    byte_size: Buffer.byteLength(content),
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

test('copies company document files and verifies exact bytes and SHA-256', t => {
  const { sourceRoot, destinationRoot } = fixture(t);
  const key = '123e4567-e89b-12d3-a456-426614174000.pdf';
  const document = addDocument(sourceRoot, key, Buffer.from('%PDF-1.7\nSICOVEN'));
  const result = copyCompanyDocumentFiles({ documents: [document], sourceRoot, destinationRoot });
  assert.deepEqual(result, { copiedFiles: 1, totalBytes: document.byte_size });
  assert.equal(fs.readFileSync(path.join(destinationRoot, key), 'utf8'), '%PDF-1.7\nSICOVEN');
  assert.equal(fs.existsSync(path.join(sourceRoot, key)), true);
});

test('does not overwrite an existing destination document', t => {
  const { sourceRoot, destinationRoot } = fixture(t);
  const key = '123e4567-e89b-12d3-a456-426614174000.jpg';
  const document = addDocument(sourceRoot, key, Buffer.from('original'));
  fs.writeFileSync(path.join(destinationRoot, key), 'keep-existing');
  assert.throws(() => copyCompanyDocumentFiles({ documents: [document], sourceRoot, destinationRoot }));
  assert.equal(fs.readFileSync(path.join(destinationRoot, key), 'utf8'), 'keep-existing');
});

test('rolls back files created earlier in the batch when a later document fails validation', t => {
  const { sourceRoot, destinationRoot } = fixture(t);
  const first = addDocument(sourceRoot, '123e4567-e89b-12d3-a456-426614174000.pdf', Buffer.from('valid'));
  const second = addDocument(sourceRoot, '123e4567-e89b-12d3-a456-426614174001.png', Buffer.from('tampered'));
  second.sha256 = '0'.repeat(64);
  assert.throws(() => copyCompanyDocumentFiles({
    documents: [first, second], sourceRoot, destinationRoot
  }), /SHA-256/i);
  assert.equal(fs.existsSync(path.join(destinationRoot, first.storage_key)), false);
  assert.equal(fs.existsSync(path.join(sourceRoot, first.storage_key)), true);
});

test('rejects path traversal, symlinks, and duplicate storage keys', t => {
  const { sourceRoot, destinationRoot } = fixture(t);
  assert.throws(() => copyCompanyDocumentFiles({
    documents: [{ storage_key: '../outside.pdf', byte_size: 1, sha256: '0'.repeat(64) }],
    sourceRoot, destinationRoot
  }), /clave de almacenamiento/i);
  const key = '123e4567-e89b-12d3-a456-426614174000.webp';
  const document = addDocument(sourceRoot, key, Buffer.from('image'));
  assert.throws(() => copyCompanyDocumentFiles({
    documents: [document, document], sourceRoot, destinationRoot
  }), /duplicadas/i);
  const symlinkKey = '123e4567-e89b-12d3-a456-426614174001.pdf';
  fs.symlinkSync(path.join(sourceRoot, key), path.join(sourceRoot, symlinkKey));
  assert.throws(() => copyCompanyDocumentFiles({
    documents: [{ ...document, storage_key: symlinkKey }], sourceRoot, destinationRoot
  }), /archivo regular/i);
});

test('rejects a symlink in an intermediate parent directory', t => {
  const { root, sourceRoot, destinationRoot } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-document-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const realParent = path.join(outside, 'legacy-parent');
  fs.mkdirSync(realParent);
  const linkedParent = path.join(root, 'legacy-parent');
  fs.symlinkSync(realParent, linkedParent, 'dir');
  const linkedSource = path.join(linkedParent, 'legacy');
  fs.mkdirSync(linkedSource);
  const key = '123e4567-e89b-12d3-a456-426614174002.pdf';
  const document = addDocument(linkedSource, key, Buffer.from('content'));
  assert.throws(() => copyCompanyDocumentFiles({
    documents: [document], sourceRoot: linkedSource, destinationRoot, trustedRoot: root
  }), /directorio intermedio.*seguro/i);
  assert.equal(fs.existsSync(path.join(destinationRoot, key)), false);
});
