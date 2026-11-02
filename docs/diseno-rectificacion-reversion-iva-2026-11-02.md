# Diseño controlado de rectificación y reversión de IVA

**Estado:** diseño normativo/funcional preliminar. No habilita todavía la rectificación ni la reversión automática de un enteramiento.  
**Fecha de revisión:** 2026-11-02.

## 1. Fuentes y alcance verificado

- Providencia Administrativa SENIAT SNAT/2025/000054, publicada en Gaceta Oficial N.º 43.171 del 16-07-2025. Su texto consultado establece, entre otros puntos:
  - Art. 11: si el ajuste de precio disminuye el impuesto y la retención aún no fue enterada, el agente devuelve el exceso; si ya fue enterado, el proveedor lo descuenta de la cuota tributaria o puede solicitar recuperación conforme al procedimiento aplicable.
  - Art. 12: para retención indebida no enterada, el proveedor acciona contra el agente; si ya fue enterada, se aplican los mecanismos de descuento/recuperación allí indicados. El agente que enteró más de lo efectivamente retenido puede solicitar reintegro conforme al COT.
  - Arts. 14 y 15: oportunidad y procedimiento de enteramiento, incluida la declaración de compras retenidas en Portal Fiscal y el pago electrónico o mediante planilla 99035.
  - Art. 16: entrega del comprobante al proveedor dentro de los primeros dos días hábiles del período de imposición siguiente.
- Código Orgánico Tributario, Gaceta Oficial N.º 6.507 Extraordinario del 29-01-2020, art. 157: admite modificación espontánea de declaraciones definitivas bajo las condiciones allí indicadas; establece límites y consecuencias para declaraciones sustitutivas (incluidas dos o más sustitutivas y la primera presentada después de doce meses), con excepciones expresas.
- La investigación web localizó copias y transcripciones secundarias de estas normas, pero no se obtuvo una copia primaria oficial descargable de SENIAT/Gaceta para verificar especificaciones técnicas del TXT ni la interfaz actual del Portal Fiscal. Por tanto, esta revisión no constituye dictamen legal ni prueba de aceptación del archivo.

## 2. No confundir cuatro actuaciones

1. **Corrección del comprobante/factura fuente:** nota de crédito/débito, ajuste de precio o incidencia del documento de compra.
2. **Rectificación de declaración presentada:** declaración sustitutiva/rectificativa conforme al COT y al procedimiento habilitado por SENIAT. Debe conservarse el acuse y la relación con la declaración sustituida.
3. **Regularización del importe retenido:** devolución por el agente solo en los supuestos y oportunidad permitidos por la Providencia; cuando ya se enteró, no asumir que el agente puede simplemente devolver o compensar.
4. **Reintegro/recuperación ante el Fisco:** procedimiento administrativo distinto de una reversión contable. SICOVEN no debe simular que una solicitud equivale a aprobación o devolución efectiva.

## 3. Modelo inmutable propuesto

La declaración original y todos sus eventos REVIEWED, FILED y PAYMENT permanecen inalterables. Una corrección posterior debe ser un expediente nuevo, enlazado por identificadores, nunca una edición de la declaración original.

Datos mínimos del expediente:
- empresa y contribuyente;
- ID de declaración original, período/quincena, número presentado y acuse/recibo;
- comprobantes y documentos fuente afectados (incluidas notas de crédito/débito);
- fecha de detección, motivo y usuario;
- situación de enteramiento: no presentado, presentado/no pagado, pagado parcial o pagado total;
- referencia externa SENIAT/Portal Fiscal y documento de respuesta, si existen;
- decisión documentada del responsable tributario;
- declaración sustitutiva y su acuse, si el procedimiento oficial la admite;
- evento de ajuste contable y asiento correctivo enlazado;
- pagos/devoluciones/reintegros reales, con sus referencias y movimientos bancarios;
- estado de revisión independiente y pista de auditoría.

## 4. Reglas de seguridad contable

- Prohibido editar o borrar declaración presentada, acuse, pago, asiento o conciliación bancaria histórica.
- Prohibido reutilizar o liberar movimientos bancarios conciliados por un pago fiscal histórico.
- Un asiento correctivo debe ser un asiento nuevo, balanceado en Bs. y USD, con referencia explícita al asiento original, causa, fecha efectiva y expediente de corrección.
- La reversión contable no revierte por sí sola una declaración en Portal Fiscal ni acredita un reintegro del SENIAT.
- Si el pago fue enterado, el sistema debe bloquear la devolución automática por caja/banco hasta que exista base normativa y evidencia de la vía fiscal aplicable.
- Los expedientes pueden documentar una actuación sin marcarla como aceptada/resuelta por SENIAT.
- La actualización de estado debe ser derivada de eventos anexados, nunca de sobrescribir eventos previos.

## 5. Máquina de estados propuesta

`INCIDENT_RECORDED → REVIEW_RECORDED → ACTION_AUTHORIZED → EXTERNAL_SUBMISSION_RECORDED → EXTERNAL_ACKNOWLEDGED → ACCOUNTING_ADJUSTMENT_POSTED → BANK_SETTLEMENT_RECORDED`

No todos los expedientes recorren todos los estados. Cada transición exige sus precondiciones y evidencia. `EXTERNAL_ACKNOWLEDGED` requiere acuse/resultado externo verificable; no se puede inferir de un envío local. `BANK_SETTLEMENT_RECORDED` requiere movimiento real y conciliación.

Estados de salida diferenciados:
- `CLOSED_NO_ADJUSTMENT`: análisis concluye que no procede ajuste, con motivo.
- `PENDING_TAX_AUTHORITY`: trámite enviado sin respuesta verificable.
- `PENDING_REFUND_OR_CREDIT`: derecho/solicitud documentada, aún sin pago o crédito aplicado.
- `COMPLETED_WITH_EVIDENCE`: actuaciones externas y contables verificadas.

## 6. Bloqueos antes de implementar

1. Obtener y revisar ejemplar oficial de la Gaceta N.º 43.171 y texto oficial vigente del COT.
2. Confirmar con SENIAT la interfaz y especificación técnica vigente para declaración original, declaración sustitutiva y archivo de retenciones; no inventar campos, códigos ni formatos.
3. Determinar con asesoría tributaria si la rectificación aplica a cada supuesto y cómo se tramita cuando el enteramiento ya fue pagado.
4. Definir asientos y tratamiento bancario por cada supuesto (no enterado, enterado parcialmente, enterado totalmente, retención indebida, exceso enterado).
5. Implementar el nuevo libro de eventos append-only y sus validaciones SQLite; integrar el expediente de incidencia existente sin convertir `ACTION_RECORDED` en una aprobación fiscal.
6. Pruebas de concurrencia, atomicidad, recuperación tras reinicio real de Electron y trazabilidad integral.

## 7. Estado de SICOVEN a la fecha

- El PR #85 ya bloquea la reversión contable genérica de asientos vinculados a enteramientos IVA y conserva el vínculo entre evento fiscal, asiento y débitos bancarios.
- Existe un expediente de incidencias fiscales append-only para documentar análisis/actuaciones y referencias, pero no es todavía un motor de rectificación ni ejecuta por sí mismo declaraciones sustitutivas, reintegros o reversión de pagos.
- La prueba de recuperación existente cierra y reabre una conexión SQLite al mismo archivo; no demuestra todavía cierre y relanzamiento integral del proceso Electron instalado.
- No se ha verificado aceptación de TXT ni de una declaración por el Portal Fiscal.
- No declarar certificación, homologación ni aceptación SENIAT sobre la base de pruebas internas.
