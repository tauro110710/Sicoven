# Centro Integral de Correcciones — vínculo documental estricto
Fecha: 04/11/2026

## Cambios integrados en main

- La ejecución de un expediente ya no acepta cualquier registro de la empresa que casualmente tenga la misma referencia.
- Se valida que el documento correctivo esté en la colección correspondiente, pertenezca a la misma empresa, tenga referencia exacta y contenga un campo de relación explícita con el registro fuente.
- Reglas implementadas para ventas, compras, asientos, movimientos bancarios, movimientos de inventario, comprobantes de retención, declaraciones, eventos ISLR, productos y tasas BCV. Si el tipo no tiene vínculo demostrable, el expediente no se cierra.
- Para NC/ND de ventas y compras se limita la evidencia a tipos documentales 02/03 y se exige relación explícita al documento original.
- Se valida la referencia fuente al crear el expediente, incluyendo el ID interno como referencia verificable cuando aplique.
- Si la solicitud ya declaró una referencia correctiva, la referencia ejecutada debe coincidir; no se permite sustituirla silenciosamente.
- El evento de ejecución guarda el ID interno y la colección exacta del documento correctivo que sirvió de evidencia.
- Se eliminó de la interfaz la referencia ficticia “PENDIENTE DE DOCUMENTO CORRECTIVO”; ahora una solicitud sin número previsto permanece realmente sin referencia.

## Pruebas añadidas

- Documento con referencia coincidente pero sin relación con el origen: rechazado.
- Documento vinculado desde otra empresa: rechazado.
- Documento de la misma empresa, referencia exacta y relación explícita: aceptado como evidencia.
- Asiento de reverso: exige `reversalOfEntryId` hacia el asiento fuente.
- La bitácora conserva el ID y colección del correctivo ejecutado.
- La referencia de ejecución debe coincidir con la referencia correctiva declarada.

La suite del módulo contiene ocho pruebas automatizadas. No se ejecutaron en esta sesión; no se declara que estén aprobadas.

## Commits de esta continuación

- `dfa8d4a` — motor de verificación de vínculo documental.
- `58b748c` — validación estricta en IPC de ejecución.
- `adcc670` — pruebas de vínculo de ventas y reverso de asientos.
- `5705127` — validación estricta de referencia fuente.
- `0c41961` — eliminación de referencia ficticia en la interfaz.
- `023e30a` — conservación del ID exacto del correctivo en la bitácora.
- `04ba302` — paso de evidencia verificada desde IPC al workflow.
- `43ec622` y `18082f4` — pruebas de trazabilidad y coincidencia de referencias.
- `759b511` — restricción de evidencia a documentos fiscales correctivos y vínculos específicos.

## Riesgos y pendientes no resueltos

Los nombres de campos de relación deben contrastarse con cada generador real de documentos. Para entidades cuyos módulos no persisten un vínculo explícito, el expediente queda bloqueado deliberadamente en vez de aceptar evidencia débil. Debe completarse la integración real de NC/ND, reversiones, CxC/CxP, tesorería, retenciones, declaraciones, Kardex y soportes. También faltan las pruebas de integración con SQLite real, restauración y empaquetado Electron.

No se tocaron los registros originales ni el administrador semilla. No se publicaron releases ni se iniciaron ejecuciones de CI.


La continuación posterior incorporó observación/subsanación/reenvío, retiro controlado por el solicitante y validación de soportes posteriores a la última observación. Véase `auditoria-centro-correcciones-evidencias-2026-11-04.md` para el alcance y las limitaciones vigentes.
