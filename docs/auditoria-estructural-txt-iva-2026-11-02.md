# Auditoría estructural y evolución del TXT de retenciones IVA — 02-11-2026

## Alcance

Auditoría estática y ampliación técnica de `src/utils/seniatGenerators.ts`, `src/utils/seniatGenerators.test.ts`, `src/components/Retenciones/RetencionesIvaView.tsx` y los tipos fiscales. El trabajo se realiza en la rama `feature/txt-iva-structural-audit`; no modifica `main`, el administrador semilla ni el modelo de persistencia SQLite.

La referencia de 16 campos disponible es el instructivo `RI_DRIVA2020-IT01V3_0_0`, versión 3.0.0, septiembre de 2020, consultado en una reproducción documental de terceros. Se conserva como referencia histórica de estructura, no como afirmación de vigencia normativa actual ni como homologación.

## Contrato de salida estructural

| # | Campo histórico | Valor / origen |
|---:|---|---|
| 1 | RIF agente | `cleanRif(company.rif)` |
| 2 | Período AAAAMM | `voucher.period` |
| 3 | Fecha documento | `voucher.invoiceDate` |
| 4 | Operación | `C` para compra |
| 5 | Tipo documento | Compra fuente: `01`, `02` o `03` |
| 6 | RIF contraparte | RIF proveedor normalizado |
| 7 | Número documento | Factura/ND/NC tomado de la compra vinculada |
| 8 | Número control | Comprobante y compra fuente conciliados |
| 9 | Monto documento | `totalAmountBs`, dos decimales |
| 10 | Base imponible | `taxableBaseBs`, dos decimales |
| 11 | IVA retenido | `vatWithheldBs`, dos decimales |
| 12 | Documento afectado | `0` para factura; `affectedInvoiceNumber` para ND/NC |
| 13 | Número comprobante | `voucherNumber` de 14 dígitos y período coincidente |
| 14 | Monto exento | `exemptAmountBs`, dos decimales |
| 15 | Alícuota | `taxRate`, dos decimales |
| 16 | Expediente importación | `0` en operaciones no importadas |

Las filas conservan 16 campos separados por tabulador y se unen mediante CRLF.

## Controles de integridad implementados

- RIF del agente y proveedor, fecha calendario, período AAAAMM y correlativo de comprobante.
- Un solo período por archivo, identificadores y correlativos no duplicados.
- Bloqueo de comprobantes con corrección fiscal pendiente.
- Importes finitos/no negativos y conciliación matemática del IVA y de la retención.
- La fecha del documento no puede ser posterior al período declarado.
- Cuando la vista entrega el conjunto de compras, cada comprobante debe resolver su `purchaseRecordId` dentro de la empresa; incluso una colección vacía se considera fuente autoritativa y bloquea comprobantes huérfanos (solo llamadas legacy que omiten el argumento conservan el modo de compatibilidad).
- RIF, fecha, número documental y control del comprobante deben conciliar con la compra fuente.
- Las ND/NC requieren número propio y factura afectada; no se sustituye ningún dato faltante por valores inventados.
- La vista exporta el conjunto completo del período, sin dejar que el filtro de búsqueda altere la población fiscal.
- Una declaración sin operaciones sigue siendo una entidad distinta; no se transforma en un TXT vacío automáticamente.

## Límites del flujo fiscal actual

El modelo de compras incluye ND y NC y existen flujos específicos para registrarlas. Sin embargo, el alta genérica de compras rechaza esos tipos. Además, la nota de crédito existente marca el comprobante de retención original como pendiente de corrección fiscal y bloquea la exportación de ese período hasta resolver el ajuste. Esta rama prepara el mapeo documental en el generador, pero no afirma que las notas ya produzcan comprobantes autónomos de retención IVA.

El expediente de importación permanece en cero y no se incorporan tipos 04/05/06 porque el modelo de comprobantes y la fuente documental actual no contienen datos suficientes para construirlos con seguridad.

## Pruebas añadidas

- Correspondencia exacta de los 16 campos para una factura ordinaria.
- Escenarios de alícuota reducida (8 %) con retención 75 %, alícuota general (16 %) con retención 100 % y documento exento con base/IVA/retención en cero.
- Conciliación de enteramientos: el resumen solo reconoce pagos cuyo asiento real cuadra en Bs/USD, debita el pasivo IVA y acredita las cuentas bancarias por los importes exactos de los movimientos enlazados; se rechazan partidas malformadas o cuentas/valores discordantes.
- Dos comprobantes generan dos filas CRLF, cada una con 16 campos.
- Clasificación de ND y NC desde la compra vinculada y salida del documento afectado.
- Rechazo de compra fuente ausente (incluida colección vacía), documento afectado ausente, proveedor/fecha/control/número documental discordantes y fecha documental posterior al período.
- Se añadió un workflow de GitHub Actions que ejecuta `npm test`, `npm run check:types` y `npm run build` en las PR contra `main`.

## Próxima ejecución técnica

1. Revisar y corregir cualquier fallo de pruebas, tipado o build que reporte el workflow del SHA final.
2. Cerrar la matriz automatizada restante de documentos vinculados y pagos parciales/totales sin modificar documentos ni comprobantes históricos.
3. Verificar que la previsualización y descarga consuman exactamente la misma cadena generada y mantengan tabuladores/CRLF y codificación UTF-8.
4. Mantener fuera del alcance de este cierre técnico cualquier declaración de aceptación externa que no esté respaldada por evidencia disponible.

## Fuentes de referencia

- Instructivo SENIAT `RI_DRIVA2020-IT01V3_0_0`, versión 3.0.0, septiembre de 2020 (reproducción de terceros): https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855
- Providencia SNAT/2025/000054 (reproducción consultada para artículos 13–17): https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2025-54

**Estado:** generador enlazado a compras fuente; matriz de factura, ND/NC, alícuotas y exención ampliada; conciliación de asientos de enteramiento reforzada. En el HEAD `68b596458b8dfdbf70b0696f304e9ab74c29dda7`, SICOVEN CI #110, Desktop Validation #1321 e instalador Windows #1438 finalizaron SUCCESS. La aceptación externa del Portal Fiscal sigue sin ejecutarse.


## Aclaración de vigencia operativa y alcance — 02-11-2026

La revisión web de 02/11/2026 localizó el instructivo RI_DRIVA2020-IT01V3_0_0, versión 3.0.0 de septiembre de 2020, en reproducciones coincidentes (Readkong, Scribd y Studocu); no se encontró una versión posterior que lo sustituya. Se adopta por tanto como especificación técnica de trabajo para el TXT de retenciones IVA: 16 columnas y reglas descritas en el documento. La fecha de publicación de una reproducción reciente no equivale a una nueva revisión del instructivo.

El documento distingue expresamente el nombre Monto_IVA del significado para agentes de retención: el campo corresponde al monto retenido por el comprador. Por ello, la columna 11 debe recibir vatWithheldBs; la columna 15 contiene la alícuota aplicada. El generador actual sigue ese mapeo.

El instructivo explica que el archivo puede probarse en el Portal Fiscal, opción Retención IVA (prueba carga de archivo). Esa aceptación no se ha ejecutado desde esta auditoría. La única ambigüedad técnica abierta aquí es la representación de una factura con varias alícuotas: el formato define un campo de alícuota por fila, pero no explica expresamente si se repite el documento en filas separadas ni cómo distribuir el comprobante y la retención. No se debe cambiar el layout de 16 campos por esa incertidumbre.


## Cierre técnico del flujo sin operaciones — 02-11-2026

- El artículo 15 de la Providencia SNAT/2025/000054 exige presentar declaración incluso cuando no se hayan efectuado operaciones sujetas a retención.
- El instructivo RI_DRIVA2020-IT01V3_0_0 define el archivo TXT de operaciones con 16 columnas, pero no prescribe una fila sintética de 16 ceros para declarar un período sin operaciones.
- Se retiró de SICOVEN la descarga de esa fila no especificada y su generador/pruebas asociadas. La declaración sin operaciones permanece como registro explícito en SQLite y se presenta mediante el procedimiento habilitado en el Portal Fiscal; la constancia se registra en el evento FILED.
- No se modifica la estructura de los TXT de operaciones reales.


## Revisión final de facturas con varias alícuotas — 02-11-2026

Se revisó el flujo completo de compra, cálculo de retención, comprobante IVA y exportación:

- `PurchaseRecord` conserva `taxableBaseBs`, `taxRate` y `vatAmountBs` como valores escalares.
- `VatRetentionVoucher` conserva la misma estructura escalar para base, alícuota, IVA causado e IVA retenido.
- La captura `NewPurchaseModal` solo permite seleccionar una alícuota para toda la factura.
- La exportación coloca una alícuota en la columna 15 de cada fila y un importe de retención en la columna 11.

La consulta del instructivo RI_DRIVA2020-IT01V3_0_0 confirma que la columna 15 representa la alícuota aplicada y que la columna 11 representa, para el agente de retención, el importe efectivamente retenido. No define expresamente la cardinalidad de filas para una sola factura que contenga bases gravadas a distintas alícuotas, ni el tratamiento de la base, monto de documento, monto exento y comprobante al repetir el documento. La investigación adicional tampoco encontró una regla oficial inequívoca que autorice duplicar filas o distribuir la retención entre alícuotas.

**Decisión de integridad:** no se implementa una serialización especulativa. Duplicar el comprobante, repetir el total de factura o prorratear la retención sin una regla SENIAT confirmada podría alterar la declaración. El desglose multialícuota queda bloqueado únicamente por esta definición externa. La implementación requiere confirmar el comportamiento en «Retención IVA (prueba carga de archivo)» del Portal Fiscal con un caso de factura mixta y conservar el resultado/acuse como evidencia. Hasta entonces, SICOVEN no debe presentar una factura mixta como si su exportación estuviera homologada.

## Estado de ejecución automatizada — HEAD 68b5964

| Control | Run | Resultado |
|---|---:|---|
| SICOVEN CI | #110 | SUCCESS |
| Desktop Validation | #1321 | SUCCESS |
| Windows installer | #1438 | SUCCESS |

Estos resultados acreditan las pruebas automatizadas del commit indicado; no equivalen a aceptación del archivo por SENIAT ni a certificación oficial.


## Adenda operativa: serialización de importes enteros (04/11/2026)

Tras el rechazo de un archivo TXT en el Portal Fiscal, la contadora del contribuyente indicó que la carga requiere campos numéricos sin decimales y montos redondeados a enteros. Se ajustó el generador de Retenciones IVA para serializar las columnas de montos (9, 10, 11 y 14) y la alícuota (15) como enteros, sin sufijos decimales.

El redondeo ocurre exclusivamente al construir el TXT. Los comprobantes fuente, importes calculados, libros, asientos, saldos y persistencia mantienen su precisión original. Las validaciones previas a la serialización continúan operando sobre los importes decimales originales.

Esta adaptación responde al rechazo operativo reportado y debe confirmarse con una nueva prueba de carga en el Portal Fiscal. No constituye por sí sola una homologación ni prueba que todos los casos de redondeo sean aceptados por el SENIAT.
