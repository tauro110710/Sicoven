export type MigrationRow = Record<string, unknown>;

export const isValidIsoDate = (value: unknown): boolean => {
  const date = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

export const normalizeMigrationValue = (value: unknown): string =>
  String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const splitDelimited = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      row.push(cell.trim()); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('El archivo delimitado contiene comillas sin cerrar.');
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
};

export const validateUniqueMigrationHeaders = (headers: unknown[], context = 'archivo'): string[] => {
  const normalized = headers.map(header => normalizeMigrationValue(header));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const header of normalized) {
    if (!header) continue;
    if (seen.has(header)) duplicates.add(header);
    seen.add(header);
  }
  if (duplicates.size) {
    throw new Error('El ' + context + ' contiene encabezados duplicados o equivalentes tras normalizar: ' +
      [...duplicates].join(', ') + '. Renombra las columnas antes de importar.');
  }
  return normalized;
};

export const parseDelimitedRecords = (text: string, requestedDelimiter?: string): MigrationRow[] => {
  const candidates = requestedDelimiter ? [requestedDelimiter] : [',', ';', '\t', '|'];
  const scored = candidates.map(delimiter => {
    const rows = splitDelimited(text, delimiter);
    const headerCount = rows[0]?.length ?? 0;
    const consistent = rows.slice(1).filter(row => row.length === headerCount).length;
    return { delimiter, rows, score: headerCount > 1 ? consistent * 100 + headerCount : 0 };
  }).sort((a, b) => b.score - a.score);
  const parsed = scored[0];
  if (!parsed || parsed.rows.length < 2 || parsed.rows[0].length < 2) return [];
  const headers = validateUniqueMigrationHeaders(parsed.rows[0].map((header, index) => header || 'columna_' + (index + 1)), 'archivo delimitado');
  return parsed.rows.slice(1).map(values => {
    const record: MigrationRow = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ''; });
    return record;
  }).filter(record => Object.values(record).some(value => String(value ?? '').trim() !== ''));
};

export const parseMigrationNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  let raw = String(value).trim().replace(/[\s\u00a0]/g, '');
  let negativeByParentheses = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    negativeByParentheses = true;
    raw = raw.slice(1, -1);
  } else if (raw.includes('(') || raw.includes(')')) return NaN;
  const currencyPrefix = /^(?:USD|US\$|Bs(?:\.S)?\.?|VES|VEF|\$)/i;
  const currencySuffix = /(?:USD|US\$|Bs(?:\.S)?\.?|VES|VEF|\$)$/i;
  if (currencyPrefix.test(raw)) raw = raw.replace(currencyPrefix, '');
  if (currencySuffix.test(raw)) raw = raw.replace(currencySuffix, '');
  if (!/^[+-]?\d[\d.,]*$/.test(raw)) return NaN;
  const sign = raw.startsWith('-') ? -1 : 1;
  if (raw.startsWith('+') || raw.startsWith('-')) raw = raw.slice(1);
  const commaCount = (raw.match(/,/g) || []).length;
  const dotCount = (raw.match(/\./g) || []).length;
  let normalized = raw;
  if (commaCount && dotCount) {
    const decimalSeparator = raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
    const groupSeparator = decimalSeparator === ',' ? '.' : ',';
    const parts = raw.split(decimalSeparator);
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) return NaN;
    const groups = parts[0].split(groupSeparator);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(group => !/^\d{3}$/.test(group))) return NaN;
    normalized = groups.join('') + '.' + parts[1];
  } else if (commaCount || dotCount) {
    const separator = commaCount ? ',' : '.';
    const parts = raw.split(separator);
    if (parts.length > 2) {
      if (!/^\d{1,3}$/.test(parts[0]) || parts.slice(1).some(part => !/^\d{3}$/.test(part))) return NaN;
      normalized = parts.join('');
    } else {
      const [whole, fraction] = parts;
      if (!whole || !fraction || !/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return NaN;
      normalized = fraction.length === 3 ? whole + fraction : whole + '.' + fraction;
    }
  }
  const parsed = Number(normalized) * sign * (negativeByParentheses ? -1 : 1);
  return Number.isFinite(parsed) ? parsed : NaN;
};
