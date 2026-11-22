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
