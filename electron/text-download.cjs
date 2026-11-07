const path = require('node:path');

const MIME_TYPES = new Map([
  ['text/plain;charset=utf-8', 'Archivo de texto'],
  ['text/plain', 'Archivo de texto'],
  ['text/csv;charset=utf-8', 'Archivo CSV'],
  ['text/csv', 'Archivo CSV'],
  ['application/xml;charset=utf-8', 'Archivo XML'],
  ['application/xml;charset=iso-8859-1', 'Archivo XML'],
  ['application/xml', 'Archivo XML'],
  ['application/json;charset=utf-8', 'Archivo JSON'],
  ['application/json', 'Archivo JSON']
]);
const EXTENSIONS = new Set(['txt', 'csv', 'xml', 'json']);

function prepareTextDownload(input) {
  const rawName = String(input?.fileName || 'SICOVEN.txt').replace(/\\/g, '/');
  const baseName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  const fileName = baseName || 'SICOVEN.txt';
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new Error('Tipo de archivo no permitido para esta descarga.');
  const contentType = String(input?.contentType || 'text/plain;charset=utf-8').toLowerCase();
  if (!MIME_TYPES.has(contentType)) throw new Error('Formato de contenido no permitido para esta descarga.');
  const encoding = input?.encoding === undefined ? 'utf-8' : input.encoding;
  if (encoding !== 'utf-8' && encoding !== 'iso-8859-1') throw new Error('Codificación de archivo no permitida.');
  const content = input?.content;
  if (typeof content !== 'string' || content.length === 0) throw new Error('El archivo no contiene información para guardar.');
  if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) throw new Error('El archivo supera el límite seguro de 10 MB.');
  let buffer;
  if (encoding === 'iso-8859-1') {
    const bytes = [];
    for (let index = 0; index < content.length; index += 1) {
      const code = content.charCodeAt(index);
      if (code > 0xff || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
        throw new Error('El contenido no se puede representar de forma segura en ISO-8859-1.');
      }
      bytes.push(code);
    }
    buffer = Buffer.from(bytes);
  } else {
    buffer = Buffer.from(content, 'utf8');
  }
  return { fileName, extension, filterName: MIME_TYPES.get(contentType), contentType, buffer };
}

module.exports = { prepareTextDownload };
