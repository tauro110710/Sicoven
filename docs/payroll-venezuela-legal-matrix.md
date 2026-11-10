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
  - La garantía debe conservar cada depósito trimestral con el salario integral usado en ese trimestre y cada depósito adicional por antigüedad con su propia base. No es correcto multiplicar todos los días históricos por el salario diario actual. La comparación final necesita ese historial y el salario integral vigente al terminar.

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

La interfaz permite registrar y editar trabajadores, consultar el historial salarial, preparar borradores semanales o quincenales y consultar el historial por empresa. Los borradores conservan las bases y reglas aplicadas en un snapshot inmutable. La configuración permite registrar obligaciones separadas por empresa, fuente, vigencia, base y periodicidad de nómina; no se cargan porcentajes supuestos. Las reglas semanales y quincenales pueden tener topes distintos. Solo se aplican reglas activas, verificadas y vigentes para la frecuencia y fecha del borrador.

La contabilización genera el asiento desde los totales del snapshot, con cuentas diferenciadas para salarios, aportes patronales, neto por pagar, retenciones legales y otras deducciones. Antes de confirmar, SQLite valida empresa, referencia, fecha, tasa BCV contable histórica y coincidencia exacta de importes; el reintento es idempotente. La tasa utilizada proviene del historial contable BCV de la empresa, independiente del historial BCV de Inventario. Si falta una tasa aplicable, el asiento se bloquea. Los recibos PDF se generan por trabajador, con asignaciones, deducciones y neto, en un solo archivo imprimible.

El panel de cálculo bajo LOTTT conecta el art. 121 con el salario normal del mes anterior o el promedio de tres meses para salario variable, y muestra vacaciones, bono vacacional y límites individuales mínimo/máximo de utilidades conforme a antigüedad y meses completos del ejercicio. No presenta el mínimo o máximo de utilidades como la participación real en beneficios líquidos.

Siguen pendientes antes de declarar Nómina completa: integración verificable de prestaciones sociales art. 142 y sus intereses art. 143 con historial trimestral/mensual de depósitos y salarios integrales; cálculo de utilidades reales según beneficios líquidos de la empresa; automatización de obligaciones parafiscales con sus condiciones y calendarios de declaración/pago; y validación manual de recibos y asientos en la aplicación Windows. No se activa ninguna obligación cuyo supuesto patronal o base crítica no esté configurado.
