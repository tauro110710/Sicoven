# DIRECTIVA CENTRAL SICOVEN — OBJETIVO REESTRUCTURADO (2026-11-21)

**Esta directiva reemplaza cualquier instrucción anterior incompatible dentro de este archivo. Es obligatoria y no debe desviarse.** SICOVEN tendrá DOS MODOS DE INICIO/ALCANCE CONTABLE: (A) CONTABILIDAD ORDINARIA y (B) RECONSTRUCCIÓN HISTÓRICA PROVISIONAL. Ambos utilizan el MISMO motor contable y el mismo flujo cronológico real; la reconstrucción no es un motor paralelo, simulador ni replay.

## Objetivo
Crear una herramienta práctica para el contador independiente que lleva contabilidades de pequeñas y medianas empresas en Venezuela. Operar realmente, con datos auténticos y trazables, desde la fecha elegida, en secuencia día a día, mes a mes y año a año. No desviarse a funciones ajenas, paneles técnicos, simulaciones, documentación aislada ni reconstrucción/replay como motor separado.

## Los dos modos (ambos opcionales según el inicio seleccionado)
- **Modo ordinario:** el contador elige el período desde el que comienza su servicio/registro en SICOVEN, registra operaciones reales desde ese punto y avanza cronológicamente. No se fabrican ni reconstruyen operaciones anteriores. Si requiere saldos de apertura, se manejan mediante los mecanismos ordinarios permitidos y documentados, sin simular actividad previa.
- **Modo de reconstrucción histórica provisional:** el contador elige un período anterior para reconstruir la contabilidad real atrasada de la empresa, desde ese punto y en orden cronológico, hasta el período actual. No se inventan operaciones. Se pueden incorporar posteriormente operaciones reales omitidas en su fecha efectiva; SICOVEN valida, recalcula automáticamente y en orden cronológico todos los efectos posteriores afectados, conserva datos/soportes originales y registra auditoría. La reconstrucción es provisional y debe diferenciar estimaciones patrimoniales o saldos iniciales sustentados/explicados de operaciones reales y de obligaciones fiscales formales actuales.

## Flujo cronológico único, obligatorio en ambos modos
- **Diario:** registrar operaciones reales con fecha efectiva (compras, ventas, gastos, cobros, pagos, caja/bancos, inventario y otras); validar y contabilizar en secuencia.
- **Mensual:** revisión, conciliación, controles fiscales, ajustes y cierre del período según corresponda.
- **Anual:** cierre, resultado, estados financieros, balances y traslado de saldos al siguiente ejercicio.
- Si una operación real atrasada se incorpora en reconstrucción a un período ya procesado, recalcular en secuencia los efectos posteriores afectados (Kardex/capas y costos, inventario, precios si la política lo determina, impuestos, cuentas por cobrar/pagar, caja, asientos, saldos, cierres, reportes y aperturas), marcar períodos afectados y proteger los cerrados con controles explícitos. No duplicar ni alterar silenciosamente documentos fuente.

## Requisitos exclusivos de reconstrucción provisional
- Registrar saldo patrimonial de apertura a la fecha de inicio, con soporte o estimación identificada, motivo y auditoría.
- Incorporar soportes flexiblemente (factura, extracto bancario, relación de caja, estimación profesional u otros) y registrar quién/cuándo/por qué.
- Inventario inicial sustentado; método de costeo configurable (PEPS o promedio ponderado) y movimientos/Kardex íntegros.
- Cuentas por cobrar/pagar antiguas se regularizan solo mediante asientos auditables, no borrado silencioso.
- Activos fijos: fecha de adquisición, costo/escala original, vida útil, método y depreciación anual.
- Separar claramente contabilidad financiera de estimaciones y módulos de declaración fiscal; las estimaciones históricas no se convierten automáticamente en declaraciones formales actuales.
- Informes tanto en escala original como comparativa/consolidada cuando aplique. Toda conversión y redondeo debe ser trazable.
- Proteger períodos cerrados; cambios previos requieren autorización/justificación, auditoría y recalculo controlado en cascada.

## Reglas que no se negocian
- La contabilidad ordinaria no debe convertirse en reconstrucción ni exigir funciones de reconstrucción.
- Reconstrucción provisional no significa simular/replay ni inventar operaciones: procesa operaciones reales con el mismo motor cronológico.
- Nunca crear operaciones ficticias, tasas BCV, documentos, soportes o saldos. No sustituir datos faltantes silenciosamente.
- Reconversiones monetarias venezolanas y escala se resuelven automáticamente por fecha efectiva. BCV se exige solo cuando corresponda a la operación/tratamiento; política funcional vigente: desde 2018-09-07 es obligatorio si hay conversión aplicable, antes de esa fecha opcional cuando proceda; Bs-only está exento. Validar fuentes legales antes de afirmar certeza normativa.
- No hacer cambios en `main`, fusionar, lanzar versión ni desplegar sin autorización expresa. Mantener el trabajo en la rama indicada.

## Prioridad absoluta de trabajo
Implementar e integrar runtime real, persistencia, UI práctica, validaciones, auditoría y pruebas para estos dos modos y el motor cronológico compartido. Resolver defectos encontrados en el camino que afecten directamente al objetivo. No desviar el trabajo. No considerar logrado por helpers/documentación solamente; exigir integración y verificación.

---

## 1. Inicio de la contabilidad ordinaria
- El contador registra una empresa y elige el período desde el que comenzará su contabilidad en SICOVEN (por ejemplo, febrero de 2010).
- A partir de ese período, registra operaciones ordinarias —compras, ventas, gastos, pagos, cobros y otras operaciones pertinentes— con sus fechas reales.
- Puede avanzar de mes a mes y de año en año, sin saltos forzados, hasta el período actual y continuar normalmente.
- SICOVEN procesa automáticamente las operaciones y sus efectos contables, balances, períodos, reportes y saldos, respetando la realidad monetaria y contable de cada fecha.
- En modo ordinario, no reconstruir contabilidad anterior ni importar/inventar operaciones inexistentes. En modo reconstrucción provisional, solo registrar operaciones auténticas atrasadas en su fecha efectiva y recalcular los efectos posteriores mediante el mismo motor cronológico; no simular actividad.

## 2. Tratamiento automático según la fecha de cada operación
- Antes de una reconversión: utilizar la escala monetaria vigente en esa fecha.
- En una reconversión: aplicar la conversión y equivalencia que corresponda a su fecha, normativa, alcance y contexto.
- Después de una reconversión: utilizar la nueva escala sin mezclar ni confundir cifras de períodos monetarios anteriores.
- Si una operación, saldo, cálculo, reporte o proceso contable relaciona períodos monetarios distintos, conservar coherencia en equivalencias, cálculos, saldos, presentación y registros, sin alterar cifras/documentos originales.
- SICOVEN identifica automáticamente el período monetario por fecha; el contador no activa manualmente modos de reconversión.

## 3. Aplicabilidad de la tasa BCV — condicional, nunca indiscriminada
- Exigir tasa BCV únicamente cuando sea necesaria y aplicable por la fecha, moneda, operación y tratamiento contable.
- Si una operación en bolívares de un período no requiere tasa BCV para su registro, no solicitarla.
- Si en esa época la tasa no existía, no estaba disponible o no se utilizaba para ese tratamiento, no obligar al contador a introducirla.
- Cuando una tasa histórica sí sea necesaria pero no se encuentre disponible, mantenerla como faltante explícito: explicar qué tasa/dato falta y por qué es necesaria. **No inventarla, aproximarla, ni sustituirla silenciosamente por la tasa actual.**
- Las equivalencias y representaciones necesarias para comparar períodos deben ser explícitas, correctas y consistentes; nunca fabricar importes equivalentes.

## 4. Único alcance activo de trabajo hasta completar la integración
Trabajar exclusivamente en implementar, conectar, persistir y probar este comportamiento en los flujos normales de SICOVEN. Priorizar el registro ordinario desde el período elegido, continuidad de períodos, tratamiento monetario por fecha, reconversiones automáticas y BCV condicional. Los cambios deben ser funcionales y visibles en el uso real del programa, no quedarse en documentación, helpers aislados o paneles técnicos.

No iniciar ni priorizar trabajo ajeno al objetivo reestructurado (dos modos de inicio y motor cronológico compartido) mientras su integración completa no esté comprobada. Mantener integridad, trazabilidad, persistencia y pruebas; no crear datos ficticios ni exigir al contador procedimientos especiales. Antes de considerar la regla integrada, verificar los flujos ordinarios relevantes, casos de períodos monetarios distintos, reconversiones, tasa aplicable/no aplicable/faltante, cálculos, saldos, reportes y cierres.

**La regla solo se considera cumplida cuando el comportamiento está integrado y disponible en SICOVEN, y validado con pruebas. Documentar o crear un helper no basta.**

---

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
- Registrar una empresa/cliente nuevo y seleccionar la fecha (año, mes o día de inicio) desde la que el contador comenzará a llevar su contabilidad en SICOVEN.
- Esa fecha es solo el inicio del servicio/registro contable en SICOVEN; no implica reconstruir, migrar, recuperar ni simular operaciones anteriores.
- El contador registra normalmente compras, ventas, pagos, cobros, inventario y demás operaciones con fechas reales a partir de la fecha de inicio elegida.
- SICOVEN procesa y contabiliza esas operaciones normalmente, en orden cronológico, sin paneles técnicos ni procesos especiales.
- En modo ordinario, las operaciones anteriores quedan fuera del alcance y no se reconstruyen. En modo reconstrucción histórica provisional, el contador puede elegir un inicio anterior y registrar operaciones reales atrasadas desde esa fecha, con trazabilidad y recalculo controlado.

### Prioridad de implementación
Priorizar el flujo ordinario de alta de empresa, elección de fecha de inicio contable y registro diario de operaciones posteriores. Mantener consistencia cronológica, validaciones, asientos, saldos, inventario/Kardex, costos, cuentas auxiliares y cierres/aperturas que correspondan a los ejercicios atendidos desde ese inicio. No desarrollar un motor separado de reconstrucción/replay. La reconstrucción provisional, si se elige, debe reutilizar el motor contable cronológico compartido y procesar operaciones auténticas.

Mantener documentos originales, fechas efectivas, fecha de incorporación, referencias y soportes. Persistir de forma coherente las operaciones y resultados en SQLite, sin duplicar ni modificar documentos fuente.

### Reglas monetarias y reconversiones venezolanas por período
- SICOVEN debe identificar automáticamente, según la fecha efectiva de cada operación, la unidad monetaria vigente y las reglas de conversión aplicables en cada reconversión monetaria venezolana; tratar correctamente operaciones en bolívares de períodos distintos sin mezclar escalas.
- Las reconversiones deben estar definidas por sus fechas efectivas y alcance, y su tratamiento integrado en los flujos ordinarios de compras, ventas, pagos, cobros, caja, inventario, asientos, reportes y cierres. No se le debe pedir al contador que active manualmente un modo especial para cada reconversión.
- El sistema debe distinguir los períodos y contextos en los que la tasa BCV era exigible, utilizada o necesaria para el tratamiento contable de la operación, de aquellos en los que no existía, no se publicaba, no se utilizaba o no era aplicable. **Solo solicitar BCV cuando sea requerido por la fecha, la operación y su tratamiento contable**; no imponer una tasa a operaciones íntegramente en bolívares de períodos en los que no corresponda.
- Cuando BCV sí sea aplicable, exigir la tasa válida y la evidencia que corresponda; no reutilizar la tasa actual para operaciones antiguas ni inventar o aproximar tasas faltantes. Si la fuente o tasa aplicable no está disponible, indicar de forma clara qué dato falta y por qué se necesita.
- Conservar la cifra, moneda y documento original; usar representaciones normalizadas solo para cálculos comparables, sin alterar la fuente ni provocar errores por redondeo o mezcla de unidades.
- Nunca inventar tasas, soportes, saldos iniciales ni documentos. Resolver las diferencias pendientes con mensajes claros y concretos, sin burocracia innecesaria.

### Simplicidad y alcance
La reconstrucción provisional puede tener UI/controles de gestión necesarios (apertura patrimonial, soportes, auditoría, períodos cerrados y recalculo); deben ser simples y útiles, no burocráticos. No crear paneles técnicos ni documentación como sustituto del procesamiento real. Integrar las salvaguardas de integridad, persistencia, idempotencia y pruebas en la implementación con la menor complejidad operativa posible.

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
- La siguiente versión solo se publicará cuando se cumplan los criterios de lanzamiento. La reconstrucción provisional opcional se considerará habilitada únicamente cuando el modo y el motor cronológico compartido estén integrados, persistidos y validados de extremo a extremo; no confundir avances parciales con funcionalidad completa.


#### Seguimiento PR #181 — 2026-11-20

- Se reforzó la saga para resolver siempre la conexión SQLite de control vigente mediante `runtime.controlDb`; esto evita conservar prepared statements/conexiones antiguas después de una restauración global que reemplace la conexión.
- Se añadió prueba de rebind: registra el esquema inicial, sustituye la base de control y verifica que la consulta siguiente inicialice/reutilice las tablas en la conexión restaurada.
- La recuperación comprueba que el JSON durable coincida exactamente con empresa, razón social y RIF registrados en la intención, y valida la identidad del actor original antes de crear el evento tenant.
- HEAD de trabajo: `99a89fbddd263d66e14cce5e8319403c68bb6e3c` (puede avanzar con commits posteriores).
- CI Linux y Windows se han iniciado en tres HEADs de esta rama, pero los jobs terminaron en 2–5 segundos sin pasos ejecutados, sin URL de logs y sin artefactos de log (`BlobNotFound`). Se reintentaron dos veces; no hay salida de pruebas que permita atribuir el fallo al código ni declarar éxito.
- No fusionar PR #181 ni publicar versión hasta obtener ejecuciones Linux y Windows con pasos y resultados verificables. Si Actions sigue sin asignar runner, tratarlo como bloqueo de infraestructura del repositorio y conservar la PR en borrador.

## 8. HALLAZGO DE AUDITORÍA — PREPARACIÓN HISTÓRICA DE INVENTARIO DEBE SER NO DESTRUCTIVA

Se comprobó el flujo runtime de `AccountingContext.tsx` que expone `prepareInventoryProductsForHistoricalReconstruction`. Actualmente rechaza la preparación si el inventario tiene existencia distinta de cero, si ya hay movimientos de Kardex, compras o ventas, o si existen asientos con saldos de inventario; también limpia costos/snapshot de productos mediante un helper. **Este bloqueo y preparación destructiva no son el flujo requerido para un contador que recibe una empresa con historia.**

- No pedir que el contador vacíe el inventario ni elimine/evite operaciones reales para comenzar reconstrucción.
- No resetear stock, costos, fechas de apertura ni snapshots de manera destructiva para habilitar el inicio histórico.
- Implementar apertura histórica de inventario con cantidades/costos/escala originales, soportes o estimación marcada, y asiento contable de apertura auditado. Mantener el Kardex previo y documentos existentes intactos.
- El motor cronológico debe incorporar ese saldo inicial como evento de apertura real del período, y procesar operaciones desde la fecha elegida sin duplicar movimientos. Si el sistema ya contiene actividad, conciliar y resolverla explícitamente; nunca borrar ni resetear para forzar el flujo.
- Este hallazgo es prioritario y debe resolverse dentro del mismo objetivo del motor cronológico; no dar por funcional la reconstrucción provisional mientras el contador esté obligado a preparar productos en cero o sin historial.



## ACLARACIÓN DE ALCANCE — FECHA DE INICIO DE RECONSTRUCCIÓN (2026-11-21)

- La reconstrucción histórica **no tiene un año mínimo fijo ni está obligada a comenzar en 2010**. El año 2010 mencionado en ejemplos anteriores es ilustrativo, no una regla ni un requisito de diseño.
- La fecha de inicio de la reconstrucción la determina el Contador Público Colegiado responsable, de acuerdo con la situación de la empresa, la documentación disponible, su criterio profesional y el alcance del trabajo que asumió.
- SICOVEN debe permitir seleccionar libremente la fecha/período de inicio pertinente (incluido cualquier año que corresponda), sin imponer 2010, un número predeterminado de años, ni obligar a reconstruir períodos que el contador no haya incluido en su alcance.
- La apertura y los saldos se establecen para esa fecha seleccionada; la secuencia cronológica, los soportes, las marcas de reconstrucción/estimación y la detección de arrastres aplican desde el inicio definido. No se inventa ni se exige reconstruir historia anterior a ese punto.
- En los flujos y textos de UI, no mostrar 2010 como fecha mínima, requisito, sugerencia preseleccionada ni límite. Si se usa en ejemplos, debe quedar claramente etiquetado como ejemplo.


## REQUISITOS FUNCIONALES ADICIONALES — CONTABILIDAD DE RECONSTRUCCIÓN HISTÓRICA

Los siguientes requisitos se incorporan al objetivo de reconstrucción histórica y deben implementarse, probarse y auditarse. No sustituyen el criterio del Contador Público Colegiado ni autorizan inventar operaciones, soportes o saldos.

1. **Apertura histórica sin exigir empezar en cero:** permitir iniciar un ejercicio/período histórico según la fecha que determine el contador y registrar un asiento de apertura de reconstrucción identificable, con trazabilidad, soporte y clasificación de saldo confirmado/estimado. No exigir borrar o vaciar inventario, cuentas, movimientos ni documentos preexistentes.
2. **Escala monetaria original y vista unificada/comparativa:** conservar y auditar cada asiento y operación en su escala monetaria original, correspondiente a su fecha. Los informes comparativos y de evolución podrán mostrar una vista unificada convertida entre escalas, sin alterar ni sobrescribir valores originales. La conversión debe aplicar el régimen y divisor válidos en cada reconversión y fecha; para comparar la escala previa a agosto de 2018 con la vigente desde octubre de 2021, el factor acumulado es 10^11 (5 ceros suprimidos en 2018 y 6 en 2021). Documentar precisión, redondeo y conversión inversa; nunca convertir mediante tasas BCV salvo cuando la operación/tipo de reporte requiera una tasa cambiaria.
3. **Separación contable reconstruida vs. fiscal formal:** identificar visiblemente asientos y períodos que pertenecen a reconstrucción, estimaciones, soportes parciales o depuración. Mantenerlos distinguibles de declaraciones, liquidaciones y cumplimiento fiscal formal. No permitir que datos provisionales se presenten como declaraciones fiscales preparadas, presentadas o aceptadas.
4. **Arrastres y recálculo seguro:** al modificar, insertar o corregir una operación de un período ya reconstruido, identificar el primer período afectado y todas las dependencias posteriores (saldos, inventario/Kardex, costos, cuentas, caja, impuestos y reportes). Mostrar qué períodos/años quedaron pendientes de recalcular y bloquear la presentación silenciosa de resultados desactualizados. Recalcular cronológicamente, preservando originales, auditoría y posibilidad de revisión; períodos cerrados requieren reapertura controlada.

### Criterios mínimos de aceptación
- Tests para apertura histórica con saldos no cero y sin borrar el historial existente.
- Tests de asiento original y vista comparativa unificada que verifiquen conversión entre escalas y conservación exacta del dato original.
- Tests que impidan confundir reconstrucción/estimaciones con datos fiscales formales.
- Tests de inserción/corrección en un período pasado que marquen todos los períodos dependientes como pendientes, y que solo los limpien tras un recálculo verificable.
