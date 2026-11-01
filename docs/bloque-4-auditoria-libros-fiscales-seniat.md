# Bloque 4 — Auditoría inicial de libros fiscales SENIAT

**Estado:** auditoría técnica en actualización continua; no certifica cumplimiento fiscal ni modifica operaciones.

**Contraste de integración:** PR #57 (Bloque 4.1), PR #58 (Bloque 4.2) y PR #59 (Bloque 4.3) están fusionadas en `main`. Los defectos corregidos se marcan como resueltos; los límites y pendientes normativos permanecen abiertos.  
**Base inspeccionada:** `main`, posterior a PR #59 (merge `594845121f2f600f886b50652195412c9d65f9fa`).  
**Alcance:** Libro de Compras, Libro de Ventas, retenciones IVA/ISLR, generadores TXT/XML y controles SQLite relacionados.  
**Regla:** no alterar datos históricos, asientos ni comprobantes; no modificar el administrador semilla.

## 1. Hallazgos confirmados en el código

### 1.1 Exportación TXT de retenciones IVA sin aislamiento por período — prioridad crítica

En `src/components/LibroCompras/LibroComprasView.tsx`, `handleDownloadTxt` filtra `vatVouchers` únicamente por `companyId`. No filtra por `period` ni por el período mensual seleccionado en la vista. Luego genera el archivo usando todos esos comprobantes y construye el nombre con el período del primer registro.

**Riesgo:** un archivo destinado a un período puede contener comprobantes de varios meses y llevar un nombre que representa solo el primer período.

**Estado:** CORREGIDO EN PR #57, fusionada. La exportación exige período `YYYY-MM`, filtra por empresa y período exactos y usa el mismo período en el nombre del archivo. Se añadieron pruebas de período. La aceptación en Portal Fiscal sigue pendiente de validación externa.

### 1.2 Generador TXT de retenciones IVA — validaciones insuficientes

En `src/utils/seniatGenerators.ts`, `generateSeniatIvaTxt`:
- fija el tipo de documento en `01` para todas las filas;
- sustituye número de factura/control vacío por valores de apariencia real (`00000001` y `00-000001`);
- no valida período, RIF, fecha, importes finitos/no negativos ni consistencia entre IVA causado y retenido;
- concatena campos tabulados sin validar/neutralizar tabuladores o saltos de línea dentro de los datos.

El modelo `VatRetentionVoucher` no conserva tipo de documento fuente ni referencia de documento afectado.

**Riesgo:** un archivo fiscal puede contener datos fabricados por fallback, campos desplazados o una representación incompleta del documento de origen.

**Estado:** CORREGIDO PARCIALMENTE EN PR #57, fusionada. Se eliminaron los fallbacks ficticios y se añadieron validaciones de RIF, período, fecha, correlativo, importes, porcentaje, consistencia de retención y caracteres de control. El tipo de documento y la especificación técnica vigente del TXT siguen sujetos a validación oficial; no se afirma aceptación SENIAT.

### 1.3 Condición de agente de retención IVA no está impuesta en la capa de dominio

En `src/components/LibroCompras/NewPurchaseModal.tsx`, el porcentaje 0/75/100 se puede seleccionar manualmente. El estado `ESPECIAL` solo determina el valor inicial. En `AccountingContext.tsx`, la validación de la compra comprueba que el porcentaje esté entre 0 y 100, pero no vuelve a validar que la empresa tenga la condición jurídica de agente ni que el proveedor/operación esté dentro del supuesto de retención.

El tipo `TaxpayerType` solo distingue `ESPECIAL` y `ORDINARIO`; no modela expresamente el caso de persona natural especial constituida como firma personal.

**Contraste normativo:** la Providencia SNAT/2025/000054 amplió el supuesto de agentes a personas naturales calificadas y notificadas como especiales que estén constituidas como firma personal; establece retención general del 75% y supuestos específicos de retención del 100%, además de exclusiones. Entró en vigencia el 01-08-2025 y derogó la providencia anterior.

**Corrección requerida:** modelar condición/soporte de agente y condición fiscal del proveedor; implementar reglas por vigencia y supuestos de retención/exclusión desde una fuente normativa versionada. La UI no debe permitir elegir libremente un porcentaje sin justificación; la capa de dominio/SQLite debe rechazar combinaciones no elegibles. No inferir automáticamente que todo contribuyente especial es firma personal ni que toda compra está sujeta a retención.

### 1.4 Inconsistencia entre tipos de documento ofrecidos y aceptados

`NewPurchaseModal.tsx` ofrece `01`, `02` y `03` (factura, nota de débito y nota de crédito). Sin embargo, `AccountingContext.tsx` rechaza en la capa de dominio cualquier compra cuyo tipo no sea `01`, indicando que el flujo de notas aún no está habilitado.

**Riesgo:** la interfaz permite iniciar un registro que el dominio siempre rechazará.

**Corrección requerida:** mientras no exista el circuito completo, ocultar/deshabilitar los tipos no admitidos y explicar el alcance. La futura habilitación exige enlazar documento afectado, reversión/ajuste fiscal, asiento correctivo y conservación del original; nunca registrar una nota como factura positiva.

### 1.5 Período presentado por defecto

Libro de Compras y Libro de Ventas muestran `fiscalYear-10` como período cuando no hay mes seleccionado. Esto puede presentar octubre como si fuera el período fiscal actual sin que el usuario lo haya elegido.

**Corrección requerida:** usar un período explícito elegido por el usuario o mostrar “Todos los períodos”; no inferir octubre ni construir una etiqueta fiscal no seleccionada.

### 1.6 Cobertura de pruebas del generador IVA

`src/utils/seniatGenerators.test.ts` cubre exportaciones ISLR XML/TXT y casos de eventos, pero no contiene pruebas para `generateSeniatIvaTxt`.

**Pruebas requeridas:** aislamiento por empresa/período; facturas y notas admitidas; campos vacíos; RIF y fechas inválidos; importes no finitos/negativos; caracteres tabulador/CR/LF; retención mayor al IVA; período discordante; comprobantes rectificados y duplicados.

### 1.7 Parámetros históricos de UT en ISLR

`electron/islr-fiscal-integrity.cjs` mantiene una tabla temporal codificada en `getVerifiedUt` (0,02; 0,40; 9; 43 Bs. por rangos de períodos). La transición a Bs. 43 desde junio de 2025 se corresponde con la Providencia SNAT/2025/000048: para tributos de períodos distintos del anual se usa la UT vigente al inicio del período. El valor no debe extenderse a otros cálculos ni confundirse con unidades laborales, tasas o contribuciones.

**Corrección requerida:** conservar el origen normativo, publicación, fecha de vigencia, intervalo de aplicación y versión de cada parámetro en un catálogo fiscal local versionado; mantener pruebas de límites de vigencia. No cambiar los valores existentes sin contrastar todos los períodos históricos.

## 2. Fuentes normativas consultadas

1. Providencia Administrativa SNAT/2025/000054, Gaceta Oficial N.º 43.171 del 16-07-2025. Copia íntegra de la Gaceta consultada: https://www.marambio-hlb.com/wp-content/uploads/2025/07/PROVIDENCIA-000054-Ret.-IVA.-G.O.-43.171-16-07-2025.pdf
2. Alerta legal Baker McKenzie sobre la Providencia SNAT/2025/000054, vigencia 01-08-2025 y derogación de la providencia 2015: https://insightplus.bakermckenzie.com/bm/tax/attachment_dw.action?attdocparam=phBAgdAhmdguYVoIkaYHMSJB%2FJSRAnDR%2BPMwjWwOPXdrOIGc9l39jfWfmUQFvzQp1C8VJ6YhsfvdAN0%3D&attkey=yj7OosfRb2hM2s1TxlT0R62iavTwUhWDZgdP49JoiGe5ahlOnoaIcm2gKCLvWrBaTeOj%2BBpGL7uJ2EwyqqzGs9ATVk4w4E8%3D&fromContentView=1&nav=h0D4lt8kmyzixB0RLU%2BtCNr0ZOKERj%2B%2BLnmxBIj7zcz3vf9KYRXuLj366QqrJARbRDqYv5Ipmmg%3D
3. Providencia Administrativa SNAT/2025/000048, Gaceta Oficial N.º 43.140 del 02-06-2025, reajuste de UT a Bs. 43 y regla de vigencia por período: https://www.pwc.com/ve/es/assets/documentos/stl/NAC-Reajuste-Valor-UT-Junio2025-v3-2.pdf
4. Copia de Gaceta Oficial N.º 43.140: https://inseroca.com/wp-content/uploads/2025/06/Unidad-tributaria-GO-43140-02-06-2025-Aumento-_250604_115749.pdf

**Limitación documental:** los archivos anteriores permiten identificar reglas y vigencias citadas, pero antes de cerrar el bloque se debe fijar en el repositorio el documento primario oficial o copia íntegra autenticable de cada Gaceta y obtener la especificación oficial vigente del TXT/XML de carga SENIAT. La existencia de un generador o su etiqueta “oficial” no demuestra aceptación por el portal.

## 3. Alcance que queda fuera de este subbloque

- No se cambia la tasa general de IVA ni las tasas especiales sin respaldo normativo vigente.
- No se modifica el flujo de autenticación ni el administrador semilla.
- No se reescriben asientos ni comprobantes históricos.
- No se afirma que los archivos actuales sean aceptados por SENIAT.
- No se habilita facturación electrónica ni homologación de equipos/proveedores; eso pertenece al Bloque 10.
- No se modifica la operación de ISLR hasta completar la validación de todos los conceptos, bases, sustraendos, UT y eventos de pago.

## 4. Secuencia de corrección propuesta

1. Fijar las fuentes primarias y la especificación de importación/exportación SENIAT por versión.
2. Corregir el aislamiento mensual del TXT IVA y eliminar valores ficticios de fallback.
3. Modelar elegibilidad de agente/proveedor y reglas de retención IVA con vigencia efectiva, excepciones y evidencia.
4. Corregir la interfaz para que solo ofrezca documentos admitidos.
5. Versionar parámetros fiscales (UT y demás reglas ISLR/IVA) con fuente y fecha efectiva.
6. Añadir pruebas unitarias y de integración de generación de libros/archivos; probar exportaciones contra fixtures de estructura derivados de la especificación oficial, nunca con datos ficticios en bases de clientes.
7. Verificar conciliación libro ↔ comprobantes ↔ retenciones ↔ asientos y separación multiempresa/período.

## 5. Criterio de cierre del Bloque 4

- Libro de compras y ventas conciliados con documentos y asientos.
- Retenciones IVA/ISLR calculadas conforme a reglas versionadas y elegibilidad validada en UI y SQLite.
- Archivos de exportación construidos según especificaciones oficiales vigentes y comprobados con casos de referencia.
- Períodos, empresas y documentos aislados; no hay registros ficticios ni fallbacks silenciosos.
- Pruebas de reversión, rectificación, notas y preservación histórica.
- Validación profesional fiscal independiente antes de declarar cumplimiento.

**Resultado de esta auditoría:** se identifican defectos concretos que deben corregirse antes de certificar el Bloque 4. Este documento no realiza esas correcciones ni declara el bloque terminado.


## 6. Hallazgos adicionales contrastados con la Providencia SNAT/2025/000054

### 6.1 Fecha y período fiscal de la retención IVA no siguen el disparador normativo

El artículo 13 establece que la retención se practica cuando ocurra primero el pago o el abono en cuenta. Sin embargo, en `AccountingContext.tsx` el período `vatPeriod`, la fecha del comprobante y el correlativo se derivan de `purchaseData.invoiceDate`. El modelo de compra también conserva `accountCreditDate`, pero ese campo se utiliza para el período ISLR, no para el comprobante IVA.

**Riesgo:** cuando la fecha de pago/abono en cuenta difiera de la emisión de la factura, el comprobante y el período IVA pueden quedar asignados a un mes que no corresponde al momento fiscal de retención.

**Estado:** CORREGIDO EN PR #58, fusionada. Se incorporó `PurchaseVatFiscalEvent` con disparador `PAYMENT` o `ACCOUNT_CREDIT`, fecha efectiva y período; el comprobante conserva la fecha documental por separado. El flujo actual representa una fecha efectiva por compra y no resuelve todavía la secuencia completa de pagos parciales posteriores ni sus comprobantes adicionales. No se modificaron registros históricos.

### 6.2 Falta de control de períodos de enteramiento quincenal

Los artículos 14 y 15 distinguen retenciones practicadas del día 1 al 15 y del 16 al último día del mes, y exigen declarar conforme a las especificaciones técnicas del Portal Fiscal, incluso cuando no hubo operaciones sujetas a retención.

**Estado: IMPLEMENTADO PARCIALMENTE EN PR #59, FUSIONADA.** Se incorporó un auxiliar de declaraciones por empresa, período y ventana quincenal, con snapshot inmutable, comprobantes incluidos, totales conciliados, declaración sin operaciones, estados de revisión/presentación, acuse y enteramientos parciales documentados. La persistencia se valida en SQLite y genera auditoría.

**Límites pendientes:** no se calcula automáticamente el vencimiento; se documenta manualmente con publicación, referencia y URL HTTPS SENIAT, cuya página no se consulta automáticamente. No se genera todavía un TXT quincenal certificado, no se presenta automáticamente en el Portal Fiscal y no se rectifica una declaración ya presentada. La especificación técnica vigente y el calendario oficial siguen pendientes de verificación externa.

### 6.3 Plazo y contenido del comprobante de retención IVA

El artículo 16 establece entrega a más tardar dentro de los primeros dos días hábiles del período de imposición siguiente y exige, entre otros, numeración consecutiva de 14 caracteres (AAAAMM + secuencial de ocho dígitos), agente, proveedor, RIF, fecha de emisión/entrega, documento, base, impuesto causado e importe retenido. El modelo conserva campos parciales, y no se encontró en la revisión inicial un control explícito del plazo de emisión/entrega ni el snapshot completo de agente/fecha de entrega/impresor.

**Corrección requerida:** completar la trazabilidad documental conforme al artículo 16, conservar la fecha de entrega y validar la secuencia de 14 caracteres. El control de vencimiento debe advertir/bloquear según el flujo definido, sin inventar fechas hábiles ni calendarios.

### 6.4 Consecuencia normativa para las reglas de elegibilidad

La revisión del texto íntegro de la Gaceta confirma que la elegibilidad no se limita a un selector 75/100:
- Artículos 1 y 2 definen agentes, proveedores y operaciones particulares.
- Artículo 3 enumera exclusiones que deben evaluarse.
- Artículo 4 fija el 75% general.
- Artículo 5 define supuestos de 100%, incluida factura sin IVA discriminado, incumplimiento formal, consulta del Portal Fiscal y operaciones del artículo 2.
- Artículo 13 fija el momento de retención.
- Artículos 14 y 15 fijan enteramiento/declaración por quincena.
- Artículo 16 regula emisión, plazo y contenido del comprobante.

La aplicación automática de estas reglas exige conservar la evidencia consultada (por ejemplo, clasificación del proveedor, consulta del Portal Fiscal y condición de exclusión) y la versión normativa usada en cada operación. Si falta evidencia necesaria, el sistema debe dejar el caso pendiente de revisión y no asumir el 75% ni el 100%.


### 6.5 Estructura TXT de 16 columnas y declaración sin operaciones

Se localizó una copia de la “Guía Fácil — Elaboración de un Archivo TXT de Retención de IVA” identificada como material del SENIAT. Describe las columnas A–P (16 campos), separadas por tabuladores; documenta una declaración con operaciones y un modelo separado cuando no existen pagos sujetos a retención. También muestra validación del portal para el importe retenido calculado a partir de base imponible, alícuota y porcentaje de retención.

**Fuentes:** copia de la guía SENIAT alojada por un tercero: https://docs.erpya.com/assets/img/docs/lve/procedures/consigment-management/consignment-sales/withholding-declaration-cxp/Formato_TXT_IVA.pdf ; instructivo técnico SENIAT RI_DRIVA2020-IT01V3_0_0 (septiembre 2020), copia consultable: https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855

**Limitación:** no se ha acreditado que estas copias sean la última versión técnica vigente en el Portal Fiscal en 2026. La estructura sirve como referencia histórica verificable, no como garantía de aceptación actual.

**Corrección requerida:** mantener la exportación con operaciones en 16 columnas y validar que el archivo tenga exactamente 16 campos por línea, sin campos desplazados. Añadir pruebas de la igualdad del monto retenido con la base, alícuota y porcentaje registrado. Diseñar una salida independiente para declaración sin operaciones únicamente después de verificar el modelo vigente en el Portal Fiscal; no improvisar una fila de ceros a partir de capturas antiguas.


## 7. Contraste de correcciones fusionadas y estado actual

### 7.1 Bloque 4.1 — exportación TXT IVA (PR #57)

Los hallazgos 1.1 y 1.2 se consideran corregidos en el código integrado:
- Período mensual explícito y filtro por empresa/período.
- Eliminación de valores ficticios de factura/control.
- Validación de RIF, período, fecha, correlativo, importes, porcentaje y consistencia de la retención.
- Pruebas automatizadas de campos incompletos e inconsistentes.

Pendiente:
- Obtener la especificación técnica vigente del Portal Fiscal.
- Verificar estructura y aceptación con una prueba autorizada en el entorno oficial.
- No afirmar cumplimiento ni aceptación hasta disponer de evidencia.

### 7.2 Bloque 4.2 — evento fiscal IVA (PR #58)

El hallazgo 6.1 se considera corregido para el flujo actual:
- Contado: evento de pago efectivo.
- Crédito: evento de abono/reconocimiento en cuenta.
- Fecha de factura separada de fecha fiscal.
- Período y correlativo ligados al evento.

Limitaciones:
- No existe todavía un subledger de múltiples pagos parciales por factura que genere todos los eventos/comprobantes que pudieran corresponder.
- No se modifica el historial anterior a la incorporación del evento.
- No se ha certificado el circuito completo ante SENIAT.

### 7.3 Bloque 4.3 — auxiliar quincenal (PR #59)

**Estado: FUSIONADO EN MAIN.**
- PR #59: https://github.com/fenixlife1978/Sicoven/pull/59
- HEAD validado: `ef4393ce027691a75593d1eacb67eea3055573fc`.
- Merge commit: `594845121f2f600f886b50652195412c9d65f9fa`.
- Desktop Validation run `41261535195`: SUCCESS.
- Windows Installer run `41261535220`: SUCCESS.
- Pruebas automatizadas, TypeScript, build, auditoría de recursos, NSIS, verificación de instalador, actualización 1.0.6→1.0.7 y preservación SQLite: SUCCESS.

Capacidades integradas:
- Ventanas exactas 1–15 y 16–fin de mes, incluido febrero bisiesto.
- Snapshot inmutable por empresa/período/quincena.
- Comprobación de que el snapshot inicial incluya exactamente todos los comprobantes de la ventana.
- Conciliación de base imponible, IVA causado e IVA retenido.
- Declaración sin operaciones explícita, rechazada si existen comprobantes en la ventana.
- Asignación manual, individual y documentada de fecha fiscal para comprobantes históricos sin evento de pago/abono.
- Consistencia de la asignación histórica entre ambas quincenas.
- Estados append-only de preparación, revisión, presentación y enteramiento.
- Número de declaración, acuse, pagos parciales, referencias y soportes.
- Persistencia SQLite, validación de integridad, auditoría y respaldo JSON.
- Bloqueo de revisión y presentación cuando aparecen comprobantes posteriores no incluidos en el snapshot o fechas históricas pendientes.

Límites:
- No calcula vencimientos legales; el usuario documenta la fecha y la fuente. La aplicación valida el formato de URL y dominio, pero no consulta su contenido.
- No genera un TXT quincenal certificado por la especificación vigente.
- No presenta declaraciones automáticamente ante SENIAT.
- No modifica comprobantes, compras, asientos, tesorería ni cierres históricos.
- No rectifica declaraciones presentadas.
- No resuelve aún el circuito normativo completo de múltiples pagos parciales posteriores de una factura ni los comprobantes adicionales que correspondan.
- No acredita aceptación del Portal Fiscal ni cumplimiento fiscal certificado.


### 7.4 Pendientes que permanecen abiertos

- Elegibilidad normativa y evidencia del agente/proveedor (6.4).
- Comprobante de retención IVA: contenido completo, emisión/entrega y plazo del artículo 16 (6.3).
- Especificación oficial vigente de archivo TXT, incluida declaración sin operaciones (6.5).
- Flujo de notas de crédito/débito y rectificaciones.
- Parámetros históricos y catálogo normativo versionado.
- Conciliación integral libro ↔ comprobante ↔ declaración ↔ enteramiento ↔ asiento.
- Auditoría y validación profesional fiscal independiente.

**Conclusión:** #57, #58 y #59 están integradas en `main` y corrigen defectos concretos. El Bloque 4 sigue abierto: persisten pendientes normativos, especificación vigente del Portal Fiscal, elegibilidad de agentes/proveedores, contenido/plazos del comprobante, rectificaciones y conciliación fiscal integral. La fusión de #59 no demuestra aceptación SENIAT ni cumplimiento certificado.
