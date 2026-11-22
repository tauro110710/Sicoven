# PRIORIDAD EXCLUSIVA ACTUAL — TERMINAR SOLO LOS TRES OBJETIVOS

Esta directiva prevalece sobre cualquier backlog, fase, pendiente, plan histórico o sugerencia de trabajo posterior que aparezca en este archivo. Hasta completar y validar los tres objetivos de abajo, no iniciar, ampliar ni priorizar ninguna otra tarea del repositorio. No crear módulos, bandejas, recibos, paneles ni funciones ajenas a estos objetivos. Mantener los cambios estrictamente necesarios para terminarlos y corregir defectos que bloqueen su integración.


## Objetivos únicos prioritarios
1. **Alta de empresa e inicio contable sin límites de año:** permitir cualquier fecha válida, pasada o futura, sin mínimo ni máximo artificial. 2012 es una fecha válida de ejemplo, no un límite; fecha administrativa separada; persistencia y aislamiento correctos.
2. **Reconversiones monetarias automáticas por fecha:** aplicar la escala monetaria venezolana correcta a cada operación por su fecha efectiva, conservar importes/escala originales, equivalencias exactas, trazabilidad y evitar doble conversión o pérdida de precisión en cualquier período. Tasa BCV histórica solo cuando corresponda y sea necesaria.
   - La escala se determina por fecha del movimiento: bolívar previo a 2008, Bs.F (2008–19/08/2018), Bs.S (20/08/2018–30/09/2021) y bolívar vigente desde 01/10/2021. No usar una escala global ni la escala de hoy para operaciones antiguas.
   - La tasa BCV es opcional/configurable por fecha de vigencia o período. Solo se requiere cuando el registro, valoración o tratamiento contable necesita conversión Bs/USD; no bloquear operaciones nominales en Bs. por falta de tasa. Si se necesita USD y falta una tasa histórica válida, solicitarla o dejar la equivalencia claramente pendiente; nunca inventar ni aplicar la tasa actual retroactivamente.
   - Conservar por movimiento monto nominal, escala, fecha efectiva, tasa aplicada (si existe), fuente y equivalencia; los flujos afectados deben recalcularse en orden cronológico ante operaciones atrasadas, sin duplicar reconversiones.
3. **Integración real de compras, inventario/Kardex, costos y contabilidad:** conectar las conversiones con compras y sus fechas, entradas de Kardex, existencias, costos, CxP, impuestos y asientos, incluidos los recálculos cronológicos de operaciones atrasadas que afecten estos flujos, sin duplicar ni alterar documentos originales.

## Criterio de cierre de estos tres objetivos
No basta con helpers, metadata, etiquetas, previews ni pruebas aisladas. Debe verificarse el flujo real, persistencia SQLite, coherencia entre compras/Kardex/costos/asientos, escenarios retroactivos relevantes, pruebas automatizadas, TypeScript y build; además, validaciones Windows/desktop pertinentes. Corregir fallos y repetir checks. No fusionar ni publicar mientras haya verificaciones críticas pendientes o fallidas. Solo después de confirmar los tres objetivos como terminados se retomará el resto del trabajo documentado.

---

# SICOVEN — Alcance de trabajo vigente

## 1. Registro de empresa e inicio contable sin límites de año
- Registrar empresas nuevas y seleccionar cualquier fecha contable válida, sin mínimo ni máximo artificial. 2012 es válido, pero no es límite.
- Mantener separadas la fecha administrativa de registro y la fecha inicial contable.
- Confirmar persistencia SQLite, empresa activa y aislamiento de datos entre empresas.

## 2. Reconversiones monetarias automáticas según fecha
- Aplicar automáticamente la escala monetaria venezolana correcta según la fecha efectiva de cada operación, sin limitar el inicio contable a 2012.
- Escala por fecha: bolívar previo a 2008; Bs.F 01/01/2008–19/08/2018; Bs.S 20/08/2018–30/09/2021; bolívar vigente desde 01/10/2021. Determinarla para cada movimiento individual.
- BCV opcional y configurable por fecha/período; exigirla solo si se necesita conversión USD. Operaciones nominales en Bs. no deben bloquearse por falta de tasa; equivalencias USD sin tasa histórica se dejan pendientes explícitas, sin inventar valores ni usar la tasa actual.
- Conservar el monto nominal original, la escala de origen, el equivalente normalizado a bolívares digitales y trazabilidad; evitar doble conversión y pérdida de precisión.
- Verificar que la equivalencia se use en los cálculos que comparan/suman períodos de escalas distintas, no solo en etiquetas o vistas previas.
- Usar tasa BCV histórica únicamente cuando corresponda y sea necesaria; nunca sustituir faltantes por tasa actual inventada.

## 3. Integración de compras, inventario/Kardex, costos y contabilidad
- Integrar cada compra con sus líneas de artículos, entradas de Kardex, existencia, costo promedio/PEPS, cuentas por pagar, impuestos y asiento contable que corresponda.
- Aplicar la escala monetaria de acuerdo con las fechas efectivas de factura, abono en cuenta y movimiento, sin desalinear cantidades, importes, costos, USD y asientos.
- Compras, inventario, Kardex y asientos no pueden exigir una tasa BCV indiscriminadamente: deben admitir registro en Bs. nominales sin tasa cuando sea viable, y calcular equivalencias USD solo con una tasa válida configurada para la fecha/período correspondiente.
- Mantener SQLite como autoridad, empresa aislada, persistencia atómica e idempotencia; conservar documentos y montos originales.
- Aceptación: validar registro con fechas sin límites artificiales, reconversiones en todos los flujos afectados, compras que actualizan Kardex/costos/asientos sin duplicar y escenarios retroactivos. Ejecutar pruebas, TypeScript, build y verificaciones de escritorio aplicables; corregir fallos antes de integrar o publicar.
