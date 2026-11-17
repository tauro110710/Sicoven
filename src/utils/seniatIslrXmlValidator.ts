export type SeniatIslrXmlIssue = {
  line: number;
  field: string;
  code: string;
  message: string;
};

export type SeniatIslrXmlValidation = {
  isValid: boolean;
  rowCount: number;
  issues: SeniatIslrXmlIssue[];
};

const RIF_PATTERN = /^[VEPJG][0-9]{9}$/i;
const PERIOD_PATTERN = /^2[0-9]{3}(0[1-9]|1[0-2])$/;
const AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

function issue(line: number, field: string, code: string, message: string): SeniatIslrXmlIssue {
  return { line, field, code, message };
}

function decodeXmlText(raw: string): string | null {
  if (raw.includes('<') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-f]+;)/i.test(raw)) return null;
  return raw.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? '';
    const value = entity[1].toLowerCase() === 'x'
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff) ||
        (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d)) return '';
    return String.fromCodePoint(value);
  });
}

function isRealDate(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Preflight local del XML mensual de Retenciones ISLR, conforme al esquema
 * "Salarios y Otras Retenciones" del Manual Técnico SENIAT v3.1.
 * No valida existencia del RIF ni del concepto en las bases del SENIAT.
 */
export function validateSeniatIslrXml(content: string): SeniatIslrXmlValidation {
  const issues: SeniatIslrXmlIssue[] = [];
  const add = (line: number, field: string, code: string, message: string) => issues.push(issue(line, field, code, message));
  if (typeof content !== 'string' || !content.trim()) {
    add(1, 'Archivo', 'EMPTY_XML', 'El XML está vacío.');
    return { isValid: false, rowCount: 0, issues };
  }
  if (content.charCodeAt(0) === 0xfeff) add(1, 'Archivo', 'XML_BOM', 'El archivo no debe comenzar con BOM.');
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) add(1, 'Archivo', 'XML_DTD_FORBIDDEN', 'No se permiten DTD ni declaraciones de entidades externas.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(content)) {
    add(1, 'Archivo', 'XML_INVALID_CONTROL', 'El XML contiene caracteres de control no permitidos.');
  }
  if ([...content].some(character => character.codePointAt(0)! > 0xff)) {
    add(1, 'Archivo', 'XML_NOT_LATIN1', 'El XML contiene caracteres que no pueden representarse en ISO-8859-1.');
  }

  const declaration = /^<\?xml\s+version=["']1\.0["']\s+encoding=["']ISO-8859-1["']\s*\?>/i.exec(content);
  if (!declaration) add(1, 'Declaración XML', 'XML_DECLARATION_ENCODING', 'La declaración XML debe indicar versión 1.0 y codificación ISO-8859-1.');

  const afterDeclaration = declaration ? content.slice(declaration[0].length) : content;
  const rootMatch = /^\s*<RelacionRetencionesISLR\b([^>]*)>([\s\S]*)<\/RelacionRetencionesISLR>\s*$/.exec(afterDeclaration);
  if (!rootMatch) {
    add(1, 'RelacionRetencionesISLR', 'XML_ROOT_INVALID', 'La raíz debe ser RelacionRetencionesISLR y contener su cierre correspondiente.');
    return { isValid: false, rowCount: 0, issues };
  }

  const attributes: Record<string, string> = {};
  const seenAttributes = new Set<string>();
  let duplicateAttribute = false;
  const attributeText = rootMatch[1];
  const attributeRegex = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/g;
  let attributeMatch: RegExpExecArray | null;
  while ((attributeMatch = attributeRegex.exec(attributeText))) {
    if (seenAttributes.has(attributeMatch[1])) duplicateAttribute = true;
    seenAttributes.add(attributeMatch[1]);
    attributes[attributeMatch[1]] = attributeMatch[3];
  }
  if (duplicateAttribute || attributeText.replace(attributeRegex, '').trim() !== '' ||
      Object.keys(attributes).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(attributes, 'RifAgente') ||
      !Object.prototype.hasOwnProperty.call(attributes, 'Periodo')) {
    add(1, 'Atributos raíz', 'XML_ROOT_ATTRIBUTES', 'La raíz debe contener únicamente los atributos obligatorios RifAgente y Periodo.');
  }
  if (!RIF_PATTERN.test(attributes.RifAgente || '')) {
    add(1, 'RifAgente', 'AGENT_RIF_INVALID', 'El RIF del agente debe tener una letra V, E, P, J o G seguida de nueve dígitos.');
  }
  if (!PERIOD_PATTERN.test(attributes.Periodo || '')) {
    add(1, 'Periodo', 'PERIOD_INVALID', 'El período debe tener formato AAAAMM y un mes entre 01 y 12.');
  }

  const body = rootMatch[2];
  const detailRegex = /<DetalleRetencion>([\s\S]*?)<\/DetalleRetencion>/g;
  const details: Array<{ body: string; index: number }> = [];
  let detailMatch: RegExpExecArray | null;
  while ((detailMatch = detailRegex.exec(body))) details.push({ body: detailMatch[1], index: detailMatch.index });
  const remainder = body.replace(detailRegex, '').trim();
  if (remainder) add(lineAt(content, content.indexOf(body) + body.indexOf(remainder)), 'Estructura', 'XML_UNEXPECTED_CONTENT', 'Hay contenido o etiquetas fuera de los elementos DetalleRetencion.');
  if (details.length === 0) add(1, 'DetalleRetencion', 'XML_DETAILS_REQUIRED', 'La declaración mensual debe contener al menos un DetalleRetencion.');

  const expectedFields = [
    'RifRetenido', 'NumeroFactura', 'NumeroControl', 'FechaOperacion',
    'CodigoConcepto', 'MontoOperacion', 'PorcentajeRetencion'
  ];
  details.forEach((detail, index) => {
    const detailLine = lineAt(content, content.indexOf(body) + detail.index);
    const values: Record<string, string> = {};
    let cursor = 0;
    let structureValid = true;
    for (const field of expectedFields) {
      const expression = new RegExp('^\\s*<' + field + '>([\\s\\S]*?)</' + field + '>');
      const match = expression.exec(detail.body.slice(cursor));
      if (!match) {
        structureValid = false;
        add(detailLine, field, 'XML_FIELD_ORDER_OR_MISSING', 'El registro ' + (index + 1) + ' debe contener ' + field + ' en el orden exigido por el esquema SENIAT.');
        break;
      }
      const raw = match[1];
      const decoded = decodeXmlText(raw);
      if (decoded === null) {
        add(detailLine, field, 'XML_FIELD_NOT_WELL_FORMED', 'El campo ' + field + ' contiene etiquetas o entidades XML inválidas.');
      } else {
        values[field] = decoded;
        if (!decoded.length) add(detailLine, field, 'XML_FIELD_EMPTY', 'El campo ' + field + ' es obligatorio.');
      }
      cursor += match[0].length;
    }
    if (!structureValid) return;
    if (detail.body.slice(cursor).trim()) {
      add(detailLine, 'DetalleRetencion', 'XML_EXTRA_FIELDS', 'El registro contiene etiquetas adicionales o datos fuera de orden.');
    }
    const rif = values.RifRetenido || '';
    if (!RIF_PATTERN.test(rif)) add(detailLine, 'RifRetenido', 'SUPPLIER_RIF_INVALID', 'El RIF retenido debe tener una letra V, E, P, J o G seguida de nueve dígitos.');
    const invoice = values.NumeroFactura || '';
    if (!/^[A-Za-z0-9]{1,10}$/.test(invoice)) add(detailLine, 'NumeroFactura', 'INVOICE_NUMBER_INVALID', 'El número de factura debe contener de 1 a 10 caracteres alfanuméricos; use 0 si no existe.');
    const control = values.NumeroControl || '';
    if (!/^(?:NA|na|[A-Za-z0-9]{1,10})$/.test(control)) add(detailLine, 'NumeroControl', 'CONTROL_NUMBER_INVALID', 'El número de control debe tener de 1 a 10 caracteres alfanuméricos o NA si no existe.');
    const date = values.FechaOperacion || '';
    if (!isRealDate(date)) {
      add(detailLine, 'FechaOperacion', 'OPERATION_DATE_INVALID', 'La fecha debe ser real y usar DD/MM/AAAA.');
    } else if (PERIOD_PATTERN.test(attributes.Periodo || '') && date.slice(6, 10) + date.slice(3, 5) !== attributes.Periodo) {
      add(detailLine, 'FechaOperacion', 'OPERATION_DATE_PERIOD_MISMATCH', 'La fecha de la operación debe pertenecer al período declarado.');
    }
    if (!/^[0-9]{3}$/.test(values.CodigoConcepto || '')) add(detailLine, 'CodigoConcepto', 'CONCEPT_CODE_INVALID', 'El código de concepto debe tener exactamente tres dígitos.');
    const amount = values.MontoOperacion || '';
    if (!AMOUNT_PATTERN.test(amount) || !Number.isFinite(Number(amount))) add(detailLine, 'MontoOperacion', 'OPERATION_AMOUNT_INVALID', 'El monto debe ser decimal no negativo, con punto y máximo dos decimales.');
    const rate = values.PorcentajeRetencion || '';
    if (!AMOUNT_PATTERN.test(rate) || !Number.isFinite(Number(rate)) || Number(rate) > 100) {
      add(detailLine, 'PorcentajeRetencion', 'WITHHOLDING_RATE_INVALID', 'El porcentaje debe estar entre 0 y 100, con máximo dos decimales.');
    }
  });

  return { isValid: issues.length === 0, rowCount: details.length, issues };
}
