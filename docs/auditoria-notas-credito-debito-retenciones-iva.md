# Auditoría técnica — notas de crédito/débito y efecto en retenciones IVA

**Fecha:** 01/11/2026  
**Base revisada:** `main` en `e1bce1ebc379f95204a49561b4daf099f58edde7`.  
**Alcance:** inspección estática de modelos, cálculo de notas de crédito de proveedor, Libro de Compras, auxiliar quincenal IVA y validación de integridad SQLite. No se ejecutó una nueva suite en esta auditoría.

## Resultado ejecutivo

SICOVEN ya tiene una ruta parcial para notas de crédito de proveedor y una marca de corrección fiscal pendiente en los comprobantes IVA. Sin embargo, todavía no existe un libro de eventos de rectificación IVA que permita documentar de forma completa y auditable el destino de una retención cuando la factura original ya fue declarada o enterada. Las notas de débito no tienen un flujo equivalente identificado en el circuito de compras.

No se debe resolver este vacío recalculando ni sobrescribiendo comprobantes históricos, snapshots de declaraciones o pagos ya registrados.

## Hallazgos confirmados en código

### 1. Notas de crédito de proveedor: existe flujo parcial
- `PurchaseCreditNoteModal.tsx` registra devoluciones físicas de inventario y presenta la operación como enlazada a Kardex, saldo del proveedor y asiento contable.
- `purchaseCreditNote.ts` calcula importes proporcionales de base, IVA, retención IVA, ISLR e IGTF en escenarios limitados.
- Rechaza facturas con alícuotas mixtas, diferencias de costo, capas PEPS insuficientes, retenciones incoherentes y ciertos casos ISLR con sustraendo.
- `accounting-integrity.cjs` verifica el vínculo de la nota con la factura, el asiento, el Kardex y los comprobantes de retención afectados.
- Cuando hay comprobante IVA relacionado, la nota exige enlazar el asiento correctivo y deja el comprobante con `requiresFiscalCorrection`; no elimina ni reescribe el comprobante.

### 2. La declaración bloquea comprobantes con corrección pendiente
- La revisión y presentación de una declaración se bloquean si alguno de sus comprobantes tiene `requiresFiscalCorrection`.
- El snapshot conserva base, IVA y retención del comprobante original.
- Las declaraciones y sus eventos son append-only.
- El pago conserva su historial y, desde PR #63, la referencia a los movimientos bancarios conciliados.

### 3. No existe todavía un expediente fiscal de rectificación IVA
- El modelo `VatWithholdingDeclarationEventType` solo contempla `REVIEWED`, `FILED`, `PAYMENT` y `DUE_DATE_SET`.
- No hay evento de rectificación, sustitución, anulación fiscal, reintegro ni compensación.
- No existe relación explícita entre una nota de crédito/débito, el comprobante IVA afectado, la declaración presentada, el importe enterado y la acción fiscal posterior.
- El flag `requiresFiscalCorrection` bloquea, pero no representa por sí solo el flujo para resolver la incidencia.

### 4. Notas de débito: flujo no acreditado
- `PurchaseRecord.documentType` admite `01`, `02` y `03`, y el Libro de Compras identifica documentos 02/03 y resta las notas de crédito en algunos totales.
- El formulario general permite seleccionar tipo documental y factura afectada, pero la inspección no encontró un flujo equivalente al módulo especializado de devolución para notas de débito de proveedor.
- No debe asumirse que el registro genérico de un documento 02 produce correctamente el asiento, CxP, IVA, retenciones y el enlace al comprobante original.

### 5. Restricción inconsistente para nota de crédito de compras de contado
- El cálculo especializado acepta `CONTADO` y tiene pruebas para notas de crédito de contado.
- El modal declara elegible tanto `CONTADO` como `CREDITO`.
- Pero el botón de acceso en `LibroComprasView.tsx` se deshabilita para cualquier compra cuyo `paymentTerm` no sea `CREDITO`.
- La interfaz, por tanto, impide llegar a una capacidad que el cálculo y la validación dicen soportar. Además, el texto del botón indica que contado requiere conciliación de caja/bancos, por lo que no debe habilitarse sin comprobar ese vínculo y la devolución de fondos/saldo a favor.

## Riesgos que no se deben automatizar sin fuente primaria

1. Si una nota de crédito emitida después de la retención reduce la base de la retención original, genera una nueva retención, exige anulación/rectificación o tiene otro tratamiento según el momento del evento fiscal.
2. Qué ocurre si la retención ya fue declarada pero todavía no enterada.
3. Qué ocurre si fue declarada y enterada total o parcialmente.
4. Cómo se trata el excedente a favor del agente/proveedor y si puede compensarse contra períodos posteriores.
5. Tratamiento de notas de débito: incremento de base, nuevo hecho imponible/retención o ajuste del comprobante previo.
6. Identificación de documento afectado y reglas de presentación del TXT para tipos 02/03.
7. Procedimiento de rectificación y relación con acuses/recibos previos.

La copia histórica de un instructivo TXT o una interpretación secundaria no autoriza a codificar estas reglas como normativa vigente.

## Diseño técnico recomendado para el siguiente subbloque

Antes de calcular importes fiscales, implementar un expediente append-only de incidencia fiscal que registre hechos y referencias, sin decidir automáticamente el tratamiento tributario:

- empresa;
- documento fuente (factura, nota de crédito o nota de débito);
- comprobante IVA original afectado;
- declaración/quincena en la que aparece el comprobante, si existe;
- eventos FILED y PAYMENT existentes, con sus referencias;
- motivo y fecha de detección;
- estado operativo: pendiente de revisión, revisión documentada, acción fiscal registrada;
- decisión del contador, texto libre obligatorio, responsable y fecha;
- referencia externa a rectificación/acuse/pago/reintegro, si existe;
- vínculo al asiento correctivo, sin permitir alterar el asiento ni el snapshot histórico.

El expediente no debe recalcular el comprobante, cambiar declaraciones presentadas, borrar pagos, generar automáticamente otra retención ni marcar resuelta la incidencia solo porque exista un asiento contable. La resolución debe exigir decisión documentada y soporte verificable. Los estados deben describir la gestión, no afirmar aceptación del SENIAT.

## Secuencia de implementación propuesta

1. Definir tipos y validador puro del expediente append-only, con aislamiento por empresa y unicidad de vínculos.
2. Validar en SQLite la inmutabilidad de expedientes/eventos y la integridad de referencias a documentos, comprobantes, declaraciones y asientos.
3. Agregar pruebas de escenarios no presentados, presentados sin enterar, parcialmente enterados y totalmente enterados, sin inferir tratamiento fiscal: todos deben permanecer pendientes hasta decisión documentada.
4. Integrar una vista de incidencias desde el comprobante y la declaración.
5. Corregir el acceso de notas de crédito contado solo después de diseñar conciliación de salida de fondos/saldo a favor.
6. Diseñar flujo específico de notas de débito y asiento, sin usar el formulario genérico como sustituto.
7. Añadir cálculo fiscal solo cuando exista especificación primaria vigente y validación profesional independiente.

## Criterios de aceptación

- No se modifica ningún comprobante o snapshot histórico.
- Ninguna nota se considera fiscalmente resuelta por el mero asiento contable.
- No se duplican ni reutilizan comprobantes, declaraciones, pagos o movimientos bancarios.
- Los estados y vínculos quedan persistidos y validados también en SQLite.
- Los casos sin fuente primaria permanecen explícitamente pendientes.
- Pruebas cubren aislamiento multiempresa, duplicados, referencias inexistentes, cronología y append-only.
- El administrador semilla permanece intacto.

**Conclusión:** existe base parcial para NC de proveedor, pero no un circuito fiscal completo de NC/ND y rectificaciones IVA. El siguiente desarrollo seguro es primero el expediente trazable de incidencia, no una fórmula fiscal supuesta.
