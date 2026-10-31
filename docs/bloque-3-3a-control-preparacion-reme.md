# Bloque 3.3A — Control de preparación de índices para REME

## Objetivo

Introducir una barrera técnica previa al futuro motor REME. Este subbloque **no calcula factores, no reexpresa saldos y no genera asientos**. Determina si los tramos mensuales solicitados cuentan con evidencia de índices que supera controles preliminares.

## Reglas de selección

- Para períodos hasta noviembre de 2007 se exige la serie IPC del Área Metropolitana de Caracas (IPC_AMC).
- Desde diciembre de 2007 se exige la serie INPC del BCV.
- Solo se consideran series de niveles de índice (`INDEX_LEVEL`), no variaciones porcentuales.
- Se utiliza la última versión importada de cada serie; si esa versión no está aprobada, no se retrocede silenciosamente a una versión anterior.
- Se exige revisión aprobatoria, emisor identificado como Banco Central de Venezuela, URL HTTPS del dominio exacto `www.bcv.org.ve`, huella SHA-256 y metadatos de publicación.
- Cada mes del tramo solicitado debe existir y estar marcado `OBSERVED`.
- Los meses faltantes, estimados o proyectados bloquean el tramo. No se interpola ni se completa automáticamente.
- Si el período cruza noviembre/diciembre de 2007, se separa entre IPC_AMC e INPC_BCV.

## Seguridad y persistencia

- La consulta es de solo lectura.
- El canal IPC exige sesión válida y licencia autorizada.
- El puente preload solo expone la consulta; no permite importar, aprobar ni alterar series.
- No se modifica ninguna tabla de contabilidad, saldo, comprobante ni clasificación.
- La función siempre devuelve `calculationEnabled: false`, incluso cuando la evidencia pasa el control preliminar.

## Límites explícitos

La coincidencia de emisor, URL y metadatos no constituye por sí sola certificación de autenticidad. El administrador debe contrastar el archivo descargado con la publicación original y documentar esa revisión en el catálogo de fuentes.

La aprobación documental de una serie tampoco basta para habilitar REME. Antes del cálculo se requiere completar:

1. Validación de la metodología VEN-NIF aplicable al ejercicio y a la entidad.
2. Cobertura completa de índices para todas las fechas de origen y medición.
3. Clasificación profesional aprobada y conciliada por componentes.
4. Tratamiento de períodos estimados según BA VEN-NIF 2, versión vigente, con evidencia del experto cuando corresponda.
5. Papeles de trabajo revisables, conciliación y aprobación profesional.
6. Pruebas contables y de regresión antes de cualquier propuesta de asiento.

## Evidencia de prueba

La batería automatizada cubre ausencia de series, aprobación pendiente, emisor y URL no oficiales, meses faltantes, tramos que cruzan el cambio de series y autenticación IPC.

Los datos usados en pruebas son fixtures sintéticos aislados en SQLite en memoria; no se cargan en la base de un cliente ni se presentan como índices económicos reales.
