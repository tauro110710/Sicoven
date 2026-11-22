# PRIORIDAD EXCLUSIVA ACTUAL — TERMINAR SOLO LOS TRES OBJETIVOS

Esta directiva prevalece sobre cualquier backlog, fase, pendiente, plan histórico o sugerencia de trabajo posterior que aparezca en este archivo. Hasta completar y validar los tres objetivos de abajo, no iniciar, ampliar ni priorizar ninguna otra tarea del repositorio. No crear módulos, bandejas, recibos, paneles ni funciones ajenas a estos objetivos. Mantener los cambios estrictamente necesarios para terminarlos y corregir defectos que bloqueen su integración.


## Objetivos únicos prioritarios
1. **Alta de empresa e inicio contable desde 2012:** permitir crear empresas con cualquier fecha de inicio contable válida, sin límites artificiales de año. 2012 debe ser una fecha válida, no un mínimo ni un máximo; fecha administrativa separada; persistencia y aislamiento correctos.
2. **Reconversiones monetarias automáticas por fecha:** aplicar la escala monetaria venezolana correcta a cada operación por su fecha efectiva, conservar importes/escala originales, equivalencias exactas, trazabilidad y evitar doble conversión o pérdida de precisión. Tasa BCV histórica solo cuando corresponda y sea necesaria.
3. **Integración real de compras, inventario/Kardex, costos y contabilidad:** conectar las conversiones con compras y sus fechas, entradas de Kardex, existencias, costos, CxP, impuestos y asientos, incluidos los recálculos cronológicos de operaciones atrasadas que afecten estos flujos, sin duplicar ni alterar documentos originales.

## Criterio de cierre de estos tres objetivos
No basta con helpers, metadata, etiquetas, previews ni pruebas aisladas. Debe verificarse el flujo real, persistencia SQLite, coherencia entre compras/Kardex/costos/asientos, escenarios retroactivos relevantes, pruebas automatizadas, TypeScript y build; además, validaciones Windows/desktop pertinentes. Corregir fallos y repetir checks. No fusionar ni publicar mientras haya verificaciones críticas pendientes o fallidas. Solo después de confirmar los tres objetivos como terminados se retomará el resto del trabajo documentado.

---

# SICOVEN — Alcance de trabajo vigente

## 1. Registro de empresa e inicio contable desde 2012
- Registrar empresas nuevas y seleccionar fecha contable desde 2012-01-01 en adelante.
- Mantener separadas la fecha administrativa de registro y la fecha inicial contable.
- Confirmar persistencia SQLite, empresa activa y aislamiento de datos entre empresas.

## 2. Reconversiones monetarias automáticas según fecha
- Aplicar automáticamente la escala monetaria venezolana correcta por fecha efectiva de cada operación desde 2012.
- Conservar el monto nominal original, la escala de origen, el equivalente normalizado a bolívares digitales y trazabilidad; evitar doble conversión y pérdida de precisión.
- Verificar que la equivalencia se use en los cálculos que comparan/suman períodos de escalas distintas, no solo en etiquetas o vistas previas.
- Usar tasa BCV histórica únicamente cuando corresponda y sea necesaria; nunca sustituir faltantes por tasa actual inventada.

## 3. Integración de compras, inventario/Kardex, costos y contabilidad
- Integrar cada compra con sus líneas de artículos, entradas de Kardex, existencia, costo promedio/PEPS, cuentas por pagar, impuestos y asiento contable que corresponda.
- Aplicar la escala monetaria de acuerdo con las fechas efectivas de factura, abono en cuenta y movimiento, sin desalinear cantidades, importes, costos, USD y asientos.
- Mantener SQLite como autoridad, empresa aislada, persistencia atómica e idempotencia; conservar documentos y montos originales.
- Aceptación: validar registro desde 2012, reconversiones en todos los flujos afectados, compras que actualizan Kardex/costos/asientos sin duplicar y escenarios retroactivos. Ejecutar pruebas, TypeScript, build y verificaciones de escritorio aplicables; corregir fallos antes de integrar o publicar.
