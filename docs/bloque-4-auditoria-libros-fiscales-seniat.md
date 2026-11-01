

### 6.5 Estructura TXT de 16 columnas y declaración sin operaciones

Se localizó una copia de la “Guía Fácil — Elaboración de un Archivo TXT de Retención de IVA” identificada como material del SENIAT. Describe las columnas A–P (16 campos), separadas por tabuladores; documenta una declaración con operaciones y un modelo separado cuando no existen pagos sujetos a retención. También muestra validación del portal para el importe retenido calculado a partir de base imponible, alícuota y porcentaje de retención.

**Fuentes:** copia de la guía SENIAT alojada por un tercero: https://docs.erpya.com/assets/img/docs/lve/procedures/consigment-management/consignment-sales/withholding-declaration-cxp/Formato_TXT_IVA.pdf ; instructivo técnico SENIAT RI_DRIVA2020-IT01V3_0_0 (septiembre 2020), copia consultable: https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855

**Limitación:** no se ha acreditado que estas copias sean la última versión técnica vigente en el Portal Fiscal en 2026. La estructura sirve como referencia histórica verificable, no como garantía de aceptación actual.

**Corrección requerida:** mantener la exportación con operaciones en 16 columnas y validar que el archivo tenga exactamente 16 campos por línea, sin campos desplazados. Añadir pruebas de la igualdad del monto retenido con la base, alícuota y porcentaje registrado. Diseñar una salida independiente para declaración sin operaciones únicamente después de verificar el modelo vigente en el Portal Fiscal; no improvisar una fila de ceros a partir de capturas antiguas.
