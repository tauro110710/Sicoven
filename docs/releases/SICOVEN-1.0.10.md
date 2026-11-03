# SICOVEN 1.0.10 — notas de versión

## Contabilidad básica
- Validación de partida doble en bolívares y dólares en el Libro Diario.
- Aislamiento del Libro Mayor por empresa activa.
- Prueba integrada de conciliación de Balance de Comprobación, Estado de Situación Financiera, Estado de Resultados, Cambios en el Patrimonio, Flujo de Efectivo y asiento de apertura del siguiente ejercicio.
- Los soportes documentales son opcionales y no bloquean la contabilización por su ausencia.

## Restauración y recuperación
- Incluye las mejoras G13 integradas en main: verificación de SQLite y documentos, journal durable, snapshots vinculados por SHA-256 y rollback más seguro.
- La aceptación física de restauración/interrupción en equipo Windows continúa pendiente; esta versión no declara certificación integral G13.

## Plataforma
- Aplicación de escritorio Windows.
- SQLite local como única fuente de verdad.
- No incluye datos de demostración.

## Estado de conformidad
Esta versión no representa homologación SENIAT ni certificación fiscal oficial. La aceptación externa y las pruebas manuales pendientes se mantienen expresamente abiertas.
