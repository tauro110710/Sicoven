# Validación local previa del TXT de Retenciones IVA

SICOVEN genera el archivo de operaciones de Retenciones IVA con 16 campos por registro, separados por tabulaciones. El validador local se ejecuta sobre el mismo texto que se muestra en la previsualización y que se descarga.

## Controles locales

- Archivo no vacío, sin BOM, NUL, filas vacías ni salto final.
- Filas separadas por CRLF y exactamente 16 campos por fila.
- Ningún campo vacío; se utiliza `0` cuando el dato no aplica.
- Longitudes máximas y ausencia de espacios periféricos/caracteres de control.
- RIF, período AAAAMM, fecha real AAAA-MM-DD, operación C/V y tipo documental 01/02/03.
- El RIF de proveedor `0` solo se admite cuando el importe exportado como IVA retenido equivale al 100 % del IVA calculado con la base y alícuota exportadas.
- Importes y alícuota en enteros sin separadores de miles ni decimales, conforme al comportamiento operativo de carga reportado para este archivo.
- Comprobante de 14 dígitos cuyo prefijo coincide con el período.
- Un solo agente y un solo período por archivo; comprobantes no repetidos.
- Facturas con documento afectado 0; notas de débito/crédito con documento afectado informado.

## Resultado y límites

Si el TXT presenta errores estructurales, SICOVEN bloquea la descarga y muestra línea, columna, campo y motivo. Si supera la revisión, la interfaz indica **Validación local aprobada** y permite descargar el mismo contenido validado.

Esta revisión no se conecta al Portal Fiscal. No comprueba que el agente esté habilitado, que el RIF coincida con el usuario SENIAT, que la declaración esté dentro del plazo, ni que el portal acepte los datos fiscales. Tampoco constituye homologación oficial. La aceptación final solo se confirma al ejecutar «Retención IVA (prueba carga de archivo)» con un usuario habilitado.

La estructura de 16 columnas se documenta en el instructivo SENIAT RI_DRIVA2020-IT01V3_0_0 (septiembre de 2020), disponible en una reproducción documental: https://es.readkong.com/page/instructivo-declaracion-de-retenciones-de-iva-seniat-4300855. La serialización de importes enteros se mantiene como regla operativa provisional basada en el rechazo de carga reportado por el contribuyente y debe reconfirmarse en el portal.
