# SICOVEN — Alcance de trabajo vigente

## 1. Registro de empresas e inicio contable desde 2012
- Permitir registrar empresas y elegir libremente la fecha de inicio contable, incluyendo cualquier fecha desde 2012, sin imponer el año actual ni exigir reconstruir operaciones anteriores.
- Conservar por separado la fecha administrativa de registro y la fecha de inicio contable.
- Validar el alta, persistencia SQLite, selección de la nueva empresa y apertura de su contabilidad sin arrastrar datos de otra empresa.

## 2. Reconversiones y escalas monetarias automáticas por fecha
- Integrar las reconversiones monetarias venezolanas y escalas vigentes en el flujo contable real, aplicándolas automáticamente según la fecha efectiva de cada operación.
- Conservar los importes originales, la escala monetaria de origen y la trazabilidad; evitar conversiones dobles, pérdida de precisión y redondeo acumulativo.
- Verificar los períodos de vigencia y las equivalencias desde 2012 en registros, saldos, cálculos, consultas y reportes que correspondan.
- No inventar ni sustituir tasas BCV históricas faltantes por tasas actuales; solicitar o marcar faltantes solo cuando sean necesarios para el cálculo dependiente.

## 3. Integración efectiva de compras, inventario, costos y contabilidad
- Alinear compras y facturas con entradas de inventario/Kardex, costos, existencias, cuentas por pagar, caja/bancos, impuestos y asientos contables correspondientes, usando la fecha efectiva de cada documento.
- Asegurar que las reconversiones automáticas por fecha se apliquen coherentemente en todos estos flujos y en sus cálculos derivados.
- Mantener persistencia SQLite, atomicidad, idempotencia, aislamiento por empresa y conservación de documentos originales.
- Validar escenarios reales y retroactivos desde 2012: alta de empresa, compras, entradas/salidas de inventario, costo y saldo, asientos y reconversiones; ejecutar pruebas, TypeScript y build, y pruebas de escritorio/SQLite cuando aplique. Corregir y volver a validar fallos antes de considerar estos tres puntos terminados.
