import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGuidedEntryError } from './guidedEntryErrors';

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
