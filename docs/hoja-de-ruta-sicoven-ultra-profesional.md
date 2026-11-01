# SICOVEN ULTRA PROFESIONAL — Hoja de ruta de evolución

## Gobierno del proyecto

### Regla arquitectónica innegociable: escritorio y SQLite local

- **SICOVEN es y será exclusivamente un software de escritorio.** Su funcionamiento operativo no depende ni dependerá de Vercel, ni de plataformas de hosting, despliegue o ejecución web de terceros.
- **Vercel no es de interés para el proyecto y queda fuera de su arquitectura, operación, validación y criterios de finalización.** No se utilizará como destino de despliegue, backend, base de datos, servicio auxiliar ni requisito para compilar, instalar, actualizar o ejecutar SICOVEN.
- **SQLite local es la única base de datos operativa y la única fuente de la verdad.** Los datos contables y empresariales se leen y escriben en la base SQLite local del equipo donde se ejecuta SICOVEN.
- La aplicación debe poder funcionar de forma autónoma en escritorio, sin conexión obligatoria a Vercel ni dependencia de servicios remotos para las operaciones contables, fiscales, auxiliares o administrativas.
- Cualquier integración externa futura será opcional, explícita y subordinada a SQLite local; nunca podrá sustituirla, convertirse en autoridad de datos ni impedir la operación local.
- Las compilaciones, pruebas, instaladores, actualizaciones, respaldos y restauraciones se validarán en el entorno de escritorio correspondiente. Los límites, errores o estados de Vercel no constituyen bloqueos ni señales de calidad o disponibilidad de SICOVEN.

- Repositorio único: `fenixlife1978/Sicoven`.
- Rama estable: `main`. Esta rama de hoja de ruta no sustituye a `main`.
- Versión de referencia del código: 1.0.7.
- Base de datos de escritorio: SQLite. La persistencia local debe conservar transacciones, integridad referencial, trazabilidad y recuperación.
- Cada bloque funcional se implementará en una rama/PR independiente, se probará y se fusionará a `main` solo cuando cumpla sus criterios de aceptación.
- No publicar instaladores/releases ni desplegar distribución pública sin autorización expresa.
- No introducir datos ficticios ni fuentes de datos pagadas sin autorización.
- Los parámetros fiscales y normativos deben tener fuente, vigencia y fecha de aplicación verificables; no fijar tasas/formatos como constantes inmutables cuando dependan de la normativa.
- Preservar datos históricos, asientos vinculados, reversión y bitácora. No borrar historia para corregir operaciones.
- El flujo de inicio del administrador semilla queda expresamente fuera del alcance y no debe modificarse.
- No reabrir los siete frentes funcionales ya aprobados salvo defecto concreto demostrado.

## Estado de ejecución verificado — 01/11/2026

### Bloques cerrados y fusionados en `main`

| Bloque | PR | Commit de integración en `main` | Validación |
|---|---:|---|---|
| 1. Jerarquía del plan de cuentas VEN-NIF | [#14](https://github.com/fenixlife1978/Sicoven/pull/14) | `7548ffd7c5065acf6ae235e9f31e2ab8bbb68ef0` | CI escritorio e instalador satisfactorios |
| 2. Integridad de cuentas imputables en Diario | [#16](https://github.com/fenixlife1978/Sicoven/pull/16) | `27f96be01fac69513b84eeec28d71b9c6f05a971` | CI escritorio e instalador; upgrade 1.0.6→1.0.7 conservó SQLite |
| 3. Balance y Mayor en doble moneda | [#17](https://github.com/fenixlife1978/Sicoven/pull/17) | `c58e14448eeb4f9eb2edcd366dbf9b8b6e9bcf0a` | CI escritorio e instalador; upgrade conservó SQLite |
| 4. Bloqueo de operaciones retroactivas | [#18](https://github.com/fenixlife1978/Sicoven/pull/18) | `da83c4cf557b0feb5376fdec8309e310b25554fb` | CI escritorio e instalador satisfactorios |
| 5. Interfaz y persistencia confirmada del cierre | [#19](https://github.com/fenixlife1978/Sicoven/pull/19) | `56e044774154fbd92e06486671835e0655fa8498` | CI escritorio e instalador satisfactorios |
| 6. Preparación validada del asiento de apertura | [#20](https://github.com/fenixlife1978/Sicoven/pull/20) | `0c0b511e7eacc39973762d28ff553a69981e8757` | Desktop run 41228459268 success; Windows installer run 41228459069 success |
| 6.1. Integración de apertura contable confirmada en SQLite | [#21](https://github.com/fenixlife1978/Sicoven/pull/21) | `c81f5fb5daae9870269eb4acaa4bc96f11c5d4fa` | Fusionado; persistencia transaccional SQLite y confirmación explícita |
| 6.2. Reapertura formal y auditable de períodos | [#22](https://github.com/fenixlife1978/Sicoven/pull/22) | `f016d10acbdc501be5d554ff9815de23858b1338` | CI escritorio/Windows y upgrade 1.0.6→1.0.7 con SQLite conservada satisfactorios |
| 6.3. Cierre y apertura de ejercicios integrados | [#23](https://github.com/fenixlife1978/Sicoven/pull/23) | `1232800fc543a3672fe4dd92367af1dff6edd4fe` | CI escritorio/Windows y upgrade con conservación SQLite satisfactorios |
| 6.4. Integridad del Balance General en doble moneda y aislamiento multiempresa | [#24](https://github.com/fenixlife1978/Sicoven/pull/24) | `275ab32b16f3b7e402dace923a0769cff5aceeac` | CI escritorio/Windows satisfactorios; validaciones Bs/USD y aislamiento |
| 6.5. Estados financieros PDF en doble moneda | [#25](https://github.com/fenixlife1978/Sicoven/pull/25) | `82ef632c31bbacf80611dbfbd75e6515d64bd257` | CI pre-merge y post-merge escritorio/Windows SUCCESS; upgrade 1.0.6→1.0.7 conservó SQLite y artefacto Windows cargado |
| 2.1. Corrección del corte acumulado de balances históricos | [#27](https://github.com/fenixlife1978/Sicoven/pull/27) | `9d8147e52b3e9be7c470c281537ddaf8e59c8692` | CI escritorio `41235602359` y Windows `41235602352` SUCCESS; upgrade 1.0.6→1.0.7 conservó SQLite y artefacto Windows cargado |
| 2.2. Corrección de aperturas anuales y saldos históricos | [#29](https://github.com/fenixlife1978/Sicoven/pull/29) | `48e48bd6d4a1958125a8663759c8c244e361623d` | CI escritorio `41237562263` y Windows `41237562281` SUCCESS sobre SHA `8f8cfd3491e255eec19447665e4eb0421beed4ee`; NSIS y upgrade 1.0.6→1.0.7 conservaron SQLite |
| 2.3. Estado de Cambios en el Patrimonio con trazabilidad | [#32](https://github.com/fenixlife1978/Sicoven/pull/32) | `2415abcd2a9645e44931343f0464c604190d9a60` | CI escritorio `41238252145` y Windows `41238252132` SUCCESS sobre SHA `f9a5f21dbd34334fe448b2428122cc1457a3839c`; NSIS y upgrade 1.0.6→1.0.7 conservaron SQLite |
| 2.4. Estado de Flujos de Efectivo — método directo | [#33](https://github.com/fenixlife1978/Sicoven/pull/33) | `69887137207e17689a6522e0da0bc490b8e33bf4` | CI escritorio `41240097710` y Windows `41240097834` SUCCESS sobre SHA exacto; NSIS, upgrade 1.0.6→1.0.7, conservación SQLite y artefacto cargado |
| 2.5. Estado de Flujos de Efectivo — método indirecto | [#36](https://github.com/fenixlife1978/Sicoven/pull/36) | `8780894d427b4405bd8ab29c07042664ca23bb7b` | Desktop run `41242571620` SUCCESS; Windows run `41242571654` SUCCESS: NSIS, instalador verificado, upgrade 1.0.6→1.0.7 conservó SQLite y artefacto CI cargado (sin publicar release) |
| 2.6.1. Validación estricta de importes del anexo cuantitativo | [#40](https://github.com/fenixlife1978/Sicoven/pull/40) | `18bba4834566227dacbad8ac39cca2beffc76ccf` | Desktop `41245847791` SUCCESS; Windows `41245847806` SUCCESS: 386 pruebas, TypeScript, build, auditoría de recursos, NSIS y actualización 1.0.6→1.0.7 con conservación SQLite |

El PR #20 se fusionó mediante *squash* solo después de comprobar que ambos trabajos CI terminaron en `success`, que el SHA de la rama coincidía con `c6d515af1608cbe7d3efa0c8d8ff792d018d7c98` y que GitHub reportaba el PR abierto y fusionable. No se publicó instalador ni release.

### Secuencia contable 6.1–6.5 — completada e integrada

Los cinco subbloques están fusionados en `main`:

- **6.1 — PR #21:** integración de apertura contable confirmada en SQLite. La apertura requiere confirmación explícita y persiste mediante el flujo transaccional existente.
- **6.2 — PR #22:** reapertura formal y auditable de períodos, con registro append-only y conservación del cierre original e históricos.
- **6.3 — PR #23:** cierre y apertura de ejercicios integrados, con controles de fechas, duplicidad, empresa y trazabilidad.
- **6.4 — PR #24:** Balance General validado en Bs. y USD y filtrado por empresa antes del cálculo; pruebas de descuadres, aislamiento y valores no finitos.
- **6.5 — PR #25:** exportación PDF horizontal de estados financieros con columnas nativas separadas en Bs. y USD, sin convertir una moneda en la otra.

**Estado:** los PR #21 a #25 están cerrados y fusionados. Los CI posteriores a PR #25 de escritorio y Windows terminaron SUCCESS. El run Windows `41234017655` completó compilación NSIS, verificación del instalador, upgrade 1.0.6→1.0.7 con conservación de SQLite y carga del artefacto. El artefacto permanece sin publicar como release. No publicar instalador ni release.

### Bloque 2.1 — Comparativos históricos y corte acumulado — integrado

- **PR #27:** corrige la selección temporal de movimientos en los balances históricos.
- El Estado de Situación utiliza los movimientos acumulados de la empresa hasta el cierre del ejercicio seleccionado, incluidos los asientos de cierre.
- El Estado de Resultados conserva la actividad del ejercicio seleccionado y excluye los asientos de cierre.
- El resultado acumulado/del ejercicio se incorpora al patrimonio presentado en ambas monedas.
- Se añadieron pruebas para corte acumulado, selección anual, cierres, fechas futuras y aislamiento por empresa.
- CI escritorio `41235602359` y Windows `41235602352`: SUCCESS sobre el SHA `cdfc432b0f4330a1ca303e82e6a348d3ab655e32`. Windows completó la compilación NSIS, upgrade real 1.0.6→1.0.7, conservación de SQLite y carga del artefacto.
- Commit de integración en `main`: `9d8147e52b3e9be7c470c281537ddaf8e59c8692`.

**Límite:** este subbloque corrige la lógica de los comparativos históricos existentes; no completa por sí solo el Estado de Flujos de Efectivo ni el Estado de Cambios en el Patrimonio. El Bloque 2 permanece abierto hasta implementar y validar los cuatro estados financieros y sus notas/revelaciones conforme al marco aplicable.

### Bloque 2.2 — Apertura anual y saldos históricos — integrado

- **PR #29:** corrige la duplicación de saldos cuando el asiento de apertura anual ya transporta los saldos de balance del ejercicio anterior.
- El selector de situación identifica aperturas anuales mediante `exerciseLink.nextPeriodStartDate`; una apertura bancaria ordinaria no reinicia el acumulado.
- El Estado de Resultados utiliza únicamente los movimientos del ejercicio y excluye los asientos de cierre y apertura.
- El resultado pendiente de cierre se presenta con el signo contable correcto en ambas monedas: crédito menos débito para ingresos, costos y gastos; los débitos de costos/gastos reducen el resultado y el patrimonio.
- Se añadieron pruebas para corte anual, apertura 2025/2026, apertura bancaria dentro del año, selección de resultados y contribución del resultado al patrimonio.
- CI escritorio `41237562263` y Windows `41237562281`: SUCCESS sobre SHA `8f8cfd3491e255eec19447665e4eb0421beed4ee`. Windows completó NSIS, upgrade real 1.0.6→1.0.7 y verificación de conservación de SQLite.
- Commit de integración en `main`: `48e48bd6d4a1958125a8663759c8c244e361623d`.

**Estado del Bloque 2:** están integrados el Estado de Situación Financiera, el Estado de Resultados, los comparativos históricos, el Estado de Cambios en el Patrimonio y los Estados de Flujos de Efectivo por método directo e indirecto (PR #33 y PR #36). Las notas y revelaciones están integradas mediante el PR #38. El Bloque 2 continúa abierto para la validación normativa integral del conjunto de estados financieros y sus conciliaciones.


### Bloque 2.5 — Estado de Flujos de Efectivo por método indirecto — integrado

- **PR #36:** incorpora el cálculo del flujo operativo indirecto desde el resultado neto, ajustes no monetarios explícitos y variaciones clasificadas de capital de trabajo.
- Presenta Bs. y USD por separado, sin conversión cruzada; inversión y financiación reutilizan los movimientos clasificados del método directo.
- Cada cuenta requiere tratamiento explícito; no se presume su naturaleza por el nombre. Se validan compatibilidad de clasificación e importes finitos, y las partidas no clasificadas impiden marcar el estado como completamente clasificado.
- La conciliación compara el efectivo calculado con el mayor contable en ambas monedas. La clasificación y sus tratamientos se persisten en SQLite local.
- Se añadieron pruebas focalizadas para utilidad neta, depreciación, capital de trabajo, doble moneda, aislamiento multiempresa, períodos inválidos, clasificación incompleta e importes no finitos.
- CI pre-fusión sobre SHA `28f09b1d3a4f49bea089cf24e6d5c5208e7d1a71`: Desktop run `41242571620` SUCCESS; Windows run `41242571654` SUCCESS.
- Windows completó compilación NSIS, verificación del instalador, actualización real 1.0.6→1.0.7 con conservación de SQLite y carga del artefacto `SICOVEN-Windows-c36f95d9b0253c584ac9d1afe5e7fd2720b7fc20` (136,701,359 bytes; SHA-256 `12a41c7d5dd0d5835c4fa4b0c96f28d0c354472349858184737ef0bfe88ac1a6`). El artefacto queda en CI y no se publica como release.
- Commit de integración squash en `main`: `8780894d427b4405bd8ab29c07042664ca23bb7b`.

**Límite:** el método indirecto depende de que la clasificación contable represente correctamente la sustancia económica de cada cuenta y movimiento. Las notas/revelaciones y la validación normativa integral del conjunto de estados financieros siguen pendientes.

### Bloque 2.4 — Estado de Flujos de Efectivo por método directo — integrado

- **PR #33:** incorpora el método directo sobre movimientos contabilizados de caja y bancos, con clasificación explícita de contrapartidas en operación, inversión, financiación o sin clasificar.
- Presenta cobros, pagos y flujos netos en Bs. y USD por separado, sin conversión cruzada; excluye transferencias internas entre cuentas de efectivo y muestra trazabilidad hasta el asiento y la cuenta de origen.
- Los movimientos no clasificados o con contrapartida no conciliada se identifican expresamente y evitan marcar el estado como completamente clasificado.
- Corrige el cálculo del saldo inicial cuando existe apertura anual vinculada: esta sustituye los movimientos históricos previos y evita duplicar el saldo transportado. La conciliación del mayor utiliza la misma base.
- La prueba cubre movimientos históricos previos, apertura anual 2026 de 500 Bs./50 USD y ausencia de duplicación; la diferencia de conciliación debe quedar en cero.
- CI pre-fusión de escritorio y Windows: SUCCESS sobre SHA `7a36442092de2ef9730759c79c8411a3a2bc2bf7`.
- Commit de integración en `main`: `69887137207e17689a6522e0da0bc490b8e33bf4`.
- CI post-fusión: escritorio run `41240097710` SUCCESS y Windows run `41240097834` SUCCESS, ambos sobre el SHA exacto de integración. Windows completó NSIS, prueba real de upgrade 1.0.6→1.0.7 conservando SQLite y carga del artefacto.
- El artefacto Windows se conserva como artefacto de CI; no se publicó release ni instalador.

**Límite:** este subbloque entrega únicamente el método directo. El método indirecto requiere ajustes de partidas no monetarias, devengos y variaciones de capital de trabajo, con conciliación independiente; no se debe simular a partir de la reclasificación directa.

### Bloque 2.3 — Estado de Cambios en el Patrimonio — integrado

- **PR #32:** incorpora un roll-forward patrimonial en Bs. y USD a partir de las cuentas y asientos contabilizados.
- Utiliza el asiento de apertura anual vinculado para el saldo inicial; cuando no existe, reconstruye saldos previos y resultados no transferidos.
- Detalla los movimientos de cuentas patrimoniales y conserva vínculo con el asiento fuente.
- Cuando el asiento CIERRE ya transfirió el resultado al patrimonio, lo incluye una sola vez; si no existe transferencia, muestra el resultado del ejercicio por separado.
- Integra el estado en Reportes Anuales y en la exportación CSV.
- No atribuye automáticamente aportes, dividendos, reservas o ajustes si el asiento no los identifica.
- CI escritorio `41238252145` y Windows `41238252132`: SUCCESS sobre SHA `f9a5f21dbd34334fe448b2428122cc1457a3839c`. Windows completó NSIS, upgrade real 1.0.6→1.0.7 y conservación de SQLite.
- Commit de integración en `main`: `2415abcd2a9645e44931343f0464c604190d9a60`.

**Límite:** el estado presenta movimientos patrimoniales trazables, pero no inventa su naturaleza económica. Las revelaciones cualitativas y notas normativas siguen pendientes.

## Capacidades preexistentes identificadas en la inspección inicial

La inspección inicial de `main` confirma que el producto ya contiene:

- Vistas de Libro Diario, Libro Mayor y Balances conectadas desde la navegación principal.
- Contexto contable central con catálogo de cuentas, asientos, reversión de asientos y operación de cierre mediante `closeAccountingPeriod`.
- Catálogo base jerárquico en `src/data/defaultChartOfAccounts.ts`, con códigos, niveles, cuentas padre y distinción entre cuentas de movimiento y agrupadoras.
- Tipos de datos contables y de documentos en `src/types/accounting.ts`.
- Funcionalidad de compras, ventas, inventario, conciliación bancaria, tesorería, CxC/CxP, retenciones IVA/ISLR y reversión fiscal.
- Métodos de costeo declarados para inventario: promedio ponderado y PEPS.
- Generadores de libros/formatos SENIAT y pruebas dedicadas existentes.

Estas evidencias prueban presencia de componentes y modelos, no por sí solas el cumplimiento normativo integral ni el circuito funcional completo. Cada módulo será validado en su lógica, persistencia, interfaz, reportes y escenarios reales antes de declararlo terminado.

## Bloques de evolución y secuencia

### Bloque 0 — Gobierno, inventario y línea base
- Mantener esta hoja de ruta y matriz de capacidades.
- Mapear componentes, tipos, funciones, IPC/SQLite, tablas, migraciones, reportes y pruebas existentes.
- Clasificar cada capacidad como completa, parcial, ausente o pendiente de validación funcional.
- Identificar dependencias y riesgos sin tocar los siete frentes cerrados ni autenticación semilla.

**Cierre:** inventario trazable a archivos y funciones, dependencias documentadas, riesgos priorizados y pruebas focalizadas definidas.

### Bloque 1 — Núcleo de Contabilidad General VEN-NIF
- Plan de cuentas jerárquico configurable por empresa, validación de códigos, padres, niveles y cuentas imputables.
- Libro Diario con comprobantes manuales y automáticos, plantillas, asientos recurrentes y ajustes.
- Libro Mayor por cuenta y período, saldo inicial, movimientos, saldo final y referencias al asiento fuente.
- Balance de comprobación con débitos/créditos, saldos y validación de cuadre.
- Ejercicios y períodos contables: apertura, cierre mensual/anual, bloqueo y reapertura autorizada con trazabilidad.
- Multimoneda con moneda funcional, moneda de transacción, tasa histórica, importes originales y equivalentes; reglas de precisión documentadas.
- Integración con compras, ventas, inventario, tesorería y retenciones sin duplicar asientos.
- Controles de permisos, auditoría, integridad transaccional y reversión.

**Cierre:** circuito completo de registro → diario → mayor → balance; cuadre reproducible por empresa/período; cierre y bloqueo efectivos; pruebas de persistencia y reversión.

### Bloque 2 — Estados financieros VEN-NIF
- Estado de Situación Financiera.
- Estado de Resultados Integral.
- Estado de Flujos de Efectivo por método directo e indirecto, cuando los datos permitan sustentar la clasificación.
- Estado de Cambios en el Patrimonio.
- Notas y revelaciones configurables según marco aplicable.
- Comparativos entre períodos, histórico y reexpresado cuando corresponda.
- Presentación en moneda funcional y vistas de conversión, sin confundir conversión con reexpresión.
- Exportación PDF/Excel y rastreo de cada cifra a cuentas y asientos.

**Cierre:** ecuación contable consistente, estados enlazados al mayor, comparativos reproducibles y exportaciones verificadas.

### Bloque 3 — Ajuste por inflación / REME
- Identificar marco aplicable: VEN-NIF para PYMES o VEN-NIF plenas, según entidad y período.
- Catálogo y fuente documentada de índices oficiales; conservar valor, publicación, fecha y período de aplicación.
- Clasificación monetaria/no monetaria y tratamiento de partidas patrimoniales.
- Cálculo reproducible de reexpresión, resultado monetario y movimientos relacionados.
- Papeles de trabajo, asientos propuestos/revisables, conciliaciones y revelaciones.
- Separar cifras históricas, ajustadas y comparativas.

**Cierre:** cálculos trazables a fuentes e índices vigentes, pruebas con casos contables de referencia y revisión profesional; no se declarará cumplimiento solo por aplicar un índice.

### Bloque 4 — Libros fiscales SENIAT
- Libros de compras y ventas con clasificación de operaciones, alícuotas, exentas, exoneradas y no sujetas.
- Retenciones de IVA, comprobantes, períodos, enteros y validaciones según condición del contribuyente y normativa vigente.
- Exportaciones TXT/formatos exigidos, con especificación versionada y pruebas de estructura.
- ISLR por concepto, unidad tributaria y reglas vigentes, residentes/no residentes cuando aplique.
- Conservación de comprobantes, anulaciones, notas, reversión y auditoría.
- Parámetros legales versionados por fecha efectiva y fuente oficial.

**Cierre:** conciliación entre libros, documentos, comprobantes y reportes exportados; archivos validados contra especificaciones vigentes.

### Bloque 5 — Bancos y tesorería
- Multicuentas y monedas.
- Importación de extractos TXT/CSV/Excel mediante plantillas configurables y vista previa.
- Detección de duplicados, validación de fechas/importes y conciliación manual/automática.
- Movimientos pendientes, diferencias y asientos desde movimientos aprobados.
- Flujo de efectivo histórico/proyectado y disponibilidad por cuenta/moneda.

**Cierre:** importación repetible sin duplicados, conciliación auditable y saldos bancarios explicables.

### Bloque 6 — Cuentas por cobrar y pagar
- Antigüedad por tramos, vencimientos y estados de cuenta.
- Saldos nominales y en divisas, exposición cambiaria y tasas históricas.
- Anticipos, notas de crédito/débito, cobros/pagos parciales, retenciones y aplicaciones.
- Alertas y reportes por tercero, documento, moneda y período.

**Cierre:** conciliación integral entre auxiliares y cuentas de control, sin alterar los circuitos de anticipos ya aprobados.

### Bloque 7 — Inventario, compras y costos
- Kardex, entradas/salidas, devoluciones, ajustes y trazabilidad documental.
- Promedio ponderado y PEPS configurables según política de la empresa.
- Costos históricos y multimoneda, gastos atribuibles y costo de ventas.
- Integración de compras, inventario y contabilidad.
- Control de inventario negativo configurable y auditoría.

**Cierre:** costo y existencia reconstruibles desde movimientos; integración contable cuadrada y pruebas de devoluciones/ajustes.

### Bloque 8 — Activos fijos
- Registro de activos, clases, adquisición, ubicación, responsable, valor residual y vida útil.
- Métodos de depreciación y calendario.
- Diferenciación contable/fiscal y ajuste por inflación cuando corresponda.
- Mejoras, transferencias, bajas y ventas.
- Asientos, auxiliares y reportes.

**Cierre:** roll-forward por activo, depreciación reproducible y asientos conciliados.

### Bloque 9 — Nómina y RR. HH. (LOTTT)
- Expediente, contrato, salario, asistencia y novedades.
- Nómina, deducciones, aportes y recibos.
- Prestaciones, garantía trimestral, intereses, vacaciones, bono vacacional, utilidades y liquidaciones.
- Parámetros legales versionados y soportados por fuente oficial.
- Integración contable y auditoría.

**Cierre:** cálculos verificables por período y trabajador, recibos y asientos conciliados.

### Bloque 10 — Facturación fiscal y documentos electrónicos
- Correlativos, números de control, series y formatos de impresión aplicables.
- Integración con equipos/proveedores compatibles cuando exista documentación técnica y legal.
- Manejo de contingencias, anulados y trazabilidad.
- No afirmar homologación o autorización fiscal sin evidencia documental.

**Cierre:** documentos consistentes con libros y contabilidad; compatibilidad/homologación acreditada cuando se anuncie.

### Bloque 11 — Multiempresa y despacho contable
- Aislamiento de datos y configuración por empresa.
- Ejercicios, monedas, parámetros y permisos individuales.
- Consolidación solo cuando proceda y con reglas documentadas.
- Panel de vencimientos, tareas y estado de clientes.
- Bitácora y reportes por empresa.

**Cierre:** pruebas cruzadas que demuestren que ninguna empresa puede leer o modificar datos de otra sin autorización.

### Bloque 12 — Reportes, análisis e IA asistiva
- Centro de reportes con filtros y exportaciones.
- Indicadores, comparativos y ratios sustentados por datos contables.
- Alertas de duplicados, saldos inusuales e inconsistencias.
- IA para explicar y orientar; no contabiliza, altera ni revierte operaciones sin autorización explícita.
- Toda recomendación debe mostrar datos de origen y límites.

**Cierre:** reportes reconciliados y acciones de IA limitadas por permisos, confirmación y trazabilidad.

### Bloque 13 — Seguridad, respaldos, restauración y experiencia
- Respaldos automáticos/manuales, integridad, retención y restauración validada.
- Migraciones versionadas, recuperación ante fallos y protección contra sobrescritura.
- Permisos, sesiones, auditoría y soportes.
- UX profesional, navegación, búsqueda, tablas, formularios, impresión, accesibilidad y adaptación de pantalla.
- Actualización del instalador preservando datos.

**Cierre:** restauración real probada, actualización preserva datos, regresión aprobada y documentación de operación.

## Política de PR y fusión

1. Un PR por bloque funcional o subbloque cohesivo.
2. Cada PR declara alcance, archivos tocados, riesgos, migraciones, pruebas ejecutadas y limitaciones.
3. No fusionar si hay fallos de pruebas, regresiones, cambios fuera de alcance o dudas sobre integridad de datos.
4. Los bloques se fusionan secuencialmente a `main`; el siguiente parte del `main` ya actualizado.
5. Reutilizar la línea base histórica aprobada; no repetir automáticamente la suite completa de 320 pruebas si no hay cambios que lo justifiquen. Ejecutar pruebas focalizadas y regresión selectiva.
6. La publicación de instalador/release es una decisión separada y requiere autorización expresa.

## Criterio global de finalización

SICOVEN se considerará listo para una actualización profesional integral cuando los circuitos contables, fiscales y auxiliares estén completos; los estados financieros cuadren y sean trazables; los cálculos normativos tengan fuentes y vigencias; la multimoneda y multiempresa estén aisladas y verificadas; las exportaciones funcionen; la restauración y actualización preserven datos; la UX sea consistente; no existan defectos bloqueantes; y la versión instalable haya sido probada. La publicación final se hará únicamente con autorización expresa.


### Bloque 2.6 — Notas y revelaciones de estados financieros — integrado

- **PR #38:** incorpora notas cualitativas por empresa y ejercicio en Reportes Anuales.
- Tipos disponibles: políticas contables, estimaciones, compromisos, contingencias, partes relacionadas, hechos posteriores y otras revelaciones.
- Cada nota conserva título, contenido, número, estado de borrador/revisada y referencias explícitas a cuentas y asientos fuente.
- Las notas se persisten en el snapshot SQLite, se incluyen en respaldos y restauraciones, y se validan al guardar e importar: empresa, ejercicio, referencias, existencia de cuentas/asientos y unicidad del número de nota por empresa/ejercicio.
- El anexo cuantitativo presenta movimientos anuales del mayor por cuenta en Bs. y USD separados, excluye asientos de cierre y aclara que los movimientos no equivalen a saldos de cierre.
- Las notas aparecen en la vista imprimible del reporte anual y en la exportación CSV. Se corrigió la alineación de columnas de las filas de notas y del anexo cuantitativo.
- CI escritorio run `41244103656`: SUCCESS; completó instalación, pruebas automatizadas, controles de autenticación, TypeScript, auditoría de recursos y build.
- CI Windows run `41244103534`: SUCCESS; compilación NSIS, verificación del instalador, actualización real 1.0.6→1.0.7 conservando SQLite y carga del artefacto.
- Artefacto CI: `SICOVEN-Windows-a97c25fcf19cf1b312393dc6afafec331a083d9c`, 136,703,161 bytes; SHA-256 `0e6980179c91fb1a2398b818c3ea4cff573afc4f66f0413c5018ad38bfd54907`. Se conserva como artefacto de CI; no se publicó release ni instalador.
- Commit de integración squash en `main`: `8fd31a5c7b805db6ffab0e85a6fa3884d625fece`.

**Límite:** la herramienta permite documentar notas y anexar movimientos trazables, pero no certifica por sí sola el cumplimiento VEN-NIF ni genera automáticamente todas las revelaciones exigibles para cada tipo de entidad. La validación normativa integral, suficiencia de notas y conciliación profesional de los cuatro estados siguen pendientes; por tanto, el Bloque 2 no se declara globalmente terminado.


### Bloque 2.6.1 — Validación estricta del anexo cuantitativo — integrado

- **PR #40:** corrige `buildDisclosureAccountMovements` para rechazar importes no finitos (NaN e ±Infinity), negativos, referencias de cuenta inexistentes, empresa vacía y ejercicios inválidos, en lugar de convertir silenciosamente ciertos valores inválidos a cero.
- Conserva el cálculo de movimientos por empresa y ejercicio, la separación de Bs. y USD, la exclusión de asientos `CIERRE` y la trazabilidad a los asientos de origen. No modifica asientos, históricos, SQLite, autenticación ni el administrador semilla.
- La prueba de naturaleza acreedora de ingresos fue ajustada para esperar saldo positivo (crédito menos débito), consistente con la convención de la función.
- CI sobre SHA `74af5496d006d8dc77469ba85d6178c9548530c9`: Desktop run `41245847791` SUCCESS; Windows run `41245847806` SUCCESS.
- Windows completó las pruebas automatizadas (386 pruebas), TypeScript, build del renderer, auditoría de recursos, compilación NSIS, verificación del instalador y actualización real 1.0.6→1.0.7 conservando SQLite. Artefacto cargado en CI, sin publicar release ni instalador.
- PR #40 fusionado mediante squash en `main`; commit de integración: `18bba4834566227dacbad8ac39cca2beffc76ccf`.

**Límite:** este subbloque refuerza la validación de entradas del anexo cuantitativo. No certifica el cumplimiento VEN-NIF ni sustituye la validación normativa integral, suficiencia de revelaciones y conciliación profesional del Bloque 2.


### Bloque 3.0 — Base normativa y gobierno de índices — integrado

- **PR #42:** documenta la base normativa preparatoria del ajuste por inflación, con referencia al BA VEN-NIF N.º 2, versión 4, y su aplicación diferenciada: NIC 29 para grandes entidades y Sección 31 de la NIIF para las PYMES para entidades PYME.
- Define el criterio de reconocimiento del párrafo 15: inflación acumulada del ejercicio superior a un dígito; cuando sea de un dígito, la gerencia debe evaluar materialidad, comparabilidad y revelación suficiente.
- Documenta el tratamiento de índices del párrafo 16: IPC del Área Metropolitana de Caracas con base diciembre de 2007 para orígenes históricos anteriores al 31-12-2007 e INPC desde enero de 2008; para transacciones posteriores a diciembre de 2007, únicamente INPC mensual emitido por el BCV.
- Prohíbe sustituir el índice general por índices desagregados, promedios de los tres últimos índices, interpolaciones o proyecciones automáticas sin fundamento normativo.
- Define la jerarquía ante meses sin INPC: estimación de experto conforme al párrafo 17; estudios públicos indicados por FCCPV conforme al párrafo 18; y estimación propia excepcional del párrafo 19 únicamente si concurren sus condiciones restrictivas.
- Documenta revelaciones, sensibilidad, cambios prospectivos de estimación, evaluación de deterioro de activos no monetarios y trazabilidad completa de cada dato de índice.
- Define metadatos para conservar en SQLite local la fuente, período, valor original, publicación, fecha de consulta, evidencia/huella del documento, tipo de dato, aprobador y versiones históricas.
- Archivo añadido: `docs/bloque-3-marco-normativo-inpc.md`.
- PR #42 fusionado mediante squash en `main`; commit de integración: `5b3d7314adda953240b78958ba70921ca310684a`.
- Validación: revisión documental y contraste con el BA VEN-NIF 2 versión 4, registro de la Biblioteca Virtual FCCPV y guía de aplicación FCCPV disponible públicamente. Al ser un cambio exclusivamente documental, no modifica código funcional ni requiere reconstruir el instalador. Los estados/checks de Vercel quedan fuera de los criterios del proyecto.

**Límite:** el PR #42 es una especificación normativa preparatoria. No implementa el motor de reexpresión, no importa una serie de índices, no clasifica partidas, no calcula resultado monetario/REME y no genera asientos. No cierra el Bloque 3 ni certifica cumplimiento VEN-NIF.

**Siguiente paso del Bloque 3:** iniciar el subbloque 3.1 de verificación y carga controlada de series históricas y actuales (IPC-AMC / INPC), con fuente auténtica, períodos identificados, detección explícita de meses ausentes, versión de serie y conservación local en SQLite. No introducir cifras de ejemplo ni estimaciones no aprobadas. Antes de habilitar cálculos, confirmar la vigencia normativa aplicable al ejercicio y documentar qué publicaciones/estimaciones reconoce FCCPV para cada intervalo sin INPC.



# ACTUALIZACIÓN DE CONTINUIDAD — 31/10/2026
## Estado real posterior a PR #51

Esta actualización prevalece sobre cualquier estado anterior de los bloques 3.1, 3.2 y 3.3 que figure más arriba en este documento.

### Bloque 3.1 — Datos y evidencia de índices
- **3.1A — almacenamiento e importación:** integrado mediante PR #44.
- **3.1B — interfaz de administración:** integrado mediante PR #45.
- **3.1C — adquisición y verificación de fuentes auténticas:** investigación realizada; sigue bloqueado el cierre por falta del archivo primario auténtico verificable. No se han cargado índices reales.
- **3.1D — incorporación de series reales verificadas:** pendiente. No importar datos secundarios, proyecciones ni fixtures como índices oficiales.

### Bloque 3.2 — Clasificación monetaria/no monetaria
- **3.2A — modelo de clasificación:** integrado.
- **3.2B — persistencia SQLite e historial inmutable:** integrado.
- **3.2C — interfaz:** integrado mediante PR #49, commit de integración `554de310bb7b410461540f65e114b04cfb1e4544`.
- **3.2D — matriz de casos profesionales y pruebas:** integrado mediante PR #50, commit de integración `657589bdfcb75eb0d3af5bf64b41bc76a5ac2f33`.
- Pendiente: aprobación profesional con casos reales y validación del marco aplicable a cada entidad/ejercicio.

### Bloque 3.3A — control técnico de preparación de índices
- **PR #51 — INTEGRADO.**
- Commit de integración en `main`: `b90b01597214148f1cc52f2b7bbce2ddc01fed78`.
- El límite de series quedó fijado: IPC-AMC hasta diciembre de 2007 inclusive e INPC-BCV desde enero de 2008.
- Requiere versión más reciente aprobada, emisor/URL BCV, SHA-256, metadatos, cobertura mensual completa y observaciones observadas positivas.
- Rechaza meses faltantes, estimados y proyectados; no interpola ni retrocede silenciosamente a una versión anterior.
- Es un control preliminar de evidencia; `calculationEnabled` permanece siempre en `false`.
- CI pre-fusión y post-fusión de escritorio y Windows completados con éxito. La prueba Windows posterior a la fusión ejecutó la actualización real 1.0.6→1.0.7, preservó SQLite y cargó el artefacto de CI. No se publicó release ni instalador.

### Bloque 3.3B — gobierno de fuentes alternativas y estimaciones
- **Diseño documental integrado mediante PR #52**; expedientes estructurados SQLite e interfaz integrados mediante PR #53. Commit de integración #53: `e5f8d4a5554a53a83cefbd1438f002025bc89de4`.
- Implementa expedientes diferenciados para párrafos 17, 18 y 19; evidencia, metodología versionada, cobertura mensual, identidad profesional, revisión independiente, aprobación acotada a empresa/ejercicio/período/marco/finalidad, adjuntos con SHA-256 y auditoría append-only.
- Documento propuesto: `docs/bloque-3-3b-gobierno-fuentes-alternativas-reme.md`.
- Distingue INPC BCV, IPC-AMC histórico, estudio de experto (párrafo 17), estudio público indicado por FCCPV (párrafo 18) y estimación propia excepcional de la entidad (párrafo 19).
- Define evidencia, alcance de aprobación, estados, separación de estimaciones/proyecciones y pruebas negativas.
- **Salvaguarda:** no modifica el gate oficial de PR #51 ni habilita cálculos REME. La revisión profesional de vigencia normativa sigue pendiente.

### Bloque 3.3C — auditoría y diseño seguro del motor REME
- Diseño integrado mediante PR #54; commit `753b01839e1cd0362df8232a04868b8ccc348de7`.
- Auditoría identifica bloqueos: fuentes primarias y cobertura auténtica 3.1C/3.1D; resolvedor mensual de observaciones alternativas aprobadas/versionadas; clasificación conectada a componentes conciliados; casos profesionales y precisión/redondeo aprobados.
- No implementa fórmulas ni factores, mantiene `calculationEnabled=false`, no genera asientos ni modifica saldos.

### Bloque 3.3 — motor REME
**PENDIENTE; NO HABILITADO.** Solo se diseñará e implementará después de:
1. verificar la normativa vigente y su aplicación por entidad/ejercicio;
2. contar con series y/o estimaciones admisibles con evidencia original y alcance aprobado;
3. aprobar profesionalmente la clasificación de partidas;
4. fijar fórmulas, fechas, factores, redondeo y tratamiento de cada marco;
5. construir casos de referencia con resultados esperados revisados por contador público;
6. implementar papeles de trabajo, conciliaciones y asientos propuestos con aprobación expresa.

### Próxima secuencia de trabajo
1. Revisar y validar el diseño documental 3.3B contra el texto normativo vigente y aclaratorias FCCPV.
2. Convertirlo en un modelo SQLite aditivo, importación, expediente, revisión y gate alternativo, sin tocar el gate oficial.
3. Probar que cada supuesto restrictivo bloquea cuando falta evidencia y que los historiales son inmutables.
4. Solo después diseñar el motor matemático REME, inicialmente en modo de simulación aislada, sin contabilizar ni modificar saldos.
5. Mantener bloqueados cálculos de producción hasta revisión profesional y evidencia de índices.

### Estado global
Los bloques 1 y 2 tienen implementación funcional amplia, pero conservan validaciones profesionales pendientes. El bloque 3 está parcialmente implementado y no está cerrado. Los bloques 4 a 13 permanecen según el estado descrito en esta hoja de ruta; no se consideran terminados por la sola existencia de componentes previos. SICOVEN continúa siendo una aplicación de escritorio con SQLite local. La distribución final requiere autorización expresa del usuario.


---

# ACTUALIZACIÓN TRANSVERSAL — RT-01: RESPALDO DOCUMENTAL OPCIONAL

**Criterio aprobado:** la ausencia de un archivo digital adjunto no puede bloquear el registro ni la contabilización de una operación que cumpla sus validaciones fiscales y contables.

- Auditoría inicial realizada sobre el HEAD `ea7fd869fc5d9afc8e6264b5df5ad997dc41613d`.
- Los formularios `NewPurchaseModal.tsx`, `NewSaleModal.tsx` y `NewEntryModal.tsx` no contienen un requisito universal de archivo adjunto.
- Compras y ventas mantienen la obligatoriedad de los datos estructurados que correspondan: identificación fiscal, número de documento, importes y validaciones específicas.
- El número o referencia de pago requerido en ciertos escenarios es un dato de la operación, no un archivo adjunto.
- No se deben relajar validaciones fiscales, de integridad, período ni partida doble.
- La gestión documental futura distinguirá pendiente de soporte, adjunto sin revisar, verificado, observado y sustituido.
- La carga posterior no podrá modificar silenciosamente el asiento ni los datos fiscales originales.
- Los adjuntos se diseñarán para almacenamiento local seguro y metadatos/auditoría en SQLite; no se almacenarán binarios dentro del JSON general de estado.
- La responsabilidad legal de conservación del soporte sigue correspondiendo al contribuyente, con control profesional del contador.

**Documento técnico:** `docs/rt-01-independencia-contabilizacion-respaldo-documental.md`.

**Estado actualizado al 01/11/2026:** RT-01 ya está implementado e integrado en `main` mediante PR #61 (motor local) y PR #62 (interfaz). Los soportes son opcionales y no condicionan el registro ni la contabilización. La cobertura actual incorpora Compras, Ventas y Libro Diario. La ampliación a otros tipos de entidad y consultas históricas queda como evolución posterior, no como requisito para considerar integrada esta primera entrega.

**Aplicación transversal:** módulos 1, 4, 5, 6, 7, 8, 9 y 10, según el tipo de operación. La ausencia de archivo nunca será por sí sola un motivo para impedir un asiento válido.


## RT-01 — SEGUNDA FASE: MOTOR DOCUMENTAL LOCAL

**Estado:** integrado en `main` mediante PR #61. Motor documental, almacenamiento local e IPC implementados; pruebas automatizadas y CI aprobadas. La interfaz correspondiente se integró posteriormente mediante PR #62.

Implementación añadida:
- Tablas SQLite `supporting_documents` y `supporting_document_events`.
- Metadatos asociados a empresa y operación contable existente.
- Almacenamiento físico bajo el directorio privado de datos de SICOVEN.
- Selector nativo de archivos; el renderer no proporciona rutas arbitrarias.
- Formatos permitidos: PDF, JPG/JPEG, PNG y WEBP.
- Límite por archivo: 20 MB.
- Verificación de firma real del archivo frente a su extensión.
- SHA-256 calculado por SICOVEN y verificado al abrir.
- Registros documentales y eventos append-only.
- Estados: adjunto sin revisar, verificado, observado y sustituido.
- Sustitución mediante un nuevo documento, conservando el anterior.
- Registro de incorporación, revisión y acceso en auditoría.
- Autenticación y licencia requeridas en cada operación IPC.

Pruebas automatizadas añadidas:
- Adjuntar soporte después de que la compra ya exista.
- Rechazo de extensión/contenido no coincidente.
- Rechazo de empresa u operación inexistente.
- Verificación SHA-256.
- Conservación del estado de revisión al abrir.
- Sustitución sin borrar historial.
- Protección append-only.
- Rechazo de revisión de documentos sustituidos.

**Interfaz integrada — PR #62:** `SupportingDocumentsPanel.tsx` permite listar, adjuntar, abrir, sustituir, verificar y observar documentos. `AccountingContext` expone las operaciones documentales usando el token de sesión y la empresa activa. El panel está conectado a las operaciones de Compras, Ventas y Libro Diario. La interfaz informa expresamente que los adjuntos son opcionales y no afectan el registro contable.

**Validación de PR #62:** commit revisado `94a31931d6e6f80cab8216b3486419c9901526ea`; Desktop run `41308856297` SUCCESS y Windows installer run `41308856350` SUCCESS. El trabajo Windows completó la compilación NSIS, verificación del instalador y actualización real 1.0.6→1.0.7 con conservación de SQLite. PR #62 fusionada mediante squash el 01/11/2026; commit de integración `bc629d763a6b840306d8a9fdbfa9cfa3ef821aed`.

**Límites pendientes de RT-01:** la integración visual actual cubre Compras, Ventas y Libro Diario; no se debe afirmar que ya existe integración en todos los módulos transversales enumerados. La revisión profesional de expedientes y la ampliación a otras entidades/documentos siguen siendo evolución posterior. No se publicó instalador ni release.


# ACTUALIZACIÓN DE CONTINUIDAD — 01/11/2026 (PR #52–#62)

Esta sección prevalece sobre estados anteriores que indiquen como pendientes funciones ya fusionadas. Se verificaron las PR y sus commits de integración en `main`.

## Bloque 3.3B — expedientes estructurados de fuentes alternativas REME — integrado
- PR #52 documentó el gobierno de fuentes alternativas; commit `4339fbb856848683b45dcff0739f4496932fd4f6`.
- PR #53 implementó expedientes SQLite e interfaz; commit `e5f8d4a5554a53a83cefbd1438f002025bc89de4`.
- Requisitos diferenciados para estimaciones de experto (párrafo 17), estudios indicados por FCCPV (párrafo 18) y estimación propia excepcional (párrafo 19).
- Expediente vinculado a empresa real, ejercicio, período, marco y finalidad; identidad y responsabilidad profesional; metodología versionada; cobertura mensual; evidencia adjunta con SHA-256 y referencias HTTPS con huella.
- Revisión independiente: importador no revisa y autor no aprueba su propio trabajo. Aprobación limitada al alcance exacto del expediente. Estados, decisiones y evidencias append-only.
- No modifica el gate oficial BCV de PR #51, no incorpora índices reales/ficticios, no habilita cálculos ni genera asientos. Revisión profesional de vigencia normativa pendiente.

## Bloque 3.3C — auditoría y diseño seguro del motor REME — integrado como diseño
- PR #54; commit `753b01839e1cd0362df8232a04868b8ccc348de7`.
- Auditoría documentó los contratos y bloqueos previos al motor: falta verificación de fuentes primarias/cobertura auténtica 3.1C/3.1D; falta resolvedor mensual de observaciones alternativas aprobadas y versionadas; clasificaciones aún no conectadas a componentes conciliados consumibles; faltan casos profesionales y precisión/redondeo aprobados.
- No implementa fórmulas ni factores. `calculationEnabled=false`; sin asientos ni cambios de saldos, cierres o históricos.

## Bloque 4 — auditoría y subbloques de retenciones IVA
- PR #55 auditoría integrada; commit `f13cadac3a747fd5d12e3972ab27898fb44a22de`. Su matriz identifica pendientes normativos y de circuito completo; no certifica cumplimiento SENIAT ni aceptación de archivos.
- PR #57 / Bloque 4.1, commit `160f3e421f8e6502c7241e219d498951bf58eb2f`: exportación TXT IVA aislada por empresa/período, período mensual obligatorio, sin números ficticios de factura/control, validación de RIF, fecha, comprobante, correlativo e importes.
- PR #58 / Bloque 4.2, commit `6f39ad8e7a629d15d65057044ee04ceb13d3b6a2`: evento fiscal IVA separado de fecha de factura; contado usa fecha efectiva de pago y crédito fecha de reconocimiento del pasivo, preservando invoiceDate.
- PR #59 / Bloque 4.3, commit `594845121f2f600f886b50652195412c9d65f9fa`: auxiliar quincenal 1–15 y 16–fin, snapshots inmutables, conciliación, declaración sin operaciones, eventos append-only, acuses, pagos parciales y vencimientos documentados manualmente.
- **Pendientes Bloque 4:** verificación de especificación TXT SENIAT vigente (incluidas columnas y declaración en cero), calendario oficial de vencimientos, elegibilidad de agente/proveedor y porcentajes/exclusiones, notas de crédito/débito, múltiples pagos parciales, comprobantes/plazos del artículo 16, rectificaciones, UT/parámetros históricos y conciliación integral libro→comprobante→declaración→enteramiento→asiento. No se afirma homologación ni presentación automática ante SENIAT.

## RT-01 — respaldo documental opcional — integrado en primera entrega
- PR #60 formalizó independencia entre contabilización y adjuntos; commit `75a0fffe6b28264211822c8843ab5bc86ab9e953`.
- PR #61 implementó motor documental local SQLite e IPC; commit `6fd3be9364d7b294e05bb8a7cdec093ec4c1c22a`.
- PR #62 integró interfaz en Compras, Ventas y Libro Diario; commit `bc629d763a6b840306d8a9fdbfa9cfa3ef821aed`.
- PR #62: Desktop run `41308856297` SUCCESS; Windows run `41308856350` SUCCESS, incluyendo NSIS y upgrade real 1.0.6→1.0.7 con conservación SQLite.
- Adjuntos opcionales; PDF/JPG/JPEG/PNG/WEBP hasta 20 MB, firma binaria y SHA-256 verificados, almacenamiento privado, estados, sustitución preservando historial y eventos append-only. Interfaz permite adjuntar, listar, abrir, verificar, observar y sustituir.
- Cobertura UI actual: Compras, Ventas y Libro Diario. Ampliación a otras entidades y revisión profesional documental quedan como evolución. No se publicó instalador ni release.

## Secuencia de trabajo vigente
1. **REME 3.1C/3.1D:** conseguir y verificar archivo primario auténtico de índices y cobertura mensual; no sustituirlo por datos secundarios, proyecciones ni fixtures.
2. Completar resolvedor mensual para expedientes alternativos 3.3B, con selección estricta de observaciones aprobadas/versionadas y alcance exacto.
3. Conectar clasificación monetaria/no monetaria a componentes conciliados y consumibles, sin habilitar cálculos.
4. Obtener casos de referencia, fórmulas, fechas, factores, precisión y redondeo revisados por profesional competente.
5. Solo después implementar motor REME aislado en simulación, manteniendo deshabilitada la contabilización automática hasta autorización profesional expresa.
6. En paralelo, continuar pendientes del Bloque 4 conforme a la matriz anterior, empezando por especificación oficial TXT/calendario y elegibilidad normativa. No declarar cumplimiento SENIAT sin evidencia vigente.

## Estado global actualizado
- RT-01: primera entrega integrada; expansión pendiente.
- Bloque 3: gobierno de fuentes y diseño de seguridad integrados; REME sigue bloqueado por falta de series auténticas, resolvedor completo, conciliación y validación profesional.
- Bloque 4: subbloques 4.1–4.3 integrados; pendientes normativos y de circuito integral explícitos.
- Los bloques 1 y 2 mantienen la validación profesional integral pendiente. Los bloques 5–13 conservan el estado previamente documentado.
- SQLite local continúa como única fuente de verdad. No tocar el administrador semilla. No publicar instaladores/releases sin autorización expresa.


# DECISIÓN DE ALCANCE — EXCLUSIÓN DEFINITIVA DE REME — 01/11/2026

Esta decisión prevalece sobre todas las secciones anteriores de esta hoja de ruta que describan REME como pendiente, bloqueado, planificado o próximo paso.

## REME queda fuera del producto
- SICOVEN **no implementará el módulo REME**, su motor de reexpresión, sus cálculos, factores, ajustes ni generación de asientos.
- Motivo de alcance: el responsable del proyecto no dispone de los archivos originales de índices ni de credenciales profesionales para acceder a recursos restringidos de la Federación; tampoco corresponde sustituir esa evidencia con series secundarias, proyecciones, reconstrucciones o cifras inventadas.
- Los PR #42, #44, #45, #49, #50, #51, #52, #53 y #54, y sus componentes/documentos asociados, se conservan en el historial técnico como trabajo ya fusionado. Su existencia no significa que SICOVEN ofrezca REME ni que sus cálculos estén disponibles.
- Los componentes REME existentes no se ampliarán, no se conectarán a contabilización y no se presentarán como funciones activas. No se cargarán índices ni se habilitarán cálculos.
- Los apartados 3.1, 3.2 y 3.3 quedan **retirados del alcance funcional activo**. No son bloqueos para declarar avance de SICOVEN en sus demás módulos.
- Si en el futuro se requiere reabrir esta decisión, deberá existir una solicitud expresa, acceso legítimo a fuentes originales y participación/revisión de un profesional competente. No forma parte del plan actual.

## Secuencia activa después de excluir REME
1. **Bloque 4 — retenciones IVA/SENIAT:** continuar desde los subbloques ya fusionados 4.1–4.3. Próximo trabajo: verificación documental de la especificación técnica vigente de importación TXT, casos de declaración sin operaciones, reglas de comprobantes y calendario de enteramiento, distinguiendo claramente norma primaria, guía técnica y material secundario.
2. No declarar homologación, presentación automática, aceptación por el Portal Fiscal ni cumplimiento integral hasta disponer de especificación oficial vigente y pruebas verificables.
3. Completar la conciliación de extremo a extremo: operación y evento de retención → comprobante → auxiliar quincenal → declaración → enteramiento/pago → asiento contable y auditoría.
4. Mantener los soportes documentales opcionales de RT-01; su ausencia no bloqueará operaciones válidas.
5. Mantener pendientes de validación profesional integral de los Bloques 1 y 2, sin confundir esa validación con el desarrollo técnico ya integrado.

## Estado de continuidad
- Última entrega documental anterior: RT-01, PR #60–#62, fusionadas en `main`; PR #62 commit `bc629d763a6b840306d8a9fdbfa9cfa3ef821aed`.
- Última hoja leída antes de esta decisión: blob `d93faebabe133ab3f812190e99d14daaa2b12584` (502 líneas).
- Próximo bloque activo: Bloque 4, continuación normativa/técnica de retenciones IVA. REME no se retoma.
- Arquitectura inalterada: aplicación de escritorio; SQLite local como única base de datos y fuente de verdad; no tocar el administrador semilla; no publicar instaladores/releases sin autorización expresa.


## BITÁCORA DE AUDITORÍA — BLOQUE 4 / TXT IVA — 01/11/2026

### Hallazgos verificados en el código fusionado
- PR #57 incorpora `generateSeniatIvaTxt` con 16 campos separados por tabuladores y validaciones de RIF, período, fecha, correlativo, alícuota e importes.
- La exportación actual solo asigna tipo documental `01` (factura); el modelo no exporta notas de débito `02` ni notas de crédito `03` por este generador.
- El generador rechaza una colección vacía y remite el tratamiento de declaración sin operaciones a un formato que aún no está implementado.
- El campo de documento afectado y número de expediente se emiten como `0` por defecto. No se debe asumir que esos valores son aceptables para todos los tipos de documento.
- PR #58 separa fecha de factura y evento fiscal; PR #59 agrega snapshots quincenales, declaración sin operaciones, acuses y pagos parciales documentados.

### Contraste documental disponible — no equivale a validación vigente
- Se localizó una copia de una “Guía Fácil — Elaboración de un archivo TXT de Retención de IVA” atribuida al SENIAT, alojada en un repositorio documental de terceros y fechada/capturada con referencias de 2007–2008.
- Esa guía describe 16 columnas A–P, archivo delimitado por tabulaciones, fecha AAAA-MM-DD, tipos 01/02/03 y un ejemplo separado para declaración sin operaciones con columnas adicionales. Por su antigüedad y alojamiento no oficial, **no se acepta como especificación vigente**.
- La búsqueda en el dominio oficial SENIAT no permitió localizar una especificación técnica actual descargable que confirme el esquema actual, las columnas, la declaración en cero o la aceptación de los casos de notas de crédito/débito.
- La Providencia SNAT/2025/000054 disponible en repositorios jurídicos secundarios regula la obligación de presentar la declaración incluso sin operaciones y remite a las especificaciones técnicas del SENIAT; el calendario aplicable debe contrastarse con la providencia anual vigente. No se debe codificar un calendario fijo a partir de publicaciones de terceros.

### Decisión técnica
- Mantener bloqueada cualquier afirmación de “TXT oficial vigente”, homologación o aceptación garantizada por el Portal Fiscal.
- No inventar campos, valores sustitutos, tipos documentales ni reglas para notas de crédito/débito.
- No fabricar una línea de ceros hasta verificar el formato vigente de declaración sin operaciones.
- El generador actual queda descrito como exportación preliminar sometida a validación documental; sus validaciones internas no demuestran aceptación por SENIAT.

### Próximo subbloque activo — 4.4: cobertura documental y conciliación de retenciones IVA
1. Obtener una especificación primaria vigente del SENIAT para TXT IVA o evidencia oficial equivalente.
2. Verificar con ella el esquema de columnas, formatos, tipos documentales, documento afectado, expediente, declaración sin operaciones y reglas de importes.
3. Auditar el modelo de notas de crédito/débito y pagos parciales para asegurar que cada evento se refleje una sola vez y sin duplicar retenciones.
4. Añadir pruebas de contrato basadas exclusivamente en la especificación verificada; hasta entonces, mantener los casos no confirmados explícitamente bloqueados.
5. Conciliar operación/evento → comprobante → quincena → declaración → acuse → enteramiento → asiento y auditoría.

**Estado:** investigación documental parcial; especificación primaria vigente no localizada. No se declara cerrado 4.4 ni homologado el TXT.


### Auditoría de integridad del auxiliar quincenal — PR #59 — 01/11/2026

**Alcance de revisión:** inspección estática de `src/types/vatWithholdingDeclaration.ts`, `electron/accounting-integrity.cjs`, `electron/accounting-persistence.cjs`, `src/components/Retenciones/VatWithholdingDeclarationsPanel.tsx` y pruebas asociadas. No se ejecutó una nueva suite en esta revisión.

**Controles confirmados en el código:**
- Una sola declaración por empresa, período y quincena.
- Un comprobante no puede aparecer en más de una declaración de la misma empresa; el snapshot debe coincidir con el comprobante fuente.
- La declaración debe contener exactamente todos los comprobantes de la empresa dentro de la quincena, con asignaciones explícitas para fechas históricas que no estaban guardadas.
- Los totales de base, IVA y retención se recalculan y concilian contra el snapshot.
- Declaración sin operaciones explícita, incompatible con comprobantes dentro de la ventana.
- Las colecciones de declaraciones y eventos son append-only; las transiciones de revisión, presentación y pago tienen controles de secuencia.
- Los pagos parciales deben ser positivos, con referencia bancaria, en orden cronológico y su suma no puede superar el total retenido.

**Límites encontrados:**
- El evento de vencimiento valida estructura, referencia y patrón de dominio de la URL, pero no descarga ni verifica el contenido de la publicación enlazada. La fecha debe considerarse documentada por el usuario, no verificada automáticamente por SICOVEN.
- El formulario de pago parcial recoge importe, fecha y referencia bancaria; no incorpora una validación automatizada contra un movimiento bancario importado. La conciliación bancaria real queda pendiente.
- La revisión fue estática; no sustituye la ejecución de pruebas ni una revisión profesional de los casos fiscales.

**Resultado:** no se ordena una modificación funcional inmediata sobre la base de esta inspección. Los controles de unicidad, snapshot, totales y secuencia están presentes. La verificación primaria de vencimientos y la conciliación contra banco se mantienen como pendientes explícitos del subbloque 4.4. No se declara homologación SENIAT.


---

## ACTUALIZACIÓN DE ESTADO — 01/11/2026 — PR #63 Y VERIFICACIÓN POST-MERGE

Esta sección prevalece sobre las menciones anteriores que describían la conciliación bancaria de enteramientos IVA como pendiente dentro del subbloque 4.4.

### Bloque 4.4 — conciliación bancaria de enteramientos IVA — INTEGRADO Y VALIDADO

- PR #63: https://github.com/fenixlife1978/Sicoven/pull/63
- Rama: `feature/bloque-4-4-conciliacion-bancaria-retenciones`.
- Commit integrado en `main`: `e1bce1ebc379f95204a49561b4daf099f58edde7`.
- CI posterior al merge sobre ese SHA:
  - Desktop Validation, run 41313171085: SUCCESS. Pasaron instalación de dependencias, guardas de seguridad, pruebas automatizadas, TypeScript, auditoría de recursos, build y auditoría de assets.
  - Windows Installer, run 41313171184: SUCCESS. Pasaron pruebas automatizadas, TypeScript, build renderer, auditoría, compilación NSIS, verificación del instalador y actualización real 1.0.6 → 1.0.7 conservando datos SQLite.
- Los artefactos generados permanecen en Actions; no se publicó instalador ni release.

**Capacidades integradas:** cada nuevo evento PAYMENT exige uno o más movimientos bancarios DEBIT importados, de la misma empresa y de cuentas en Bs.; la suma debe coincidir al céntimo con el enteramiento; las fechas deben quedar entre presentación y pago; los movimientos no pueden reutilizarse. La validación existe en el contexto y en la capa de integridad SQLite. Los pagos históricos sin vínculos se mantienen como pendientes, sin asociaciones inventadas. La auditoría conserva los IDs bancarios. No se crean asientos ni se altera la conciliación bancaria contable existente.

**Límite:** la conciliación vincula datos importados; no autentica extractos con el banco ni demuestra por sí sola la recepción del pago por SENIAT.

### Investigación documental posterior — especificación TXT IVA

Se realizó una nueva búsqueda dirigida a localizar en el dominio oficial del SENIAT una especificación descargable vigente que confirme el formato del TXT de retenciones IVA. No se localizó una fuente primaria oficial pública que permita confirmar que el instructivo RI_DRIVA2020-IT01V3_0_0 (septiembre de 2020) siga vigente en 2026.

- El instructivo versión 3.0.0 de septiembre de 2020 sigue localizable en copias alojadas por terceros; sirve como antecedente técnico, no como prueba de vigencia actual.
- La Providencia SNAT/2025/000054 y publicaciones informativas secundarias reiteran que el Portal Fiscal aplica especificaciones técnicas del SENIAT; no sustituyen la publicación de esa especificación.
- No se autoriza declarar homologado el TXT, activar tipos documentales no verificados ni emitir un modelo de declaración sin operaciones basado en una plantilla antigua.
- La validación definitiva requiere una fuente primaria vigente y, cuando exista acceso autorizado, una prueba de carga en el ambiente oficial de validación. SICOVEN no necesita ni solicitará credenciales profesionales para mantener esta limitación documentada.

### Estado consolidado del Bloque 4

- **4.1 — TXT IVA preliminar:** integrado; no homologado. La especificación técnica vigente y la prueba autorizada siguen pendientes.
- **4.2 — evento fiscal IVA:** integrado para el disparador fiscal y separación de fecha documental; circuito de múltiples pagos parciales posteriores por factura aún requiere completar análisis y validación.
- **4.3 — auxiliar quincenal:** integrado; snapshots y eventos append-only. No rectifica declaraciones presentadas ni certifica presentación en el Portal Fiscal.
- **4.4 — conciliación bancaria de enteramientos:** integrado y validado técnicamente mediante PR #63 y CI post-merge SUCCESS.
- **Pendientes transversales:** notas de crédito/débito y rectificaciones fiscales después de presentar; tratamiento de retenciones ya enteradas/no enteradas; validación profesional independiente de elegibilidad y comprobantes; conciliación integral libro → compra → evento → comprobante → declaración → acuse → enteramiento → asiento; fuente primaria vigente para TXT y declaración sin operaciones; calendario y feriados oficiales versionados para plazos.

**Conclusión:** el subbloque funcional 4.4 queda cerrado en su alcance de conciliación fiscal-bancaria. El Bloque 4 completo permanece ABIERTO por los pendientes documentales, normativos y de circuito fiscal indicados. No se afirma homologación SENIAT ni cumplimiento fiscal certificado.

## ACTUALIZACIÓN DE CONTINUIDAD — EXPEDIENTES DE INCIDENCIAS IVA — 01/11/2026

### Bloque 4.5 — expediente trazable de incidencias y rectificaciones IVA

**Estado funcional:** integrado en `main` mediante PR #66, commit `3a06a744240017c63f8c6b4da1862373dd4dd08a`.

Alcance incorporado:
- Expedientes asociados a facturas, notas de crédito y notas de débito de compras.
- Persistencia en tablas SQLite locales independientes.
- Expediente, eventos y referencias con protección append-only mediante triggers.
- Aislamiento por empresa y validación de factura original, comprobante IVA, declaración, eventos fiscales, movimientos bancarios y asiento correctivo.
- Historial de incidencia, revisión y actuación documentada desde el panel de Retenciones IVA.
- Prevención de reutilización de comprobantes, eventos de pago y movimientos bancarios entre expedientes.
- Verificación de que la nota esté vinculada a la factura cuyo número declara como afectado.

**Salvaguardas y límites:**
- No se recalculan comprobantes ni se alteran snapshots, declaraciones presentadas, eventos originales, pagos, movimientos bancarios o asientos.
- Un asiento correctivo no resuelve por sí solo una incidencia.
- El estado operativo del expediente no acredita rectificación, aceptación ni recepción por SENIAT.
- No se codifica tratamiento fiscal automático de NC/ND, compensaciones, reintegros ni retenciones adicionales.
- No se exige adjuntar un archivo por cada operación.
- El administrador semilla permanece intacto.

**Validación técnica registrada antes de la integración:**
- CI de escritorio SUCCESS: 510 pruebas automatizadas, TypeScript, compilación de renderer y auditoría de activos.
- CI del instalador Windows SUCCESS: pruebas automatizadas, TypeScript, compilación NSIS y verificación del instalador.
- Prueba real de actualización 1.0.6 → 1.0.7 SUCCESS, preservando los datos SQLite.
- La ejecución posterior al merge no quedó disponible como verificación independiente en el registro consultado; por tanto, no se afirma CI post-merge adicional.
- No se publicó instalador ni release.

### Estado consolidado actualizado del Bloque 4

- **4.1 — TXT IVA preliminar:** integrado; no homologado. Pendiente especificación primaria vigente y prueba autorizada.
- **4.2 — evento fiscal IVA:** integrado. Persisten pendientes de validación profesional y circuitos de pagos posteriores.
- **4.3 — auxiliar quincenal:** integrado; snapshots y eventos append-only. No rectifica declaraciones presentadas ni certifica presentación en Portal Fiscal.
- **4.4 — conciliación bancaria de enteramientos:** integrado y validado técnicamente mediante PR #63.
- **4.5 — expediente de incidencias fiscales IVA:** integrado mediante PR #66. Documenta trazabilidad, no decide el tratamiento tributario.
- **Bloque 4 completo:** ABIERTO. La integración de 4.4 y 4.5 no equivale a homologación SENIAT ni a certificación fiscal.

### Próximo subbloque de trabajo

1. Completar la auditoría especializada del flujo de notas de débito de proveedor: documento fuente, factura afectada, CxP, base/IVA, retenciones, asiento, Kardex cuando corresponda y consistencia del libro.
2. Auditar el circuito de notas de crédito de contado: devolución real de fondos o reconocimiento de saldo a favor, conciliación de caja/banco y asiento; mantener bloqueada la acción mientras no se garantice esa trazabilidad.
3. Añadir pruebas integrales de escenarios de incidencia: factura no declarada, declaración presentada sin enteramiento, enteramiento parcial y enteramiento total. Las pruebas deben verificar que el expediente no infiere por sí mismo una solución fiscal.
4. Evaluar vínculos desde el comprobante y la declaración para facilitar consulta, sin permitir editar los registros históricos.
5. Mantener sin cambios el generador TXT hasta contar con especificación oficial vigente y validación profesional independiente.

**Regla de continuidad:** no automatizar el tratamiento tributario de NC/ND ni habilitar rectificaciones fiscales por inferencia. La decisión del contador debe quedar documentada; SICOVEN registra trazabilidad y controles, no sustituye el criterio profesional ni la actuación ante el SENIAT.

## BITÁCORA DE CONTINUIDAD — AUDITORÍA NC/ND Y NOTAS DE CONTADO — 01/11/2026

### Documentación integrada
- PR #64 fusionado: actualiza la hoja de ruta con el subbloque 4.5.
- PR #65 fusionado en commit `d5b5539bd53ab191e923628d54a64998481d6e9a`: incorpora la auditoría especializada de NC/ND y deja explícitos los pendientes posteriores a la implementación del expediente fiscal IVA.
- La auditoría confirma que el flujo de ND continúa bloqueado intencionalmente: el selector genérico mantiene deshabilitado el tipo 02 y la integridad SQLite rechaza nuevas notas de débito sin flujo contable autorizado.

### Hallazgo y corrección en curso — NC de compras pagadas de contado
- El cálculo puro de NC ya admite compras de contado y crédito.
- El modal ya admite ambas modalidades y requiere factura vigente, líneas de inventario conciliables y SQLite disponible.
- `AccountingContext.addPurchaseCreditNote` distribuye el crédito: reduce CxP solo cuando existe una obligación pendiente; si la factura fue pagada de contado, registra el importe como anticipo/saldo a favor del proveedor.
- Las pruebas de `electron/accounting-integrity.test.cjs` validan el caso de contado sin CxP ficticia y rechazan asientos que intenten crearla.
- Se detectó que la vista del Libro de Compras todavía bloqueaba el botón para `CONTADO`, contradiciendo el modal, el contexto y las pruebas SQLite.

**PR #68 — corrección de interfaz en revisión:** habilita la acción de NC de contado únicamente cuando se mantienen las salvaguardas existentes de SQLite, almacenamiento y líneas de inventario. La etiqueta indica “NC · saldo a favor” y aclara que no realiza reembolso automático de efectivo. No modifica el motor contable ni los cálculos fiscales.

### Estado de validación documental
- PR #65: CI de escritorio SUCCESS y CI de instalador Windows SUCCESS, incluida la actualización 1.0.6 → 1.0.7 con preservación de SQLite.
- PR #68: CI de escritorio e instalador Windows en ejecución al registrar esta bitácora. No fusionar hasta que ambos concluyan SUCCESS.
- No se publica instalador ni release.

### Próximas tareas después de PR #68
1. Diseñar el flujo especializado de nota de débito de proveedor: factura afectada, proveedor, CxP, base, IVA, retenciones, asiento y trazabilidad en Libro de Compras; Kardex solo cuando el hecho documentado implique mercancía.
2. Añadir pruebas de integridad SQLite que cubran ND, aislamiento por empresa, duplicidad documental, vínculo a factura original, períodos cerrados y balance de asiento.
3. No habilitar el tipo 02 en el formulario genérico hasta que ese flujo esté implementado y validado de extremo a extremo.
4. Probar los escenarios de NC después de declaración: no presentada, presentada sin enteramiento, enteramiento parcial y total; el expediente registra trazabilidad, no infiere tratamiento fiscal.
5. Mantener pendiente la fuente primaria vigente del TXT SENIAT y la revisión profesional independiente de las reglas tributarias.

**Regla de contabilización:** una NC de contado se reconoce como saldo a favor/anticipo del proveedor, no como devolución de efectivo. Cualquier reembolso real deberá tener un flujo separado, con recepción bancaria/caja y asiento conciliados. No confundir ambas operaciones.


## BITÁCORA DE CONTINUIDAD — MERGES NC CONTADO Y AUDITORÍA DE ND — 01/11/2026

### PR #68 — corrección de nota de crédito de contado
- Fusionado por squash a `main` en commit `0b471f8056fb6231cbfbe041cce753c00a04aa21`.
- Habilita el botón de NC para facturas de compra pagadas de contado, manteniendo las validaciones existentes.
- La etiqueta identifica el resultado como saldo a favor del proveedor; no ejecuta reembolso de efectivo.
- CI pre-merge SUCCESS: escritorio (pruebas, TypeScript, build y auditoría de activos) e instalador Windows (pruebas, TypeScript, renderer, NSIS, verificación del instalador y actualización 1.0.6 → 1.0.7 preservando SQLite).
- No se publicó instalador ni release.

### PR #69 — actualización de hoja de ruta
- Fusionado por squash a `main` en commit `0fb7a80562948d0b9a572c5a9be12b26123b30c8`.
- Registró el estado de PR #68 como pendiente al momento de su redacción; esta bitácora posterior deja constancia de su integración efectiva.
- CI pre-merge SUCCESS: escritorio e instalador Windows, incluida actualización 1.0.6 → 1.0.7 preservando SQLite.
- No se publicó instalador ni release.

### Auditoría especializada del tipo 02 — Nota de débito de proveedor
Se revisaron `NewPurchaseModal.tsx`, `PurchaseRecord`, `AccountingContext.addPurchase`, `LibroComprasView.tsx`, `accounting-integrity.cjs` y pruebas SQLite.

Hallazgos confirmados:
- El tipo 02 existe en el tipo TypeScript, pero el selector está deshabilitado.
- El dominio `addPurchase` rechaza todo documento distinto de tipo 01.
- La integridad SQLite rechaza altas nuevas de documentos distintos de factura 01 y NC 03.
- No existe un flujo de ND que vincule factura original, proveedor, saldo CxP, asiento, Kardex condicional y consecuencias fiscales.
- La vista puede representar un prefijo ND si ya existiera un registro, pero eso no constituye soporte de creación ni contabilización.

**Decisión:** mantener bloqueado el tipo 02. No retirar defensas ni reutilizar el alta genérica de factura. La auditoría y el contrato propuesto quedan documentados en `docs/auditoria-diseno-nota-debito-proveedor.md`.

### Requisitos previos a implementar ND
1. Flujo especializado con vínculo inmutable a factura 01 y validación de empresa/proveedor/número documental.
2. Clasificación económica explícita; no asumir que todo cargo incrementa inventario o IVA.
3. Asiento balanceado en Bs. y USD y conciliación real de CxP/anticipos, sin pago ficticio.
4. Kardex solo cuando exista mercancía recibida o ajuste de costo técnicamente reproducible; ninguna cantidad ficticia.
5. Retenciones y comprobantes sin recalcular ni alterar históricos por inferencia; regla primaria vigente y decisión profesional para automatización.
6. Validaciones de dominio y SQLite, idempotencia, append-only y pruebas negativas multiempresa/períodos cerrados.
7. CI escritorio e instalador Windows SUCCESS antes de integrar.

**Estado del Bloque 4:** continúa ABIERTO. PR #68 resuelve el bloqueo de interfaz para NC de contado, pero no habilita reembolsos de efectivo ni rectificaciones fiscales automáticas. El tipo 02 sigue deliberadamente deshabilitado. No se declara homologación SENIAT ni certificación fiscal.
