# Bloque 4 — Auditoría inicial de libros fiscales SENIAT

**Estado:** auditoría técnica inicial; no certifica cumplimiento fiscal ni modifica operaciones.  
**Base inspeccionada:** `main`, posterior a PR #54.  
**Alcance:** Libro de Compras, Libro de Ventas, retenciones IVA/ISLR, generadores TXT/XML y controles SQLite relacionados.  
**Regla:** no alterar datos históricos, asientos ni comprobantes; no modificar el administrador semilla.

## 1. Hallazgos confirmados en el código

### 1.1 Exportación TXT de retenciones IVA sin aislamiento por período — prioridad crítica

En `src/components/LibroCompras/LibroComprasView.tsx`, `handleDownloadTxt` filtra `vatVouchers` únicamente por `companyId`. No filtra por `period` ni por el período mensual seleccionado en la vista. Luego genera el archivo usando todos esos comprobantes y construye el nombre con el período del primer registro.

**Riesgo:** un archivo destinado a un período puede contener comprobantes de varios meses y llevar un nombre que representa solo el primer período.

**Corrección requerida:** hacer obligatorio el período fiscal de exportación; seleccionar exclusivamente comprobantes de la empresa y período exactos; impedir exportación cuando no exista período inequívoco; validar que cada fila corresponda al mismo período. Añadir pruebas multiempresa y multiperíodo.

### 1.2 Generador TXT de retenciones IVA — validaciones insuficientes

En `src/utils/seniatGenerators.ts`, `generateSeniatIvaTxt`:
- fija el tipo de documento en `01` para todas las filas;
- sustituye número de factura/control vacío por valores de apariencia real (`00000001` y `00-000001`);
- no valida período, RIF, fecha, importes finitos/no negativos ni consistencia entre IVA causado y retenido;
- concatena campos tabulados sin validar/neutralizar tabuladores o saltos de línea dentro de los datos.

El modelo `VatRetentionVoucher` no conserva tipo de documento fuente ni referencia de documento afectado.

**Riesgo:** un archivo fiscal puede contener datos fabricados por fallback, campos desplazados o una representación incompleta del documento de origen.

**Corrección requerida:** eliminar fallbacks ficticios; bloquear y reportar registros incompletos; validar campos y caracteres de control; ampliar el snapshot del comprobante solo si la normativa/formato oficial exige esos campos. Antes de cambiar la estructura de salida, obtener y fijar una especificación oficial vigente del archivo SENIAT.

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
