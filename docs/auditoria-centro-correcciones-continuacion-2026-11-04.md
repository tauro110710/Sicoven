# Continuación de auditoría — Centro Integral de Correcciones
Fecha: 04/11/2026

## Cambios aplicados en main

- Se endureció la validación de identidad del expediente: el actor debe ser administrador autenticado, con ID entero seguro positivo y nombre de usuario no vacío.
- La ejecución exige una referencia correctiva de hasta 160 caracteres.
- Se impide cerrar un expediente reutilizando como referencia de ejecución la misma referencia del documento fuente.
- Se ampliaron las pruebas automatizadas para cubrir identidades inválidas y el rechazo de la referencia original.
- Se añadieron pruebas de atomicidad para revisión y ejecución: si falla la escritura del evento en el ledger general `audit_events`, también debe revertirse el cambio de estado del expediente y conservarse el historial previo.

## Commits de esta continuación

- `a784908cb78325ddf6cfc8682bfa20acce83aabe` — endurecimiento del workflow.
- `882c04e28a97d43607a2da0cd217c3dd23ed9522` — pruebas de identidad y referencia.
- `19ad6db0175575d724a0520007d4fef50d44e753` — pruebas de rollback de revisión y ejecución.

## Validación

Los cambios fueron revisados estáticamente contra el módulo SQLite y su suite de pruebas. No se ejecutaron `npm test`, `npm run check:types`, `npm run build` ni el empaquetado Electron en esta sesión. Por tanto, las pruebas nuevas están incorporadas, pero su resultado no se declara verde.

## Pendientes funcionales que siguen bloqueando la declaración de completitud

1. La ejecución del expediente verifica que exista una referencia en una colección de SQLite, pero aún no demuestra una relación documental fuerte y específica entre el correctivo y el origen para cada tipo de entidad.
2. No todas las rutas NC/ND están completas: ventas contado, compras de servicios sin inventario, pagos/cobros previos, reintegros y efectos completos en auxiliares e impuestos requieren circuitos especializados.
3. La rectificación fiscal debe enlazar declaración, comprobantes, enteramiento, acuse, pago y procedimiento legal aplicable. Un evento o incidencia fiscal no equivale a una declaración sustitutiva presentada.
4. La corrección parcial debe distribuirse de forma consistente entre asiento, CxC/CxP, caja/bancos, retenciones, Kardex, costos e impuestos.
5. El expediente necesita ciclo de observaciones/subsanación y retiro controlado, sin borrar eventos ni permitir que el solicitante se autoapruebe.
6. Los soportes documentales deben quedar vinculados directamente al expediente y a cada efecto correctivo, con hash, autor, revisión y conservación.
7. Se requieren pruebas integrales sobre concurrencia real, rollback, backup/restore, multiempresa, períodos cerrados, doble moneda y consistencia de todos los auxiliares.

## Criterio de cierre

No declarar terminado el Centro Integral hasta demostrar que cada corrección produce los efectos correctivos apropiados en su módulo especializado, que el expediente referencia esos efectos mediante vínculos verificables y que todas las pruebas de escritorio/SQLite y de restauración pasan. El registro original debe permanecer intacto y la trazabilidad debe ser reconstruible de extremo a extremo.
