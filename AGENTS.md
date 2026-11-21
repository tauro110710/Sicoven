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

## 5. PRIORIDAD ABSOLUTA: REGISTRO CONTABLE CRONOLÓGICO SIMPLE

El propósito de SICOVEN es facilitar al contador el registro de una empresa y sus operaciones, sin convertirlo en operador de procesos técnicos.

### Flujo normal requerido
- Registrar una empresa y escoger el año/periodo desde el que se empezará a cargar información.
- El contador captura compras, ventas, pagos, cobros, inventario y demás operaciones con sus fechas reales. La captura debe sentirse como el registro ordinario, sin paneles ni procedimientos especiales de reconstrucción.
- SICOVEN ordena internamente las fuentes por fecha efectiva y calcula sus efectos cronológicos, desde el periodo inicial elegido hasta el último registro.
- Si se incorpora o corrige una operación de fecha anterior, SICOVEN recalcula automáticamente los efectos posteriores que dependan de ella.

### Prioridad de implementación
Implementar directamente el procesamiento cronológico real y persistido de fuentes, inventario/Kardex, existencias, PEPS/promedio, costos, cuentas auxiliares, asientos, saldos y cierres/aperturas de ejercicios. El motor debe reproducir el resultado de los registros históricos y posteriores en orden temporal.

Mantener documentos originales, fechas efectivas, fecha de incorporación, referencias y soportes. Recalcular solo resultados derivados, sin duplicar ni modificar documentos fuente. Las operaciones y resultados deben persistirse coherentemente en SQLite.

### Reglas históricas
- Aplicar la escala monetaria y reconversiones venezolanas que correspondan a la fecha de cada operación.
- No exigir BCV para operaciones documentadas íntegramente en bolívares cuando no corresponda; en operaciones en moneda extranjera conservar monto/moneda originales y tratar la conversión según la evidencia y regla aplicable al período.
- Nunca inventar tasas, soportes, saldos iniciales ni documentos. Resolver las diferencias pendientes con mensajes claros y concretos, sin burocracia innecesaria.

### Simplicidad y alcance
No crear ni volver a priorizar paneles de reconstrucción, pasos de aprobación, mecanismos accesorios, planes de solo lectura o documentación como sustituto del procesamiento real. Integrar las salvaguardas de integridad, persistencia, idempotencia y pruebas en la implementación con la menor complejidad operativa posible.

No declarar la reconstrucción funcional hasta que el procesamiento cronológico esté implementado, conectado a los flujos normales, persistido y verificado con pruebas. No tocar `main`, no fusionar, no publicar ni desplegar sin autorización explícita.

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

#### Seguimiento de integración — 2026-11-21 (adjuntos documentales)

- PR #183 de creación durable de empresas quedó integrada en main mediante squash, commit f76b25d78601e4afa0408d49b7045ecba6bd1459; CI Linux, G13 Linux/Windows y Windows Release terminaron SUCCESS. PR #182, rama antigua divergente, fue cerrada como sustituida por #183.
- La rama antigua feat/recoverable-supporting-document-attachments no se integra directamente: contiene 58 commits heredados y mezcla una variante de recuperación de creación durable ya sustituida por la implementación validada de #183.
- Se creó feat/recoverable-supporting-documents-mainline desde el main posterior a #183. Se trasladó únicamente el delta específico de adjuntos: intención durable documents.attach, staging y recuperación por SHA-256, almacenamiento con controles de rutas/symlinks, recibo idempotente y reintento estable en preload.
- No se trasladaron modificaciones antiguas de company-session-ipc.cjs, tenant-runtime.cjs, creación de empresas, esquema ni sus pruebas; main conserva exactamente la implementación de creación durable que pasó validaciones en #183.
- Se añadieron pruebas de reintento idempotente, recuperación tras fallo SQLite luego de persistir el archivo, rechazo de otro archivo o entidad/documento sustituido con el mismo operationId, preservación de archivo alterado y bloqueo de rutas con symlink. Los reintentos quedan ligados a empresa, operación contable, tipo, título, descripción y destino de sustitución originales.
- Pendiente: auditoría final del protocolo filesystem/SQLite (incluida durabilidad de entradas de directorio, concurrencia y restauración), ejecución CI Linux/G13/Windows Release, corrección de fallos y validación completa antes de fusionar. No habilitar reconstrucción histórica integral ni publicar versión con esta fase parcial.


## 7. DIRECTIVA PERMANENTE E INNEGOCIABLE: NO DESVIARSE DE LA RECONSTRUCCIÓN HISTÓRICA

**La prioridad absoluta es implementar el procesamiento cronológico REAL de los registros y reconstruir sus efectos contables desde el período elegido hasta la actualidad. Este objetivo no debe desviarse, diluirse, posponerse ni sustituirse NUNCA MÁS por mecanismos accesorios.**

El trabajo debe concentrarse directamente en que SICOVEN procese y recalcule, en orden cronológico y con resultados persistidos correctos:
- registros y documentos fuente;
- saldos y movimientos de cuentas;
- inventario, Kardex, existencias y capas/costos;
- costos de compras, ventas, salidas y devoluciones;
- asientos contables y sus auxiliares;
- cierres y aperturas entre ejercicios, desde el primer período reconstruido hasta el último.

### Prohibición de desviación
- No volver a priorizar colas de operaciones, permisos, aprobaciones, formularios, paneles de revisión, flujos burocráticos, mecanismos genéricos de recuperación, infraestructura accesoria ni mejoras de otros módulos, salvo que una dependencia concreta sea **directamente indispensable** para ejecutar, persistir o verificar la reconstrucción cronológica.
- No crear nuevos planes, listas de requisitos, fases burocráticas, PR de temas laterales o documentación extensa como sustituto de implementar la funcionalidad central.
- No detener el trabajo para pedir confirmaciones innecesarias. Resolver directamente decisiones técnicas razonables y continuar.
- Si surge un defecto o dependencia, corregirlo en el contexto del trabajo de reconstrucción y volver inmediatamente al objetivo central.
- La seguridad, integridad de SQLite, idempotencia, trazabilidad y pruebas deben ser controles integrados y proporcionados a la implementación; nunca una excusa para construir procesos que impidan al contador trabajar.
- Mantener este objetivo como prioridad hasta que la reconstrucción cronológica real esté implementada, probada, habilitada y verificada. No cambiar de objetivo por iniciativa propia ni declarar terminado por haber creado un panel, plan de solo lectura, simulación, documentación o fundamentos aislados.

**Definición práctica de éxito:** el contador elige la fecha/período de inicio, ejecuta la reconstrucción y SICOVEN recalcula de forma real, coherente y cronológica registros, saldos, inventario, costos, asientos y cierres de ejercicios hasta la actualidad, conservando fuentes y sin duplicar operaciones. Todo trabajo que no acerque directamente a este resultado queda fuera de prioridad.
