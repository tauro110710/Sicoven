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
- Cuando la vista entrega el conjunto de compras, cada comprobante debe resolver su `purchaseRecordId` dentro de la empresa.
- RIF, fecha, número documental y control del comprobante deben conciliar con la compra fuente.
- Las ND/NC requieren número propio y factura afectada; no se sustituye ningún dato faltante por valores inventados.
- La vista exporta el conjunto completo del período, sin dejar que el filtro de búsqueda altere la población fiscal.
- Una declaración sin operaciones sigue siendo una entidad distinta; no se transforma en un TXT vacío automáticamente.

## Límites del flujo fiscal actual

El modelo de compras incluye ND y NC y existen flujos específicos para registrarlas. Sin embargo, el alta genérica de compras rechaza esos tipos. Además, la nota de crédito existente marca el comprobante de retención original como pendiente de corrección fiscal y bloquea la exportación de ese período hasta resolver el ajuste. Esta rama prepara el mapeo documental en el generador, pero no afirma que las notas ya produzcan comprobantes autónomos de retención IVA.

El expediente de importación permanece en cero y no se incorporan tipos 04/05/06 porque el modelo de comprobantes y la fuente documental actual no contienen datos suficientes para construirlos con seguridad.

## Pruebas añadidas

- Correspondencia exacta de los 16 campos para una factura ordinaria.
- Dos comprobantes generan dos filas CRLF, cada una con 16 campos.
- Clasificación de ND y NC desde la compra vinculada y salida del documento afectado.
- Rechazo de compra fuente ausente, documento afectado ausente e identificadores discordantes.
- Se añadió un workflow de GitHub Actions que ejecuta `npm test`, `npm run check:types` y `npm run build` en las PR contra `main`.

## Próxima ejecución técnica

1. Revisar y corregir cualquier fallo de pruebas, tipado o build que reporte el workflow recién añadido.
2. Completar las reglas de campos opcionales y longitudes con validaciones configurables, evitando introducir excepciones históricas sin datos de origen.
3. Cerrar el tratamiento interno de rectificaciones IVA para que el bloqueo por corrección fiscal se resuelva con trazabilidad y sin reescribir comprobantes históricos.
4. Completar la matriz de escenarios: factura ordinaria, exenta, alícuota reducida, alícuota general, retención 75/100, reversión parcial/total, período sin operaciones y documentos vinculados.
5. Verificar que la previsualización y descarga produzcan bytes idénticos y mantengan tabuladores/CRLF, incluyendo caracteres acentuados y codificación del archivo.
6. Mantener fuera del alcance de este cierre técnico cualquier declaración de aceptación externa que no esté respaldada por evidencia disponible.

## Fuentes de referencia

- Instructivo SENIAT `RI_DRIVA2020-IT01V3_0_0`, versión 3.0.0, septiembre de 2020 (reproducción de terceros): https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855
- Providencia SNAT/2025/000054 (reproducción consultada para artículos 13–17): https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2025-54

**Estado:** generador enlazado a compras fuente y estructura reforzada en rama de trabajo. Ejecución CI pendiente de resultado; aceptación externa no forma parte del bloqueo para continuar el desarrollo técnico.
