# SICOVEN — Directiva de trabajo

La prioridad es la funcionalidad integral, la consistencia contable y la armonía de la experiencia de usuario.

## Objetivo
Asegurar que los módulos, circuitos, procesos, ventanas, formularios, diálogos y modales de SICOVEN trabajen correctamente entre sí, de principio a fin, sin regresiones ni estados incoherentes.

## Criterios
- Auditar y corregir defectos funcionales reales en cualquier módulo relacionado.
- Seguir los flujos completos de operación entre módulos y validar persistencia, cálculos, fechas, moneda, saldos y trazabilidad.
- Asegurar que ventanas, formularios y modales abran, validen, confirmen, cancelen, guarden y cierren correctamente; evitar bloqueos, duplicaciones y pérdida de datos.
- Preservar la información existente y los cambios locales del usuario; nunca descartar cambios sin autorización.
- Mantener la precisión monetaria y la cronología contable, incluidas las reconversiones venezolanas que correspondan por fecha.
- Reutilizar y consolidar correcciones válidas; evitar duplicaciones y cambios de alcance innecesarios.
- Ejecutar pruebas, lint/typecheck y build aplicables; corregir fallos y volver a ejecutar las validaciones afectadas. Informar claramente qué se pudo ejecutar y qué no.
- Trabajar mediante ramas y Pull Requests; no realizar commits directos a main.
- No publicar Releases ni desplegar a producción sin autorización específica.

La revisión debe enfocarse en que el sistema funcione de manera estable, completa, integrada y usable; no en restringir artificialmente el trabajo a una tarea o PR.
