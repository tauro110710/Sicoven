import { validateVenezuelanRif } from './formatters';

export interface SeniatIvaTxtIssue {
  line: number;
  column?: number;
  field?: string;
  code: string;
  message: string;
}

export interface SeniatIvaTxtValidation {
  isValid: boolean;
  rowCount: number;
  issues: SeniatIvaTxtIssue[];
}

const FIELD_NAMES = [
  'RIF agente', 'Período impositivo', 'Fecha del documento', 'Tipo de operación',
  'Tipo de documento', 'RIF proveedor', 'Número de documento', 'Número de control',
  'Monto total', 'Base imponible', 'IVA retenido', 'Documento afectado',
  'Comprobante de retención', 'Monto exento', 'Alícuota', 'Expediente'
];

const MAX_LENGTHS = [10, 6, 10, 1, 2, 10, 20, 20, 15, 15, 15, 20, 14, 15, 5, 15];
const NUMERIC_COLUMNS = [8, 9, 10, 13, 14];
const SENIAT_DECIMAL_PATTERN = /^\\d+\\.\\d{2}$/;
const roundToTwo = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Valida la estructura del TXT de Retenciones IVA antes de permitir su descarga.
 * Comprueba el contrato de 16 campos/tabuladores y las reglas locales documentadas.
 * No consulta el Portal Fiscal ni acredita aceptación tributaria.
 */
export function validateSeniatIvaTxt(content: string): SeniatIvaTxtValidation {
  const issues: SeniatIvaTxtIssue[] = [];
  const add = (line: number, code: string, message: string, column?: number) => {
    issues.push({
      line,
      ...(column === undefined ? {} : { column, field: FIELD_NAMES[column - 1] }),
      code,
      message
    });
  };

  if (typeof content !== 'string' || content.length === 0) {
    add(1, 'EMPTY_FILE', 'El archivo está vacío; no hay registros que validar.');
    return { isValid: false, rowCount: 0, issues };
  }
  if (content.charCodeAt(0) === 0xFEFF) {
    add(1, 'BOM_NOT_ALLOWED', 'El archivo no debe comenzar con una marca BOM.');
  }
  if (content.includes('\u0000')) {
    add(1, 'NUL_CHARACTER', 'El archivo contiene caracteres NUL no permitidos.');
  }
  if (content.endsWith('\n') || content.endsWith('\r')) {
    add(1, 'TRAILING_NEWLINE', 'El archivo no debe terminar con una línea vacía.');
  }
  const withoutCrLf = content.replace(/\r\n/g, '');
  if (withoutCrLf.includes('\n') || withoutCrLf.includes('\r')) {
    add(1, 'INVALID_LINE_ENDING', 'Las filas deben separarse con CRLF (\r\n), sin saltos aislados.');
  }

  const rows = content.split('\r\n');
  if (rows.some(row => row.length === 0)) {
    const emptyIndex = rows.findIndex(row => row.length === 0);
    add(emptyIndex + 1, 'EMPTY_ROW', 'El archivo contiene una fila vacía.');
  }

  let expectedAgentRif = '';
  let expectedPeriod = '';
  const voucherNumbers = new Set<string>();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 1;
    if (!row) return;
    const fields = row.split('\t');
    if (fields.length !== 16) {
      add(line, 'FIELD_COUNT', `La fila contiene ${fields.length} campos; debe contener exactamente 16 separados por tabulaciones.`);
      return;
    }

    fields.forEach((value, index) => {
      const column = index + 1;
      if (value.length === 0 || value.trim().length === 0) {
        add(line, 'EMPTY_FIELD', 'El campo no puede estar vacío; use 0 cuando el dato no aplique.', column);
        return;
      }
      if (value !== value.trim()) {
        add(line, 'SURROUNDING_WHITESPACE', 'El campo contiene espacios al inicio o al final.', column);
      }
      if (value.length > MAX_LENGTHS[index]) {
        add(line, 'FIELD_TOO_LONG', `El campo supera la longitud máxima de ${MAX_LENGTHS[index]} caracteres.`, column);
      }
      if (/[\r\n\u0000]/.test(value)) {
        add(line, 'CONTROL_CHARACTER', 'El campo contiene caracteres de control no permitidos.', column);
      }
    });

    const [agentRif, period, documentDate, operation, documentType, supplierRif,
      documentNumber, controlNumber, total, base, withheld, affectedDocument,
      voucherNumber, exempt, rate, expedition] = fields;

    if (!validateVenezuelanRif(agentRif).isValid) {
      add(line, 'INVALID_AGENT_RIF', 'El RIF del agente no tiene una estructura válida.', 1);
    }
    if (!/^\d{6}$/.test(period) || !/^(0[1-9]|1[0-2])$/.test(period.slice(4, 6))) {
      add(line, 'INVALID_PERIOD', 'El período debe tener formato AAAAMM y un mes entre 01 y 12.', 2);
    }
    if (!isValidIsoDate(documentDate)) {
      add(line, 'INVALID_DATE', 'La fecha debe ser una fecha real con formato AAAA-MM-DD.', 3);
    } else if (/^\d{6}$/.test(period) && documentDate.slice(0, 7).replace('-', '') > period) {
      add(line, 'DATE_AFTER_PERIOD', 'La fecha del documento no puede ser posterior al período declarado.', 3);
    }
    if (!['C', 'V'].includes(operation)) {
      add(line, 'INVALID_OPERATION', 'El tipo de operación debe ser C (compra) o V (venta).', 4);
    }
    if (!['01', '02', '03'].includes(documentType)) {
      add(line, 'INVALID_DOCUMENT_TYPE', 'El tipo de documento debe ser 01, 02 o 03.', 5);
    }
    if (supplierRif !== '0' && !validateVenezuelanRif(supplierRif).isValid) {
      add(line, 'INVALID_SUPPLIER_RIF', 'El RIF del proveedor no tiene una estructura válida.', 6);
    }
    if (!documentNumber) add(line, 'MISSING_DOCUMENT_NUMBER', 'Falta el número del documento.', 7);
    if (!controlNumber) add(line, 'MISSING_CONTROL_NUMBER', 'Falta el número de control.', 8);

    NUMERIC_COLUMNS.forEach(index => {
      if (!SENIAT_DECIMAL_PATTERN.test(fields[index])) {
        add(line, 'INVALID_NUMERIC_FORMAT', 'El campo debe ser numérico con punto decimal y exactamente dos cifras decimales, sin separadores de miles.', index + 1);
      }
    });
    // El TXT no incluye retentionRate; para RIF 0 se exige retención del 100%
    // del IVA calculado, conservando dos decimales como en el esquema SENIAT.
    if (supplierRif === '0' && SENIAT_DECIMAL_PATTERN.test(base) && SENIAT_DECIMAL_PATTERN.test(withheld) && SENIAT_DECIMAL_PATTERN.test(rate)) {
      const expectedFullWithholding = roundToTwo(Number(base) * Number(rate) / 100);
      if (Number(withheld) !== expectedFullWithholding) {
        add(line, 'SUPPLIER_RIF_ZERO_REQUIRES_FULL_WITHHOLDING', 'El RIF proveedor 0 solo se admite cuando el IVA retenido equivale al 100% del IVA calculado sobre la base y alícuota exportadas.', 6);
      }
    }
    if (SENIAT_DECIMAL_PATTERN.test(total) && SENIAT_DECIMAL_PATTERN.test(base) && SENIAT_DECIMAL_PATTERN.test(exempt) && Number(total) < Number(base) + Number(exempt)) {
      add(line, 'TOTAL_BELOW_BASES', 'El monto total no puede ser inferior a la suma de la base imponible y el monto exento.', 9);
    }
    if (SENIAT_DECIMAL_PATTERN.test(rate) && Number(rate) > 100) {
      add(line, 'INVALID_TAX_RATE', 'La alícuota no puede superar el 100%.', 15);
    }
    if (documentType === '01' && affectedDocument !== '0') {
      add(line, 'UNEXPECTED_AFFECTED_DOCUMENT', 'Las facturas deben indicar 0 en el documento afectado.', 12);
    }
    if (['02', '03'].includes(documentType) && (!affectedDocument || affectedDocument === '0')) {
      add(line, 'MISSING_AFFECTED_DOCUMENT', 'Las notas de débito y crédito deben identificar el documento afectado.', 12);
    }
    if (!/^\d{14}$/.test(voucherNumber)) {
      add(line, 'INVALID_VOUCHER_NUMBER', 'El número de comprobante debe tener exactamente 14 dígitos.', 13);
    } else {
      if (/^\d{6}$/.test(period) && voucherNumber.slice(0, 6) !== period) {
        add(line, 'VOUCHER_PERIOD_MISMATCH', 'Los primeros seis dígitos del comprobante deben coincidir con el período.', 13);
      }
      if (voucherNumbers.has(voucherNumber)) {
        add(line, 'DUPLICATE_VOUCHER_NUMBER', 'El número de comprobante está repetido en el archivo.', 13);
      }
      voucherNumbers.add(voucherNumber);
    }
    if (expectedAgentRif && agentRif !== expectedAgentRif) {
      add(line, 'MIXED_AGENT_RIF', 'Todas las filas del archivo deben corresponder al mismo agente de retención.', 1);
    } else if (!expectedAgentRif) expectedAgentRif = agentRif;
    if (expectedPeriod && period !== expectedPeriod) {
      add(line, 'MIXED_PERIODS', 'El archivo no puede mezclar períodos impositivos.', 2);
    } else if (!expectedPeriod) expectedPeriod = period;
    // La columna P se conserva como texto: el expediente puede contener letras/números.
    if (!expedition) add(line, 'MISSING_EXPEDITION_VALUE', 'Indique 0 cuando no exista expediente.', 16);
  });

  return { isValid: issues.length === 0, rowCount: rows.filter(row => row.length > 0).length, issues };
}
