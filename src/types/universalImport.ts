export type UniversalJsonCollection = {
  path: string;
  rows: Record<string, unknown>[];
  totalItems: number;
  invalidItems: number;
};

/**
 * Descubre colecciones de registros dentro de JSON de terceros sin asumir
 * nombres de software, claves de colección ni una estructura POSVEN concreta.
 * No recorre dentro de cada fila para evitar separar detalles hijos como
 * colecciones independientes sin conocer sus relaciones.
 */
export const extractUniversalJsonCollections = (value: unknown): UniversalJsonCollection[] => {
  const collections: UniversalJsonCollection[] = [];

  const addArray = (path: string, items: unknown[]) => {
    const rows = items.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
    // También se conservan arreglos escalares o mixtos para explicar
    // cuántos elementos no pueden tratarse como registros importables.
    collections.push({
      path,
      rows,
      totalItems: items.length,
      invalidItems: items.length - rows.length
    });
  };

  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      addArray(path || '$', node);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? path + '.' + key : key;
      if (Array.isArray(child)) addArray(childPath, child);
      else if (child && typeof child === 'object') visit(child, childPath, depth + 1);
    }
  };

  if (Array.isArray(value)) addArray('$', value);
  else visit(value, '', 0);

  return collections;
};

export type UniversalImportFormat = 'json' | 'csv' | 'tsv' | 'txt' | 'xlsx' | 'xlsm' | 'unsupported';

export const detectUniversalImportFormat = (fileName: string): UniversalImportFormat => {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  return ['json', 'csv', 'tsv', 'txt', 'xlsx', 'xlsm'].includes(extension)
    ? extension as UniversalImportFormat
    : 'unsupported';
};

export type ImportSourceSystem = {
  id: 'posven-pro' | 'unknown';
  label: string;
  confidence: 'explicit' | 'unknown';
};

/**
 * Identifica el software de origen solo cuando el propio contenido lo declara.
 * La extensión del archivo nunca se usa para inferir qué sistema lo generó.
 */
export const detectImportSourceSystem = (value: unknown): ImportSourceSystem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { id: 'unknown', label: 'Sistema de origen no identificado', confidence: 'unknown' };
  }
  const record = value as Record<string, unknown>;
  const metadataCandidates = [record, record.metadata, record.meta]
    .filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) as Record<string, unknown>[];
  const declaredValues = metadataCandidates.flatMap(candidate =>
    Object.entries(candidate)
      .filter(([key]) => ['app','application','system','software','sourcesystem'].includes(key.toLowerCase().replace(/[^a-z]/g, '')))
      .map(([, declared]) => String(declared ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  );
  if (declaredValues.some(declared => ['posvenpro','posven'].includes(declared))) {
    return { id: 'posven-pro', label: 'POSVEN-Pro', confidence: 'explicit' };
  }
  return { id: 'unknown', label: 'Sistema de origen no identificado', confidence: 'unknown' };
};
