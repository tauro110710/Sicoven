# Diseño contable: moneda funcional y moneda de presentación (fase 4)

Fecha: 2026-11-04  
Proyecto: SICOVEN  
Rama: `audit/contabilidad-vennif-fiscal-seniat-1.0.14`  
Estado: diseño y criterios de aceptación; no habilita conversión automática ni modifica saldos históricos.

## 1. Objetivo y alcance

Completar la contabilidad bimonetaria existente distinguiendo tres conceptos que no deben confundirse:

- **Moneda funcional:** moneda del entorno económico principal en el que opera la entidad.
- **Moneda de presentación:** moneda en la que se emiten los estados financieros. Puede coincidir o no con la funcional.
- **Moneda de la transacción:** moneda en que está denominada una operación, derecho u obligación.

Las columnas Bs/USD actualmente disponibles en libros y estados financieros son una capacidad de registro y consulta; no constituyen, por sí solas, una evaluación de moneda funcional ni una conversión conforme a NIC 21.

Este diseño no cambia el marco VEN-NIF adoptado por cada entidad ni presume que toda empresa venezolana tenga automáticamente VES o USD como moneda funcional.

## 2. Base normativa y cautelas

1. La NIC 21 establece el tratamiento de transacciones en moneda extranjera, la conversión de operaciones extranjeras a moneda funcional y la conversión de estados financieros a una moneda de presentación distinta.
2. La moneda funcional se determina por el entorno económico principal en el que la entidad genera y utiliza efectivo; no por preferencia del usuario, moneda de facturación aislada, saldo bancario predominante ni tasa BCV configurada.
3. Las modificaciones de NIC 21 sobre ausencia de convertibilidad son aplicables a períodos anuales iniciados desde el 1 de enero de 2025. La entidad debe evaluar convertibilidad y, si falta, estimar una tasa spot representativa y revelar la metodología y riesgos relevantes.
4. Las circunstancias venezolanas requieren evaluación documentada de acceso real a los mecanismos legales de cambio y de las tasas disponibles. No se debe asumir que una tasa publicada es automáticamente accesible o adecuada para cada entidad y transacción.
5. Debe analizarse conjuntamente la aplicación de NIC 29 cuando el marco contable adoptado lo requiera por hiperinflación. La reexpresión por inflación y la conversión cambiaria son procesos distintos; su secuencia depende de la moneda funcional y de presentación y no se resolverá con una simple multiplicación por la tasa del día.
6. La adopción y aplicación concreta debe validarse contra la versión vigente de VEN-NIF GE o VEN-NIF PYME que la entidad haya adoptado y contra las decisiones técnicas de la FCCPV. Este documento no declara que NIC 21/29 se incorporen automáticamente sin el proceso local de adopción.

Referencias técnicas primarias:
- IFRS Foundation, IAS 21: https://www.ifrs.org/issued-standards/list-of-standards/ias-21-the-effects-of-changes-in-foreign-exchange-rates/
- IFRS Foundation, modificaciones de NIC 21 por ausencia de convertibilidad: https://www.ifrs.org/projects/completed-projects/2023/lack-of-exchangeability-research/
- IFRS Foundation, agenda decision sobre tasas y falta prolongada de convertibilidad: https://www.ifrs.org/projects/completed-projects/2018/determination-exchange-rate-lack-exchangeability/tad-june-2018/

## 3. Evaluación documentada de moneda funcional

La evaluación debe ser realizada por entidad y quedar respaldada por evidencia. La interfaz no debe seleccionar una moneda automáticamente.

### Indicadores principales que debe documentar el expediente

- Moneda que influye principalmente en los precios de venta de bienes y servicios.
- Moneda del país cuyas fuerzas competitivas y regulaciones determinan principalmente esos precios.
- Moneda que influye principalmente en mano de obra, materiales y otros costos de producción o prestación.
- Moneda en la que se generan y mantienen los fondos de las actividades operativas.
- Moneda en que se obtienen los recursos de financiación.

Los indicadores secundarios se usan para corroborar la conclusión, especialmente cuando los principales no son concluyentes. No se implementará un algoritmo de puntuación que sustituya el juicio profesional.

### Evidencia y trazabilidad mínimas

- Moneda funcional propuesta y moneda funcional aprobada.
- Fecha de evaluación y fecha desde la que surte efecto.
- Responsable que preparó la evaluación y aprobador.
- Justificación narrativa por indicador.
- Evidencias adjuntas o referencias a contratos, listas de precios, nóminas, compras, préstamos, cobros y pagos.
- Conclusión y fundamento de cualquier cambio respecto de la evaluación anterior.
- Versión del marco contable aplicado.

La evaluación debe revisarse cuando cambien los hechos y circunstancias relevantes; no debe cambiarse retroactivamente solo para mejorar resultados o presentación.

## 4. Moneda de presentación

La moneda de presentación es una decisión separada y explícita. El sistema debe guardar:

- Moneda de presentación elegida.
- Fecha de autorización y responsable.
- Motivo de presentación en moneda distinta de la funcional, cuando corresponda.
- Período inicial de aplicación y política de conversión.
- Información comparativa y conciliaciones requeridas.

Si moneda funcional y de presentación coinciden, no se debe ejecutar una conversión ficticia. Si difieren, los estados deben generarse desde importes medidos en moneda funcional y aplicar las reglas de conversión pertinentes; nunca convertir de una columna bimonetaria ya redondeada.

## 5. Reglas técnicas que deben implementarse después de aprobar el modelo

### Transacciones en moneda extranjera

- Reconocimiento inicial con la tasa spot de la fecha de la transacción, con excepciones prácticas únicamente cuando sean admisibles y no distorsionen materialmente.
- Al cierre: partidas monetarias a tasa de cierre; partidas no monetarias a costo histórico mantienen la tasa de la fecha de la transacción; partidas no monetarias medidas a valor razonable usan la tasa de la fecha de medición.
- Diferencias de cambio se reconocen conforme a la norma aplicable; no se deben enviar todas automáticamente a una cuenta genérica de ganancia/pérdida cambiaria.
- Anticipos, partidas no monetarias y pagos parciales requieren conservar la fecha y tasa de cada reconocimiento pertinente.

### Conversión a moneda de presentación distinta

- Activos y pasivos: tasa de cierre de la fecha del estado de situación financiera.
- Ingresos y gastos: tasas de las fechas de transacción; una tasa promedio solo si aproxima razonablemente esas tasas y no existen fluctuaciones significativas.
- Diferencias de conversión: tratamiento en otro resultado integral/patrimonio cuando así lo exige la norma, con trazabilidad y conciliación; no confundirlas con diferencias de cambio de transacciones.
- Las reglas específicas para una operación extranjera y para una moneda de presentación hiperinflacionaria deben modelarse aparte.

### Tasa de cambio y ausencia de convertibilidad

Cada tasa usada debe conservar: moneda origen/destino, valor, fecha efectiva, fuente, mecanismo legal, evidencia de acceso, propósito (transacción/cierre/conversión), estado de convertibilidad y aprobador. No reutilizar sin revisión la tasa BCV global de Company como sustituto universal de todas las tasas.

Si no existe convertibilidad en el sentido de NIC 21, el sistema debe bloquear la conversión automática y exigir una estimación aprobada, metodología, datos observables, restricciones, saldos afectados y revelaciones. Nunca inventar una tasa ni inferirla de cotizaciones no verificadas.

## 6. Modelo de datos propuesto

Agregar metadatos opcionales y compatibles con registros existentes, sin alterar el significado de los campos históricos `debitBs`, `creditBs`, `debitUsd` y `creditUsd`:

- `functionalCurrency`: código ISO 4217 aprobado.
- `presentationCurrency`: código ISO 4217 aprobado.
- `functionalCurrencyAssessment`: expediente versionado con fecha efectiva, indicadores, justificación, evidencias, preparador y aprobador.
- `currencyPolicyVersion`: versión de política aplicada.
- `currencyChangeReason`: fundamento obligatorio para cambios posteriores.
- `exchangeRateEvidence`: registros inmutables por tasa, fecha, fuente, mecanismo, propósito y evaluación de convertibilidad.

La estructura final debe validarse contra los mecanismos reales de persistencia, exportación/importación, respaldo y migración de SICOVEN antes de escribir código. Los registros antiguos sin estos metadatos deben seguir abriendo y reportándose; no completar monedas por inferencia ni reescribir asientos.

## 7. Requisitos de interfaz y controles

- En Configuración de empresa: sección independiente «Moneda funcional y presentación».
- Mostrar «Pendiente de evaluación» cuando no exista expediente aprobado; nunca mostrar un valor predeterminado como si fuera conclusión contable.
- Flujo de evaluación con guardado de borrador, revisión, aprobación y vigencia.
- Bloquear generación de estados convertidos cuando falten moneda aprobada, tasas requeridas o evidencia de convertibilidad.
- Los libros operativos bimonetarios existentes deben seguir funcionando sin obligar a convertir o reexpresar registros históricos.
- Mostrar claramente si un informe es libro en Bs/USD, estado en moneda funcional o estado convertido a moneda de presentación.

## 8. Pruebas de aceptación obligatorias

1. Empresa histórica sin metadatos: abre, opera y consulta reportes existentes sin cambios.
2. Empresa nueva: no se asigna moneda funcional ni de presentación por defecto.
3. Evaluación incompleta: no se puede aprobar ni generar estados convertidos.
4. Evaluación aprobada: conserva responsable, fechas, evidencia y versión; la reimpresión histórica no cambia.
5. Cambio de hechos: crea nueva evaluación efectiva, sin sobrescribir la anterior.
6. Partidas monetarias y no monetarias: aplican reglas diferentes y verificables.
7. Tasas por fecha: cada asiento conserva tasa histórica; un cambio de tasa actual no altera movimientos anteriores.
8. Falta de convertibilidad: bloquea cálculo automático y exige expediente de estimación y revelaciones.
9. Moneda funcional distinta de presentación: estados, comparativos, diferencia de conversión y conciliación reproducibles.
10. Pruebas de balance: cuadre independiente en la moneda funcional y en la moneda de presentación; no validar únicamente por coincidencia entre dos columnas.
11. Interacción con NIC 29 y entorno hiperinflacionario: pruebas específicas de secuencia y revelación, sin duplicar ajustes por inflación o conversión.
12. Exportación, importación, respaldo y restauración: metadatos, evidencia y tasas permanecen íntegros.

## 9. Decisión de implementación

La fase 4 no se considerará terminada hasta que exista:
- modelo de datos persistido y migración compatible;
- captura y aprobación de evaluación funcional;
- política explícita de presentación;
- motor de conversión separado del registro operativo;
- historial de tasas y evaluación de convertibilidad;
- tratamiento documentado de NIC 29 cuando corresponda;
- pruebas unitarias, integración, restauración y revisión contable;
- validación final de las reglas contra el marco VEN-NIF efectivamente adoptado.

**No se autoriza** activar conversión automática, fijar USD o VES como moneda funcional universal, alterar los asientos históricos ni declarar cumplimiento VEN-NIF/NIC 21 solo por disponer de dos columnas monetarias.


## Ampliación de auditoría: falta de convertibilidad y contexto venezolano

La revisión de la guía oficial IAS 21 de IFRS confirma que la moneda funcional es la del entorno económico principal en el que la entidad genera y consume efectivo; la moneda de presentación puede ser distinta. Por ello, SICOVEN no debe derivar la moneda funcional de la tasa BCV, de la moneda de facturación ni de una preferencia de visualización.

La agenda oficial del IFRIC de septiembre de 2018 trató expresamente circunstancias de Venezuela en las que la moneda funcional no podía cambiarse por otras monedas mediante un mecanismo legal accesible. El Comité señaló que el tipo oficial solo puede utilizarse como tasa de cierre o tasa de transacción cuando represente la tasa spot a la que la entidad tendría acceso mediante un mecanismo legal de cambio. La evaluación debe repetirse en cada fecha de reporte porque las condiciones pueden cambiar. Esto impide que SICOVEN asuma que publicar una tasa BCV equivale a demostrar convertibilidad o acceso efectivo.

Las modificaciones de IAS 21 sobre falta de convertibilidad, emitidas en agosto de 2023 y efectivas para períodos anuales iniciados desde el 01-01-2025, requieren evaluar la convertibilidad en la fecha de medición y para un propósito específico; si no existe convertibilidad, se estima una tasa spot que refleje una transacción ordenada entre participantes del mercado y se revelan la metodología, información y riesgos. La aplicación exacta en SICOVEN debe seguir el marco VEN-NIF adoptado y su versión aplicable, no incorporar automáticamente IFRS si no forma parte del marco de la entidad.

### Consecuencia para el diseño de datos

La futura evaluación debe capturar, por fecha de reporte y propósito:
- moneda de origen y moneda de destino;
- importe que la entidad necesita convertir y propósito (liquidación de transacciones, pago de pasivos, conversión de estados, etc.);
- mecanismo legal específico disponible, requisitos, límites, plazos y evidencia de acceso real;
- importe que puede obtenerse, plazo administrativo normal y si el acceso es solo insignificante;
- tasa observada, fuente, fecha/hora y evidencia verificable;
- conclusión de convertibilidad, responsable, aprobación y vigencia;
- si no es convertible, método de estimación, datos observables, supuestos y sensibilidad;
- revelaciones necesarias y fecha de reevaluación.

No basta con un booleano general «moneda convertible» ni con guardar una tasa oficial única. La evaluación depende del propósito, fecha y cantidad. Los controles deben bloquear conversiones automáticas sin evidencia aprobada y mantener separadas las diferencias de cambio de transacción, diferencias de conversión a presentación y efectos de inflación.

### NIC 29 y cambios normativos

La conversión de estados de una entidad cuya moneda funcional corresponde a una economía hiperinflacionaria requiere el tratamiento especial de IAS 21, párrafo 42, en conjunto con IAS 29 cuando el marco aplicable lo exija. No se debe aplicar sin análisis el promedio de tasas a ingresos y gastos en esas circunstancias. Además, el IASB emitió en noviembre de 2025 modificaciones sobre conversión a moneda de presentación hiperinflacionaria, con vigencia desde períodos anuales iniciados el 01-01-2027 y posibilidad de aplicación anticipada; la revisión de VEN-NIF debe determinar si y cuándo se incorpora esa modificación al marco adoptado.

### Evidencia consultada

- IFRS Foundation, IAS 21: definición de moneda funcional, transacciones en moneda extranjera y conversión a moneda de presentación.
- IFRIC Update, septiembre de 2018: análisis explícito de Venezuela y de la tasa a la que la entidad realmente tendría acceso mediante un mecanismo legal.
- IFRS Foundation, enmienda Lack of Exchangeability (2023): evaluación por fecha y propósito, estimación de tasa y revelaciones.
- IASB/IAS 21: modificaciones de noviembre de 2025 relativas a conversión a moneda de presentación hiperinflacionaria, con vigencia 2027.

Este añadido amplía los criterios de diseño; no implementa el motor NIC 21, no selecciona tasa ni moneda funcional y no certifica cumplimiento VEN-NIF.


## Estado de implementación en PR #95 — 04/11/2026

### Implementado en rama, pendiente de pruebas

- Company admite historial opcional de expedientes `functionalCurrencyAssessments` y evaluaciones `exchangeabilityAssessments`; la ausencia de datos sigue significando pendiente, sin moneda por defecto.
- Configuración permite registrar un expediente NIC 21 en borrador o aprobarlo con moneda funcional, moneda de presentación, fechas, preparador/aprobador, entorno económico, factores primarios y referencias documentales.
- La validación permite borradores incompletos, pero impide aprobar sin fechas coherentes, juicio profesional, factores y evidencia.
- Se incorporó un validador de convertibilidad que exige fecha, propósito, monto, mecanismo legal, evidencia y aprobación; para convertible exige acceso legal y efectivo, monto suficiente y tasa spot accesible; para no convertible exige tasa estimada, metodología y evidencia.
- El historial se agrega sin reemplazar evaluaciones previas. No se conectó a conversiones ni modifica asientos.

### Pendiente

- Construir la interfaz para capturar y aprobar las evaluaciones de convertibilidad por fecha y propósito.
- Verificar persistencia/backup/restore en SQLite con registros históricos y nuevos expedientes.
- Implementar motor de conversión NIC 21 separado de la presentación bimonetaria, con tasas históricas y diferencias de conversión diferenciadas del resultado cambiario.
- Analizar NIC 29 conjuntamente según el marco VEN-NIF efectivamente adoptado.
- Ejecutar pruebas, TypeScript y build en entorno habilitado; no existe evidencia de CI para el HEAD actual por bloqueo de ejecución de Actions.
