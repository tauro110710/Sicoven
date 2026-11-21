# Instrucciones de trabajo para SICOVEN

Estas reglas son obligatorias para cualquier agente o colaborador que trabaje en este repositorio.

## 1. Ninguna Pull Request puede quedar abandonada

- No abandonar, olvidar ni dejar huérfana ninguna PR abierta.
- Toda PR creada debe tener un responsable y un siguiente paso concreto hasta su resolución.
- Completar la implementación, corregir los hallazgos de revisión y hacer que todas las verificaciones requeridas terminen correctamente.
- Cuando esté validada y sea integrable, fusionarla en `main` y comprobar que GitHub la marque como `merged` y `closed`.
- Si una PR no puede fusionarse tal como está, corregirla, actualizarla o sustituirla por una PR consolidada; cerrar expresamente la PR obsoleta indicando la PR sucesora. Nunca dejarla abierta sin seguimiento.
- No crear PR duplicadas ni ramas de trabajo sin propósito. Al terminar, verificar que no queden PR abiertas ni ramas huérfanas de la tarea.
- No declarar una tarea terminada mientras su PR siga abierta, sus checks estén pendientes o la integración no esté verificada.

## 2. Validación antes de integrar

- Ejecutar y esperar a que terminen las pruebas automatizadas, validación TypeScript, build de producción y auditorías aplicables.
- Para cambios que afecten el escritorio, SQLite, migraciones, instalador o actualización, ejecutar también la validación Windows pertinente: empaquetado, instalación/arranque, pruebas E2E y actualización conservando los datos.
- Corregir fallos y volver a ejecutar las verificaciones afectadas. No aceptar checks pendientes, cancelados o fallidos como aprobación.
- Revisar el diff completo y el alcance de la PR antes de fusionar.
- No modificar ni recalcular documentos contables históricos como efecto colateral de cambios de configuración tributaria.

## 3. Lanzamiento de versiones: autorización anticipada

El propietario del proyecto autoriza expresamente que, cuando SICOVEN esté listo para la siguiente versión, el agente complete el lanzamiento sin volver a pedir permiso.

- No preguntar si se debe publicar una versión cuando se hayan cumplido los criterios de lanzamiento.
- La siguiente versión debe ser el incremento semántico correcto respecto de `package.json` y de la última versión realmente publicada; no reutilizar versiones ni asumir que el número configurado ya fue publicado.
- Antes de lanzar, integrar en `main` todos los cambios incluidos, actualizar versión y notas de cambios, y comprobar que los workflows de CI y Windows Release concluyan con éxito.
- La validación Windows debe incluir instalador completo, instalación y arranque, integridad SQLite, migración E2E y actualización desde la versión publicada anterior preservando los datos.
- Solo después de esas verificaciones, crear el tag de versión correspondiente y activar el workflow de release configurado para publicar el instalador y metadatos de actualización en el repositorio de descargas `fenixlife1978/sicoven-descargas`.
- Esperar y verificar que la publicación terminó correctamente: release/tag, instalador, `latest.yml`, SHA-512 y archivos auxiliares de actualización. Comprobar que los enlaces publicados correspondan a la nueva versión.
- Si el flujo automático no publica por una condición del workflow, corregir el flujo de forma segura y completar la publicación; no dejar el lanzamiento a medias ni pedir autorización adicional.
- No publicar si alguna prueba crítica falla, si existe riesgo de pérdida de datos o si la actualización no conserva la base SQLite. En ese caso, corregir primero y continuar hasta completar el lanzamiento.

## 4. Comunicación y cierre

- Informar con precisión qué se implementó, qué PR se fusionó, qué pruebas se ejecutaron y el resultado real.
- Distinguir artefactos de GitHub Actions de una versión efectivamente publicada.
- No afirmar que una versión fue lanzada hasta verificar el release y sus activos en el repositorio de descargas.
- Mantener el trabajo enfocado en SICOVEN; no mezclar repositorios ni proyectos.

## 5. Objetivo prioritario vigente: inicio y reconstrucción contable histórica

El objetivo prioritario del trabajo es terminar, validar y habilitar en la siguiente versión publicada de SICOVEN la funcionalidad que permite registrar hoy una empresa y comenzar sus registros contables desde un mes o ejercicio anterior, así como reconstruir su contabilidad desde períodos históricos anteriores hasta la actualidad. No desviar el trabajo hacia otros módulos o proyectos. Mantener este objetivo hasta que los criterios de aceptación de esta sección estén implementados y probados.

### 5.1. Comportamiento funcional y fechas obligatorias

- `registeredAt`: fecha/hora administrativa real en que la empresa se registra en SICOVEN; la genera el sistema y se conserva para auditoría.
- `accountingStartDate`: fecha desde la que el contador comienza a llevar los registros ordinarios dentro de SICOVEN; es obligatoria al crear una empresa nueva y puede ser un mes/ejercicio anterior a la fecha de registro.
- `operationalStartDate`: fecha histórica real de inicio de operaciones de la empresa; es opcional y no sustituye ni limita `accountingStartDate` ni la reconstrucción.
- La reconstrucción histórica es una función separada. Puede comenzar antes de `accountingStartDate`, por ejemplo desde la fecha real de inicio de operaciones o desde el primer período que el contador decida recuperar con los soportes disponibles.
- El primer ejercicio puede ser parcial. Los ejercicios posteriores deben abrirse y cerrarse cronológicamente con saldos coherentes.
- La fecha contable/efectiva determina el período, la escala monetaria y el régimen fiscal aplicable. La fecha de digitación/incorporación se conserva separadamente para auditoría y no desplaza la operación a otro período.
- No exigir asientos ficticios, saldos iniciales inventados ni documentos fiscales retroactivos. Los registros reconstruidos deben identificarse como reconstrucción y nunca presentarse como documentos fiscales originales.

### 5.2. Principios contables, monetarios y de evidencia

- Mantener SQLite como persistencia autoritativa; no considerar cachés de interfaz como fuente de verdad.
- Conservar inalterados los documentos y movimientos originales, fechas efectivas, fechas de incorporación, soportes, referencias, tasas BCV aplicadas, autor y huellas de auditoría.
- Incorporar operaciones atrasadas en orden cronológico y recalcular, desde la fecha afectada hasta el último movimiento, todos los efectos dependientes sin borrar ni duplicar las operaciones fuente.
- Aplicar la escala monetaria histórica que corresponda a cada fecha y reconversión venezolana. Conservar valor y escala originales; convertir para presentación/comparación con exactitud y sin doble conversión ni redondeo en cascada.
- Usar tasa BCV histórica del día cuando exista y aplique. No inventar tasas ni sustituir tasas históricas ausentes por la tasa actual. Cuando falte una tasa, advertir y permitir documentar el tratamiento profesional.
- La reconstrucción histórica no exigirá una tasa BCV universal ni mostrará ese campo como obligatorio para operaciones documentadas íntegramente en bolívares. La escala monetaria histórica de la fecha se aplica independientemente de la existencia de una conversión cambiaria.
- Para operaciones en moneda extranjera, conservar siempre moneda e importe originales. Solicitar valoración/conversión a bolívares solo cuando corresponda al reconocimiento contable de la operación, a la política aplicable y a la evidencia disponible. Registrar por separado tipo de cambio, fecha efectiva, mecanismo/mercado, fuente, soporte y criterio profesional cuando sean pertinentes.
- No proyectar retrospectivamente el régimen posterior al 07-09-2018 sobre períodos anteriores. El Convenio Cambiario N.º 1 (G.O. Extraordinaria N.º 6.405, 07-09-2018) restableció la libre convertibilidad y cambió el marco cambiario; en años previos coexistieron mecanismos diferenciados (por ejemplo, CENCOEX/SICAD/SIMADI y posteriormente DIPRO/DICOM). No asumir que una sola tasa era aplicable a toda empresa u operación ni que la empresa tenía acceso a todos los mecanismos.
- La interfaz debe adaptarse al contexto histórico y al tipo de documento: en operaciones solo en bolívares, ocultar o dejar no aplicable la captura de tasa; en operaciones en divisas, mostrar los datos de moneda y valoración histórica necesarios. No pedir BCV solo porque la fecha de la operación sea anterior o posterior a un hito.
- Si la evidencia no permite determinar una tasa aplicable, no completar automáticamente con BCV actual, tasa paralela supuesta ni un valor inventado. Permitir conservar la operación en moneda original y documentar el tratamiento pendiente/profesional; bloquear únicamente los cálculos o reportes que realmente dependan de una valoración no resuelta, mostrando el impacto concreto.
- El motor debe distinguir la tasa de conversión de una operación, la tasa de reexpresión de saldos monetarios al cierre y la moneda funcional/de presentación que corresponda. No reutilizar indiscriminadamente una tasa de factura para reexpresar saldos posteriores ni una tasa de cierre para valorar operaciones originales.
- Usar representación decimal exacta para cantidades, costos, importes y saldos sensibles. No serializar `BigInt` directamente en JSON; persistir decimal canónico como texto o coeficiente textual más escala. Convertir a `number` solo en límites de compatibilidad/presentación donde esté justificado.
- Diferenciar devolución física, nota de crédito comercial, reversión y ajuste; conservar vínculos al documento/movimiento original y su costo/capa PEPS cuando aplique.

### 5.3. Cobertura integral requerida

La reconstrucción debe abarcar, con vínculos y validaciones cruzadas:

- Inventario, Kardex, existencias, capas PEPS, costo promedio, costos de salida y devoluciones.
- Compras, ventas, notas de crédito, notas de débito, ajustes y operaciones de producción cuando existan.
- Cuentas por cobrar y pagar por tercero y documento, cobros, pagos, anticipos, aplicaciones y reembolsos.
- Caja, bancos, movimientos de tesorería, extractos, conciliaciones y partidas en tránsito.
- Activos fijos, adquisición, depreciación financiera, depreciación fiscal cuando aplique y bajas.
- IVA propio, retenciones de IVA, IGTF, ISLR, retenciones de ISLR, declaraciones, pagos, enteramientos y rectificaciones.
- Asientos, Libro Diario, Libro Mayor, balances, resultados, patrimonio, cierres y aperturas de ejercicios.
- Trazabilidad de documentos y soportes, autoría, fechas, tasas y decisiones profesionales.

No considerar completa una reconstrucción porque solo cuadren los asientos del mayor. Conciliar también auxiliares: CxC por cliente/factura, CxP por proveedor/factura, bancos por cuenta, inventario por producto/cantidad/costo, activos fijos y depreciación acumulada, e impuestos/anticipos/retenciones.

### 5.4. Motor y coordinador transaccional de reconstrucción

Antes de activar escrituras de reconstrucción integral, implementar y auditar un coordinador transaccional idempotente en la capa Electron/SQLite. No ejecutar la reconstrucción mediante una secuencia de setters React ni reutilizar como sustituto `runAtomicInvoiceImport()`.

El diseño debe contemplar como mínimo:

1. Captura inmutable de fuentes y soportes, identificadores y hashes; registrar fecha efectiva, fecha de incorporación, empresa y disposición de cada fuente.
2. Simulación cronológica fuera de la transacción de escritura, sin alterar la contabilidad activa.
3. Checkpoints de cálculo reanudables y versionados; cualquier cambio de fuentes, motor o políticas invalida los checkpoints afectados.
4. Validación explícita de cobertura por módulo, dependencias, auxiliares, escalas monetarias, tasas y períodos fiscales.
5. Bloqueo de escritura por empresa y comprobación de que las fuentes no cambiaron desde la simulación.
6. Confirmación en transacción SQLite inmediata: resultados, vínculos a fuentes, auditoría y estado `COMMITTED` deben quedar en la misma transacción.
7. Recuperación inequívoca después de caída o pérdida de respuesta: no repetir operaciones confirmadas; rollback completo si no hubo commit; intervención si no puede demostrarse el resultado.
8. Reversión/rollback seguro y verificable; ninguna confirmación parcial que deje inventario sin costos, declaraciones sin vínculos, asientos sin auxiliares o documentos sin trazabilidad.

Registrar ejecuciones, fuentes, checkpoints, salidas y auditoría con identidad idempotente basada en empresa, período, huella de fuentes, versión del motor y políticas. Repetir exactamente la misma identidad debe recuperar el resultado original; datos o políticas diferentes deben generar una ejecución diferenciada y validada.

Estados mínimos a contemplar: `PREPARED`, `SIMULATING`, `VALIDATION_REQUIRED`, `READY_TO_COMMIT`, `COMMITTING`, `COMMITTED`, `ROLLING_BACK`, `ROLLED_BACK` y `RECOVERY_REQUIRED`. No presentar un plan cronológico como autorización de ejecución: la validez del orden y la cobertura completa son condiciones separadas.

### 5.5. Orden obligatorio de ejecución del trabajo

Trabajar en este orden, cerrando cada fase con PR integrada y pruebas satisfactorias antes de avanzar. Si una falla revela una dependencia previa, resolverla en la misma secuencia y documentar el bloqueo; no saltar a la activación.

1. Terminar la PR #177, recuperación de snapshots contables confirmados tras pérdida de respuesta IPC: revisar diff y seguridad, validar Linux/Windows, migración y actualización, integrar en `main` y comprobar workflow post-merge.
2. Completar recuperación idempotente de handlers especializados que escriben directamente en tablas propias: reapertura de ejercicio/período, auditoría y expedientes correctivos, nómina, documentos y eventos fiscales. Auditar cada handler individualmente; no aplicar una solución mecánica. Reintentos tras commit deben devolver el resultado original, no limitarse a rechazar duplicados. Probar fallos antes y después del commit, reinicio y concurrencia, con aislamiento por empresa y actor.
3. Completar compatibilidad de fechas efectivas/incorporación y precisión decimal exacta en todos los flujos de escritura, importación y replay: compras, ventas, inventario, devoluciones, PEPS/promedio, CxC/CxP, anticipos, bancos, activos y fiscalidad. Corregir la asignación de capas PEPS originales en devoluciones de clientes y asegurar que operación ordinaria y replay reproduzcan los mismos resultados.
4. Completar conciliación formal persistida de bancos y conciliaciones cruzadas de auxiliares contra el mayor y los saldos de apertura/cierre. Las diferencias deben quedar visibles y justificadas; no ocultarlas mediante tolerancias arbitrarias ni crear libros paralelos.
5. Corregir cierres, reaperturas y procesos fiscales/activos por lotes: comparar fecha efectiva y fecha de incorporación; asegurar atomicidad/recuperación de depreciaciones por lote, asientos y eventos fiscales; preservar declaraciones presentadas y rectificar mediante nuevos eventos enlazados.
6. Implementar el coordinador transaccional de reconstrucción histórica y sus tablas/índices/migraciones con aislamiento por empresa, hashes, checkpoints, auditoría, simulación, validación, commit atómico y recuperación.
7. Ejecutar pruebas integrales de reconstrucción desde un período antiguo hasta la actualidad, incluida empresa creada hoy con `accountingStartDate` anterior, primer ejercicio parcial, cierres/aperturas, reconversiones, tasas BCV históricas, operación atrasada insertada después, recálculo cronológico, devoluciones/capas PEPS, auxiliares y conciliaciones.
8. Solo cuando todos los criterios estén aprobados, habilitar la funcionalidad en la interfaz y reglas de negocio, actualizar documentación/notas, incrementar versión y publicar la siguiente versión de SICOVEN conforme a la sección 3.

### 5.6. Pruebas de aceptación obligatorias antes de habilitar

- Crear hoy una empresa con `accountingStartDate` en un mes/ejercicio anterior y `operationalStartDate` opcional; verificar que `registeredAt` sea la fecha administrativa real.
- Registrar operaciones desde el período elegido, crear primer ejercicio parcial, cerrar cada año y abrir el siguiente sin saldos ficticios.
- Reconstruir desde una fecha anterior a `accountingStartDate` usando soportes disponibles, sin confundir reconstrucción con documentos fiscales originales.
- Continuar cronológicamente hasta la actualidad y conciliar mayor con todos los auxiliares.
- Incorporar una operación atrasada en un período ya reconstruido y comprobar recálculo de todos los efectos posteriores sin borrar ni duplicar fuentes ni resultados.
- Verificar PEPS, promedio ponderado, devoluciones, notas de crédito y costos contra los movimientos originales.
- Verificar reconversiones y escalas monetarias por fecha, tasas BCV históricas y tratamiento explícito de tasas ausentes; sin doble conversión ni redondeo acumulativo.
- Simular interrupciones antes, durante y después de persistencia/commit; comprobar rollback total o recuperación exacta del resultado confirmado tras reinicio y reintento.
- Verificar aislamiento multiempresa, concurrencia, inmutabilidad de fuentes, hashes, soportes y auditoría.
- Verificar migración y actualización desde la versión publicada anterior conservando todos los datos SQLite.
- No habilitar la reconstrucción integral si existe cualquier bloqueo crítico, cobertura incompleta o resultado no demostrable. El panel debe distinguir claramente preparación, advertencias, cobertura incompleta, validación aprobada y ejecución confirmada.

### 5.7. Regla de alcance y comunicación

- Mantener como objetivo de lanzamiento la siguiente versión publicada que incluya esta funcionalidad completa; no confundir el merge de fundamentos con la activación de la reconstrucción.
- No anunciar ni marcar como funcional una capacidad que solo tenga formulario, calendario fiscal, plan de solo lectura, biblioteca decimal o pruebas parciales.
- No inventar datos, soportes, saldos, tasas ni resultados para hacer pasar pruebas. Usar fixtures identificados como tales y pruebas de integración con datos controlados.
- Mantener un registro de fases terminadas, pendientes, PR, commits, workflows y bloqueos en `AGENTS.md` o documentación de proyecto versionada, actualizándolo al cerrar cada fase.
- Priorizar velocidad mediante trabajo agrupado y pruebas focalizadas, nunca omitiendo auditorías, integridad, migraciones o validaciones Windows requeridas.


## 6. Registro de avance del objetivo histórico (actualizado 2026-11-20)

### Fase 1 — recuperación del snapshot contable central

<badge>TERMINADA E INTEGRADA</badge>

- PR #177: https://github.com/miguel110710/Sicoven/pull/177
- Commit integrado en `main`: `041a3c8c2cc2e174a6cc8cca8098a5999b468f53`.
- Incluye recibos idempotentes append-only por empresa/tipo/ID, hash de solicitud y resultado original, en la misma transacción SQLite del snapshot y la auditoría.
- Incluye recuperación/reintento del guardado central desde renderer y migración del esquema multiempresa v1→v2.
- Linux CI del commit de código `a303206372c4367ecdc5e374229537f3f9bad579`: SUCCESS (tests, TypeScript y build).
- Windows Release run `44813601173`: SUCCESS; incluye build completo sin datos demo, smoke de instalación/arranque, E2E de migración y actualización desde v1.0.17 conservando SQLite.
- El commit final de la PR añadió este plan de trabajo a `AGENTS.md`. La documentación no cambia el runtime.
- La recuperación universal sigue pendiente; esta fase cubrió el snapshot central únicamente.

### Fase 2 — recuperación idempotente de handlers especializados

<badge>SUBGRUPOS 1 Y 2 INTEGRADOS; SUBGRUPO 3 EN VALIDACIÓN</badge>

**PR #178 — integrada en main**
- URL: https://github.com/miguel110710/Sicoven/pull/178
- Commit squash: `645d40114a0768a536b665e471d90b906fa0ffba`.
- Incluye ejecutor transaccional de operaciones idempotentes, recibos por empresa/tipo/ID, hash de solicitud, actor y resultado original.
- Integra reaperturas de período/ejercicio, auditoría y expedientes correctivos, operaciones de nómina y creación de empresa.
- Linux y Windows Release SUCCESS; Windows incluyó typecheck, build sin demo, auditorías, empaquetado de validación, smoke install/launch, migración E2E y upgrade desde v1.0.17 conservando SQLite.
- Límite: IDs fallback generados dentro de preload solo protegían reintentos de la misma invocación; no garantizaban recuperación post-reinicio.

**PR #179 — integrada en main**
- URL: https://github.com/miguel110710/Sicoven/pull/179
- Commit squash: `3fa829200930421c1abc2e2beb58786bb887c504`.
- Centraliza `createOperationReceiptIdentity` y añade recibos transaccionales a incidencias fiscales IVA, importación/revisión de índices de inflación, clasificaciones RE/MRE, expedientes de fuentes alternativas y revisión documental SQLite-only.
- Linux CI run `44823092661`: SUCCESS.
- Windows Release run `44823092640`: SUCCESS; typecheck, pruebas, build sin demo, auditorías, instalador de validación, smoke install/launch, migración E2E y upgrade desde v1.0.17 preservando SQLite.
- La PR se fusionó con el HEAD esperado `047cab144a1d09a81aa46d2364e439567105359a`; sin hilos de revisión pendientes.
- No publicó versión; continúa v1.0.37.

**PR #180 — integrada en main**
- URL: https://github.com/miguel110710/Sicoven/pull/180
- Commit squash: `c1a69b356385a5426e7467cbf00cf86e8cdbd7c6`.
- Añade el diario append-only `operation_intents` y `operation_intent_completions` en SQLite de cada empresa, con ID, canal IPC permitido, tipo de operación, hash/payload, modo de invocación, actor y secuencia durable.
- El preload registra la intención antes del handler. El recibo y la finalización se confirman en la misma transacción SQLite que el efecto de negocio.
- La recuperación valida canal, tipo, hash y actor estable por ID; solicita confirmación explícita antes de reintentar. No reejecuta operaciones silenciosamente.
- La migración relacional conserva las intenciones y finalizaciones al convertir bases heredadas a tenants.
- Linux CI run `44826799162`: SUCCESS; tests, TypeScript y build producción.
- Windows Release run `44826799271`: SUCCESS; pruebas contables, typecheck, build sin demo, auditorías, empaquetado, smoke install/launch, migración E2E y upgrade desde v1.0.17 conservando SQLite.
- No publicó instalador ni actualizó la release; continúa v1.0.37.
- Los workflows push-main posteriores (`44827742157` y `44827742120`) fallaron antes de asignar runner y ejecutar pasos; el reintento tuvo el mismo resultado. Esto queda como incidencia de ejecución de Actions, separada de la validación Linux/Windows exitosa de la PR.

**Subgrupo 3 en validación — `feat/company-metadata-saga` (PR siguiente)**
- Convierte la actualización de ficha empresarial, que afecta la base de control y la base tenant, en una saga recuperable.
- `company_metadata_intents` registra en la base de control la solicitud, hash, valores anteriores/nuevos y actor, dentro de la misma transacción que actualiza el registro de empresa.
- La base tenant registra el evento de auditoría y su recibo idempotente en una transacción local. La base de control registra la finalización después de confirmar el recibo tenant.
- Si SICOVEN se cierra entre ambas bases, la intención permanece y se reconcilia al consultar/listar empresas; el recibo evita duplicar el evento de auditoría.
- La reconciliación conserva el actor original y no revierte metadata ya confirmada. Las empresas archivadas o eliminadas no se abren ni se sustituyen para intentar recuperar la operación.
- La actualización recibe un ID estable y el preload reintenta la misma solicitud dentro de la invocación.
- Se detectó que PR #180 añadió las tablas de intención a empresas con esquema v2 sin subir el número de esquema. Esta rama corrige el punto: esquema tenant v3, migraciones v1→v3 y v2→v3, y pruebas de creación de las tablas en bases existentes.
- Incluye pruebas de interrupción antes del audit tenant, después del audit tenant y antes de la finalización de control, recuperación idempotente, rollback de metadata/intent y recreación del esquema tras restauración global.
- Aún no integra el diario durable de creación de empresa; sigue pendiente porque puede quedar un archivo SQLite tenant huérfano antes de registrar la empresa.

**Pendiente dentro de la fase de límites transaccionales**
- Completar diario durable de creación de empresa en la base de control y reconciliar bases tenant huérfanas verificando identidad, snapshot inicial y recibo `company_created`; nunca sobrescribir ni borrar un archivo no verificado.
- Completar el protocolo de adjuntar soportes/documentos: staging, hash, journal, commit/reconciliación SQLite-filesystem y recuperación segura de huérfanos.
- Auditar handlers de escritura directa que todavía no usan recibos/intenciones; no asumir cobertura universal.
- Resolver de forma visible intenciones que fallan validación o quedan pendientes; el usuario debe poder revisar, reintentar o cerrar de forma auditada, nunca perderlas silenciosamente.
- Probar fallos antes/después de COMMIT, reinicio, reintento, concurrencia, aislamiento multiempresa/actor y recuperación del resultado original.
- Actualizar este registro al cerrar cada subgrupo y al fusionar su PR.

### Estado de publicación

- Última versión publicada conocida: `v1.0.37`.
- No se ha publicado una versión nueva por estas fases.
- La siguiente versión solo se publicará cuando se cumplan todos los criterios de activación histórica de la sección 5. No publicar fundamentos parciales como si la reconstrucción integral estuviera habilitada.


#### Seguimiento PR #181 — 2026-11-20

- Se reforzó la saga para resolver siempre la conexión SQLite de control vigente mediante `runtime.controlDb`; esto evita conservar prepared statements/conexiones antiguas después de una restauración global que reemplace la conexión.
- Se añadió prueba de rebind: registra el esquema inicial, sustituye la base de control y verifica que la consulta siguiente inicialice/reutilice las tablas en la conexión restaurada.
- La recuperación comprueba que el JSON durable coincida exactamente con empresa, razón social y RIF registrados en la intención, y valida la identidad del actor original antes de crear el evento tenant.
- HEAD de trabajo: `99a89fbddd263d66e14cce5e8319403c68bb6e3c` (puede avanzar con commits posteriores).
- CI Linux y Windows se han iniciado en tres HEADs de esta rama, pero los jobs terminaron en 2–5 segundos sin pasos ejecutados, sin URL de logs y sin artefactos de log (`BlobNotFound`). Se reintentaron dos veces; no hay salida de pruebas que permita atribuir el fallo al código ni declarar éxito.
- No fusionar PR #181 ni publicar versión hasta obtener ejecuciones Linux y Windows con pasos y resultados verificables. Si Actions sigue sin asignar runner, tratarlo como bloqueo de infraestructura del repositorio y conservar la PR en borrador.


- Se detectó una compatibilidad adicional de esquema: algunas bases tenant v2 podían tener `operation_receipts` sin `actor_username`. `initializeOperationReceiptSchema` ahora agrega esa columna de forma aditiva, sin reescribir recibos históricos; la prueba de migración conserva un recibo anterior y confirma que un recibo nuevo guarda el usuario.
- Últimos workflows de la rama: Linux `44829935543` y Windows `44829935432`, HEAD `fbe88973a4c0d94f89a7c1618bbe87fb0abcf34b`; ambos terminan sin pasos/logs disponibles. Se mantiene bloqueada la fusión por falta de validación ejecutable.

- Se reintentaron los workflows del HEAD actual `234cb7996a336941930dfbb463b82d94b735a288`: Linux run `44830034770` (job `136616582211`) y Windows run `44830034797` (job `136616596611`). Ambos volvieron a terminar en 2–4 segundos, sin pasos ejecutados ni logs disponibles. Se mantiene la PR #181 en borrador; no hay evidencia suficiente para declarar éxito ni atribuir un fallo al código.


#### Seguimiento de integración — 2026-11-21

- PR #181 fue validada y fusionada en `main` mediante squash. Commit integrado: `0ff7af591a4a0db3ccdd4d19646df0d19ccb54c0`.
- Validación de PR #181: CI Linux SUCCESS; G13 Linux/Windows SUCCESS; Windows Release SUCCESS, incluyendo empaquetado del instalador de validación, verificación de metadatos, smoke install/launch, migración E2E y actualización desde v1.0.17 preservando datos SQLite.
- La rama original de PR #182 quedó divergente tras el squash de PR #181. Para evitar reintroducir cambios ya integrados, se creó `feat/durable-company-creation-mainline` desde el nuevo `main` y se trasladó únicamente el delta de creación durable de empresas.
- La nueva rama está 12 commits adelante y 0 detrás de `main`; el diff funcional contiene siete archivos. Debe completar CI Linux y Windows Release sobre esta base antes de reemplazar/cerrar la PR #182 original.
- No se publicó versión; la última versión publicada continúa siendo `v1.0.37`. La reconstrucción histórica integral sigue deshabilitada.
