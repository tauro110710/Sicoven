'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'SICOVEN_TREE_MANIFEST_V1';
const MAX_ENTRIES = 100000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024;
const MAX_PATH_LENGTH = 1024;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_PATH_LENGTH ||
      value.includes('\\') || value.startsWith('/') || /^[a-z]:/i.test(value)) {
    throw new Error('El manifiesto contiene una ruta relativa inválida.');
  }
  const segments = value.split('/');
  if (segments.some(part => !part || part === '.' || part === '..' ||
      /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
      RESERVED_WINDOWS_NAME.test(part))) {
    throw new Error('El manifiesto contiene un segmento de ruta no portable.');
  }
  return segments.join('/');
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function createTreeManifest(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('La raíz documental debe ser un directorio real.');
  }
  const entries = [];
  let totalBytes = 0;

  async function walk(directory, prefix) {
    const names = fs.readdirSync(directory).sort((a, b) => a.localeCompare(b, 'en'));
    for (const name of names) {
      const relative = normalizeRelativePath(prefix ? prefix + '/' + name : name);
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('El árbol documental no admite enlaces simbólicos ni junctions.');
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory' });
        if (entries.length > MAX_ENTRIES) throw new Error('El árbol documental supera el máximo de entradas.');
        await walk(absolute, relative);
      } else if (stat.isFile()) {
        totalBytes += stat.size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
          throw new Error('El árbol documental supera el tamaño máximo permitido.');
        }
        entries.push({ path: relative, type: 'file', size: stat.size, sha256: await hashFile(absolute) });
        if (entries.length > MAX_ENTRIES) throw new Error('El árbol documental supera el máximo de entradas.');
      } else {
        throw new Error('El árbol documental contiene un elemento especial no admitido.');
      }
    }
  }

  await walk(root, '');
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    format: FORMAT,
    entryCount: entries.length,
    fileCount: entries.filter(entry => entry.type === 'file').length,
    totalBytes,
    entries
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.format !== FORMAT || !Array.isArray(manifest.entries) ||
      manifest.entries.length > MAX_ENTRIES ||
      manifest.entryCount !== manifest.entries.length ||
      !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 0 ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 ||
      manifest.totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('El manifiesto documental es inválido.');
  }
  let files = 0;
  let bytes = 0;
  let previous = '';
  const seen = new Set();
  for (const entry of manifest.entries) {
    const normalized = normalizeRelativePath(entry?.path);
    if (normalized !== entry.path || seen.has(normalized) || (previous && previous.localeCompare(normalized, 'en') >= 0)) {
      throw new Error('El manifiesto contiene rutas duplicadas o desordenadas.');
    }
    seen.add(normalized);
    previous = normalized;
    if (entry.type === 'directory') {
      if (Object.keys(entry).some(key => !['path', 'type'].includes(key))) throw new Error('Entrada de directorio inválida.');
    } else if (entry.type === 'file') {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
        throw new Error('Entrada de archivo inválida.');
      }
      files++;
      bytes += entry.size;
    } else {
      throw new Error('Tipo de entrada documental desconocido.');
    }
  }
  if (files !== manifest.fileCount || bytes !== manifest.totalBytes) {
    throw new Error('Los totales del manifiesto no coinciden con sus entradas.');
  }
  return manifest;
}

async function verifyTreeManifest(rootDirectory, expectedManifest) {
  validateManifest(expectedManifest);
  const actual = await createTreeManifest(rootDirectory);
  if (JSON.stringify(actual) !== JSON.stringify(expectedManifest)) {
    throw new Error('El árbol documental no coincide con el manifiesto verificado.');
  }
  return actual;
}

module.exports = { FORMAT, createTreeManifest, validateManifest, verifyTreeManifest };
