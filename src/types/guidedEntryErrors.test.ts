import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGuidedEntryError, GUIDED_ENTRY_TITLES } from './guidedEntryErrors';

test('asistente guiado: clasifica la alícuota no admitida de compras, ventas y motor fiscal', () => {
  const messages = [
    'La alícuota de IVA no está admitida: SICOVEN solo acepta 0 %, 8 %, 16 % y 31 % (16 % IVA + 15 % suntuario).',
    'La alícuota fiscal 27 % no está admitida. SICOVEN solo acepta 0 %, 8 %, 16 % y 31 % (16 % IVA + 15 % impuesto suntuario).',
    'La alícuota de IVA de la venta no está admitida: SICOVEN solo acepta 0 %, 8 %, 16 % y 31 % (16 % IVA + 15 % suntuario).'
  ];
  for (const message of messages) {
    const guided = classifyGuidedEntryError(message);
    assert.equal(guided.field, 'taxRate', message);
    assert.match(guided.hint, /0 %, 8 %, 16 % o 31 %/);
  }
});

test('asistente guiado: tasa BCV, importes, inventario, cuentas, SQLite y documento', () => {
  assert.equal(classifyGuidedEntryError('La tasa BCV es obligatoria para ventas desde el 01/01/2018.').field, 'bcvRate');
  assert.equal(classifyGuidedEntryError('El total de la factura debe ser un importe válido mayor que cero.').field, 'amounts');
  assert.equal(classifyGuidedEntryError('Las líneas deben usar artículos existentes, cantidades y costos válidos, sin repetir artículos.').field, 'inventory');
  assert.equal(classifyGuidedEntryError('Cuentas contables inválidas para el artículo A-001.').field, 'accounts');
  assert.equal(classifyGuidedEntryError('La edición de escritorio requiere SQLite local disponible y lista. No se registró la venta.').field, 'storage');
  assert.equal(classifyGuidedEntryError('La venta requiere fecha válida, número de factura y nombre del cliente.').field, 'document');
});

test('asistente guiado: un mensaje desconocido igual recibe instrucción de reintento', () => {
  const guided = classifyGuidedEntryError('Ocurrió un problema inesperado.');
  assert.equal(guided.field, 'unknown');
  assert.match(guided.hint, /vuelva a guardar/i);
});

// El asistente guiado debe señalar el campo exacto que el contador corrige en el
// formulario de compras, sin cerrar la pantalla ni bloquear la base local.

test('el rechazo de Kardex señala la línea de inventario, no la base de datos', () => {
  const result = classifyGuidedEntryError(
    'SQLite rechazó la compra: una entrada de Kardex no coincide en fecha, proveedor, tasa BCV, cantidad o costo con su línea de factura.'
  );
  assert.equal(result.field, 'inventory');
  assert.match(result.hint, /costo unitario/i);
  assert.match(result.hint, /tasa BCV/i);
});

test('el rechazo de la factura en Bs. y USD señala los importes', () => {
  const result = classifyGuidedEntryError(
    'SQLite rechazó la compra: el asiento no reconoce en Bs. y USD el costo, IVA, IGTF, retenciones y CxP de la factura.'
  );
  assert.equal(result.field, 'amounts');
  assert.match(result.hint, /dos decimales/i);
});

test('un RIF con formato inválido señala el documento con el formato legal', () => {
  const result = classifyGuidedEntryError('El RIF no cumple con el formato legal de 8 o 9 dígitos.');
  assert.equal(result.field, 'document');
  assert.match(result.hint, /J-12345678-9/);
});

test('una base local inaccesible es el único caso que se informa como almacenamiento', () => {
  const result = classifyGuidedEntryError('No se pudo abrir la base de datos local: permisos de escritura.');
  assert.equal(result.field, 'storage');
});

test('el asiento que no concilia la factura se marca como factura de compra', () => {
  const result = classifyGuidedEntryError('El asiento contable no concilia con la factura de compra.');
  assert.equal(result.field, 'purchaseInvoice');
});

test('el título del flujo de compras nombra la operación que falló', () => {
  assert.equal(GUIDED_ENTRY_TITLES.purchase, 'No se pudo registrar la compra');
});
