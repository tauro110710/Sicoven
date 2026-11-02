# Auditoría estructural del TXT de retenciones IVA — 02-11-2026

## Alcance

Revisión estática de `src/utils/seniatGenerators.ts`, `src/utils/seniatGenerators.test.ts`, `src/components/Retenciones/RetencionesIvaView.tsx` y los tipos fiscales actuales. No modifica el generador, comprobantes, asientos, históricos ni SQLite.

La referencia técnica disponible es el instructivo `RI_DRIVA2020-IT01V3_0_0`, versión 3.0.0, septiembre de 2020, consultado en una reproducción documental de terceros. No se ha localizado una publicación primaria actualizada del SENIAT que confirme que esa especificación siga vigente en noviembre de 2026. Por tanto, los hallazgos siguientes describen conformidad frente a la referencia histórica, no homologación actual.

## Correspondencia de los 16 campos

| # | Campo histórico | Salida actual | Resultado |
|---:|---|---|---|
| 1 | RIF contribuyente/agente | `cleanRif(company.rif)` | Coincide en estructura; validar excepciones admitidas |
| 2 | Período impositivo AAAAMM | `voucher.period` | Coincide; debe representar período fiscal correcto |
| 3 | Fecha documento AAAA-MM-DD | `voucher.invoiceDate` | Coincide en forma; falta validar relación temporal con período |
| 4 | Tipo operación | Constante `C` | Correcto para compra según instructivo histórico |
| 5 | Tipo documento | Constante `01` | Solo factura; no representa tipos 02/03/04/05/06 |
| 6 | RIF comprador/vendedor | RIF proveedor normalizado | Caso ordinario; no admite el caso histórico de RIF cero para proveedor sin RIF |
| 7 | Número documento | `voucher.invoiceNumber` | Falta validar longitud máxima de 20 y restricciones de espacios |
| 8 | Número control | `voucher.controlNumber` | Falta permitir cero cuando no aplique y validar longitud máxima de 20 |
| 9 | Monto documento | `totalAmountBs.toFixed(2)` | Formato decimal correcto; falta validar ancho máximo y monto mayor que cero |
| 10 | Base imponible | `taxableBaseBs.toFixed(2)` | Formato decimal correcto; falta validar ancho máximo |
| 11 | Monto IVA (para agente: IVA retenido) | `vatWithheldBs.toFixed(2)` | Semántica coincide con la descripción histórica del agente de retención |
| 12 | Documento afectado | Constante `0` | Correcto para factura; insuficiente para notas de débito/crédito |
| 13 | Número comprobante AAAAMMSSSSSSSS | `voucherNumber` | Longitud y período comprobados |
| 14 | Monto exento IVA | `exemptAmountBs.toFixed(2)` | Formato decimal correcto; falta validar ancho y regla de coherencia con monto/base |
| 15 | Alícuota | `taxRate.toFixed(2)` | Formato decimal correcto; falta validar catálogo/reglas vigentes por documento |
| 16 | Expediente importación | Constante `0` | Correcto cuando no es importación; no soporta documento/expediente de importación |

## Brechas demostrables en el código actual

1. **Tipos documentales:** el generador fija `01` y `0` en documento afectado. El modelo `PurchaseRecord` contempla `01`, `02` y `03`, además de `affectedInvoiceNumber`, pero `generateSeniatIvaTxt` recibe solo comprobantes y no recibe/consulta las compras enlazadas. Por ello no puede construir con fiabilidad filas de notas de débito/crédito.
2. **Proveedor sin RIF:** el instructivo histórico describe un caso con RIF cero sujeto a retención del 100%; el generador exige que el RIF del proveedor pase `validateVenezuelanRif`. No se debe abrir esa excepción hasta confirmar que sigue vigente y modelar el caso de forma explícita.
3. **Control documental:** el generador exige número de factura y control no vacíos, aunque la guía histórica admite cero cuando el número de control no aplique. También falta limitar ambos campos a 20 caracteres y validar espacios internos conforme al instructivo.
4. **Fecha frente al período:** se valida que la fecha exista y que el período sea AAAAMM, pero no se comprueba que la fecha del documento sea menor o igual al período declarado, exigencia de la guía histórica.
5. **Montos y anchos:** se comprueba que los importes sean finitos/no negativos y se reconcilian IVA y retención; no se valida el máximo de caracteres de los campos numéricos ni que el monto total sea estrictamente mayor que cero.
6. **Casos no factura:** el expediente de importación siempre sale como cero; la función no admite datos para importaciones/exportaciones ni certificaciones.

## Integración y controles ya existentes

- La vista de retenciones exporta `periodVouchers` del período completo, no la tabla filtrada por búsqueda.
- El exportador rechaza períodos mezclados, comprobantes duplicados y comprobantes con corrección fiscal pendiente.
- El archivo se construye con 16 valores separados por tabuladores y líneas CRLF.
- Una declaración sin operaciones se mantiene separada de la exportación de comprobantes; no se genera un TXT vacío por inferencia.
- La función no acredita que una declaración haya sido presentada ni aceptada por el Portal Fiscal.

## Pruebas añadidas en esta rama

- Correspondencia exacta del orden y valor de los 16 campos para una factura de compra ordinaria.
- Dos comprobantes producen dos líneas CRLF, cada una con 16 campos.
- Las pruebas fijan la referencia histórica y no se interpretan como prueba de vigencia o aceptación oficial.

## Secuencia de cierre pendiente

1. Obtener del SENIAT el instructivo/plantilla técnica vigente o respuesta oficial que confirme la especificación actualmente aceptada.
2. Resolver con esa fuente si siguen vigentes las excepciones y códigos históricos (RIF cero, tipos 02/03, control cero, importación/exportación, límites de longitud y reglas temporales).
3. Extender el contrato del generador para recibir los documentos fuente enlazados y mapear tipo/afectado/expediente sin inferencias.
4. Implementar validaciones por tipo documental y pruebas de registros válidos e inválidos, incluidos NC/ND, proveedor sin RIF cuando proceda, importación y declaraciones sin operaciones.
5. Ejecutar pruebas automatizadas y CI sobre el SHA final.
6. Probar el archivo en la opción de prueba de carga del Portal Fiscal y conservar captura/acuse/mensaje verificable.
7. Solo después de evidencia externa, actualizar el estado a aceptación verificada; nunca antes.

## Fuentes

- Instructivo SENIAT, `RI_DRIVA2020-IT01V3_0_0`, versión 3.0.0, septiembre de 2020 (reproducción de terceros): https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855
- Providencia SNAT/2025/000054, reproducción consultada para los artículos 13–17: https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2025-54

**Estado:** auditoría estructural histórica y pruebas internas reforzadas. Vigencia técnica y aceptación SENIAT no verificadas. No declarar TXT homologado.
