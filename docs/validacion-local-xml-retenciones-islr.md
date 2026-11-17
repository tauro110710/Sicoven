# Validación local previa del XML de Retenciones ISLR

SICOVEN genera el XML mensual de **Salarios y Otras Retenciones** del Manual Técnico SENIAT 60.40.40.039, versión 3.1. El archivo se valida sobre el mismo contenido que aparece en la vista previa y se descarga en ISO-8859-1.

## Controles locales

- Declaración XML 1.0 con codificación ISO-8859-1; rechazo de BOM, DTD, entidades externas y controles XML no permitidos.
- Raíz `RelacionRetencionesISLR` con los atributos obligatorios `RifAgente` y `Periodo`, sin atributos adicionales.
- RIF de agente y retenido con una letra V/E/P/J/G y nueve dígitos.
- Período AAAAMM con mes válido.
- Uno o más elementos `DetalleRetencion`; se exige la secuencia exacta de siete elementos: `RifRetenido`, `NumeroFactura`, `NumeroControl`, `FechaOperacion`, `CodigoConcepto`, `MontoOperacion`, `PorcentajeRetencion`.
- Número de factura alfanumérico de 1 a 10 caracteres; si no existe, se exporta `0`. Se eliminan separadores no alfanuméricos y se conservan los últimos diez caracteres.
- Número de control alfanumérico de hasta 10 caracteres conforme al esquema; se exportan los dígitos secuenciales y se utiliza `NA` cuando no existe.
- Fecha real DD/MM/AAAA y perteneciente al período declarado.
- Código de concepto de tres dígitos.
- Monto no negativo y porcentaje entre 0 y 100, ambos con punto decimal y máximo dos decimales.
- Rechazo de etiquetas fuera de orden, campos ausentes, atributos inesperados y contenido adicional.

## Alcance y límites

El validador se aplica al XML mensual de **Salarios y Otras Retenciones**. La declaración de **Dividendos y Acciones** utiliza otro esquema (atributo `Fecha` y elemento `Tipo`) y no se debe cargar usando este generador.

La validación local no consulta el Portal Fiscal. No confirma que los RIF existan o estén habilitados, ni que el código de concepto esté vigente para el contribuyente. Tampoco valida el cálculo tributario, el sustraendo aplicable, convenios de doble tributación o la integridad de operaciones que no estén registradas en SICOVEN. No constituye homologación ni garantiza aceptación del portal.

La especificación estructural utilizada es el Manual Técnico SENIAT 60.40.40.039, Retenciones de ISLR (Declaración Mensual), versión 3.1 / junio 2014. Antes de declarar, debe realizarse la prueba de carga en el Portal Fiscal con el RIF y período correspondientes. La aceptación solo se confirma con el resultado del portal.
