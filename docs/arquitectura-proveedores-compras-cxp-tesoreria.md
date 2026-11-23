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


## Auditoría del flujo operativo de costos de inventario entre reconversiones (23-11-2026)

Esta comprobación amplía la revisión del replay aislado y rastrea también funciones operativas del `AccountingContext.tsx`:

- Las compras operativas calculan el costo Bs. de entrada (incluidos costos aterrizados) y llaman a `calculateWeightedAverageCostDual`, que suma `existingQuantity × existingUnitCostBs` con `incomingQuantity × incomingUnitCostBs`. No realiza conversión por fecha ni escala monetaria en ese helper.
- El flujo operativo de venta consume el costo promedio Bs. almacenado o capas PEPS reconstruidas de movimientos; la tasa de la venta no reexpresa el costo Bs. del inventario existente. El comentario de código explícitamente preserva la valoración USD histórica.
- La reconstrucción de capas PEPS ordena movimientos por fecha y consume cantidades, pero los valores unitarios Bs./USD se toman de cada movimiento y no se convierten por reconversión dentro de esa función.
- La importación de movimientos permite cargar historial de fechas pasadas; debe verificarse la validación de orden/escala y la conciliación contra saldos antes de considerar segura su entrada a operaciones.

**Riesgo operativo confirmado:** el promedio Bs. operativo puede combinar costos nominales de entradas que pertenezcan a escalas monetarias distintas. En PEPS, el valor Bs. de capas históricas también puede sumar importes nominales de escalas diferentes. Esto no es sólo un defecto del replay aislado: los helpers de costeo usados por operaciones normales no aplican conversión de escala por fecha. La magnitud del impacto depende de fechas, movimientos y política de valoración, por lo que no se propone conversión automática aún.

**Acción técnica requerida antes de corregir:** diseñar un modelo explícito que preserve costos originales Bs., fecha y tasa BCV de cada movimiento; determine la escala contable de comparación para cada período; reexpresar valores Bs. de capas/saldos/costo de venta cuando proceda sin alterar USD históricos; y garantizar que importación, compras, ajustes, devoluciones, producción, venta, Kardex, journals y reportes compartan la misma política. Crear tests cronológicos con movimientos a ambos lados de cada reconversión y conciliaciones de cantidad, costo Bs. comparable, USD y asientos. No alterar los controles de períodos cerrados ni las regresiones contables existentes.


## Seguimiento: producción y entrada histórica de Kardex (23-11-2026)

Se rastreó el flujo operativo de `executeProduction` en `AccountingContext.tsx`:

- La producción consume componentes mediante promedio ponderado o capas PEPS, toma `avgCostBs/avgCostUsd` o los valores Bs/USD de las capas reconstruidas, y registra salidas y entrada del producto terminado.
- El costo de producción Bs. se calcula sumando los costos Bs. de los componentes. El costo unitario del producto terminado se incorpora al promedio dual existente usando `calculateWeightedAverageCostDual`.
- La función valida fecha, inicio contable, tasa requerida según período, stock disponible, referencia única y orden cronológico contra los movimientos existentes. Estos controles deben preservarse.
- La revisión no encontró una conversión de escala monetaria por reconversión dentro del costeo de componentes PEPS ni promedio ponderado del bloque inspeccionado. Por tanto, la producción también puede propagar costos Bs. nominales no comparables a producto en proceso/terminado si la materia prima cruza reconversiones.

Se inspeccionó además `importInventoryMovements`:
- Requiere persistencia SQLite y valida fecha de inicio y cierre, referencias duplicadas, orden cronológico, costos, cantidades y existencia.
- En importación, el promedio ponderado usa `calculateWeightedAverageCost` cuando hay tasa, o `calculateWeightedAverageCostDual` cuando no; las salidas PEPS consumen las capas reconstruidas.
- La ruta de importación calcula y prepara movimientos y asientos en memoria; queda pendiente rastrear la fase completa de persistencia para comprobar rollback ante fallo parcial y validar importaciones que cruzan reconversiones.

**Impacto ampliado:** el problema de comparabilidad de Bs. puede propagarse desde materia prima hacia producción en proceso, producto terminado, costo de ventas y reportes. No se concluye que todas las rutas operativas sean incorrectas; la política contable de referencia y pruebas de extremo a extremo siguen pendientes.

**Siguiente etapa de auditoría:** revisar orden cronológico de Kardex, importaciones y restauración, cierres/reaperturas, generación y persistencia de asientos y movimientos; construir una matriz de pruebas que cubra períodos de reconversión, promedio, PEPS, producción, devolución, merma y ajustes; cuantificar discrepancias sin alterar datos existentes.


## Conciliación de costo de Kardex, devolución física y costo de ventas (23-11-2026)

### Hallazgo: el saldo Bs. de Kardex no es una conciliación monetaria por escala

- `reconstructFifoLayers` verifica que las cantidades de capas reconstruidas concilien con los saldos por movimiento y con existencia actual, y rechaza capas estimadas si no cuadran.
- Esa comprobación es cuantitativa: las capas se reconstruyen con `unitCostBs`/`unitCostUsd` nominales por movimiento; no valida que Bs. de diferentes eras sean comparables ni reconcilia por sí misma el total de inventario con el saldo mayor de las cuentas contables.
- `calculatePeriodicCostOfSales` aplica apertura + compras/costos desembarcados - inventario final en Bs. Esto depende de que los tres valores ya estén en la misma escala monetaria; la fórmula no hace conversión por fecha.

### Devolución física a proveedor y devolución de cliente

- La nota de crédito física a proveedor identifica la entrada original de Kardex, valida factura/RIF/artículo, cantidad retornada acumulada, existencia y capa PEPS disponible; para promedio ponderado bloquea si el promedio actual difiere del costo original. La devolución usa el costo original Bs. y calcula USD desde Bs. a la tasa de la nota, según el código inspeccionado.
- Esto conserva la referencia y limita la devolución a la compra original, pero plantea un punto que deberá decidir la política: cómo se reconcilia el USD derivado en la fecha de devolución con el USD histórico original de la capa, y cómo se valora el saldo Bs. en escala comparable entre eras. No debe alterarse la protección existente de capas originales.
- La devolución de cliente y el costo de ventas utilizan el costo PEPS de las capas reconstruidas o el costo promedio almacenado; los asientos CMV/inventario reflejan esos importes. Si esos costos nominales mezclan escalas, la discrepancia se propaga a CMV y al saldo de inventario.

### Conciliación que debe preceder al cambio de política

La prueba de conciliación no debe limitarse a comparar cantidad física. Para cada artículo y fecha, cruzar: cantidad de movimiento y balance; costo Bs. nominal y su era; USD histórico; valor del saldo; cuenta de inventario; asiento generado y referencia documental. Debe cubrir compras, ventas/CMV, devolución de cliente, devolución física a proveedor, producción/WIP, ajustes positivos/negativos, merma/autoconsumo e importaciones, con métodos promedio y PEPS, y períodos cerrados/reabiertos. Los resultados deben identificar diferencias sin reescribir la fuente histórica.


## Auditoría de valoración del inventario contra cuentas de mayor y cierre/apertura (23-11-2026)

### Catálogo y cuentas de inventario

El catálogo estándar distingue cuentas de inventario de mercancías (1.1.4.01), materias primas e insumos (1.1.4.02), provisión por desvalorización (1.1.4.03) y productos en proceso (1.1.4.04). Los códigos existen como cuentas imputables separadas; por tanto, la conciliación debe segmentar por cuenta y naturaleza, no comparar un único total de existencias de producto con todo el grupo contable.


### Comprobaciones de balance y selección temporal

- `accountingReportIntegrity.ts` define una comprobación de balance en Bs. y USD, filtrado por empresa y selección de asientos por año/tipo de reporte. Esa validación comprueba que el balance presentado cuadre, pero no demuestra que el valor del inventario calculado desde cantidades y costos sea igual al saldo de las cuentas de inventario.
- La selección de situación financiera usa la última apertura anual vinculada como frontera de arrastre; el reporte de resultados limita movimientos al año seleccionado y excluye asientos de apertura/cierre. La frontera evita duplicar saldos ya trasladados, pero necesita una prueba de reconciliación de escala en los asientos de apertura y cierre.

### Riesgo específico del cierre y apertura anual

- `buildClosingEntryItems` reexpresa líneas Bs. de cuentas de ingresos, costos y gastos entre la fecha del asiento y la fecha de cierre, pero deja USD sin reexpresión; las cuentas de balance se acumulan aparte en valores Bs. nominales y USD.
- `buildOpeningEntryItems` reexpresa los saldos Bs. de cuentas de balance entre la fecha de cada asiento y la fecha de apertura; el resultado del período también se reexpresa hacia la apertura. USD se conserva sin conversión.
- Esto es evidencia de tratamientos distintos, deliberados por clase de cuenta, en los procesos de cierre y apertura. No confirma por sí solo un error de balance, pero obliga a probar que inventario (auxiliar/Kardex), cuentas de inventario de mayor y asientos de traslado se mantienen comparables y conciliados al cruzar reconversiones. El cierre reexpresa resultados nominales, no revalúa automáticamente el inventario auxiliar descrito en las auditorías anteriores.

### Diferencia entre controles existentes y conciliación faltante

Los controles actuales verifican cuadratura de asientos, selección temporal y cantidades PEPS. La auditoría no ha encontrado evidencia en estas funciones de una conciliación monetaria independiente que compare, por artículo/fecha/cuenta, valor de Kardex normalizado, saldo mayor de inventario, movimientos y costo de ventas. La ausencia de esa comprobación en los módulos inspeccionados no se debe extrapolar como ausencia total en toda la interfaz.

**Próximo paso de auditoría:** localizar los reportes UI que consumen estos cálculos, identificar su fuente de valor (mayor, auxiliar o producto/costo), y diseñar una conciliación de inventario por cuenta que explicite fecha de referencia y escala Bs., preserve USD y valores nominales originales, y detecte diferencias sin modificar registros históricos.



## Auditoría de reportes UI: Balance General, Balances Históricos y Reporte Anual (23-11-2026)

### Diferencias verificadas entre fuentes de Bs.

**`src/components/Balances/BalancesView.tsx` (balance de comprobación, ajustado y general):** las líneas de los asientos seleccionados se suman en Bs. nominales directamente (`regDebitBs/regCreditBs/adjDebitBs/adjCreditBs`); este cálculo no llama a `normalizeVenezuelanAmountToCurrentScale`. El Balance General usa esos saldos para activo, pasivo y patrimonio, y para el resultado sin cerrar. La selección temporal se limita por la última apertura anual, pero eso no asegura que el período posterior a esa apertura no cruce una reconversión. El reporte puede por tanto combinar importes Bs. de escalas distintas dentro de esa ventana.

**`src/components/Balances/HistoricalBalancesView.tsx` (balances históricos comparativos):** cada línea Bs. se normaliza con `normalizeVenezuelanAmountToCurrentScale(..., entry.date)` antes de acumularla. La interfaz declara explícitamente presentación en escala vigente 2021+ y preserva asientos originales. Esto es un tratamiento distinto al Balance General de `BalancesView`.

**`src/components/Balances/AnnualReportsView.tsx` (reportes anuales):** normaliza importes Bs. por fecha para el ejercicio, pero el conjunto de cuentas del reporte de resultados excluye ACTIVO. No es una conciliación ni una presentación del inventario en el mayor; el anexo cuantitativo por cuentas se calcula desde movimientos contables del ejercicio.

### Conclusión técnica puntual

Queda confirmada una divergencia de presentación: balances actuales agregan Bs. nominales, balances históricos reexpresan a escala vigente y reportes anuales reexpresan movimientos por fecha. No se debe tratar como equivalentes ni comparar sus Bs. sin indicar la escala y el método. La diferencia es especialmente crítica en las cuentas de inventario, porque la cuenta del mayor en Balance General usa movimientos nominales mientras el Kardex/costo auxiliar puede contener costos de diferentes reconversiones.

### Siguiente verificación

Trazar el generador de PDF del Balance General y las funciones auxiliares que alimentan el detalle de cuentas, para comprobar que la exportación usa exactamente los mismos saldos que la pantalla. Después identificar un punto común de cálculo/normalización y definir explícitamente cuál es el método correcto para cada reporte, antes de implementar cambios. No modificar los registros ni normalizar balances de comprobación sin una política de presentación contable acordada.


## Auditoría de exportaciones PDF/CSV de balances (23-11-2026)

### Balance General PDF

La pantalla `BalancesView.tsx` calcula sus saldos y totales y los entrega directamente a `exportBalanceGeneralPdf`; el generador PDF (`src/utils/pdfGenerator.ts`) no vuelve a calcular ni normaliza montos: formatea los arrays de cuentas y los totales recibidos. Por tanto, la exportación del Balance General replica la lógica y los saldos de pantalla, no corrige la escala monetaria por separado. El propio generador indica que presenta saldos nativos sin convertir moneda.


### Reportes anuales y exportación CSV

`AnnualReportsView.tsx` genera CSV desde estructuras calculadas previamente (`report`, `equityReport`, `disclosureMovements`). El CSV no contiene una capa independiente de normalización; exporta las cifras ya preparadas, además de incluir movimientos cuantitativos Bs/USD y saldos patrimoniales. La impresión/PDF se realiza desde la propia vista con `window.print()`.

### Alcance de la conclusión

La divergencia documentada no se origina por una diferencia de fórmula entre pantalla y PDF del Balance General: el PDF recibe y formatea los mismos saldos/totales. El riesgo de escala está en el cálculo que alimenta la pantalla y en cómo se prepara cada reporte anual/histórico, no en la exportación visual. CSV/PDF deben quedar incluidos en la futura matriz de validación de reportes, verificando que muestren la misma escala, fecha de corte y política que sus cálculos fuente.

### Próximo paso

Auditar los reportes de flujo de efectivo y cambios en patrimonio, así como sus impresiones/exportaciones, para determinar si normalizan por fecha, convierten con tasas o agregan Bs nominales; registrar diferencias antes de proponer un cálculo común.


## Auditoría de flujo de efectivo y cambios en patrimonio (23-11-2026)

### Estado de flujos de efectivo — método directo

`src/types/cashFlowStatement.ts` aplica `normalizeVenezuelanAmountToCurrentScale` a los importes Bs. de contrapartidas y a los movimientos de efectivo por fecha de asiento. Los USD se acumulan sin conversión. El saldo inicial se construye desde la última apertura anual vinculada válida, más movimientos posteriores a esa apertura y anteriores al inicio del ejercicio; si no hay apertura, acumula movimientos anteriores. La conciliación compara el efectivo inicial + variación anual con el saldo del mayor calculado usando la misma función de reexpresión Bs. por fecha. La vista `CashFlowStatementView.tsx` imprime desde la vista (`window.print()`) y presenta método directo en Bs/USD; no se identificó un exportador PDF con cálculo separado.

### Estado de flujos de efectivo — método indirecto

`src/types/cashFlowIndirectStatement.ts` reexpresa en Bs. por fecha el resultado, variaciones de cuentas clasificadas y saldos iniciales/finales de esas cuentas; mantiene USD nominal contabilizado. Inversión y financiación reutilizan flujos del método directo. La conciliación del indirecto compara con el saldo final de mayor del reporte directo. Esta implementación comparte la normalización temporal con los reportes directos, aunque depende de clasificación explícita por cuenta y del tratamiento de las cuentas seleccionadas.


### Cambios en patrimonio

`src/types/equityChanges.ts` normaliza Bs. por fecha para saldos de apertura vinculados, movimientos de patrimonio y resultado del ejercicio cuando no ha sido transferido a patrimonio; USD permanece como registrado. Los movimientos mantienen ID/fecha/número y referencia del asiento fuente. La vista anual exporta CSV desde el resultado calculado, por lo que no se observa una capa de reexpresión distinta en la exportación.

### Conclusión

En los flujos de efectivo y cambios en patrimonio sí está implementada la reexpresión Bs. por fecha, a diferencia del Balance General nominal descrito anteriormente. Directo e indirecto usan la misma normalización temporal para Bs. y dejan USD contabilizado sin recálculo; los cambios patrimoniales también reexpresan Bs. El principal riesgo que queda es de **coherencia entre reportes y auxiliares**: Balance General nominal frente a reportes normalizados, y la necesidad de comprobar que las bases de apertura, cuentas clasificadas y saldo final de mayor representan la misma escala/política y se reconcilian con inventario auxiliar y cierres. La vista de flujo directo tiene controles de conciliación/clasificación, pero esos controles aritméticos no prueban que sus cifras Bs. sean comparables con el Balance General.

### Próximo paso de auditoría

Inspeccionar los tests de flujo directo/indirecto y cambios patrimoniales, revisar qué casos de reconversiones cubren y qué escenarios de aperturas vinculadas, anulaciones y saldos iniciales entre períodos faltan. No cambiar cálculos hasta definir la política común de presentación y su matriz de regresión.


## Matriz precisa de cobertura de pruebas de cierres, aperturas y reportes monetarios (23-11-2026)

Se inspeccionaron directamente los cinco archivos de pruebas en la rama `audit/monetary-scale-coherence`, con sus blobs actuales. Esta matriz distingue casos efectivamente presentes de escenarios no encontrados en los archivos revisados.


### Cierre anual — `accountingYearClosing.test.ts`

- Cubre cierre de ingresos, costos y gastos, traslado de utilidad/pérdida a patrimonio, balance Bs./USD, aislamiento de empresa, asientos fuera del período, rechazo de cierre duplicado y asiento descuadrado, y requisito de cuenta patrimonial válida.
- Cubre integración cierre→apertura para que el resultado cerrado se lleve una sola vez.
- Contiene un caso de reconversión 2021-09-30/2021-10-01; el importe de ingresos Bs. se reexpresa al cierre y se comprueba el resultado patrimonial.
- **No encontrado:** reconversiones 2008 y 2018; serie de múltiples reconversiones; anulaciones/reversos del cierre; prueba de cierres de ejercicios consecutivos con saldos reexpresados.

### Apertura anual — `accountingYearOpening.test.ts`


- Cubre traslado de cuentas de balance y resultado, cuenta patrimonial requerida, asientos descuadrados/duplicados, aislamiento de empresa y corte de fechas, tolerancia estricta Bs./USD, última apertura anual vinculada, reverso futuro de apertura y no duplicación de ingresos/gastos de años anteriores.
- Tiene prueba de reconversión 2018-08-19/2018-08-20: los saldos de ambas fechas se normalizan a la escala de la fecha de apertura 2022-01-01.
- **No encontrado:** secuencia que abarque reconversiones 2008, 2018 y 2021; apertura con reversión y reapertura nueva entre escalas; cadena de varios años que pruebe repetidamente el arrastre y cierre/apertura; comparación auxiliar de inventario con cuentas de mayor.

### Flujo de efectivo directo — `cashFlowStatement.test.ts`


- Cubre clasificación y conciliación, inversión/financiación, cuentas de efectivo, transferencias, operaciones sin clasificar, empresas aisladas, períodos inválidos, apertura vinculada, arrastre desde apertura previa y reverso de apertura en el mismo día.
- Prueba específica de escala histórica con apertura 2013 y recibo 2014: Bs. normalizado, USD sin reexpresión, saldo inicial + flujo = cierre de mayor y reporte reconciliado.
- **No encontrado:** pruebas específicas de 2008, 2018 y 2021; varios saltos de escala en una misma serie; anulación de operación ordinaria; reversión de apertura en fecha distinta; verificación de consistencia con Balance General nominal.

### Flujo de efectivo indirecto — `cashFlowIndirectStatement.test.ts`


- Cubre resultado, depreciación, capital de trabajo, reconciliación, reversión de apertura, apertura previa vinculada y movimientos pre-período, empresas aisladas, valores no finitos, precisión USD, clasificación incompleta y discrepancia de conciliación.
- Prueba específica de escala 2013/2014: resultado y flujo Bs. reexpresados, saldo inicial y final reconciliados, USD preservado.
- **No encontrado:** pruebas de 2008, 2018 y 2021; cadena multi-reconversión; reversos de operaciones no-apertura; coherencia contra Balance General nominal y contra flujo directo con fuentes idénticas en todas las eras.

### Cambios en patrimonio — `equityChanges.test.ts`


- Cubre reexpresión de Bs. en la frontera 2021-09-30/2021-10-01, apertura patrimonial, movimientos, resultado transferido/no transferido, aislamiento de empresa y período inválido.
- **No encontrado:** reconversiones 2008/2018, serie de múltiples reconversiones, reversos de apertura o movimientos patrimoniales, arrastre plurianual entre aperturas vinculadas, prueba comparativa de patrimonio contra Balance General.

### Prioridad y criterio de entrada para una política monetaria común

1. Agregar pruebas unitarias de normalización con casos fechados antes/después de cada reconversión, incluyendo varias eras en una misma serie.
2. Componer las pruebas de apertura/cierre en cadena: cierre, apertura vinculada, movimientos, reverso, nueva apertura y siguiente ejercicio.
3. Para flujos directo/indirecto y patrimonio, usar el mismo conjunto de entradas contables y verificar que los resultados se reconcilien bajo la política de presentación definida; no exigir igualdad de reportes con naturaleza diferente, sino explicar y probar sus bases y escala.
4. Añadir casos de reversos de operaciones históricas y aperturas anuladas, sin duplicar ni eliminar fuente.
5. Añadir comparación Balance General vs. balances históricos, flujo y patrimonio con fecha de corte, escala Bs. y origen de cifras explícitos.
6. Mantener USD original, fecha efectiva, tasa, monto nominal y trazabilidad; cualquier reexpresión debe ser una vista/calculo derivado, no reescritura de fuente.

**Limitación de ejecución:** esta etapa fue una inspección de archivos de prueba en GitHub. No se ejecutó suite local ni CI en esta sesión; las brechas son ausencia de casos encontrados en los archivos examinados, no afirmación de que todos los escenarios fallen en runtime.


## Auditoría de pruebas del Balance General y reportes de balances (23-11-2026)

Se enumeraron los archivos del árbol de la rama y se inspeccionaron directamente `BalancesView.tsx`, `HistoricalBalancesView.tsx`, `AnnualReportsView.tsx` y `accountingReportIntegrity.test.ts`.

### Cobertura automatizada localizada

- No se encontró un test dedicado a `BalancesView.tsx`, `HistoricalBalancesView.tsx` o `AnnualReportsView.tsx` en el árbol de archivos revisado.
- Existe `src/types/accountingReportIntegrity.test.ts`, pero sus pruebas se centran en integridad/selección de movimientos y no constituyen cobertura de presentación de las tres vistas ni prueba de equivalencia de escala entre ellas.
- Cierre y apertura anual tienen sus tests separados en `accountingYearClosing.test.ts` y `accountingYearOpening.test.ts`; sus casos no prueban directamente el resultado visible de Balance General después de varios ciclos.

### Verificación de fuente del Balance General

En `BalancesView.tsx`, los acumuladores de movimientos regulares y ajustes suman `debitBs/creditBs` directamente. En el bloque revisado no aplican `normalizeVenezuelanAmountToCurrentScale` antes de sumar. Por tanto, los reportes seleccionados pueden agregar nominal Bs. de fechas pertenecientes a escalas distintas, según el período que seleccione la vista.

### Diferencia de tratamiento en las otras vistas

- `HistoricalBalancesView.tsx` importa la normalización de escala por fecha desde `historicalAccountingCalendar` y la usa en el cálculo histórico.
- `AnnualReportsView.tsx` también importa el normalizador por fecha, además de los generadores de cambios en patrimonio y disclosure.
- Esta inspección confirma que el riesgo está en la divergencia de bases monetarias de cálculo; la impresión/PDF que replica los valores de pantalla no soluciona por sí sola la diferencia.

### Casos de regresión requeridos

1. Un conjunto común de asientos pre/post 2008, 2018 y 2021 con saldos de activo, pasivo y patrimonio.
2. Períodos de balance que incluyan movimientos de varias escalas, con fecha de corte explícita.
3. Balance General nominal y balance histórico reexpresado: comprobar que la base monetaria de cada uno esté identificada y que las diferencias sean explicables, no asumir igualdad de cifras.
4. Apertura, cierre y reverso de ambos, y el balance después de cada paso.
5. Comparar pantalla y PDF/exportación con la misma fuente, fecha, moneda y método; probar que la exportación no altere ni normalice de manera distinta.
6. Validar cuadre por cuenta, empresa, año/período y movimientos incluidos/excluidos.

**Conclusión de cobertura:** la divergencia monetaria identificada en las vistas no está protegida por tests de componentes específicos localizados. La matriz de pruebas debe cubrir cálculo, integración de apertura/cierre y presentación/exportación antes de decidir si se cambia el cálculo nominal del Balance General o se incorpora un modo de presentación reexpresada. Mantener separados el valor nominal fuente y cualquier valor derivado de comparación.


## Auditoría del ciclo de cierre/apertura anual y reapertura (23-11-2026)

Se inspeccionaron `src/types/accountingYearClosing.ts`, `src/types/accountingYearOpening.ts` y los flujos `closeAccountingYear`, `reopenAccountingYear`, `reopenAccountingPeriod` y `reverseJournalEntry` en `src/context/AccountingContext.tsx`.

### Hallazgos verificados en el código

- El cierre anual transforma cada línea de INGRESOS/COSTOS/GASTOS desde la fecha del asiento hasta el cierre (`periodEndDate`) con `convertVenezuelanAmountBetweenDates`, y mantiene los USD tal como están registrados. Los totales de cada asiento original se validan antes de generar el cierre.
- La apertura reexpresa líneas de balance desde la fecha del asiento hasta `openingDate`, conserva USD nominales y agrega el resultado del período desde `periodStartDate`. Excluye ingresos/costos/gastos del traslado de balance y los incorpora al patrimonio mediante cuenta configurada.
- El proceso orquestador exige SQLite listo, bloquea cierres/reaperturas concurrentes, espera escrituras pendientes, valida facturas sin asiento, registra depreciación antes del cierre y usa snapshot persistido para calcular cierre. Requiere ejercicio calendario completo, fecha no futura y tasas BCV solo si aplican por fecha.
- Cierre y apertura se agregan al estado y se actualiza el calendario fiscal antes de esperar la confirmación de persistencia. En el bloque de error, si la persistencia no quedó marcada como fallida, se retiran los IDs de cierre/apertura de `journalEntries`; **no se restaura explícitamente el estado `companies` que ya actualizó `closedThroughDate`, `fiscalYear` y `fiscalExercises`**. Si la confirmación falla después de ese cambio, existe riesgo de estado UI/calendario desincronizado respecto de los asientos retirados. La ruta de recuperación debe verificarse y corregirse con rollback simétrico o bloqueo/recarga segura.
- La reapertura anual delega la reversión conjunta de los dos asientos a SQLite y exige dos contra-asientos confirmados; luego actualiza empresa y libro en estado UI y espera persistencia. Si esa espera falla, no hay rollback explícito de esas actualizaciones locales en el bloque mostrado; requiere comprobar el comportamiento del pump y la estrategia de recuperación antes de asumir atomicidad en UI.
- La reapertura parcial detecta cierres automáticos por referencia y fuerza reapertura anual completa; no permite fecha parcial. Para períodos no anuales, valida fecha anterior al cierre, motivo, y delega en SQLite.
- La reversión ordinaria preserva el original, exige fecha válida posterior al original y posterior al cierre vigente, rechaza contra-asientos y duplicados, usa análisis integral, y valida balance Bs/USD y contrapartida bancaria. Para asientos de período cerrado exige AIA; el flujo de reapertura anual tiene ruta separada.

### Riesgos y casos de prueba que quedan pendientes

1. Simular rechazo/fallo de persistencia después de actualizar `companies`: verificar coherencia de `closedThroughDate`, `fiscalYear`, `fiscalExercises`, cierre/apertura en libro y bloqueo de operaciones; no permitir UI como confirmación de cierre.
2. Simular fallo en la confirmación de reapertura: comprobar que SQLite, estado React, calendario y dos reversos no diverjan y que no se permita operar sobre estado incierto.
3. Reabrir ciclo anual con movimientos posteriores al cierre, verificar restauración completa y consecutivos, referencias, auditoría y efectos dependientes.
4. Reapertura y reversión en fechas distintas de cierre: comprobar que entradas posteriores no reescriban la historia y que los saldos se trasladen correctamente a ciclos subsiguientes.
5. Cadena de varios ejercicios con reconversiones 2008/2018/2021 y diferencias de escala: comparar saldos nominales fuente, cierre, apertura y balances derivados.
6. Verificar cierre con cuentas patrimoniales inactivas: la habilitación usada en el asiento debe ser transitoria y no alterar el catálogo persistente.
7. Pruebas de concurrencia y doble ejecución con bloqueo real de SQLite, además de fallos entre la creación del cierre y la apertura.

**Conclusión:** los builders contienen conversiones por fecha, pero los puntos de riesgo del ciclo completo son la confirmación/rollback de estado local y la coherencia entre snapshots persistidos y UI. Este hallazgo se documenta como riesgo de integración, no como pérdida de datos demostrada; no se ejecutaron pruebas locales.


## Auditoría del motor de reversos y AIA (23-11-2026)

Se inspeccionó `src/types/journalReversal.ts` y su invocación desde `AccountingContext.tsx`.


### Defecto confirmado: reversión genérica exige USD incluso para registros Bs-only

En `buildReversalItems`, la validación del asiento original exige simultáneamente cuadre Bs/USD y `totals.debitBs > 0` **y** `totals.debitUsd > 0`. El flujo de reversión ordinaria, por su parte, solo exige tasa BCV y revisión de moneda para fechas en las que la política la exige (desde 2018). Esta contradicción bloquea reversos de asientos válidos exclusivamente en Bs. de períodos anteriores a 2018, aunque la política de SICOVEN permite operación Bs-only antes de ese umbral. La validación del reverso debe respetar la política monetaria/fecha del asiento fuente y no imponer USD universalmente.

### Hallazgos de alcance

- AIA cambia las líneas de INGRESOS/COSTOS/GASTOS a una cuenta de patrimonio seleccionada y mantiene las cuentas de balance en su código original. El helper valida que la cuenta de patrimonio exista y sea de movimiento, pero la selección no comprueba `isActive !== false`; en el orquestador de reversión se valida el resultado y la política de fecha por separado. Debe añadirse una prueba para cuenta patrimonial inactiva y confirmar si la validación del posting la bloquea.
- El helper intercambia lados Bs/USD de las líneas fuente. No reexpresa el monto Bs por la fecha original y la fecha efectiva de reversión; eso conserva la cantidad nominal, por lo que el tratamiento monetario de reversos/AIA entre escalas necesita política explícita y pruebas de límites 2008, 2018 y 2021. No cambiarlo hasta establecer la base de reversión.
- El preflight bloquea operaciones comerciales con vínculos auxiliares incompletos o incompatibles: notas de crédito, inventario, Kardex, cobros/pagos, anticipos y conciliación bancaria. Es una salvaguarda importante; las pruebas deben confirmar que todos esos bloqueos también se repiten en la persistencia SQLite y son atómicos.
- `assessJournalReversal` ejecuta `buildReversalItems` para calcular el preflight. El requisito universal de USD puede hacer que la evaluación no llegue a ofrecer reversión para asientos históricos Bs-only, aunque no se requiera BCV/USD por fecha.

### Regresiones prioritarias

1. Reversión Bs-only anterior a 2008 y entre 2008–2017, equilibrada, válida y sin BCV, con fecha efectiva posterior.
2. Reversión dual de 2018 y posteriores; BCV requerido según política de fecha, balance en ambas monedas.
3. AIA Bs-only de período cerrado con cuenta de patrimonio activa; prueba de cuenta inactiva.
4. Reversos y AIA que cruzan límites monetarios: confirmar conservación de nominal, conversiones y base contable aprobada, sin modificar asientos fuente.
5. Reversión duplicada, reversión de contra-asiento, reversión de asiento con Z, activos fijos, notas de crédito, inventario y cobros/pagos vinculados.
6. Confirmación SQLite y evento final de auditoría: fallo de persistencia no debe dejar el usuario con una reversión presentada como completada; la auditoría final fallida debe informar que el contra-asiento ya está persistido y evitar duplicación.

**Conclusión:** el requisito de USD en `buildReversalItems` contradice el tratamiento Bs-only de períodos previos a 2018 y es un bloqueo lógico verificable por inspección. Se documenta para corrección posterior; no se alteró código operacional ni se ejecutaron pruebas locales.


## Verificación de regresiones del helper de reversión y confirmación SQLite (23-11-2026)

Se revisó el test `src/types/journalReversal.test.ts` (825 líneas) y el flujo `reverseJournalEntry` (aprox. líneas 1107–1284 de `AccountingContext.tsx`).

### Cobertura existente que sí se comprobó

- Pruebas para reversión dual Bs/USD, AIA con reclasificación a patrimonio, cuenta patrimonial requerida, descuadre en Bs/USD, USD con tolerancia, líneas inválidas, cuentas no-movimiento y cuentas inexistentes.
- Pruebas de protección de inventario y COGS, devoluciones parciales/totales, conciliación bancaria, compra y notas de crédito, liquidaciones, anticipos, reversión duplicada, contra-asiento, y asiento fiscal Z inmutable.
- La prueba de reversión genérica y la evaluación preflight tienen fixtures duales (Bs/USD). No encontré un caso Bs-only ni uno de antes de 2018; por tanto el bloqueo descrito anteriormente carece de regresión que lo detecte.

### Secuencia de ejecución y riesgos de persistencia

- El flujo exige SQLite disponible, valida fuente/fecha/duplicidad, analiza vínculos auxiliares, genera el contra-asiento y vuelve a validar balance en Bs/USD. Registra el evento `accounting_correction_requested` antes de añadir el reverso; si falla ese evento, el flujo se detiene antes de publicar el asiento.
- `addJournalEntry` publica el reverso y luego se actualizan en React las ventas/compras anuladas, comprobantes fiscales marcados para corrección, liquidaciones/anticipos, depreciación y vínculos de extracto. Después se espera `persistenceConfirmation`. No se observó rollback explícito de estas actualizaciones React si esa promesa rechaza. Esto refuerza el riesgo ya documentado: estado visible puede divergir si falla la confirmación de snapshot.
- El evento `accounting_correction_executed` se escribe después de que SQLite confirma. Si falla, el código comunica expresamente que el reverso ya está guardado y que no debe repetirse. Este mensaje evita la duplicación por reintento, pero queda una operación persistida sin evento final de auditoría, que requiere reconciliación controlada.
- El bloqueo de concurrencia libera las referencias `journalReversalInFlightRef` y `correctionWorkflowInFlightRef` en `finally`; no obstante, si la confirmación de persistencia falla, la UI puede conservar las mutaciones previas y permitir una operación posterior desde un estado incierto. Debe probarse un bloqueo de sesión/recarga obligatoria o rollback simétrico antes de liberar el flujo.

### Casos añadidos a la matriz pendiente

1. Asiento Bs-only válido de período anterior a 2018: el helper, preflight y posting deben aceptarlo sin USD/BCV cuando la política por fecha lo permite.
2. Fallo del evento solicitado antes de la reversión: confirmar que no cambia libro, documentos, conciliaciones ni consecutivo.
3. Rechazo de persistencia después de `addJournalEntry`: comprobar rollback/recuperación de cada auxiliar, contra-asiento y consecutivo; estado incierto no puede habilitar operaciones.
4. Fallo del evento final de auditoría después de persistencia: mostrar claramente que el contra-asiento existe y prevenir duplicación; permitir reconciliar la auditoría pendiente.
5. Doble clic, concurrencia entre reversión y corrección, y recarga/reinicio entre solicitud, persistencia y evento final.


**Conclusión:** el test existente confirma que la reversión está protegida en escenarios duales, pero no cubre la operación Bs-only permitida por la política histórica. La secuencia de persistencia y actualización React presenta riesgo de estado no revertido ante fallo de confirmación; es riesgo de integración confirmado por código, no pérdida de datos demostrada. No se ejecutaron pruebas locales.


## Auditoría de consecutivos, referencias, reversos encadenados y aislamiento por empresa (23-11-2026)

### Controles confirmados

- **Correlativo por empresa:** `addJournalEntry` calcula el máximo de `entryNumber` de la empresa destino y lo combina con `journalSequenceRef` indexado por `companyId`; los consecutivos de otras empresas no forman parte de ese cálculo.
- **Validación SQLite de secuencias:** `validateAccountingSnapshot` exige números enteros crecientes por empresa y rechaza reutilizar números previos o duplicarlos dentro del snapshot.
- **Reversión única y vínculo:** el helper de reversión detecta contra-asientos y fuentes ya reversadas. El validador SQLite verifica misma empresa, vínculo recíproco, referencia `REV-<número>`, tipo AJUSTE, fecha, razón, papel de trabajo, tasa y que cada línea invierta Debe/Haber de la fuente. También rechaza una segunda reversión del mismo origen.
- **Aislamiento de origen:** la función React busca el asiento fuente en la empresa activa; el validador de persistencia exige que la empresa del origen coincida con la empresa del contra-asiento.
- **AIA:** el validador exige que las líneas de resultados se reclasifiquen a una única cuenta patrimonial de movimiento, mientras las cuentas de balance se conservan.

### Defecto de integración detectado: vínculo recíproco de reversión no emitido desde React

En el flujo `reverseJournalEntry`, tras `addJournalEntry` se actualizan documentos auxiliares (ventas, compras, liquidaciones, anticipos, activos y conciliación bancaria), pero no se encontró una actualización del asiento fuente que establezca `reversedByEntryId = reversal.id` y `isAdjusted = true`. El contra-asiento nuevo sí recibe `reversalOfEntryId`.

Sin embargo, el validador de `electron/accounting-integrity.cjs` exige que el asiento fuente en el siguiente snapshot tenga `reversedByEntryId === entry.id` y `isAdjusted === true`. Los tests de integridad construyen manualmente el asiento fuente ya marcado para validar el contra-asiento; no cubren la ejecución end-to-end del flujo React.

**Impacto probable y bloqueante:** la reversión puede quedar rechazada por SQLite al validar el snapshot, aunque el contra-asiento se haya agregado al estado React. La confirmación depende del efecto de persistencia/rollback; el caso de integración no está cubierto por los tests revisados. No se ejecutó la aplicación para confirmar el comportamiento en runtime.

### Cobertura revisada y brechas

- Tests existentes: rechazo de consecutivo inferior, contra-asiento que no invierte exactamente, falta de vínculo/papel de trabajo, segunda reversión y reversión de contra-asiento.
- No se encontró prueba dedicada que intente cruzar empresas en el vínculo de reversión o simule concurrencia real de correlativos.
- No se encontró prueba end-to-end que invoque `reverseJournalEntry`, persista el snapshot y confirme el vínculo recíproco que exige SQLite.
- La referencia `REV-<entryNumber>` no incluye companyId; su validación es contextual al origen y a la empresa, por lo que no debe tratarse como clave global.
- Sigue vigente el bloqueo Bs-only previo a 2018 en `buildReversalItems`, que requiere totales positivos tanto en Bs como USD; su cobertura se documentó en auditoría anterior.

### Conclusión

La secuencia de números está protegida por empresa y SQLite rechaza reutilización/duplicidad. El aislamiento de empresa y los contra-asientos exactos están protegidos por el validador. Pero la inspección encontró una discrepancia concreta entre el flujo React de reversión y los requisitos del validador: el flujo no parece emitir el enlace recíproco que SQLite exige. Debe corregirse y cubrirse con prueba de integración antes de considerar segura la reversión contable. La inspección de código no sustituye una ejecución local.


### Auditoría de consecutivos, referencias, reversos encadenados e aislamiento por empresa (23-11-2026)

#### Protecciones verificadas

- **Consecutivo por empresa:** `addJournalEntry` calcula el máximo a partir de asientos de `targetCompany.id` y mantiene `journalSequenceRef` indexado por ese ID. Empresas distintas pueden tener secuencias independientes; el ID del asiento incluye el identificador de empresa y número.
- **Validación SQLite de secuencia:** el validador rechaza nuevos números no crecientes, duplicados dentro de la misma empresa y entradas con líneas inválidas o insuficientes. Se encontró prueba de rechazo de correlativo inferior y aceptación del siguiente correlativo.
- **Origen de reversión aislado:** `reverseJournalEntry` busca el original por ID y empresa activa, bloquea revertir un contra-asiento, y rechaza si el original ya tiene reversión o hay un contra-asiento enlazado en esa empresa.
- **Evidencia correctiva:** `findLinkedCorrectionEvidence` filtra por empresa, entidad origen y vínculo de ID; para ventas/compras exige tipos documentales 02/03 y referencia coincidente. Tests cubren evidencia vinculada y empresa.
- **Concurrencia de reversión en UI:** los refs `journalReversalInFlightRef` y `correctionWorkflowInFlightRef` impiden dos reversiones/correcciones simultáneas en el flujo observado.

#### Brechas y riesgos que requieren prueba/corrección

- **Reverso encadenado no probado entre empresas:** no se encontró un test dedicado que intente enlazar una reversión de una empresa con un asiento original de otra, o duplicar el vínculo de reversión entre empresas. Los filtros de UI son positivos, pero la prueba SQLite cruzada sigue faltando.
- **Flujo de reversión versus vínculo recíproco:** el flujo React emite `reversalOfEntryId` en el contra-asiento y declara que el original no se modifica. El validador y pruebas previas exigen coherencia del enlace de reversión; el flujo de UI no escribe `reversedByEntryId` en el origen. Esto mantiene el original inmutable, pero debe confirmarse en integración que el snapshot satisface el contrato SQLite sin dejar la reversión rechazada o parcialmente aplicada.
- **Consecutivo reservado antes de confirmación:** `addJournalEntry` incrementa `journalSequenceRef` y crea el asiento antes de que el flujo `reverseJournalEntry` espere la confirmación del snapshot. En fallo de persistencia puede quedar un salto de número en memoria. Un salto no reutiliza números ni altera otro asiento, pero la recuperación/reinicio y el mensaje al usuario deben verificarse; no se encontró prueba específica de este escenario para reversión.
- **Casos de corrección con ejecución directa:** el workflow de correcciones tiene pruebas explícitas de aprobación directa sin revisión ni papel de trabajo; esto es un comportamiento configurado, no un defecto por sí solo, pero debe evaluarse contra la política contable y permisos de SICOVEN.

#### Matriz de regresión añadida

1. Dos empresas crean asientos con consecutivos independientes y la misma referencia visible; no hay colisión de IDs.
2. Reversión de empresa A con un asiento de empresa B como origen debe ser rechazada en UI y SQLite.
3. Reversión duplicada y reversión de un contra-asiento deben rechazarse sin modificar auxiliares.
4. Fallo de SQLite tras reservar número: reintento no duplica el asiento, no reutiliza número persistido y restablece/explica el salto.
5. Reversión en empresa A no marca ventas, compras, retenciones, anticipos ni conciliaciones de empresa B.
6. Reversal link unidireccional/recíproco y snapshot completo se valida en una prueba end-to-end de `reverseJournalEntry`.
7. Referencias iguales entre empresas no deben confundirse; evidencia correctiva debe ser ID-linked y company-scoped.
8. Corrección directa se prueba con rol, autorización, evidencia, evento de auditoría y política de aprobación explícita.

**Conclusión:** la secuencia contable e identificación observada están separadas por empresa y protegidas por validación creciente/duplicados. No se demostró colisión ni alteración entre empresas. La brecha principal es cobertura de integración: el cruce de empresa en reversos, el vínculo contra-asiento/origen y la recuperación tras fallo SQLite deben comprobarse end-to-end antes de considerar cerrado este bloque. No se ejecutaron tests locales.


### Auditoría de cierre anual, apertura, resultados acumulados y traslado de saldos (23-11-2026)

**Fuentes inspeccionadas:** `src/types/accountingYearClosing.ts`, `src/types/accountingYearClosing.test.ts`, `src/types/accountingYearOpening.ts`, `src/types/accountingYearOpening.test.ts`, `src/types/equityChanges.ts` y `src/types/equityChanges.test.ts`. Esta revisión es estática; no se ejecutaron pruebas locales.


#### Controles que sí están implementados

- **Cierre anual:** filtra por empresa y fechas del ejercicio, valida fechas, líneas, cuentas imputables, importes no negativos, asiento balanceado en Bs/USD y evita cierre vigente duplicado. Los saldos de ingresos/costos/gastos en Bs se convierten individualmente desde la fecha del asiento a la fecha de cierre; USD conserva importes registrados.
- **Transferencia del resultado:** el resultado de cierre se recalcula a partir de los saldos Bs/USD ya redondeados de cuentas nominales; la contrapartida se exige en una cuenta de patrimonio imputable y activa, con signo apropiado para utilidad o pérdida. El asiento total debe quedar balanceado en ambas monedas.
- **Apertura anual:** valida cronología, compañía, catálogo, asientos históricos, y duplicidad de apertura. Usa la última apertura anual vinculada como punto de partida, para evitar sumar nuevamente el histórico que esa apertura ya representa. Bs se convierte desde fecha de asiento a fecha de apertura y USD no se reexpresa.
- **Resultado acumulado:** en apertura, ingresos/costos/gastos del ejercicio se convierten a la escala de la apertura y se trasladan a patrimonio; requiere cuenta patrimonial imputable cuando el resultado no es cero. Los balances se calculan con neto debe-haber, sin invertir arbitrariamente cuentas de naturaleza acreedora.
- **Pruebas existentes:** incluyen utilidad y pérdida, balance en dos monedas, cuenta patrimonial requerida, ejercicio siguiente sin duplicar el resultado, límites de empresa/fecha y un caso de reconversión de 2021.
- **Estado de cambios en patrimonio:** `buildEquityChangesReport` separa apertura, movimientos y resultado del período, mantiene los movimientos ligados a asiento, no infiere conceptos como dividendos o reservas desde descripciones, y reconoce aperturas anuales mediante `exerciseLink` en vez del tipo `APERTURA` por sí solo.

#### Riesgos y cobertura pendiente

- **Apertura/cierre no equivalen a una reexpresión integral de estados:** estos procedimientos trasladan saldos y resultados mediante las conversiones descritas; no se debe concluir que ya calculan y contabilizan el AIA o una reexpresión completa bajo inflación.
- **Validación de continuidad entre ejercicios:** existen pruebas de que el resultado cerrado se traslada a la apertura siguiente una sola vez, pero falta una matriz de integración que compare, por cuenta y moneda, el cierre final y la apertura siguiente en escenarios con reconversiones, reversos, aperturas vinculadas múltiples y períodos reabiertos.
- **Reversos y corte:** la apertura considera reversos efectivos al corte para escoger apertura previa; el cierre procesa asientos dentro de las fechas del ejercicio y los reversos presentes en ese intervalo se compensan por sus importes. Hace falta prueba integrada de reversos tardíos, reabertura/reversión del cierre y asiento correctivo insertado después de una fecha ya cerrada.
- **Redondeo y precisión:** el cierre redondea el neto Bs por cuenta y USD por cuenta antes de recalcular el resultado; apertura acumula movimientos y redondea los netos al generar líneas. Debe comprobarse que la acumulación de muchas líneas y cuentas no introduce diferencia por redondeo entre saldos trasladados, sumas de reportes y libros.
- **Patrimonio y clasificación:** el informe de cambios patrimoniales normaliza Bs, pero el código no determina automáticamente aportes, dividendos, reservas o correcciones por inflación; exige clasificación y evidencia explícita. Falta comprobar que los códigos patrimoniales usados para resultado acumulado estén coherentes con el catálogo y con los saldos de otros reportes.
- **AIA:** en los módulos inspeccionados se encontró una matriz de clasificación inflacionaria que define tratamiento, pero no se comprobó en este bloque la cadena completa de cálculo, autorización, asiento, persistencia y reflejo en cierre/apertura de AIA. No se afirma que esa funcionalidad esté ausente; queda como auditoría separada.

#### Pruebas de integración propuestas

1. Cierre 2021 con operaciones antes y después del cambio de escala, reverso dentro del período y saldo patrimonial; verificar ambos libros y la apertura siguiente.
2. Cierre con utilidad, pérdida, resultado cero, múltiples cuentas patrimoniales y centavos acumulados; comprobar balance y diferencias por redondeo.
3. Reverso posterior al corte, asiento tardío y cierre reabierto: conservar la fecha efectiva, no alterar períodos congelados sin flujo de reapertura, y reconciliar la nueva apertura.
4. Dos aperturas vinculadas y una apertura anulada: seleccionar la vigente correcta, no duplicar historia ni saltar saldos válidos.
5. Conciliar por cuenta y moneda cierre-apertura, balance de comprobación, balance general, cambios patrimoniales y resultado acumulado, registrando explícitamente diferencias esperadas por bases distintas.
6. AIA: confirmar clasificación aprobada por componente, fecha/base de medición, cálculo, asiento dual, trazabilidad, reversión y efecto en los reportes; mantener separación de partidas monetarias/no monetarias.

**Conclusión:** el núcleo de cierre y apertura anual tiene controles sólidos y normaliza Bs por fecha en las cuentas de resultado y en los saldos que traslada; USD conserva la base registrada. La evidencia de pruebas es buena para los casos aritméticos y el traslado de resultado, pero insuficiente para cerrar la continuidad integral de ejercicios en casos complejos de reconversión, reversos, reapertura, redondeo y AIA. No se encontró ni se ejecutó una prueba que cierre todo el recorrido integrado.


### Auditoría del módulo de inflación: clasificaciones, series oficiales y bloqueo de cálculo (23-11-2026)

**Archivos inspeccionados:** `electron/inflation-classifications.cjs`, `electron/inflation-classifications.test.cjs`, `electron/inflation-reme-readiness.cjs`, `electron/inflation-reme-readiness.test.cjs`, `electron/inflation-indexes.cjs`, `electron/inflation-indexes.test.cjs`, `src/types/inflationClassification.ts` y `src/components/Inflacion/InflationWorkspace.tsx`.

- **Clasificaciones con gobierno:** las decisiones se guardan vinculadas a empresa/ejercicio/cuenta y pueden ser por cuenta o componente. Validan tipo de cuenta, clasificación/base compatible, fecha de origen/medición/reporte cuando aplica, importes y respaldo; incluyen estado de revisión, versiones/supersedencia, auditoría y protecciones de operación idempotente. Pruebas cubren empresa/cuenta/flujo incompatibles, componentes, referencias contractuales, cantidades en texto decimal exacto, revisión append-only y permisos.
- **Series y fuentes:** hay estructura de series mensuales, fuente/documento, aprobaciones y verificación de preparación por tramo. El readiness busca serie de niveles aprobada, emisor BCV, URL oficial HTTPS y cobertura mensual; bloquea períodos faltantes y no interpola meses ausentes.
- **Guardia de cálculo:** los tests explícitamente verifican que readiness puede reportar `ready=true` para serie validada, pero `calculationEnabled=false`. Esto demuestra que la preparación de datos no habilita automáticamente el cálculo contable; es una barrera deliberada, no una falla por sí misma.
- **Límite funcional confirmado:** este bloque ofrece clasificación, importación/validación de series y evaluación de readiness. No se identificó aquí una ejecución completa de reexpresión/AIA que calcule importes por componente y genere automáticamente asientos de ajuste; la preparación y el gobierno de datos no equivalen a contabilización.
- **Riesgo operativo:** antes de activar cualquier cálculo, se debe definir fórmula/criterio contable, fechas de origen, componentes monetarios y no monetarios, medición actual, índices aprobados, redondeo, contra cuenta, reversión, autorización, persistencia y reflejo en reportes. Activar solo porque el índice esté listo sería insuficiente.

**Conclusión:** la capa de clasificación y calidad documental es robusta y la preparación del INPC está protegida por cobertura y aprobación. La función de cálculo contable está deliberadamente deshabilitada (`calculationEnabled=false`) en las pruebas inspeccionadas. No se debe interpretar la interfaz de inflación como AIA operativo hasta auditar/implementar el cálculo, asiento, persistencia, reversión y reconciliación.
