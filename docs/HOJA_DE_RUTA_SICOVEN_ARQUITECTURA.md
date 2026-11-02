# SICOVEN — Hoja de ruta y reglas arquitectónicas permanentes

## Alcance del producto

SICOVEN es exclusivamente un software de escritorio autónomo. No es una aplicación web ni un servicio alojado.

## Fuente única de verdad

- SQLite local es la única base de datos y fuente de verdad del sistema.
- Las operaciones, validaciones, auditorías, reportes y pruebas deben ejecutarse contra la base SQLite local.
- No introducir Firebase, Firestore, Turso, Vercel, bases de datos remotas ni servicios externos como dependencia operativa.
- No convertir cachés, archivos temporales ni almacenamiento auxiliar en fuentes de verdad.

## Exclusión expresa de Vercel

Vercel no forma parte de la arquitectura ni de la operación de SICOVEN. Sus despliegues, cuotas, límites, estados de compilación y fallos no son bloqueantes, criterios de aceptación ni tareas de la hoja de ruta. No se deben ejecutar despliegues Vercel ni esperar disponibilidad de Vercel para validar o completar SICOVEN.

## Validación y distribución

La validación del producto se realiza mediante:
- Pruebas automatizadas locales y CI del repositorio.
- Comprobación de tipos y compilación del escritorio.
- Pruebas de persistencia, integridad y migraciones SQLite.
- Construcción y verificación del instalador de escritorio.
- Pruebas reales de actualización entre versiones y conservación de los datos SQLite.
- Pruebas funcionales de los flujos contables y fiscales.

## Reglas de trabajo

- Trabajar exclusivamente en el repositorio `fenixlife1978/Sicoven`.
- No mezclar cambios con CRM-SICOVEN ni con otros proyectos.
- Mantener `main` intacta y trabajar en la rama/PR autorizada; no fusionar sin autorización expresa.
- No modificar el flujo del administrador semilla salvo solicitud expresa.
- No declarar homologación o certificación SENIAT sin contrastar la norma primaria vigente y completar la validación que corresponda en el entorno oficial.

## Estado de continuidad — bloque TXT IVA

- Rama de trabajo: `feature/txt-iva-structural-audit`.
- PR de seguimiento: #88.
- Commit de corrección de conciliación: `06a9f2a11084c1db0897a7698bf9aeb03efda9c5`.
- SICOVEN CI #40: correcto (pruebas automatizadas, TypeScript y build).
- Desktop Validation #1251: correcto.
- Windows installer #1368: correcto; instalador generado y actualización 1.0.6 → 1.0.7 verificada conservando SQLite.
- Próximo trabajo: terminar auditoría estructural del TXT de retenciones IVA (clasificación documental, integridad de los 16 campos, sanitización, codificación, orden determinista y casos límite); después contrastar la especificación SENIAT vigente y documentar con precisión qué queda probado y qué requiere homologación oficial.
- Vercel queda expresamente fuera de alcance y no debe volver a aparecer como bloqueo o criterio de avance.


## Continuidad técnica — TXT de retenciones IVA (actualización 2026-11-02)

- La exportación con operaciones ahora exige la compra fuente de cada comprobante; no infiere ni sustituye silenciosamente el tipo documental.
- Se valida la coincidencia de empresa, proveedor, fecha, número, control y tipo documental.
- Para ND/NC se exige que la factura afectada exista en las compras de la misma empresa y proveedor; cuando existe `originalPurchaseId`, debe apuntar a esa factura.
- Se validan 16 campos, separadores, longitudes máximas y ausencia de espacios internos en los identificadores de factura/control/documento afectado.
- La salida con operaciones se ordena por correlativo de comprobante, independientemente del orden de entrada; se verifica que no agrega BOM ni salto de línea final.
- Se añadió una salida de 16 campos para declaración sin operaciones y su descarga desde la declaración quincenal preparada. El auxiliar ya permite preparar y registrar declaraciones quincenales cero de forma explícita, sin comprobantes ni montos retenidos. Su fila es una adaptación técnica provisional: el instructivo histórico de 2017 describe el registro sin operaciones, pero con una disposición de campos distinta a la especificación de agente de retención publicada en 2020. No se declara homologada esta fila.
- La Providencia SNAT/2025/000054 (G.O. 43.171, 16-07-2025), artículo 15, establece la obligación de presentar la declaración informativa incluso cuando no existan operaciones sujetas a retención. La declaración cero debe quedar registrada por quincena en el auxiliar SQLite.
- El instructivo RI_DRIVA2020-IT01V3_0_0 es de septiembre de 2020 y documenta 16 campos separados por tabulador. No se ha localizado una especificación técnica SENIAT posterior que confirme que el layout sigue sin cambios a noviembre de 2026.
- El instructivo de 2020 documenta separador tabulador y carga del archivo TXT. La salida se mantiene UTF-8 sin BOM, CRLF entre registros y sin salto final para archivos con operaciones; esta codificación aún requiere prueba de aceptación en ambiente SENIAT.
- Estado de homologación: pendiente. Requiere confirmar el layout técnico vigente con SENIAT y procesar archivos de prueba representativos (factura, ND, NC, exento, alícuotas vigentes, declaración cero) en el ambiente oficial.


## Endurecimiento adicional del TXT IVA (2026-11-02)

- El proveedor con RIF igual a cero se admite únicamente cuando la retención es del 100%, conforme a la regla expresa del instructivo RI_DRIVA2020-IT01V3_0_0 para proveedor sin RIF y al supuesto de retención total de la Providencia SNAT/2025/000054.
- Se bloquean comprobantes vinculados a compras anuladas, notas cuyo documento original esté anulado y documentos con monto total cero.
- La compra fuente debe aportar su propio número de factura; no se permite completar el dato faltante usando el número que venga en el comprobante de retención.
- Se añadieron pruebas de regresión para RIF cero/retención total, compra anulada, factura afectada anulada, documento cero y número de factura fuente ausente.
- La última tanda de CI/validación/instalador se encuentra en ejecución sobre los cambios finales; no declarar verde hasta que concluyan los tres flujos sobre el mismo SHA.

## Estado consolidado del bloque TXT de retenciones IVA — 2026-11-02

### Implementado en la rama de trabajo

1. **Generación con fuente fiscal verificable**
   - La exportación con operaciones exige el arreglo de compras fuente; no se asigna automáticamente el tipo documental cuando falta el dato.
   - Cada comprobante se enlaza con su compra fuente y valida empresa, proveedor, fecha, número, control y tipo documental.
   - La compra fuente debe aportar el número del documento; el generador no lo completa tomando el número del comprobante de retención.
2. **Clasificación documental**
   - Tipos documentales implementados: 01 factura, 02 nota de débito y 03 nota de crédito.
   - ND/NC requieren factura afectada de la misma empresa y proveedor; se comprueba el vínculo de origen cuando existe.
   - Se rechazan notas sin factura original válida y facturas originales anuladas.
3. **Validaciones y seguridad del archivo**
   - Validación de los 16 campos, longitudes máximas y caracteres delimitadores/inyección TAB, CR y LF.
   - Validación de RIF, período, correlativos/identificadores, importes, retención, tipo documental y consistencia con el documento fuente.
   - Se bloquean documentos fuente anulados, documentos de monto total cero y exportaciones con corrección fiscal pendiente.
   - RIF proveedor igual a 0 permitido únicamente en el supuesto de retención del 100% documentado en la regla técnica revisada.
   - Orden determinista por correlativo; serialización TAB, CRLF entre registros, UTF-8 sin BOM y sin salto de línea final.
4. **Declaración sin operaciones**
   - Auxiliar para registrar explícitamente la declaración quincenal sin operaciones en SQLite.
   - Descarga de fila TXT de 16 campos implementada como adaptación técnica provisional; no está homologada. El orden de campos del instructivo histórico de cero operaciones no coincide con el layout de agente de retención de 2020.
5. **Rectificaciones**
   - Expediente de rectificación IVA con trazabilidad append-only y auditoría de revisión/actuación.
   - La exportación queda bloqueada mientras haya una corrección fiscal pendiente.
   - El flujo del administrador semilla no se modificó.

### Evidencia automatizada más reciente

- SHA validado: 7226bf0b005b921dae81182d3d1e92db0a4ab715.
- SICOVEN CI #76: SUCCESS.
- Desktop Validation #1287: SUCCESS.
- Windows installer #1404: IN_PROGRESS al momento de esta actualización; no se declara terminado hasta que finalice correctamente y se inspeccione su resultado.
- La ejecución anterior encontró dos fixtures de prueba con IDs de compra fuente desalineados; se corrigieron antes del SHA actual.
- Estos resultados acreditan las comprobaciones automatizadas ejecutadas en ese commit, no homologación SENIAT ni aceptación tributaria oficial.

### Pendientes para cierre real del bloque

1. Confirmar resultado final de Windows installer #1404 y revisar el artefacto/actualización de escritorio, incluida conservación de SQLite.
2. Auditar nuevamente todos los casos de factura, ND, NC, exento, alícuotas, retención 75/100, RIF proveedor 0, anulaciones, correcciones y período.
3. Confirmar con especificación técnica primaria del SENIAT que el layout de 16 campos de RI_DRIVA2020-IT01V3_0_0 continúa vigente a la fecha; no asumir vigencia solo por el instructivo de 2020.
4. Resolver la estructura correcta del TXT para declaración sin operaciones contrastando el instructivo específico de cero operaciones con la regla vigente de declaración quincenal. Mantenerla identificada como provisional hasta esa confirmación.
5. Ejecutar pruebas de aceptación con archivos representativos en el entorno oficial SENIAT, cuando se disponga del acceso y procedimiento de prueba.
6. Actualizar esta hoja y la PR #88 con el SHA final y evidencias verificables.

### Estado de control del repositorio

- Trabajo limitado a fenixlife1978/Sicoven, rama feature/txt-iva-structural-audit, PR #88.
- main permanece intacta; PR no fusionada.
- SQLite local sigue siendo la única fuente de verdad.
- No declarar bloque TXT cerrado, homologado ni certificado SENIAT hasta completar los pendientes anteriores.

### Revisión posterior de validación — 2026-11-02

- SICOVEN CI #76: SUCCESS confirmado; las pruebas automatizadas y comprobación de tipos/build del workflow terminaron correctamente.
- Desktop Validation #1287: SUCCESS confirmado.
- Windows installer #1404: el instalador se construyó y verificó su existencia, pero el paso de actualización real 1.0.6 → 1.0.7 fue cancelado por el runner durante la ejecución; no se considera aprobado.
- Se solicitó reejecutar únicamente el job de Windows installer para completar la prueba de actualización y persistencia SQLite. Pendiente de resultado.
- Búsqueda adicional de fuentes técnicas oficiales SENIAT para RI_DRIVA2020-IT01V3_0_0 y SNAT/2025/000054 no devolvió resultados oficiales verificables en esta consulta. Se mantiene pendiente la confirmación primaria y no se eleva el estado de homologación.
### Corrección adicional crítica del mapeo de columnas — 2026-11-02

- La revisión directa de la tabla de columnas del instructivo RI_DRIVA2020-IT01V3_0_0 detectó que la columna 11 se denomina Monto IVA, no monto de IVA retenido.
- Se corrigió el generador para exportar el IVA total causado (vatAmountBs) en la columna 11; el importe retenido se sigue usando para validar el cálculo de retención, pero no se coloca en esa columna.
- Se añadió prueba que distingue expresamente IVA total de IVA retenido (por ejemplo, IVA causado 160.00 y retención 120.00 al 75%).
- Esta corrección cambia el SHA y requiere una nueva tanda completa de CI, Desktop Validation y Windows installer; los resultados verdes del SHA anterior no se trasladan a este cambio.
- Referencia técnica consultada: copia del instructivo RI_DRIVA2020-IT01V3_0_0 que identifica columna 11 como Monto IVA y columna 10 como Base Imponible. Pendiente conseguir/confirmar la copia primaria vigente del SENIAT.
### Diagnóstico y corrección de regresión de prueba — 2026-11-02

- La ejecución CI #82 / Desktop Validation #1293 / Windows installer #1410 ejecutó 599 pruebas y encontró una sola expectativa obsoleta: la prueba de mapeo de 16 campos aún esperaba 120.00 (IVA retenido) en la columna 11.
- El valor real del generador fue 160.00 (IVA total causado), conforme al mapeo corregido. Se actualizó la expectativa y su comentario; no se revirtió el cambio fiscal.
- Commit de corrección de prueba: 7b5b7d53afa28a3edcafee548ce3785c88709071. Requiere nueva ejecución completa; no se trasladan los fallos ni los éxitos previos a este SHA.
- En la ejecución anterior, 598 de 599 pruebas pasaron; la única falla fue la expectativa antigua descrita arriba. El instalador también se detuvo al fallar esa suite antes de completar la prueba de actualización SQLite.

## Cierre de validación automatizada del TXT IVA — 2026-11-02

- SHA de HEAD de PR #88: 54a41b6d78e5433a17bc997349493ff87577852a.
- SICOVEN CI #84: SUCCESS.
- Desktop Validation #1295: SUCCESS.
- Windows installer #1412: SUCCESS. El instalador NSIS se construyó y se verificó su existencia; además, la prueba de actualización real 1.0.6 → 1.0.7 terminó correctamente y confirmó la conservación de los datos SQLite. La carga del artefacto también terminó correctamente.
- Estas tres ejecuciones corresponden al mismo HEAD de PR y cierran la validación automatizada de esta tanda. No equivalen a homologación ni aceptación del TXT por SENIAT.
- PR #88 permanece abierta y sin fusionar; main permanece intacta.

### Pendientes normativos y funcionales antes de declarar homologación

1. Contrastar el mapeo completo de las 16 columnas con una especificación técnica primaria y vigente publicada/confirmada por SENIAT. El código actual coloca IVA total causado en columna 11, según el instructivo histórico RI_DRIVA2020-IT01V3_0_0; la vigencia actual del layout no está confirmada.
2. La fila de declaración sin operaciones sigue siendo provisional. No presentarla como archivo oficialmente aceptado: debe determinarse el formato específico vigente para declaración en cero.
3. Ejecutar aceptación con archivos de factura, ND, NC, exentos, distintas alícuotas y retenciones 75/100 en el entorno oficial SENIAT.
4. Revisar los campos restantes contra la tabla técnica vigente, en particular identificador de comprobante, documento afectado, número de factura/control, montos y códigos de operación.
5. No declarar certificación, homologación ni cierre fiscal hasta completar evidencia oficial.


## Rectificación del mapeo de la columna 11 — 2026-11-02 (prioridad crítica)

- La revisión del texto íntegro del instructivo RI_DRIVA2020-IT01V3_0_0 (septiembre 2020), secciones 2.2 y 2.3, páginas 9 y 12, confirma expresamente que el campo Monto_IVA para un Agente de Retención representa el IVA retenido por el comprador al proveedor. El mismo campo representa el IVA calculado por alícuota para el contribuyente exportador; no se debe aplicar esa segunda definición al agente de retención.
- En consecuencia, se corrigió el generador para exportar `vatWithheldBs` en la columna 11, no `vatAmountBs`. Se ajustaron las pruebas de mapeo y de retenciones 75%/100%; el caso diferencial de IVA causado 160.00 y retención 120.00 debe exportar 120.00.
- La corrección está en los commits: generador `c335278feecbad7995fae649ac0f715a2cc50d28`; pruebas `adbbd170dee476a7804492d7a1ac89f1f94a24b2`. El HEAD de la rama quedó en el commit de pruebas.
- Los workflows CI #85 y Desktop #1296 habían validado el SHA documental anterior, no esta rectificación. El instalador #1413 también corresponde al SHA anterior y no sirve como evidencia para estos cambios. Ejecutar nuevamente CI, Desktop Validation e instalador sobre el HEAD actualizado.
- Esta rectificación prevalece sobre las notas previas de esta hoja que describían la columna 11 como IVA total causado; aquellas anotaciones históricas quedan superadas y no deben usarse como criterio fiscal.
- La especificación consultada es de 2020 y la aceptación del formato actual por SENIAT continúa pendiente. La Providencia SNAT/2025/000054 regula la obligación de declarar, enterar y emitir comprobantes, pero no sustituye por sí sola las especificaciones técnicas del archivo de carga.

- Se corrigió además una expectativa heredada en otra prueba de exportación (test “IVA TXT exports only real voucher identifiers and the supplied amounts”), que todavía esperaba 160.00 en columna 11. Ahora espera 120.00 para el caso de IVA causado 160.00 con retención 75%. Commit de esa corrección: `c4b653bd4d69ea4e15e399602a8c81610d1bf887`.

- CI #89 detectó una tercera expectativa obsoleta en la prueba estructural de 16 columnas (línea 335), que todavía describía y esperaba IVA causado 160.00. Se actualizó a IVA retenido 120.00 para el escenario de retención 75%. Commit: `78fa2797299c9a95ed6bfa1799d665c0e50d122b`. La falla no era del generador: era un test contradictorio con el nuevo mapeo. Repetir la batería completa en el HEAD actualizado.


## Revisión complementaria del layout TXT — 2026-11-02

- La copia consultada del instructivo RI_DRIVA2020-IT01V3_0_0 confirma el campo 11 como IVA retenido por el agente y las 16 columnas, con separador TAB. También exige que las notas de crédito afecten facturas registradas en el período declarado (validación 2.3); esta condición requiere revisar la validación actual, que permite factura fuente previa siempre que coincida con originalPurchaseId, y no necesariamente exige mismo período.
- Hallazgo por resolver antes de congelar el generador: la descripción de campo 9 Monto_Documento del instructivo histórico indica monto bruto de renglones/precio de operación excluyendo IVA y montos exentos, mientras el código actual exporta `totalAmountBs` y su test usa 1160.00 (incluye IVA). No cambiar el valor por intuición: contrastar la semántica con ejemplos y validación de carga del portal; hasta entonces el mapeo de campo 9 queda abierto.
- La Providencia SNAT/2025/000054, art. 15, obliga a presentar declaración aun sin operaciones, pero remite a las especificaciones técnicas que establezca el SENIAT. No define una fila TXT de 16 columnas para declaración cero. Por ello `generateSeniatIvaZeroOperationsTxt` sigue marcada provisional y no homologada.
- Sobre commit de código `78fa2797299c9a95ed6bfa1799d665c0e50d122b`, CI #90 ejecutó pruebas, TypeScript y build con pasos SUCCESS, pero el run quedó CANCELLED durante la cola/ejecución y fue solicitado reintento. Desktop #1301 fue cancelado por concurrencia y se solicitó reintento. Instalador #1418 continúa ejecutándose. No considerar esta tanda certificada hasta tener runs completos SUCCESS.
