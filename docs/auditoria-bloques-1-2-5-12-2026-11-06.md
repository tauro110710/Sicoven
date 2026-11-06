# Auditoría de Bloques 1, 2 y 5–12 — avance
**Fecha:** 06-11-2026  
**Repositorio:** `freelancer1978/Sicoven`  
**Base inspeccionada:** `main` — `721c481d99d1ef1cc898f07c4cdd87a6362a17cb`  
**Versión:** 1.0.17

## Alcance de esta pasada
Primera pasada del Bloque 1 (núcleo de Contabilidad General). No se modificó código funcional, datos SQLite, autenticación semilla ni instaladores. La hoja de ruta conserva su estructura, numeración y alcance; solo se tachó una sub-tarea cuya implementación y pruebas ya existen.

## Bloque 1 — hallazgo verificado

### Validación estructural de cuentas — implementada y probada
Evidencia:
- `src/types/chartOfAccounts.ts`: valida formato y duplicidad de códigos, clasificación, padre existente, nivel, relación agrupadora/imputable y evita insertar niveles intermedios que reestructuren cuentas históricas.
- `src/context/AccountingContext.tsx`: `addAccount` ejecuta `prepareAccountForCatalog` antes de añadir la cuenta al estado.
- `src/types/journalEntryValidation.ts`: rechaza asientos que utilicen cuentas inexistentes o agrupadoras.
- `electron/accounting-integrity.cjs`: vuelve a validar la estructura de cuentas nuevas en la capa SQLite.
- Pruebas: `src/types/chartOfAccounts.test.ts`, `src/types/journalEntryValidation.test.ts` y `electron/chart-of-accounts-integrity.test.cjs`.

La sub-tarea «validación de códigos, padres, niveles y cuentas imputables» del Bloque 1 se marca como terminada en la hoja de ruta. Esto no cierra el requisito completo de plan de cuentas configurable por empresa.

### Brecha confirmada: catálogo contable no está separado por empresa
Evidencia observada en `src/types/accounting.ts` y `src/context/AccountingContext.tsx`:
- `Account` no contiene `companyId`.
- El contexto mantiene un único arreglo `accounts` en el snapshot de estado.
- `addAccount` valida contra ese arreglo global y no recibe la empresa activa.
- El cambio de empresa no selecciona un catálogo de cuentas propio.

Impacto: el requisito del Bloque 1 «plan de cuentas jerárquico configurable por empresa» no está demostrado; las cuentas personalizadas se mantienen en un catálogo compartido por la instalación. Esto también requiere validación de aislamiento frente al Bloque 11. No se concluye que los asientos históricos estén mezclados: cada `JournalEntry` sí conserva `companyId`.

Decisión preventiva: no añadir `companyId` ni migrar catálogos en esta pasada. Primero se debe diseñar una migración aditiva que preserve los códigos, saldos, referencias de asientos, importaciones y restauraciones; definir el tratamiento de cuentas base compartidas; y probar empresas antiguas con catálogos personalizados antes de tocar persistencia.

## Validación de integración
La línea base `main` tiene CI y Windows Release exitosos en SHA `721c481d99d1ef1cc898f07c4cdd87a6362a17cb`:
- CI run `42245517711`: pruebas automatizadas, TypeScript y build de producción, SUCCESS.
- Windows run `42245517753`: SUCCESS.

Estos resultados prueban la línea base general, no sustituyen la validación funcional multiempresa descrita arriba.


### Libro Diario — comprobantes, plantillas y recurrencia
Hallazgos:
- `NewEntryModal.tsx` contiene captura manual y soporte de ajustes; los tipos `EntryType` y la integración de compras/ventas/retenciones muestran orígenes automáticos existentes.
- No se encontró implementación de plantillas de asientos ni de programación/ejecución de asientos recurrentes en el modal, tipos o búsquedas del repositorio.
- El Centro de Correcciones sí conserva referencias a asientos fuente y reversos, pero no sustituye plantillas ni recurrencia.

Estado: **parcial**. No se tacha el requisito completo del Diario. Plantillas y recurrencia siguen pendientes.

### Libro Diario — aislamiento multiempresa
Defecto comprobado en `src/components/LibroDiario/LibroDiarioView.tsx` de `main`:
- El listado principal tomaba `journalEntries` global, mientras los totales y la exportación se derivan de ese listado.
- Los contadores del Centro de Correcciones utilizaban compras y ventas globales, aunque la búsqueda de reversos comprobaba `companyId`.

Corrección candidata en PR #10 (no integrada todavía):
- El listado y sus totales/exportación se derivan de asientos filtrados por `currentCompany.id`.
- El Centro de Correcciones limita asientos, compras y ventas a la empresa activa.
- Se reutiliza `filterEntriesByCompany`, función existente con pruebas unitarias.
- Primer intento CI falló por orden de declaración de una variable; se corrigió. CI posterior sobre SHA `45af1b63319cf183594d21c74f25683f8c85e223` terminó SUCCESS. Se añadió después un refactor al helper en SHA `d3139ac75458fd03dd4954c0fd5a7cd5061f5121`; los nuevos checks deben validar ese SHA antes de integrar.
- Windows Release de la primera corrección fue cancelado al cerrar/reabrir PR durante la comprobación del repositorio; no se considera éxito. La nueva ejecución debe completarse y confirmar que no publica release desde un evento pull_request.

Estado: **corrección en revisión**. No tachar el aislamiento del Diario hasta CI y Windows del SHA final y fusión verificada.

### Multimoneda y moneda funcional — parcial
Evidencia:
- `Company` guarda historiales `functionalCurrencyAssessments` y `exchangeabilityAssessments`.
- `ConfiguracionView.tsx` captura moneda funcional y de presentación, factores económicos, evidencia, preparador/aprobador y evaluación de convertibilidad por fecha, propósito y monto.
- `functionalCurrency.ts` valida expedientes aprobados y exige evidencia, acceso legal/efectivo y tasas accesibles o estimadas sustentadas; existen pruebas en `functionalCurrency.test.ts`.
- La interfaz declara expresamente que la captura no ejecuta conversiones ni altera asientos históricos.
- `JournalEntryItem` mantiene importes Bs./USD y `JournalEntry` conserva `bcvRate`, pero no identifica por línea la moneda original de la transacción ni el importe original en esa moneda.
- `AnnualReportsView.tsx` presenta los estados y revelaciones existentes; no se encontró motor de conversión de moneda funcional a moneda de presentación con tasas históricas por fecha, partidas monetarias/no monetarias, diferencias de conversión y conciliación.

Estado: **parcial**. La evaluación documental y convertibilidad están implementadas; el motor NIC 21/moneda funcional, registro de moneda de transacción y conversión de estados no están demostrados. No tachar el requisito multimoneda del Bloque 1 ni el bloque financiero.

## Bloque 2 — estados financieros
La línea base incluye vistas de estados, comparativos y revelaciones, y la hoja de ruta conserva el Bloque 2 abierto. Esta pasada no acredita una revisión normativa completa de clasificación, presentación, comparativos, notas ni conciliaciones del marco adoptado por cada empresa. El bloque permanece pendiente de auditoría detallada; no se marca completo por la mera existencia de pantallas y cálculos.


### Hallazgos adicionales — Mayor, balance y auxiliares
- `LibroMayorView.tsx` usa `filterEntriesByCompany` para limitar movimientos a la empresa activa.
- `BalancesView.tsx`, `HistoricalBalancesView.tsx` y `CashFlowStatementView.tsx` invocan cálculos o selecciones que reciben el identificador de empresa; los históricos y flujos filtran también por empresa.
- La clasificación de cuentas para flujo de efectivo permanece asociada al catálogo `accounts` compartido; al no existir `companyId` en `Account`, una clasificación configurada para una cuenta puede ser común a las empresas que comparten ese código. Requiere diseño por empresa antes de considerar completo el aislamiento de configuración.

## Bloque 2 — estados financieros: revisión focalizada
Evidencia de presencia:
- `BalancesView.tsx` contiene presentación de estados de situación y resultados con selección de empresa/período y cálculos de doble moneda.
- `CashFlowStatementView.tsx` integra los métodos directo e indirecto mediante funciones de dominio que reciben `companyId`.
- `AnnualReportsView.tsx` conserva notas/revelaciones vinculadas a empresa y ejercicio, y valida referencias a asientos de la misma empresa y período.
- La exportación anual observada genera CSV (`exportCsv`) y ofrece imprimir/PDF mediante `window.print()`. No se encontró exportación Excel nativa en esta vista.
- La existencia de reportes y revelaciones no prueba por sí sola cumplimiento VEN-NIF: faltan revisar clasificación, contenido obligatorio, notas aplicables por marco adoptado, comparativos y conciliaciones completas. Tampoco se encontró el motor de conversión NIC 21 descrito en el apartado anterior.

Estado: **parcial / pendiente de auditoría normativa y de exportación**. No se tacha el Bloque 2 ni sus requisitos de cierre.


## Bloque 5 — Bancos y tesorería: primera pasada

### Capacidades verificadas
- `BankAccount` incluye `companyId`, cuenta contable, banco, número, moneda Bs./USD y saldos iniciales.
- `addBankAccount` valida empresa activa, número venezolano de 20 dígitos, banco, moneda, tipo, duplicidad del número dentro de la empresa y saldo inicial; calcula el equivalente con la tasa aplicable.
- `TesoreriaView.tsx` filtra bancos y asientos por empresa y permite operaciones de tesorería/transferencia entre cuentas.
- `ConciliacionBancariaView.tsx` separa extracto y mayor, presenta partidas en tránsito/diferencias, permite cotejo manual, conciliación automática y desconciliación controlada.
- `bankStatementMatching.ts` valida cotejo exacto por naturaleza, fecha y doble moneda; no usa tolerancia difusa. Las pruebas correspondientes existen.
- Las operaciones de alta, conciliación y ajuste exigen SQLite local disponible; no se tratan datos de caché como autoridad.

### Brechas confirmadas
1. **Importación de extractos ausente:** la pantalla ofrece alta manual de movimiento («Nuevo Movimiento Extracto»); no se encontró selector de archivo ni parser TXT/CSV/Excel, plantillas configurables o vista previa de importación.
2. **Duplicados al cargar extractos:** `addBankStatementMovement` valida cuenta, fecha, tipo, referencia, descripción y snapshot Bs./USD, pero agrega la fila sin comprobar si ya existe el mismo movimiento en esa cuenta/empresa. La conciliación evita reutilizar un asiento ya vinculado, pero eso no evita duplicar una fila de extracto.
3. **Flujo proyectado:** la tesorería muestra saldos y movimientos existentes; no se encontró en esta pasada una proyección de caja/bancos futura con vencimientos y escenarios.
4. **Cierre de conciliación:** se observan operaciones de cotejo y exportación PDF; falta probar la secuencia completa con extracto real, saldos inicial/final, partidas pendientes, reanudación tras reinicio y persistencia de la cédula.

Estado del Bloque 5: **parcial**. No se tacha ningún requisito del bloque ni se declara conciliación integral terminada. La próxima implementación focalizada debe ser importación repetible con huella de duplicidad, previsualización y confirmación antes de persistir; no debe alterar movimientos ya conciliados ni historial.



## Bloque 6 — Cuentas por cobrar y pagar: primera pasada

### Capacidades verificadas
- CxC y CxP filtran documentos por empresa, excluyen anulados y calculan saldos pendientes desde documentos y liquidaciones.
- Ambas vistas muestran vencimientos, facturas pendientes y conteo de documentos vencidos; permiten buscar por tercero/RIF/documento.
- CxC y CxP conservan historial de cobros/pagos con fecha, importe Bs./USD, tasa, medio, referencia y asiento.
- El dominio `creditSettlement.ts` conserva la tasa del pago separada de la tasa histórica de la factura, calcula el saldo nominal y su equivalente a tasa original, y valida liquidaciones.
- CxP contempla facturas y ND tipo 02 como obligaciones separadas; anticipos directos, aplicaciones y reembolsos tienen circuitos especializados y pruebas existentes. Los frentes de anticipos y liquidaciones ya aprobados no se reabren sin defecto concreto.

### Brechas confirmadas
1. **Antigüedad por tramos:** las vistas muestran saldo abierto y vencido, pero no se observó una clasificación de cartera por rangos de días (por ejemplo, no vencido, 1–30, 31–60, 61–90 y más de 90).
2. **Exposición cambiaria:** el saldo en USD y el equivalente Bs. a tasa original se presentan; no se encontró en estas vistas un reporte de exposición con comparación sistemática entre tasa histórica, tasa de cierre y diferencia de cambio por tercero/documento.
3. **Alertas:** el vencimiento se identifica dentro de las vistas, pero no se encontró un motor de alertas/notificaciones por vencimiento o mora ni un panel de tareas.
4. **Reportes por moneda/período:** la vista operativa es útil para consultar pendientes, pero falta verificar un estado de cuenta formal exportable por tercero, documento, moneda y período, con conciliación contra cuentas de control.

Estado del Bloque 6: **parcial**. Se conservan los circuitos históricos de anticipos, notas y liquidaciones; no se tacha el bloque. La próxima auditoría debe comprobar auxiliares contra cuentas de control y desarrollar antigüedad/exposición/alertas sin recalcular ni modificar liquidaciones ya registradas.



## Bloque 7 — Inventario, compras y costos: primera pasada

### Capacidades verificadas
- `InventoryProduct` y `InventoryMovement` conservan `companyId`; el contexto valida que los movimientos afecten artículos de la empresa activa y exige SQLite local.
- El Kardex registra entradas, salidas y ajustes con referencia documental, cantidad, costos Bs./USD, tasa y saldos.
- El dominio `inventoryAccounting.ts` implementa costo promedio ponderado y PEPS por capas reconstruidas desde movimientos reales; rechaza reconstrucciones que no concilien con la existencia actual y no inventa capas de apertura.
- Hay importación CSV de artículos y movimientos con validación de columnas y datos; las existencias iniciales se integran al Kardex y al Libro Diario.
- Se observan gastos atribuibles/costos de llegada, provisión por VNR, clasificación de mercancías/materias primas/productos en proceso/terminados y una matriz de producción de materiales.
- La salida valida disponibilidad y bloquea stock negativo; el comportamiento actual es bloqueo fijo, no una política configurable por empresa.
- Las devoluciones de cliente tienen validaciones; la devolución a proveedor está bloqueada de forma segura cuando no puede garantizarse la reversión fiscal, CxP e inventario completa.

### Defecto crítico confirmado — aislamiento de inventario en la interfaz
En `InventarioView.tsx` de `main`:
- `filteredProducts` parte del arreglo global `products` sin filtrar `companyId`.
- `filteredMovements` parte del arreglo global `movements` sin filtrar `companyId`.
- Los totales de valorización y el conteo de bajo mínimo usan también todos los productos.
- El tipo de datos sí guarda empresa y las funciones de dominio validan empresa activa, por lo que el defecto es de presentación/consulta; puede mostrar inventario y movimientos de otra empresa en la pantalla activa.

Estado: **parcial con defecto prioritario**. Antes de tachar el aislamiento del Bloque 7 hay que filtrar existencias, Kardex, valorización, mínimos, selección de producto y herramientas contables por la empresa activa; agregar pruebas de aislamiento y validar UI/SQLite. No modificar registros históricos ni abrir devoluciones a proveedor hasta completar el circuito fiscal y contable.



## Bloque 8 — Activos fijos: primera pasada

No se encontró módulo, tipos de dominio ni pruebas específicas para registro de activos fijos, clases, ubicación/responsable, valor residual, vida útil, depreciación, bajas, ventas o roll-forward por activo. La búsqueda de archivos y modelos en `src` no arrojó componentes/tipos de activos fijos; `accounting.ts` tampoco contiene estructuras de activos o depreciación.

Estado: **no implementado / pendiente**. No se tacha ningún requisito. Se requiere diseñar el submódulo y su persistencia SQLite antes de generar asientos automáticos.

## Bloque 9 — Nómina y RR. HH. (LOTTT): primera pasada

No se encontraron componentes, modelos ni pruebas de empleados, contratos, asistencia, novedades, nómina, deducciones/aportes, prestaciones, vacaciones, utilidades o liquidaciones. La búsqueda de rutas de nómina/empleados/LOTTT en el repositorio no devolvió un módulo funcional.

Estado: **no implementado / pendiente**. No se tacha ningún requisito. Los parámetros legales deben documentarse y versionarse con fuente oficial antes de implementar cálculos.


## Control de alcance y estado
- Se conserva REME y ajuste por inflación dentro del plan; no se elimina código ni se cambia su alcance en esta auditoría.
- No se modifica el administrador semilla.
- No se migran catálogos ni se reescriben asientos históricos.
- La hoja de ruta solo tacha la sub-tarea estructural ya verificada; los requisitos parciales y los bloques completos permanecen abiertos.

## Estado de esta pasada
- Validación estructural de códigos, padres, niveles e imputabilidad: **terminada**.
- Plan de cuentas configurable por empresa: **pendiente**.
- Auditoría integral de Diario, Mayor, balance de comprobación, moneda funcional, cierres y reversión del Bloque 1: **pendiente**.
- Bloques 2 y 5–12: **pendientes de esta secuencia de auditoría**.

No se marca como terminado ningún bloque completo ni se declara certificación VEN-NIF.
