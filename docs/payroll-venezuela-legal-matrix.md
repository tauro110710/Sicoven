# Nómina venezolana — matriz normativa de implementación

> Documento de trabajo para el motor de nómina. No reemplaza la revisión de la Gaceta Oficial ni una validación jurídica antes de activar reglas en producción. Ninguna tasa se debe aplicar por defecto si depende de la clasificación o condición de la empresa.

## Obligaciones y bases que no deben mezclarse

| Obligación | Trabajador | Patrono | Base / condición que debe parametrizarse |
|---|---:|---:|---|
| IVSS | 4% | 9%, 10% u 11% según riesgo | Salario normal; tope legal; frecuencia de cotización |
| FAOV | 1% | 2% | Salario integral mensual |
| INCES | 0,5% | 2% | Patronal: salario normal y condición de sujeto; retención del trabajador sobre utilidades/bonificación anual |
| Régimen Prestacional de Empleo | 0,5% | 2% | Salario normal y tope propio |
| Protección de Pensiones | No es retención ordinaria del trabajador | Alícuota especial fijada por decreto | Tipo de entidad, pagos incluidos, base mínima y declaración SENIAT |

Las obligaciones deben conservar códigos, bases, topes, periodicidad, condición de sujeto, alícuotas, fecha de vigencia, fuente y fecha de verificación independientes. No se debe sumar todo en un porcentaje global.

## LOTTT — beneficios del trabajador

- Art. 121: vacaciones con salario normal del mes efectivo de labores inmediatamente anterior; si el salario es por unidad de obra, pieza, destajo o comisión, promedio del salario normal de los tres meses inmediatamente anteriores. No confundir con los seis meses del art. 122.
- Art. 190: vacaciones anuales de 15 días hábiles al cumplir el primer año y un día adicional por año de servicio, hasta 15 adicionales.
- Art. 192: bono vacacional mínimo de 15 días de salario normal, más un día por año hasta 30 días.
- Art. 131: distribución de al menos 15% de los beneficios líquidos; para cada trabajador el límite mínimo equivale a 30 días de salario y el máximo a cuatro meses. Si no laboró todo el año, se reduce proporcionalmente por meses completos. No calcular utilidades solo como una provisión plana: debe distinguirse la participación real y el mínimo legal.
- Art. 122: para prestaciones e indemnizaciones, último salario integrado; si el salario es variable, promedio de los seis meses inmediatamente anteriores, integrando todos los conceptos salariales y las alícuotas legalmente aplicables de bono vacacional y utilidades.
- Art. 142: garantía de prestaciones de 15 días por trimestre, más 2 días por año después del primero, acumulativos hasta 30; al terminar la relación se compara la garantía con 30 días por año o fracción superior a seis meses y se paga el mayor, con las reglas especiales de los primeros tres meses.

## Parámetros requeridos sin convertir el módulo en un ERP

La configuración inicial debe ser breve y por empresa: clasificación de riesgo IVSS, tipo de entidad/sujeto para cada obligación, número de trabajadores para obligaciones condicionadas, periodicidad y parámetros de nómina. El sistema debe sugerir los valores legales verificados, pedir solo los datos que cambian por empresa y bloquear únicamente la obligación afectada cuando falte un dato crítico.

## Fuentes de consulta utilizadas para diseñar el motor

- LOTTT, Gaceta Oficial N.º 6.076 Extraordinario, 7 de mayo de 2012: https://ceiva.com.ve/CEIVAteca/MarcoLegal/LeyesOrganicas/LOTTT2012.pdf
- IVSS y clasificación de riesgo: https://www.exteriores.gob.es/Embajadas/caracas/es/ViajarA/Paginas/Trabajar.aspx
- FAOV: https://www.dgch.usb.ve/r%C3%A9gimen-prestacional-de-vivienda-faov
- INCES, reporte trimestral y retenciones: https://virtual.urbe.edu/gacetas/41046.pdf
- Cuadro comparativo de contribuciones y topes: https://taxsummaries.pwc.com/venezuela/individual/other-taxes
- Ley de Protección de las Pensiones: https://www.bdo.com.ve/es-ve/publicaciones/boletines-informativos/ley-de-proteccion-de-las-pensiones-de-seguridad-social-venezuela

## Estado

Los cálculos LOTTT en `payroll-legal-calculations.cjs` son funciones aisladas iniciales y están cubiertos por pruebas unitarias. Se incorporaron bases separadas para salario variable: promedio de tres meses para vacaciones (art. 121) y seis meses para prestaciones (art. 122). Estas funciones exigen que quien las invoque suministre los meses inmediatamente anteriores y, para prestaciones, los conceptos salariales y alícuotas aplicables. Todavía no están conectadas al flujo de nómina ni al historial de remuneraciones. No debe confundirse esta base aislada con una nómina lista para confirmar: aún falta integrar utilidades reales/prorrateo fiscal, calendario trimestral de prestaciones, configuración legal por empresa, recibos y asientos contables.
