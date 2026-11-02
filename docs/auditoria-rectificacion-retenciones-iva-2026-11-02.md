# Auditoría del expediente de rectificación de retenciones IVA

Fecha: 2026-11-02  
Rama: `feature/txt-iva-structural-audit`  
Alcance: rectificación interna de comprobantes de retención IVA afectados por notas de crédito y reversiones. No incluye homologación externa ni prueba en portal SENIAT.

## Resultado de la inspección

SICOVEN ya dispone de un expediente fiscal persistente en SQLite, implementado en:

- `src/types/vatFiscalIncidents.ts`
- `electron/vat-fiscal-incidents.cjs`
- `electron/vat-fiscal-incidents.test.cjs`
- IPC registrado desde `electron/main.cjs`
- API tipada en `src/electron.d.ts` y expuesta por `AccountingContext`.

No se debe crear un segundo ledger paralelo. El expediente existente ya es append-only: tablas de incidencias, eventos y referencias tienen triggers que impiden UPDATE/DELETE. Cada creación y evento escribe además en `audit_events`. Solo un administrador autenticado puede gestionarlo.

## Hallazgos funcionales

1. **Nota de crédito de proveedor:** `addPurchaseCreditNote` genera el asiento contable y el movimiento de devolución; conserva la factura original y marca el comprobante IVA original con `requiresFiscalCorrection=true`, agregando el asiento a `correctionEntryIds`. No genera un comprobante de retención sustituto ni una línea TXT negativa.
2. **Reversión de asiento:** `reverseJournalEntry` conserva el asiento original, crea contra-asiento y marca el comprobante vinculado a la compra como pendiente de corrección. También conserva las referencias de asientos correctivos.
3. **Nota de débito de proveedor:** el flujo `addSupplierDebitNote` crea el documento y asiento, pero no debe presumirse que toda ND modifica una retención; el expediente requiere evaluación individual.
4. **Exportación TXT:** `RetencionesIvaView` bloquea la exportación del período si cualquier comprobante está marcado con `requiresFiscalCorrection`.
5. **Expediente SQLite existente:** permite registrar incidencia, revisión y actuación documentada, enlazando factura fuente, nota, comprobante, declaración, eventos de declaración, pagos, movimientos bancarios y asientos correctivos. Valida pertenencia a la empresa y consistencia de referencias.
6. **Estado deliberadamente no resuelto:** `VatFiscalIncident.resolved` es literalmente `false`; los eventos admitidos son `INCIDENT_RECORDED`, `REVIEW_RECORDED` y `ACTION_RECORDED`. Un evento de actuación documentada no equivale a una rectificación fiscal conciliada ni desbloquea el TXT. Esto evita que una nota interna o una referencia externa no verificada se interprete como autorización fiscal.

## Decisión de diseño

Reutilizar el expediente existente como historial de rectificación. Mantener separados estos conceptos:

- **Incidencia abierta:** se detectó un evento que afecta potencialmente el comprobante.
- **Revisión documentada:** se registró el análisis y sus fundamentos.
- **Actuación documentada:** se registró una actuación contable/administrativa y sus referencias.
- **Rectificación conciliada:** estado futuro que solo podrá reconocerse cuando exista evidencia verificable de la solución fiscal aplicable y conciliación con el comprobante, declaración, pagos y asientos relacionados.

No habilitar todavía un estado de resolución automática. El modelo actual no contiene un tipo de resolución fiscal validada ni una regla que determine si corresponde anulación, sustitución, ajuste de declaración o tratamiento de importe ya enterado. Tampoco debe inferirse la regla de la sola existencia de una NC.

## Reglas obligatorias para la siguiente implementación

- No editar ni eliminar el comprobante original.
- No eliminar `requiresFiscalCorrection` por registrar una revisión o actuación genérica.
- No producir importes negativos ni comprobantes sustitutos sin una regla fiscal y una fuente documental que los respalde.
- Una NC debe enlazar inequívocamente la factura original; la incidencia debe enlazar el comprobante IVA de esa factura cuando exista.
- Una reversión contable debe enlazarse al contra-asiento real, sin crear asientos duplicados desde el expediente.
- Si la declaración ya fue presentada o pagada, conservar los eventos y movimientos bancarios originales; no reescribirlos.
- El TXT del período permanece bloqueado mientras exista cualquier incidencia sin conciliación fiscal válida.
- La operación de expediente solo puede ejecutarse en escritorio SQLite con sesión administrativa válida; no simular persistencia en navegador ni degradar a LocalStorage.
- La eventual resolución debe ser un nuevo evento append-only, con actor, fecha, motivo, evidencia/referencia, asiento correctivo si aplica y conciliación de importes. La política de transición y su validador deben implementarse antes de habilitar el desbloqueo.

## Pruebas existentes verificadas por inspección

`electron/vat-fiscal-incidents.test.cjs` ya cubre:

- creación de incidencia de NC enlazada con factura, comprobante, declaración y pagos;
- rechazo de referencias de otra empresa o inexistentes;
- coherencia entre comprobante y declaración;
- coincidencia entre factura afectada y factura original enlazada;
- prevención de incidencias duplicadas y reutilización de referencias;
- registro append-only de revisión y actuación sin marcar la incidencia resuelta;
- rechazo de asientos y movimientos bancarios ajenos;
- exigencia de decisión documentada y administrador autorizado.

## Cierre de esta ronda

La auditoría confirma que la base de datos y el expediente append-only ya existen y que no conviene duplicarlos. El faltante no es otro registro genérico: es una capa explícita de conciliación y resolución fiscal, conectada a la pantalla de retenciones, con una transición validada y sin desbloqueo prematuro del TXT. Esta ronda no cambia datos contables ni el estado de comprobantes.
