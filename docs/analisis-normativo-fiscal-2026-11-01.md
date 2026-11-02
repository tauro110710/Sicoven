# SICOVEN — Actualización normativa fiscal venezolana 2026

**Fecha de revisión:** 01-11-2026  
**Rama de trabajo:** `docs/bloque-fiscal-normativa-2026`  
**Alcance:** actualización de la línea base normativa del Bloque 1 (obligaciones fiscales).  
**Naturaleza:** análisis documental; no altera cálculos, comprobantes, asientos, datos históricos ni configuración de empresas.

## 1. Providencia SNAT/2026/00099 — Sujetos Pasivos Especiales

- Publicación: Gaceta Oficial N.º 43.485, 22-10-2026.
- Vigencia: 01-11-2026, conforme a su artículo 18.
- Deroga la Providencia SNAT/2023/00005 (artículo 17).
- Los contribuyentes ya calificados y notificados como especiales antes de su entrada en vigor conservan esa condición (artículo 16).
- La calificación corresponde a la Administración Tributaria y requiere notificación expresa; SICOVEN no debe convertir umbrales económicos en una calificación automática del contribuyente.

### Impacto en SICOVEN

1. Mantener la condición de sujeto pasivo especial configurada/documentada para entidades previamente notificadas. No reclasificar clientes existentes por una fórmula automática.
2. Registrar, cuando el usuario disponga de ella, la referencia y fecha de la notificación administrativa y la fecha efectiva de cualquier cambio.
3. Separar el estado tributario configurado por la empresa de una estimación informativa basada en ventas/ingresos.
4. No aplicar calendarios de sujetos pasivos especiales a contribuyentes ordinarios.
5. Antes de automatizar la evaluación de umbrales, completar revisión del texto íntegro, su método de cálculo, períodos de referencia y casos sectoriales; la determinación administrativa no se sustituye por el software.

**Fuente consultada:**  
- https://adacontable.com/seniat/providencia-snat-2026-00099-gaceta-oficial-43485/  
- https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2026-99

## 2. Providencia SNAT/2026/00093 — Facturas y otros documentos fiscales

- Publicación: Gaceta Oficial N.º 43.484, 21-10-2026.
- Establece normas generales y medios para emitir facturas, órdenes/guías, notas de débito, notas de crédito, comprobantes de retención y certificados de débito fiscal exonerado.
- Entrada en vigor: 180 días continuos después de su publicación; las fuentes consultadas indican el 19-04-2027.
- Hasta el 18-04-2027 debe respetarse el régimen anterior aplicable. No adelantar su aplicación ni invalidar documentos históricos.
- La providencia contempla medios de emisión digitales, imprentas autorizadas y máquinas fiscales; la máquina fiscal deja de ser una obligación general, pero no queda prohibida.

### Impacto en SICOVEN

1. Mantener el registro contable y los libros fiscales actuales operativos bajo las normas vigentes hasta el 18-04-2027.
2. Abrir una línea de adaptación para documentos emitidos desde el 19-04-2027, incluyendo metadatos del medio de emisión y validaciones que resulten exigibles.
3. No implementar facturación electrónica, integración con Portal Fiscal, autorización de imprentas ni certificación de máquinas fiscales como si ya estuvieran disponibles.
4. Conservar los documentos históricos y sus datos originales. La migración normativa no debe reescribir facturas, notas o comprobantes emitidos bajo reglas anteriores.
5. Incorporar las especificaciones técnicas y manuales que publique el SENIAT antes de desarrollar validaciones de formato o integración.

**Fuentes consultadas:**  
- https://adacontable.com/seniat/providencia-snat-2026-00093-gaceta-oficial-43484/  
- https://docs.cachicamo.app/fiscal/providencia00093-emision-facturas-2026

## 3. Relación con las reglas fiscales ya implementadas

La revisión de la rama `main` confirma que SICOVEN ya contiene:

- Motor de elegibilidad de retenciones IVA según Providencia SNAT/2025/000054, con estados de revisión y exclusiones del artículo 3.
- Tratamiento general del 75% y supuestos del 100%, con confirmaciones explícitas cuando dependen de consulta al Portal Fiscal.
- Snapshot de la decisión fiscal utilizado al registrar la compra.
- Fecha efectiva de pago/abono en cuenta como disparador fiscal IVA.
- Auxiliar quincenal de declaraciones, snapshots y eventos de presentación/enteramiento.
- Registro inmutable de entrega del comprobante de retención IVA, con fecha y medio de entrega.

Estos componentes no deben duplicarse. La adaptación pendiente consiste en comprobar su compatibilidad con la normativa nueva y completar brechas demostrables.

## 4. Pendientes funcionales del Bloque 1

1. Incorporar la referencia normativa SNAT/2026/00099 al perfil tributario de empresa, sin recalificación automática y sin alterar el estado de empresas existentes.
2. Preparar la transición de SNAT/2026/00093 para el 19-04-2027, conservando la coexistencia de documentos históricos y nuevos.
3. Verificar con fuentes primarias y manuales técnicos vigentes la estructura de archivos TXT/XML del SENIAT; no afirmar aceptación del Portal Fiscal a partir de guías antiguas o copias de terceros.
4. Completar el control de comprobantes de retención IVA del artículo 16 de SNAT/2025/000054, incluida la oportunidad de entrega dentro de los primeros dos días hábiles del período siguiente. La aplicación debe mostrar alertas informativas y registrar la fecha real de entrega; no inventar calendarios de días hábiles ni bloquear la contabilización por falta de adjunto.
5. Completar la conciliación libro → comprobante → declaración → enteramiento → asiento.
6. Revisar pagos parciales sucesivos y rectificaciones fiscales, preservando los registros originales.
7. Revisar los parámetros históricos de UT y otros conceptos ISLR con sus fuentes, fechas de vigencia y reglas por período.

## 4.1 Hallazgo técnico: exportación TXT IVA y declaración sin operaciones

La auditoría del generador existente en `main` (`src/utils/seniatGenerators.ts`) encontró que `generateSeniatIvaTxt` emite 16 columnas separadas por tabuladores, en este orden: RIF agente, período, fecha factura, tipo operación, tipo documento, RIF proveedor, número documento, número control, monto total, base imponible, IVA retenido, documento afectado, comprobante, monto exento, alícuota y expediente.

La secuencia coincide con una guía de elaboración de TXT de IVA localizada en una copia documental fechada aproximadamente en 2017. Esa coincidencia no demuestra que el formato continúe vigente ni que el Portal Fiscal lo acepte actualmente. En esta revisión no se obtuvo una especificación técnica primaria vigente del SENIAT ni evidencia de una carga aceptada en el Portal Fiscal.

La función también bloquea el archivo vacío y exige que la declaración sin operaciones se gestione como un flujo separado. El modelo de declaración sí permite registrar explícitamente una quincena sin operaciones, pero ese registro interno no equivale a un archivo oficial ni demuestra que la obligación haya sido presentada.

**Acción requerida antes de certificar:** obtener y archivar la versión vigente del instructivo/plantilla técnica desde el SENIAT o una respuesta oficial; contrastar cantidad, orden, longitud, codificación, separadores, campos obligatorios, tipos de documento y tratamiento de cero operaciones; ejecutar pruebas de conformidad con ejemplos oficiales y, cuando sea posible, una presentación controlada con acuse. Hasta entonces, la exportación debe rotularse como archivo preparado para revisión, no como formato homologado.

**Fuente auxiliar no vigente/no concluyente:** https://docs.erpya.com/assets/img/docs/lve/procedures/consigment-management/consignment-sales/withholding-declaration-cxp/Formato_TXT_IVA.pdf

## 4.2 Auditoría de parámetros históricos ISLR y Unidad Tributaria

La revisión del catálogo `src/data/islrConcepts.ts` y del validador `src/types/islrFiscalEvent.ts` confirma que el motor no habilita todos los conceptos del Decreto 1.808. El catálogo actual expone un subconjunto de conceptos 002, 003, 004 y 010–013; no deben habilitarse otros códigos hasta incorporar sus bases, mínimos, sustraendos, residencia/domicilio y reglas acumulativas completas.

La función `getIslrUnitTaxValueForPeriod` conserva esta serie mensual:
- Desde 2021-10: Bs. 0,02.
- Desde 2022-05: Bs. 0,40.
- Desde 2023-06: Bs. 9,00.
- Desde 2025-07: Bs. 43,00.

El salto de Bs. 9 a Bs. 43 se publicó el 02-06-2025. El artículo 3 de la Providencia SNAT/2025/000048 establece que, para tributos liquidados por períodos distintos del anual, se aplica la UT vigente al inicio del período. Por eso junio de 2025 conserva Bs. 9 y julio inicia con Bs. 43; el criterio mensual codificado es coherente con ese artículo, sujeto a validación profesional de cómo se determina el período fiscal de cada retención concreta.

El motor también conserva snapshots de UT por evento y valida que coincidan con la serie histórica; la tarifa progresiva T-2 está implementada como cálculo separado y el propio código no habilita el concepto 005 automáticamente.

**Pendientes de cierre:** cotejar cada concepto habilitado contra el texto íntegro y vigente del Decreto 1.808 y sus modificaciones; confirmar el período de liquidación aplicable a cada tipo de retención; probar límites mínimos, redondeo, pagos parciales y reversos con casos de referencia; revisar los conceptos no implementados y mantenerlos deshabilitados. No se debe extrapolar una tarifa de un concepto a otro ni reconstruir eventos históricos con la UT actual.

**Fuentes de contraste:**  
- Providencia SNAT/2025/000048, G.O. 43.140, 02-06-2025: https://docs.cachicamo.app/fiscal/providencia-000048-unidad-tributaria  
- Decreto 1.808, G.O. 36.203, 12-05-1997: https://www.cidtct.uc.edu.ve/wp-content/uploads/2025/05/Decreto-1808-ISLR.pdf

## 5. Límites de implementación

- No cambiar ni borrar datos fiscales históricos.
- No recalificar automáticamente a una empresa como sujeto pasivo especial.
- No aplicar anticipadamente la SNAT/2026/00093.
- No afirmar homologación, certificación, aceptación de TXT/XML ni presentación automática ante el SENIAT.
- No exigir adjuntos digitales para registrar una operación contable válida.
- No modificar el administrador semilla.
- SQLite local permanece como única fuente de verdad.
- Cualquier nueva validación debe residir también en la capa de dominio/persistencia cuando proteja integridad; la interfaz no será el único control.

## 6. Criterio de salida de este análisis

Este documento actualiza la línea base normativa para el Bloque 1. No declara completado el bloque ni certifica cumplimiento tributario. La implementación funcional se ejecutará en subbloques verificables, con pruebas automatizadas y preservación de la operación histórica.


## 4.3 Contraste primario localizado: Providencia SNAT/2025/000054

Se localizó una reproducción íntegra de la Providencia SNAT/2025/000054 publicada en la Gaceta Oficial N.º 43.171 del 16-07-2025, alojada como PDF por Marambio-HLB. El documento permite confirmar directamente los artículos relevantes para el diseño del Bloque 1:

- **Artículo 15, numeral 1:** el agente debe presentar en el Portal Fiscal la declaración de compras sujetas a retención del período conforme a las especificaciones técnicas del SENIAT; también debe presentarla cuando no se hayan efectuado operaciones sujetas a retención. Por tanto, una quincena sin operaciones no puede omitirse por considerarse vacía. El registro interno de SICOVEN no sustituye la presentación.
- **Artículo 15, numerales 2 y 3:** después de presentar la declaración, el agente puede enterar electrónicamente o imprimir la planilla 99035 para pagar mediante entidad bancaria autorizada/taquilla de contribuyentes especiales.
- **Artículo 16:** el comprobante de retención debe emitirse y entregarse a más tardar dentro de los primeros dos días hábiles del período IVA siguiente. La numeración consecutiva debe tener 14 caracteres con estructura AAAAMMSSSSSSSS. El comprobante debe incluir datos del agente y proveedor, fecha de emisión/entrega, número y control de factura/nota de débito, monto total, base imponible, impuesto causado y monto retenido. La entrega electrónica requiere acuerdo del proveedor.
- **Artículo 14:** el enteramiento se rige por el calendario de declaraciones y pagos de sujetos pasivos especiales, separado por retenciones practicadas del 1 al 15 y del 16 al último día del mes.

### Consecuencias de producto

1. El flujo de declaración quincenal debe admitir explícitamente cero operaciones y mantener el estado interno separado de la presentación oficial y su acuse.
2. No debe generarse un TXT vacío por inferencia ni marcarse la obligación como cumplida solo por guardar el período en SQLite.
3. El control de comprobantes debe verificar la estructura de 14 caracteres al emitir nuevos comprobantes, sin renumerar ni alterar comprobantes históricos.
4. La ventana de entrega de dos días hábiles sigue siendo orientativa mientras no se incorpore un calendario oficial de feriados; no debe declarar incumplimiento automáticamente.
5. La conciliación de pago debe distinguir declaración presentada, planilla 99035/enteramiento, débito bancario y asiento contable.

**Fuente primaria reproducida en PDF:** https://www.marambio-hlb.com/wp-content/uploads/2025/07/PROVIDENCIA-000054-Ret.-IVA.-G.O.-43.171-16-07-2025.pdf

**Límite de evidencia:** esta fuente permite leer el texto publicado de la Providencia, pero no es una especificación técnica del TXT/XML ni evidencia de aceptación del Portal Fiscal. La conformidad del archivo exportado sigue pendiente de instructivo técnico oficial y prueba controlada.
