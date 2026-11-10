# Investigación normativa inicial — Nómina venezolana

**Estado: investigación preliminar; no habilita por sí sola el cálculo legal en producción.**

El motor de nómina no debe fijar tasas o bases legales por defecto. Cada regla debe almacenarse por empresa con fuente, fecha de vigencia, fecha de verificación y supuestos aplicables. Antes de activar una obligación se debe contrastar el texto con la Gaceta Oficial, reglamentos y criterios oficiales vigentes a la fecha del período.

## LOTTT — referencias de trabajo

| Materia | Referencia | Regla a modelar | Precaución |
|---|---|---|---|
| Concepto y salario normal | Art. 104 | Clasificar conceptos salariales y distinguir salario normal de pagos accidentales/no salariales | No tratar todo pago como base idéntica |
| Vacaciones | Arts. 190 y 191 | 15 días hábiles al primer año y un día adicional por año sucesivo, hasta 15 adicionales; revisar vacaciones colectivas | No confundir días hábiles de disfrute con días de salario |
| Base de vacaciones | Art. 121 | Salario normal del mes inmediatamente anterior; variable: promedio de los tres meses anteriores | No usar automáticamente salario integral |
| Bono vacacional | Art. 192 | Mínimo 15 días de salario normal más un día por año hasta 30 | Tiene carácter salarial; revisar fraccionamiento al terminar |
| Utilidades | Arts. 131–134 | Participación mínima legal sobre beneficios líquidos, límites por trabajador de 30 días a 4 meses; anticipo de fin de año conforme art. 132 | No asumir que toda empresa paga exactamente 30 días; liquidación depende de beneficio y límites |
| Prestaciones sociales | Arts. 141–147; en especial 142 | Garantía trimestral de 15 días, días adicionales desde el segundo año y comparación con cálculo de terminación | Requiere historial salarial, antigüedad, anticipos y cálculo final comparativo |
| Base de prestaciones | Art. 122 | Último salario integral; variable: promedio de seis meses; integrar alícuotas de bono vacacional y utilidades según la norma | Debe evitarse cálculo circular de conceptos |

Fuentes de consulta:
- LOTTT, Gaceta Oficial N.º 6.076 Extraordinario (07-05-2012), texto y artículos: https://leyteca.com/ve/lottt/
- Art. 104 (salario y salario normal): https://leyteca.com/ve/lottt/articulo-104/
- Art. 121 (base de vacaciones): https://venezuelanalysis.com/wp-content/uploads/2018/11/lott_tabloideminciweb.pdf
- Art. 122 (base de prestaciones): https://leyteca.com/ve/lottt/articulo-122/
- Art. 131 (utilidades): https://leyteca.com/ve/lottt/articulo-131/
- Art. 142 (garantía y cálculo de prestaciones): https://leyteca.com/ve/lottt/articulo-142/
- Art. 190 (vacaciones): https://leyteca.com/ve/lottt/articulo-190/
- Art. 192 (bono vacacional): https://leyteca.com/ve/lottt/articulo-192/

## Aportes y contribuciones parafiscales

No existe una sola tasa patronal universal que el programa pueda aplicar a todos los comercios:

- **IVSS:** el porcentaje patronal depende de la clasificación de riesgo; las fuentes secundarias consultadas muestran bandas distintas (9–11% o 11–13%) y topes/base que deben contrastarse con la normativa y el registro de cada patrono. La cotización del trabajador y la patronal deben separarse. No activar tasas hasta confirmar tabla vigente y clasificación.
- **FAOV/BANAVIH:** referencias institucionales y académicas describen 3% distribuido entre 2% patronal y 1% trabajador, con base salarial que debe verificarse según el régimen vigente. No confundirlo con salario base de vacaciones.
- **INCES:** no tratar como una deducción ordinaria quincenal del trabajador. La contribución patronal y cualquier aporte del trabajador tienen hechos generadores, sujetos, bases y períodos distintos. Validar número de trabajadores, naturaleza del pago y calendario antes de calcular.
- **Protección de pensiones:** la Ley de Protección de las Pensiones de Seguridad Social y sus actos de aplicación establecieron una contribución especial patronal separada. Debe mantenerse como obligación independiente, con porcentaje, base, sujetos, exenciones y vigencia confirmados por Gaceta y SENIAT; no sumarla silenciosamente a IVSS.

Fuentes de orientación inicial (no sustituyen Gaceta/consulta oficial):
- Universidad Simón Bolívar, FAOV: https://www.dgch.usb.ve/r%C3%A9gimen-prestacional-de-vivienda-faov
- Grant Thornton Venezuela, guía 2026 de regímenes de seguridad social: https://www.grantthornton.com.ve/globalassets/1.-member-firms/venezuela/2026/hacer-negocios-en-venezuela-2026.pdf
- Revista FACES, tabla comparativa de aportes parafiscales: https://www.servicio.bc.uc.edu.ve/faces/revista/evol7n1/vol7n12025.pdf

## Reglas de producto derivadas

1. Las tasas se guardan con fecha inicial/final, fuente, fecha de verificación y configuración aplicable.
2. Un cálculo cerrado conserva una copia íntegra de las reglas y bases aplicadas; una actualización posterior no reescribe el pasado.
3. Los aportes del trabajador, costos patronales, provisiones y pagos a terceros se muestran en grupos separados.
4. Si falta una clasificación patronal, una base, una tasa vigente o un supuesto legal, SICOVEN debe advertirlo y bloquear únicamente el cálculo afectado; nunca completar con un porcentaje supuesto.
5. La periodicidad semanal/quincenal de pago no cambia automáticamente la periodicidad legal de declaración y pago de cada contribución.
6. Las vacaciones deben modelar disfrute real, días hábiles, salario base, bono vacacional y pagos fraccionados; no limitarse a provisionar una cifra genérica.
7. Prestaciones requieren movimientos históricos y comparación de garantía acumulada con cálculo de terminación; una cifra trimestral aislada no es liquidación definitiva.

**Pendiente antes de activar cálculo legal:** cotejar cada regla con el texto oficial de Gaceta y actos administrativos vigentes para el período, confirmar la situación concreta del patrono y preparar casos patrón de prueba revisados por un profesional laboral/contable venezolano.
