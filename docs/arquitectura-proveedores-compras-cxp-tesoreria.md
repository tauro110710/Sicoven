# Arquitectura integrada de proveedores, compras, CxP y tesorería

**Estado:** directiva de diseño para implementación y auditoría en SICOVEN.  
**Alcance:** registro maestro de proveedores, origen de compras, cuentas por pagar y aplicación de pagos. No autoriza cambios en `main`, fusión del PR ni publicación.

## Principios

1. **Una sola operación fuente:** la compra es el evento origen de la obligación; CxP no duplica ni vuelve a registrar la factura.
2. **Proveedor centralizado, registro oportuno:** existe un maestro de proveedores con identificación fiscal, nombre legal, contactos y estado activo/inactivo. El usuario puede seleccionar uno existente o crear uno desde la compra. No se exige navegar previamente al módulo Proveedores.
3. **Persistencia atómica:** registrar una compra y sus efectos vinculados (asiento, movimientos de inventario/Kardex cuando aplique, documento CxP y relación proveedor) debe ser una transacción indivisible. Si falla una validación, se revierte todo.
4. **Cuentas por pagar automáticas:** compra a crédito genera saldo de CxP por la porción pendiente. Compra de contado genera compra y pago vinculados; no queda saldo abierto.
5. **Pagos trazables:** pagos parciales/totales se registran en Tesorería y se aplican a facturas seleccionadas, conservando fecha, moneda, tasa aplicable, cuenta de caja/banco, referencia, soporte y distribución. Nunca sobrescribir ni eliminar el historial.
6. **Estado de cuenta proveedor:** consolidar facturas, notas de crédito/débito válidas, anticipos, aplicaciones, pagos, reversos y saldos por fecha; permitir consulta de documentos y asiento origen.
7. **Control de saldos:** no permitir aplicar pagos o créditos por encima del saldo disponible, salvo que la operación se registre explícitamente como anticipo o saldo a favor, con su tipo y trazabilidad.
8. **Notas de crédito y débito:** deben vincularse al comprobante afectado cuando corresponda, respetar requisitos fiscales, validar los asientos y afectar CxP/Kardex/retenciones según naturaleza y fecha; no se relajarán controles para pasar tests.
9. **Histórico monetario:** cada compra, obligación y pago conserva fecha efectiva y valores originales. Las validaciones monetarias aplican la escala y política correspondiente a la fecha, sin exigir USD como base de cuadre para operaciones anteriores al inicio de la dualidad definido por SICOVEN.
10. **Inmutabilidad y auditoría:** correcciones mediante reversos/ajustes documentados. El maestro de proveedores puede editarse o desactivarse con restricciones; documentos históricos preservan su snapshot de identificación para evitar cambios retroactivos por editar la ficha.

## Flujo

- **Compra:** seleccionar proveedor o crear ficha inline → registrar factura, fecha, términos, moneda/tasa, impuestos/retenciones, líneas y cuentas → prevalidar → guardar atómicamente.
- **Contado:** asiento y compra vinculados, pago aplicado en la misma transacción y saldo CxP cero.
- **Crédito:** asiento y compra vinculados; documento CxP automático por monto neto pendiente.
- **Abono:** Tesorería registra pago → aplica distribución a una o varias facturas del mismo proveedor → recalcula saldo → asiento y audit trail vinculados.
- **Anticipo:** registrar desembolso como anticipo al proveedor (no como factura ni como pago aplicado), luego imputarlo a compras o documentar reembolso.
- **Consulta:** módulo CxP ofrece pendientes, vencimientos, pagos, anticipos y estado de cuenta; no crea obligaciones manuales duplicadas a partir de una factura ya registrada.

## Criterios de aceptación

- Alta inline de proveedor y selección de proveedor existente desde Compras.
- Detección de duplicidad por identificador fiscal, con revisión antes de crear.
- Compra a crédito crea automáticamente la obligación y la vinculación al asiento.
- Compra de contado queda totalmente pagada y no duplica movimientos de caja/banco.
- Pagos parciales, pagos totales, distribución a varias facturas, anticipos, aplicación de anticipo y reembolso.
- Estado de cuenta, saldos pendientes y vencimientos consistentes con documentos fuente.
- Transacciones atómicas y persistencia SQLite; pruebas de rollback y concurrencia.
- Importación/restauración no puede eludir las mismas validaciones de integridad.
- No regresiones en validación fiscal, retenciones, notas de crédito/débito, Kardex ni coherencia monetaria histórica.

## Plan de implementación

1. Auditar modelo, IPC, persistencia, pantallas y tests actuales; identificar qué ya existe y evitar duplicarlo.
2. Definir/ajustar modelo de proveedor y migración segura de datos.
3. Integrar alta/selección inline en compras.
4. Garantizar generación/conciliación automática de CxP desde compras.
5. Unificar pagos y aplicaciones con Tesorería/CxP.
6. Implementar estados de cuenta y consultas de saldos.
7. Añadir pruebas unitarias, integración SQLite, rollback, importación y concurrencia.
8. Ejecutar CI y build Windows; revisar los cuatro fallos contables preexistentes y mantenerlos como pendientes hasta que se resuelvan y pasen.


## Auditoría de implementación existente (23-11-2026)

- El tipo `Supplier` y el estado `suppliers` existen en `src/types/accounting.ts` y `src/context/AccountingContext.tsx`; también existen `addSupplier` e `importSuppliers`, con validación de identificación fiscal y empresa.
- La compra (`addPurchase`) actualmente conserva `supplierRif`, `supplierName` y snapshot de proveedor en los comprobantes de retención; sin embargo, no se observa una vinculación por `supplierId` en el registro de compra, ni la creación/actualización automática del maestro dentro del flujo.
- `CuentasPorPagarView` construye su lista de proveedores desde compras activas y anticipos directos, agrupando por RIF. Por eso el flujo actual puede mostrar proveedores para pagos/anticipos sin que el maestro de proveedores sea la fuente de esa lista.
- `CreditSettlementModal` permite aplicar pagos a una factura/documento individual. La integración a nivel de estado de cuenta de proveedor y distribución de un pago entre varias facturas requiere revisión adicional antes de implementarse.
- No se ha implementado todavía la alta/selección inline en el modal de compras. Tampoco se ha probado una operación transaccional que incluya compra, maestro, asiento, Kardex y pagos.

## Estado de implementación

Esta directiva es diseño y auditoría, no evidencia de que todas sus funcionalidades estén desarrolladas. Los siguientes trabajos deben implementarse y probarse por separado: (1) alta/selección inline del proveedor con deduplicación por RIF, (2) asociación estable por `supplierId` conservando snapshots históricos, (3) revisión y unificación de CxP y pagos con distribución segura, (4) estado de cuenta por proveedor, (5) pruebas SQLite de atomicidad, rollback, importación y reconstrucción cronológica. No relajar validaciones contables ni fiscales.

## Auditoría adicional: reconstrucción de inventario PEPS (23-11-2026)

- El replay histórico cronológico tiene guardas explícitas: rechaza devoluciones de proveedor que requerirían el flujo atómico de nota de crédito/CxP y bloquea devoluciones de clientes bajo PEPS cuando no se conserva la capa consumida. No se deben retirar esas guardas como solución rápida.
- El motor reconstruye capas PEPS a partir del historial, pero el detalle de las capas consumidas en cada venta no queda materializado en la salida del replay; el test existente confirma que la devolución PEPS de cliente se rechaza en lugar de estimar un costo.
- Se debe investigar y probar un flujo seguro para devolución de cliente PEPS que reconstruya las capas al momento de la venta y revierta exactamente las capas afectadas, respetando devoluciones acumuladas, cronología y persistencia.
- La revisión de código posterior confirma una inconsistencia de escala en el replay de costos Bs. cuando los movimientos abarcan reconversiones. Evidencia y alcance quedan detallados en la sección siguiente; todavía falta cuantificar el impacto con pruebas y definir la política de valoración antes de corregir.
- Próximas verificaciones: escenarios de inventario antes/después de cada reconversión; promedio ponderado y PEPS; entrada con costos aterrizados; devolución de venta y proveedor; ajuste; ventas que cruzan capas; conciliación de cantidad y valorización contra el Kardex fuente.


## Auditoría adicional: costos Bs. entre reconversiones — evidencia de código (23-11-2026)

La revisión directa de `src/types/historicalInventoryReplay.ts` confirma que el replay combina importes Bs. de distintas fechas sin conversión entre escalas en los pasos de valoración:

- Entrada de mercancía: el costo Bs. solicitado, incluyendo costos aterrizados por unidad, se incorpora al promedio ponderado y al valor de las capas PEPS; los costos Bs. anteriores se suman directamente.
- Salida bajo promedio ponderado: se usa el promedio Bs. acumulado como costo de salida.
- Devolución de cliente bajo promedio ponderado: la entrada toma `unitCostBs` de la venta original, directamente, y lo incorpora al promedio actual; si venta y devolución están separadas por reconversiones, ambas escalas pueden no ser comparables.
- Ajustes positivos bajo promedio ponderado: se incorpora el costo Bs. del ajuste a los saldos Bs. acumulados.
- PEPS: el replay calcula capas, consumo y valoración de saldo usando costos Bs. de movimientos, sin conversión monetaria por fecha.

Esta evidencia confirma una **inconsistencia algorítmica potencial cuando el historial cruza reconversiones**; aún debe comprobarse la magnitud e impacto mediante casos de prueba, y definir si las salidas deben conservar costo Bs. nominal por fecha o expresar costo/valor de capas en una escala contable de referencia. No modificar el origen documental ni normalizar USD por este mismo procedimiento. La solución debe conservar trazabilidad de costos originales, tasa y fecha, y separar el costo nominal del valor comparable. Antes de corregir, crear tests de promedio y PEPS que atraviesen cada reconversión y prueben devolución, ajuste, landed costs y costo de ventas.


## Verificación de integración del replay histórico de inventario (23-11-2026)

- Se inspeccionó el `AccountingContext.tsx` completo a través de su fuente GitHub: importa `prepareProductsForHistoricalReconstruction`, pero no importa ni invoca `replayHistoricalInventory`.
- El panel `HistoricalAccountingReplayPanel.tsx` ejecuta `prepareHistoricalAccountingReplayPlan`, un plan de lectura de dependencias contables; no ejecuta el replay del Kardex.
- La preparación de artículos es restrictiva y protege contra datos existentes: requiere existencia cero, ningún movimiento, compras, ventas o asientos de inventario, y registra auditoría. No debe usarse para borrar o reemplazar historia.
- Conclusión: `replayHistoricalInventory` es un módulo aislado con pruebas unitarias, no una reconstrucción operativa integrada a SQLite/contabilidad. Los hallazgos de escala en ese módulo deben tratarse como defectos de su algoritmo aislado, pero su impacto en flujo real aún requiere rastrear todos los usos/importaciones y definir la integración autorizada.
- No se debe promover una reconstrucción transaccional a producción: faltan coordinación de persistencia, generación/revisión de asientos, controles de cierres, reversión/rollback y validación de dependencia entre documentos.
