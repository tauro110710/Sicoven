# Bloque 3.2D — Casos profesionales de clasificación

**Alcance:** matriz de casos para validar el modelo 3.2A–3.2C antes de habilitar cualquier cálculo REME. Los casos son criterios de evaluación y no clasificaciones automáticas. La conclusión de cada expediente depende de contrato, derecho exigible, documentación, marco VEN-NIF adoptado y ejercicio.

## Reglas de uso
1. La naturaleza del derecho u obligación prevalece sobre el nombre de la cuenta.
2. La clasificación se documenta por empresa, ejercicio y componente de saldo.
3. Una cuenta con componentes heterogéneos se desglosa; nunca se fuerza una única clasificación.
4. Importes y fechas deben reconciliarse con auxiliares y documentos.
5. La decisión queda pendiente hasta revisión profesional independiente.
6. Los ejemplos no sustituyen el juicio profesional ni la normativa local vigente.

## Matriz de casos y evidencia requerida

| Caso | Pregunta profesional | Evidencia mínima | Resultado de evaluación |
|---|---|---|---|
| Caja y bancos | ¿Es efectivo o un derecho a recibir unidades monetarias fijas/determinables? | Conciliación, extracto, moneda, restricciones y titularidad | Normalmente monetaria; separar depósitos restringidos o derechos de naturaleza distinta |
| Cuentas por cobrar | ¿El cliente debe pagar dinero o entregar bienes/servicios? | Factura, contrato, vencimiento, moneda, cláusulas de indexación, notas y cobros | Monetaria si exige dinero; si está indexada evaluar contrato; anticipos y créditos no dinerarios se separan |
| Cuentas por pagar | ¿La obligación se liquida entregando dinero o bienes/servicios? | Factura, contrato, cláusulas, vencimientos y pagos | Monetaria si se liquida en dinero; obligación de entregar bienes/servicios requiere análisis específico |
| Anticipo reembolsable | ¿Existe derecho exigible a recuperar efectivo? | Contrato, cláusula de devolución, evidencia de exigibilidad y cobros | Puede ser monetario; no clasificar por el rótulo “anticipo” |
| Anticipo aplicable a bienes/servicios | ¿El derecho es recibir bienes/servicios, no efectivo? | Orden, contrato, proveedor, aplicación futura y condiciones de reembolso | Normalmente no monetario mientras represente derecho a bienes/servicios; separar porción reembolsable si es sustantiva |
| Inventarios | ¿Cuál es el costo y fecha de adquisición de cada lote? | Kardex, factura, gastos atribuibles, lote, devoluciones y costo | No monetario histórico por lote; no usar fecha global de la cuenta |
| Propiedad, planta y equipo | ¿Se mide al costo histórico o por revaluación/valor corriente? | Factura, acta de puesta en servicio, mejoras, avalúo, depreciación y fecha de medición | Costo histórico desde origen; medición corriente desde fecha de medición según marco |
| Intangibles | ¿El activo cumple reconocimiento y cuál es su fecha/base de medición? | Contrato, factura, fecha disponible para uso, vida útil y deterioro | No monetario si reconocido como activo; identificar origen y base; no confundir gastos con activo |
| Patrimonio y aportes | ¿El saldo representa capital histórico, obligación de reembolso o aporte indexado? | Actas, estatutos, comprobantes, acuerdos de devolución y moneda | Analizar naturaleza jurídica; capital aportado no se clasifica automáticamente como obligación monetaria |
| Impuestos y créditos fiscales | ¿El derecho se recupera en dinero, se compensa contra tributos o se aplica a bienes/servicios? | Declaraciones, certificados, legislación, liquidaciones y evidencia de recuperabilidad | No asignar clase genérica: documentar el mecanismo legal de recuperación y separar componentes |
| Partidas indexadas | ¿La indexación es contractual y exigible o es solo una referencia informal? | Contrato firmado, cláusula, índice definido, fechas y cálculo | Monetaria indexada solo si la obligación/derecho es dinerario y el contrato determina ajuste |
| Saldos mixtos | ¿La cuenta contiene derechos u obligaciones de distinta naturaleza o fechas? | Auxiliar por tercero, documento, lote, contrato y moneda | Cuenta MIXED; crear componente individual para cada saldo homogéneo |
| Valor razonable/VNR/revaluación | ¿La medición corresponde a la fecha de reporte o a fecha anterior? | Informe de valoración, metodología, fecha, aprobador y conciliación | Si es a fecha de reporte, no reexpresar otra vez; si anterior, evaluar desde fecha de medición |
| Ingresos, costos y gastos | ¿Es flujo del período o saldo de activo/pasivo? | Documento y fecha de reconocimiento/devengo | NOT_APPLICABLE/FLOW en esta matriz; su tratamiento temporal se definirá en fase específica |

## Escenarios de aceptación

- **CP-01 Caja:** componente monetario, efectivo/moneda fija, sin reexpresión general.
- **CP-02 CxC indexada:** no aceptar sin contrato y cláusula; ajuste contractual no equivale a factor general.
- **CP-03 Anticipo reembolsable:** solo monetario cuando la devolución dineraria sea un derecho exigible documentado.
- **CP-04 Anticipo de mercancía:** componente no monetario cuando el derecho principal sea recibir inventario; separar devolución dineraria si existe.
- **CP-05 Inventario:** dos lotes de fechas distintas deben tener componentes y fechas de origen distintas.
- **CP-06 PPE:** costo histórico requiere fecha de origen; revaluación exige fecha de medición y reporte.
- **CP-07 Intangible:** no crear activo por el solo hecho de un desembolso; primero validar reconocimiento contable.
- **CP-08 Patrimonio:** no convertir aportes en pasivos por su sola denominación; revisar acuerdos y sustancia.
- **CP-09 Crédito fiscal:** clasificación condicionada a la forma legal de recuperación; no asumir que todo crédito fiscal es monetario.
- **CP-10 Cuenta mixta:** bloquear componente MIXED; exigir desglose.
- **CP-11 Medición corriente:** fecha posterior al reporte se rechaza; fecha igual al reporte no se reexpresa otra vez.
- **CP-12 Flujos:** ingresos/costos/gastos permanecen fuera de la matriz de saldos.

## Cierre de 3.2D
- [ ] Profesional responsable valida cada expediente y deja nombre, fecha y referencia.
- [ ] Se documenta marco VEN-NIF adoptado y ejercicio.
- [ ] Se concilian importes con auxiliares y mayor.
- [ ] Se revisan monedas, fechas y cláusulas contractuales.
- [ ] Se prueban las decisiones en la interfaz y persistencia SQLite.
- [ ] Las excepciones quedan rechazadas o pendientes, nunca autoaprobadas.
- [ ] No se ejecutan factores, REME ni asientos en este subbloque.

**Limitación actual:** esta matriz define casos de validación. No certifica que un caso real de SICOVEN esté aprobado; eso exige expediente y revisión profesional documentada.
