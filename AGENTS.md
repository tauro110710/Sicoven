# Instrucciones de trabajo para SICOVEN

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
