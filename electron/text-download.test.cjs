const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareTextDownload } = require('./text-download.cjs');

test('text download prepares UTF-8 TXT bytes and keeps the requested filename', () => {
  const result = prepareTextDownload({ fileName: 'RetencionesIVA_J123_202611.txt', content: 'área\r\n100\t120' });
  assert.equal(result.fileName, 'RetencionesIVA_J123_202611.txt');
  assert.equal(result.extension, 'txt');
  assert.equal(result.buffer.toString('utf8'), 'área\r\n100\t120');
});

test('text download strips directory components and encodes explicit ISO-8859-1', () => {
  const result = prepareTextDownload({ fileName: 'C:\\private\\retenciones.xml', content: 'áéñ', contentType: 'application/xml;charset=iso-8859-1', encoding: 'iso-8859-1' });
  assert.equal(result.fileName, 'retenciones.xml');
  assert.deepEqual([...result.buffer], [0xe1, 0xe9, 0xf1]);
});

test('text download rejects empty content, unsafe extensions, unsupported MIME and oversize payloads', () => {
  assert.throws(() => prepareTextDownload({ fileName: 'empty.txt', content: '' }), /no contiene información/);
  assert.throws(() => prepareTextDownload({ fileName: 'run.exe', content: 'x' }), /no permitido/);
  assert.throws(() => prepareTextDownload({ fileName: 'data.txt', content: 'x', contentType: 'application/octet-stream' }), /no permitido/);
  assert.throws(() => prepareTextDownload({ fileName: 'large.txt', content: 'x'.repeat(10 * 1024 * 1024 + 1) }), /10 MB/);
});

test('text download rejects characters outside ISO-8859-1', () => {
  assert.throws(() => prepareTextDownload({ fileName: 'data.txt', content: 'emoji 😀', encoding: 'iso-8859-1' }), /ISO-8859-1/);
});
