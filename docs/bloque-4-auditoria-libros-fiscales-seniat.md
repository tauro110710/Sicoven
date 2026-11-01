

## 6. Hallazgos adicionales contrastados con la Providencia SNAT/2025/000054

### 6.1 Fecha y período fiscal de la retención IVA no siguen el disparador normativo

El artículo 13 establece que la retención se practica cuando ocurra primero el pago o el abono en cuenta. Sin embargo, en `AccountingContext.tsx` el período `vatPeriod`, la fecha del comprobante y el correlativo se derivan de `purchaseData.invoiceDate`. El modelo de compra también conserva `accountCreditDate`, pero ese campo se utiliza para el período ISLR, no para el comprobante IVA.

**Riesgo:** cuando la fecha de pago/abono en cuenta difiera de la emisión de la factura, el comprobante y el período IVA pueden quedar asignados a un mes que no corresponde al momento fiscal de retención.

**Corrección requerida:** representar el evento de retención IVA de forma explícita e inmutable, con fecha de pago/abono que ocurrió primero, documento fuente, importe/base, secuencia y período. La fecha de factura debe permanecer como dato documental distinto. No modificar retroactivamente comprobantes existentes.

### 6.2 Falta de control de períodos de enteramiento quincenal

Los artículos 14 y 15 distinguen retenciones practicadas del día 1 al 15 y del 16 al último día del mes, y exigen declarar compras sujetas a retención conforme a las especificaciones técnicas del Portal Fiscal; incluso se presenta declaración cuando no hubo operaciones sujetas a retención. El modelo actual de comprobante IVA conserva `period: YYYYMM`, sin un período de enteramiento/ventana quincenal explícito ni estado de declaración/enteramiento.

**Riesgo:** el libro mensual puede sumar comprobantes sin soportar la conciliación y control de las dos ventanas de enteramiento, y el sistema no puede demostrar por sí solo que se cumplió la declaración sin operaciones.

**Corrección requerida:** añadir un auxiliar de eventos/declaraciones por ventana 1–15 y 16–fin de mes, con totales, comprobantes incluidos, fecha límite según calendario vigente, estado de declaración, referencia/acuse y pago/enteramiento. El calendario no se codificará como fecha fija sin fuente oficial versionada.

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
