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
