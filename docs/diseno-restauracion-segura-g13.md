# G13 — Diseño de restauración segura diferida de SQLite

Estado: IMPLEMENTACIÓN PARCIAL — journal durable aislado implementado en `electron/restore-journal.cjs` con pruebas en `electron/restore-journal.test.cjs`. El motor de staging/swap/recovery todavía NO está implementado ni integrado al arranque. Este documento no habilita restauraciones en la aplicación.

## 1. Decisión de arquitectura

La restauración se ejecutará únicamente al siguiente arranque de SICOVEN, antes de abrir `sicoven.sqlite`, registrar IPC, ejecutar migraciones o crear el administrador semilla. No se reemplazará una conexión SQLite abierta: módulos IPC y servicios capturan la conexión activa y un cambio en caliente podría dejar referencias obsoletas.

SQLite local continúa siendo la única fuente de verdad. La restauración no sincroniza ni fusiona datos; sustituye íntegramente el estado local por un paquete validado, previa creación de un punto de retorno.

## 2. Formato aceptado y validación previa

Solo se acepta un directorio de respaldo SICOVEN con:
- `manifest.json` versión `SICOVEN_BACKUP_V1`.
- `sicoven.sqlite` con tamaño y SHA-256 coincidentes con el manifiesto.
- `supporting-documents/` con conjunto exacto de archivos regulares, rutas relativas normalizadas, tamaños y SHA-256 coincidentes.
- Ningún enlace simbólico, junction/reparse point, ruta absoluta, segmento `..`, archivo inesperado ni colisión de nombres.
- SQLite abierta en modo read-only y validada con `PRAGMA quick_check`, `PRAGMA foreign_key_check` y presencia/JSON válido de `app_state.state_key='accounting'`.

La validación debe imponer límites defensivos de tamaño, profundidad, cantidad de archivos y longitud de rutas. Los hashes deben calcularse por streaming, no cargando documentos completos en memoria. El manifiesto es integridad, no autenticidad criptográfica: un atacante que pueda modificar todos los archivos puede regenerar sus hashes. La UI debe advertir que el respaldo debe proceder de una ubicación confiable.

## 3. Estados del proceso

El journal de restauración vive fuera de SQLite, en un directorio dedicado dentro de `app.getPath('userData')`, con permisos restrictivos y escritura atómica:
- `prepared`: paquete validado y copiado a staging; DB y documentos listos.
- `rollback_ready`: snapshot actual y documentos actuales copiados a rollback y verificados.
- `installing`: comenzó el reemplazo; cada movimiento se registra y sincroniza antes de continuar.
- `installed`: staging instalado en las rutas activas; aún no se considera confirmado.
- `committed`: arranque posterior abrió la DB restaurada, pasó integridad y comprobó los soportes; el rollback puede eliminarse después de un período de seguridad.
- `rolling_back`: se está recuperando el estado anterior.
- `rolled_back`: el estado anterior fue restaurado y verificado; se conserva journal para diagnóstico.

El journal incluye UUID, versión de protocolo, timestamp, rutas relativas internas, hashes de origen/staging/rollback, fase y último paso. Nunca contiene contraseñas, tokens ni datos contables.

## 4. Secuencia de solicitud (sesión actual)

1. Exigir licencia autorizada y sesión de administrador activa.
2. Abrir selector de directorio; no aceptar rutas recibidas libremente desde renderer.
3. Verificar el paquete completo sin modificarlo.
4. Mostrar resumen: fecha, huella de DB, cantidad de documentos y advertencia de sustitución total.
5. Exigir confirmación explícita adicional del administrador.
6. Copiar DB y documentos a staging dentro del mismo `userData`; volver a verificar tamaño/hash e integridad después de copiar.
7. Comprobar espacio libre suficiente para staging + rollback + margen.
8. Escribir journal `prepared` de forma atómica.
9. Registrar en `audit_events` la solicitud de restauración programada, incluyendo actor, ID de operación y huellas; no registrar rutas externas completas.
10. Cambiar journal a `prepared` final y solicitar cierre controlado con mensaje visible: “La restauración se completará al reiniciar SICOVEN”.
11. No cerrar ni sustituir datos si falla la preparación, la auditoría o el guardado del journal.

## 5. Secuencia de arranque (antes de openDatabase)

1. Leer journal; validar esquema, UUID y que todas las rutas resuelvan dentro de los directorios controlados.
2. Si no existe journal, continuar arranque normal.
3. Si fase es `prepared`, verificar staging otra vez, copiar estado actual a rollback y avanzar a `rollback_ready`.
4. Cambiar a `installing` antes de cualquier rename.
5. Renombrar directorios/archivos actuales a ubicaciones rollback y staging a ubicaciones activas. Mantener cada operación en el mismo volumen; no usar una copia entre volúmenes como si fuera rename atómico.
6. Actualizar journal tras cada movimiento durable. La recuperación debe ser idempotente: repetir el paso no puede borrar la única copia válida.
7. Abrir la DB restaurada en modo de verificación, ejecutar quick_check, foreign_key_check y validar estado contable. Verificar además conjunto exacto de documentos y hashes.
8. Marcar `installed`; continuar el arranque normal solo después de pasar todas las comprobaciones.
9. Tras abrir servicios esenciales y completar un arranque válido, marcar `committed`. Conservar rollback hasta un arranque posterior exitoso o un plazo explícito.
10. Si cualquier paso falla, cerrar la conexión parcial, entrar en `rolling_back`, restituir DB y documentos anteriores, verificar y marcar `rolled_back`. Si rollback también falla, detener SICOVEN y mostrar instrucciones de recuperación; jamás crear una DB vacía.

## 6. Recuperación ante interrupciones

En cada inicio, antes de SQLite:
- `prepared`: no se tocó el activo; se puede cancelar o continuar solo tras verificar staging.
- `rollback_ready`: activo intacto; continuar instalación o cancelar sin perder rollback.
- `installing`: inspeccionar hashes de activo/staging/rollback y completar o revertir según el último paso durable; no inferir por existencia solamente.
- `installed`: validar DB y documentos; si no son íntegros, rollback.
- `committed`: arranque restaurado confirmado; conservar rollback según política.
- `rolling_back`: reanudar rollback idempotentemente.
- `rolled_back`: comprobar estado previo y retirar solo staging sobrante.

Si el journal está corrupto o contradictorio, no modificar DB ni documentos: detener arranque y preservar todas las copias para recuperación manual.

## 7. Pruebas obligatorias antes de habilitar la función

Pruebas unitarias y de integración del módulo de protocolo:
- Paquete válido; DB corrupta; FK rota; JSON contable ausente/malformado.
- Manifiesto manipulado, hash/tamaño divergente, archivo faltante/extra, symlink, junction/reparse point, traversal `..`, rutas absolutas y colisiones.
- Error de espacio, permisos, lectura, escritura, fsync y rename.
- Interrupción simulada después de cada transición y de cada rename.
- Repetición del recovery varias veces (idempotencia).
- Fallo de verificación tras instalar y rollback completo de DB + documentos.
- Fallo de rollback: aplicación detenida sin inicializar DB vacía ni sobrescribir copias.
- Backup de destino y source no modificados.
- Aislamiento: solo admin/licencia autorizada puede programar; token inválido, sesión vencida y usuario no admin se rechazan.
- Auditoría de solicitud y resultado sin rutas externas ni secretos.
- Restauración en perfil aislado: comparar hashes de DB/documentos, conteos y saldos patrón antes/después.
- Prueba real Windows x64: restauración, cierre, reinicio, recuperación tras terminación forzada y arranque confirmado.

## 8. Condiciones para habilitar UI y aprobar G13

No habilitar el botón de restauración hasta que:
1. El protocolo esté implementado y revisado.
2. Todas las pruebas de interrupción y rollback estén verdes.
3. El arranque ejecute recovery antes de `openDatabase()`.
4. Se demuestre que el administrador semilla no se crea, modifica ni reemplaza durante una restauración; no cambiar su lógica existente.
5. CI Windows pruebe restauración y rollback en perfiles aislados.
6. La reconciliación compare datos contables y documentos, no solo el hash de la base.
7. La matriz G13 y la evidencia correspondan al mismo SHA candidato.

Hasta entonces G13 permanece PARCIAL y SICOVEN NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA.


## 9. Evidencia de implementación parcial del journal

- El módulo aislado valida el formato y la versión del journal, UUID de operación, fechas, estados y huellas SHA-256.
- La escritura se realiza mediante archivo temporal exclusivo, `fsync` del archivo y renombrado; se intenta sincronizar el directorio contenedor.
- Las transiciones requieren estado esperado y respetan la máquina de estados; `rollback_ready` exige la huella SHA-256 verificada de la base de retorno.
- La lectura rechaza enlaces simbólicos, elementos especiales y journals que superen 64 KiB. Ante JSON corrupto, falla sin sobrescribirlo.
- Pruebas añadidas: persistencia tras reapertura, transición no permitida, ausencia de huella de rollback, estado esperado obsoleto, operación duplicada, symlink y JSON corrupto.
- Limitación explícita: el journal aún no copia ni sustituye SQLite/documentos, no crea rollback físico y no participa en `app.whenReady()`/`openDatabase()`. G13 permanece PARCIAL.
