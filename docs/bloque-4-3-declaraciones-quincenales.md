# Bloque 4.3 — Auxiliar de declaraciones y enteramientos quincenales IVA

**Estado:** implementación inicial en rama de trabajo; pendiente CI y revisión de PR.  
**Alcance:** auxiliar de control para las dos ventanas de retención del mes, fotografía de comprobantes, revisión, presentación, vencimiento documentado y enteramientos.  
**No certifica cumplimiento fiscal ni aceptación de archivos por el Portal Fiscal SENIAT.**

## 1. Ventanas

El auxiliar separa las retenciones en:
- Primera quincena: día 1 al 15.
- Segunda quincena: día 16 al último día calendario del mes.

Los rangos se derivan del año y mes elegidos, incluyendo febrero bisiesto. No se calcula una fecha de vencimiento legal a partir de esos rangos.

## 2. Fotografía inmutable

Cada declaración conserva:
- Empresa.
- Período `AAAAMM`.
- Ventana y fechas exactas.
- IDs de comprobantes incluidos.
- Snapshot de número, proveedor, fecha fiscal, base, IVA y retención.
- Totales conciliados.
- Indicador explícito de declaración sin operaciones.
- Fecha de preparación y usuario cuando esté disponible.

Un comprobante no puede incluirse dos veces en declaraciones de la misma empresa. No se modifica la fotografía cuando cambian los registros operativos.

Los comprobantes históricos anteriores al Bloque 4.2 que no tienen `fiscalDate` deben recibir una asignación manual de fecha fiscal, respaldada por el comprobante de pago o evidencia del abono en cuenta. La asignación se conserva para todo el mes, incluso si el comprobante pertenece a la quincena opuesta a la declaración que se prepara primero. No se usa la fecha de factura como sustituto. Mientras falte la confirmación de cualquier comprobante histórico del mes, no se permite preparar ninguna de las dos quincenas.

Si un comprobante incluido recibe después una marca de corrección fiscal pendiente, la revisión de la declaración queda bloqueada hasta que se regularice el soporte. Si aparecen comprobantes nuevos dentro de la ventana después de preparar el snapshot, o comprobantes legacy del mes sin fecha asignada, la revisión y la presentación quedan bloqueadas. Si la declaración ya fue presentada, el auxiliar muestra la diferencia pero no la rectifica. El snapshot no se amplía silenciosamente; se requiere un procedimiento de rectificación, que permanece pendiente.

## 3. Ciclo de estados

La declaración se prepara y los cambios posteriores se registran como eventos append-only:
1. `PREPARED`: snapshot creado.
2. `REVIEWED`: revisión registrada.
3. `FILED`: presentación registrada con número y acuse/referencia.
4. `PARTIALLY_PAID`: enteramiento parcial documentado.
5. `PAID`: suma de enteramientos alcanza el total retenido.

Los eventos conservan fecha efectiva y fecha de registro. No se permite retroceder la cronología ni modificar o borrar eventos históricos.

Los pagos parciales requieren importe positivo, referencia bancaria y soporte documental. El acumulado no puede superar el total retenido de la declaración.

Una declaración sin operaciones debe prepararse expresamente y no puede contener comprobantes. Puede revisarse y presentarse, pero no admite un enteramiento monetario positivo por retenciones inexistentes.

## 4. Vencimientos

No se generan vencimientos automáticos ni se codifican fechas hábiles estimadas.

El auxiliar permite documentar un vencimiento únicamente si el usuario aporta:
- Fecha límite publicada.
- Título de la fuente.
- Referencia/publicación.
- URL HTTPS bajo el dominio oficial SENIAT.

La aplicación comprueba el formato de fecha y que la URL use HTTPS bajo el dominio oficial SENIAT; no consulta la página ni verifica automáticamente su contenido o disponibilidad. El usuario debe cotejar la publicación original. El registro del vencimiento es inmutable. Si la autoridad publica una corrección, deberá diseñarse un evento de sustitución con trazabilidad, no sobrescribir la evidencia anterior.

## 5. Persistencia y seguridad

- Los registros se guardan dentro del snapshot contable SQLite.
- Las colecciones `vatWithholdingDeclarations` y `vatWithholdingDeclarationEvents` se validan en la capa de integridad de SQLite.
- Declaraciones y eventos son append-only.
- La base valida empresa, período, ventana, unicidad, comprobantes, totales y transiciones.
- La preparación y cada evento generan registros en `audit_events` dentro de la misma transacción de guardado.
- Los respaldos JSON incluyen ambas colecciones; un respaldo anterior sin estas colecciones puede importarse como vacío solo cuando no se intenta eliminar historial quincenal ya existente en SQLite.
- No se reescriben comprobantes, compras, asientos ni cierres históricos.

## 6. Límites pendientes

Este auxiliar registra la presentación y los enteramientos como evidencia; no realiza por sí mismo:
- Conexión o presentación automática ante SENIAT.
- Generación de un TXT quincenal certificado por la especificación vigente.
- Cálculo de vencimientos sin calendario oficial verificable.
- Asiento automático de pago/enteramiento ni conciliación bancaria automática.
- Rectificación de declaraciones ya presentadas.
- Tratamiento normativo completo de múltiples pagos parciales de una misma factura ni la emisión de comprobantes adicionales por pagos posteriores.

La especificación técnica vigente del Portal Fiscal debe obtenerse y validarse por separado. Las copias históricas de guías de TXT no bastan para afirmar aceptación en 2026.

## 7. Pruebas previstas

- Límites de quincena y febrero bisiesto.
- Aislamiento por empresa y ventana.
- Declaración con operaciones y sin operaciones.
- Rechazo de comprobantes duplicados o ya declarados.
- Bloqueo de revisión si aparecen comprobantes posteriores no incluidos en el snapshot.
- Conciliación de totales con snapshots.
- Bloqueo de revisión con correcciones fiscales pendientes.
- Asignación manual y documentada de fechas legacy para ambas quincenas.
- Orden revisión → presentación → enteramiento.
- Pagos parciales y bloqueo de sobrepago.
- Fuente oficial obligatoria para vencimientos.
- Inmutabilidad de declaraciones/eventos.
- Auditoría SQLite y conservación de snapshots históricos.

**Resultado esperado:** auxiliar trazable de control quincenal, sin automatizar fechas normativas ni afirmar cumplimiento SENIAT que no haya sido demostrado.
