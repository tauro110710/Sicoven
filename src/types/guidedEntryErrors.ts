/**
 * Asistente guiado de errores de entrada.
 *
 * Centraliza la lectura de los mensajes que ya emiten los validadores
 * (purchaseAmountValidation, motor fiscal, contexto contable) y devuelve:
 *  - el campo que el contador debe corregir, para resaltarlo,
 *  - una instrucción corta que le dice qué hacer sin salir del formulario.
 *
 * No crea mensajes nuevos ni reemplaza los existentes: solo los clasifica.
 */

export type GuidedEntryField =
  | 'taxRate'
  | 'bcvRate'
  | 'amounts'
  | 'inventory'
  | 'document'
  | 'accounts'
  | 'purchaseInvoice'
  | 'storage'
  | 'unknown';

export type GuidedEntryError = {
  field: GuidedEntryField;
  hint: string;
};

const has = (message: string, pattern: RegExp) => pattern.test(message);

export const classifyGuidedEntryError = (message: string): GuidedEntryError => {
  const text = String(message || '');
  if (has(text, /al[ií]cuota/i)) {
    return {
      field: 'taxRate',
      hint: 'Seleccione una alícuota admitida: 0 %, 8 %, 16 % o 31 % (16 % IVA + 15 % suntuario).'
    };
  }
  if (has(text, /tasa bcv/i) || has(text, /\bbcV\b/i)) {
    return {
      field: 'bcvRate',
      hint: 'Corrija la tasa BCV de la fecha del documento y vuelva a guardar. No se inventa una tasa de respaldo.'
    };
  }
  if (has(text, /importe|monto|total|base imponible|exento/i)) {
    return {
      field: 'amounts',
      hint: 'Revise los importes marcados: base imponible, exento, IVA, IGTF y retenciones deben ser coherentes con el total.'
    };
  }
  if (has(text, /cuenta/i)) {
    return {
      field: 'accounts',
      hint: 'Seleccione cuentas de movimiento válidas del Plan de Cuentas para este documento.'
    };
  }
  if (has(text, /inventario|kardex|art[ií]culo|existencia|costo/i)) {
    return {
      field: 'inventory',
      hint: 'Revise las líneas de inventario: artículo, cantidad, costo y fecha deben ser válidos y conciliar con la base imponible.'
    };
  }
  if (has(text, /sqlite|escritorio|persistencia/i)) {
    return {
      field: 'storage',
      hint: 'La base local no está disponible. Reintente cuando SQLite esté listo; no se registró ningún dato parcial.'
    };
  }
  if (has(text, /asiento|factura de compra|concili|retenciones.*CxP|costo.*IVA.*IGTF/i)) {
    return {
      field: 'purchaseInvoice',
      hint: 'El asiento contable no concilia con la factura. Corrija en la compra: base imponible y cálculo de IVA, IGTF, retenciones y saldo de proveedor en Bs. y USD.'
    };
  }
  if (has(text, /SQLException|rechaz[aó]|SQLite|integridad|no reconoce|no concilia|error al guardar|no se pudo guardar/i)) {
    return {
      field: 'purchaseInvoice',
      hint: 'El asiento no reconoce los importes de la factura. Corrige en la compra: base imponible, IVA, IGTF, retenciones, CxP, tasa BCV y los montos en Bs. y USD.'
    };
  }
  if (has(text, /sqlite|escritorio|persistencia/i)) {
    return {
      field: 'storage',
      hint: 'La base local no está disponible. Reintente cuando SQLite esté listo; no se registró ningún dato parcial.'
    };
  }
  if (has(text, /factura|documento|n[uú]mero de control|rif|fecha/i)) {
    return {
      field: 'document',
      hint: 'Complete los datos del documento (número, control, RIF y fecha) y vuelva a guardar.'
    };
  }
  return {
    field: 'unknown',
    hint: 'Revise los datos señalados y vuelva a guardar. El formulario conserva lo que ya cargó.'
  };
};

/** Títulos por flujo de entrada, para que el aviso nombre la operación exacta. */
export const GUIDED_ENTRY_TITLES = {
  purchase: 'No se pudo registrar la compra',
  sale: 'No se pudo registrar la venta',
  purchaseCreditNote: 'No se pudo registrar la nota de crédito de compras',
  purchaseServiceCreditNote: 'No se pudo registrar la nota de crédito de servicios',
  supplierDebitNote: 'No se pudo registrar la nota de débito al proveedor',
  saleCorrectionNote: 'No se pudo registrar la nota de crédito de ventas',
  import: 'No se pudo completar la importación'
} as const;
