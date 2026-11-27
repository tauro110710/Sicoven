/**
 * Asistente guiado de errores de entrada.
 *
 * Centraliza la lectura de los mensajes que ya emiten los validadores
 * (purchaseAmountValidation, motor fiscal, integridad de SQLite, contexto
 * contable) y devuelve:
 *  - el campo que el contador debe corregir, para resaltarlo,
 *  - una instrucción corta que le dice qué hacer sin salir del formulario.
 *
 * No crea mensajes nuevos ni reemplaza los existentes: solo los clasifica.
 * El orden de las reglas importa: los diagnósticos más específicos se evalúan
 * antes que los genéricos, porque un mismo texto puede mencionar varios temas.
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

/** Formato de importes aceptado en los campos numéricos de SICOVEN. */
const AMOUNT_FORMAT =
  'Escribe el importe con dos decimales y sin símbolo de moneda (por ejemplo 113014,00 o 113014.00). No uses separadores de miles ni el símbolo Bs.';

export const classifyGuidedEntryError = (message: string): GuidedEntryError => {
  const text = String(message || '');

  // 1. Alícuota: solo se admiten las tasas del motor fiscal.
  if (has(text, /al[ií]cuota/i)) {
    return {
      field: 'taxRate',
      hint: 'Seleccione una alícuota admitida: 0 %, 8 %, 16 % o 31 % (16 % IVA + 15 % suntuario).'
    };
  }

  // 2. Kardex: la entrada y la línea de la factura deben ser idénticas.
  if (has(text, /kardex/i)) {
    return {
      field: 'inventory',
      hint:
        'El Kardex no coincide con la línea de la factura. Verifica que el artículo sea el mismo, que la cantidad sea idéntica, que el costo unitario sea exactamente el precio de esa línea, que la fecha del movimiento sea la fecha de la factura, que el RIF del proveedor esté completo y que la tasa BCV sea la de la factura. Corrige la línea de inventario y vuelve a guardar.'
    };
  }

  // 3. Datos del documento, con el formato legal de cada uno.
  if (has(text, /rif/i) && has(text, /formato|inv[aá]lid|estructura|prefijo|d[ií]gitos|no cumple/i)) {
    return {
      field: 'document',
      hint:
        'El RIF no cumple el formato legal. Debe empezar por V, J, G, E o P y continuar con 8 o 9 dígitos, por ejemplo J-12345678-9. Corrígelo sin puntos, espacios ni caracteres adicionales.'
    };
  }
  if (has(text, /n[uú]mero de control|numero de control/i)) {
    return {
      field: 'document',
      hint:
        'El número de control impreso en la factura es obligatorio y debe coincidir con el documento físico. Escríbelo tal como aparece, sin guiones adicionales ni espacios.'
    };
  }
  if (has(text, /n[uú]mero de factura|numero de factura/i)) {
    return {
      field: 'document',
      hint:
        'El número de factura debe estar completo y ser único para ese proveedor y tipo de documento. Verifica que no exista otra compra registrada con el mismo número.'
    };
  }
  if (has(text, /tasa bcv/i) || has(text, /\bbcv\b/i)) {
    return {
      field: 'bcvRate',
      hint:
        'Corrija la tasa BCV de la fecha de la factura y vuelva a guardar. Debe ser la tasa oficial de esa fecha, con sus decimales; SICOVEN no inventa una tasa de respaldo.'
    };
  }
  if (has(text, /fecha/i) && has(text, /anterior|no v[aá]lid|inv[aá]lid|per[ií]odo|inicio contable|posterior/i)) {
    return {
      field: 'document',
      hint:
        'La fecha de la factura debe ser válida, no anterior al inicio contable de la empresa y no anterior al último movimiento de Kardex del artículo. Corrige la fecha y vuelve a guardar.'
    };
  }

  // 4. Importes: costo, IVA, IGTF, retenciones y saldo de proveedor.
  if (has(text, /no reconoce en bs\.?\s*y usd|no concilia en bs|no coincide en bs\.?\s*y usd/i)) {
    return {
      field: 'amounts',
      hint:
        'El asiento y la factura no concilian en bolívares y en dólares. Revisa base imponible, exento, IVA, IGTF, retenciones de IVA e ISLR y el neto al proveedor: cada importe debe cuadrar con el total usando la misma tasa BCV. ' +
        AMOUNT_FORMAT
    };
  }
  if (has(text, /base imponible|importe|monto|exento|igtf|retenci[oó]n|suntuario/i) && has(text, /inv[aá]lid|no cuadra|no coincide|super|excede|mayor|menor|formato|revis/i)) {
    return {
      field: 'amounts',
      hint:
        'Revisa los importes fiscales: base imponible + exento + IVA + suntuario + IGTF debe dar el total de la factura, y las retenciones no pueden superar ese total. ' +
        AMOUNT_FORMAT
    };
  }
  if (has(text, /importe|monto|total|base imponible|exento/i)) {
    return {
      field: 'amounts',
      hint: 'Revise los importes marcados: base imponible, exento, IVA, IGTF y retenciones deben ser coherentes con el total. ' + AMOUNT_FORMAT
    };
  }

  // 5. Cuentas contables y de movimiento.
  if (has(text, /cuenta/i)) {
    return {
      field: 'accounts',
      hint:
        'Seleccione cuentas imputables y de movimiento del Plan de Cuentas: la cuenta de inventario o de gasto, la cuenta de Caja/Banco del pago al contado y su comprobante de pago.'
    };
  }

  // 6. Inventario y costos en general.
  if (has(text, /inventario|art[ií]culo|existencia|cantidad|costo|precio/i)) {
    return {
      field: 'inventory',
      hint:
        'Revise las líneas de inventario: artículo existente sin repetir, cantidad mayor que cero y costo unitario mayor que cero. La suma de las líneas debe coincidir con la base imponible más el monto exento.'
    };
  }

  // 7. Asiento contable que no reconoce la factura.
  if (has(text, /asiento|factura de compra|retenciones.*cxp|costo.*iva.*igtf/i)) {
    return {
      field: 'purchaseInvoice',
      hint:
        'El asiento contable no concilia con la factura. Corrija en la compra: base imponible y cálculo de IVA, IGTF, retenciones y saldo de proveedor, en bolívares y en dólares.'
    };
  }

  // 8. Falla real de la base local: es la única que bloquea las operaciones.
  // Los rechazos de dominio («SQLite rechazó …») nunca indican un archivo caído.
  if (!has(text, /SQLite rechazó|SQLite rechazo/i) &&
      has(text, /no se pudo abrir la base de datos local|permisos de escritura|base de datos local|sqlite|escritorio|persistencia|ipc|disco|bloquead/i)) {
    return {
      field: 'storage',
      hint:
        'La base local no está disponible. Reintente cuando SQLite esté listo; no se registró ningún dato parcial de esta compra.'
    };
  }

  // 9. Documento incompleto.
  if (has(text, /factura|documento|proveedor|raz[oó]n social|rif/i)) {
    return {
      field: 'document',
      hint: 'Complete los datos del documento (proveedor, RIF, número de factura, número de control y fecha) y vuelva a guardar.'
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
