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
    // Los arreglos de escalares no son registros empresariales.
    if (rows.length > 0 || items.length === 0) {
      collections.push({
        path,
        rows,
        totalItems: items.length,
        invalidItems: items.length - rows.length
      });
    }
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
