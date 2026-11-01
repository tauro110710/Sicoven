# Bloque 4.2 — Evento fiscal de retención IVA

**Estado:** implementación inicial del primer disparador fiscal en el alta de compras.  
**Alcance:** fecha fiscal, período y trazabilidad del comprobante IVA. No certifica cumplimiento fiscal ni aceptación del archivo por SENIAT.

## Regla de resolución

La fecha de emisión de la factura (`invoiceDate`) es un dato documental y no determina por sí sola el período de retención.

El flujo de compra conserva una fecha efectiva (`accountCreditDate`) con semántica dependiente de la modalidad:
- `CONTADO`: fecha efectiva del pago. El evento se registra como `PAYMENT`.
- `CREDITO`: fecha de reconocimiento/abono en cuenta del pasivo. El evento se registra como `ACCOUNT_CREDIT`.

El resolvedor `src/types/vatFiscalEvent.ts` valida modalidad y fecha calendario y devuelve el disparador, fecha fiscal y período `AAAAMM`.

## Persistencia del snapshot

El comprobante IVA conserva:
- `date`: fecha efectiva del evento fiscal.
- `period`: período mensual del evento.
- `fiscalTrigger`: `PAYMENT` o `ACCOUNT_CREDIT`.
- `fiscalDate`: fecha efectiva.
- `paymentReference`: referencia de pago cuando el disparador es `PAYMENT`.
- `invoiceDate`: fecha original de factura, sin modificación.

Los nuevos campos de snapshot son opcionales en el tipo para mantener compatibilidad de lectura con comprobantes históricos. No se migran ni reescriben comprobantes ya existentes.

## Controles

- El correlativo de 14 caracteres se genera con el período del evento fiscal, no con el mes de emisión de la factura.
- Si se suministra un correlativo, debe tener 14 dígitos y su prefijo `AAAAMM` debe coincidir con el período efectivo.
- La fecha efectiva debe ser una fecha ISO real.
- La modalidad de pago debe ser explícita.
- Se mantiene la referencia del pago de contado para trazabilidad.
- Las pruebas cubren contado, crédito, cruce de mes, modalidad ausente y fecha imposible.

## Límites que permanecen pendientes

1. El auxiliar general de declaraciones/enteramientos quincenales, acuses y pagos pertenece al siguiente subbloque.
2. La cronología detallada de pagos parciales posteriores y sus posibles consecuencias fiscales requiere diseño normativo y conciliación independiente; no se infiere ni se genera un segundo comprobante automáticamente.
3. No se implementa aquí el flujo de notas de crédito/débito.
4. Los comprobantes históricos conservan sus fechas originales; cualquier rectificación requiere un procedimiento formal separado.
5. La especificación TXT vigente del Portal Fiscal debe verificarse independientemente.

## Protección de la contabilidad

Este cambio no altera importes, bases, tasas, asientos, saldos, ni movimientos históricos. No toca autenticación ni administrador semilla, no modifica el gate de índices y no habilita REME.
