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
