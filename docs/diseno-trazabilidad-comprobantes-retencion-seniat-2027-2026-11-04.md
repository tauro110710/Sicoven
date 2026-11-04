# Diseño de trazabilidad de comprobantes de retención SENIAT 2027

Fecha de auditoría: 2026-11-04  
Rama: `audit/contabilidad-vennif-fiscal-seniat-1.0.14`  
PR: #95 (Draft, abierto, sin merge)

## 1. Alcance y criterio normativo

La Providencia Administrativa SNAT/2026/00093, publicada en Gaceta Oficial N.º 43.484, establece en su artículo 18 requisitos comunes para comprobantes de retención de IVA e ISLR. Entre ellos: numeración consecutiva de catorce caracteres `AAAAMMSSSSSSSS`, identificación y domicilio fiscal del agente, fecha de emisión y entrega, identificación y domicilio fiscal del proveedor y correo electrónico del proveedor, además de los datos de la factura o nota de débito, período e importes. La disposición final octava fija su entrada en vigencia para el 19-04-2027.

Este diseño prepara la compatibilidad futura. No activa anticipadamente obligaciones, no invalida comprobantes emitidos bajo el régimen anterior y no modifica datos históricos. El medio de entrega y la constancia de acuerdo para entrega electrónica son controles de evidencia útiles; el artículo 18 citado no los enumera como campos autónomos obligatorios.

La revisión del texto normativo no sustituye el cotejo del manual técnico vigente del SENIAT ni la validación profesional. No se afirma que los formatos XML/TXT actuales satisfagan por sí solos el artículo 18.

## 2. Flujo real identificado en el código

### Compras y emisión

- `src/components/LibroCompras/NewPurchaseModal.tsx` captura actualmente la dirección del proveedor, pero no captura su correo electrónico.
- `src/types/accounting.ts` define `PurchaseRecord` sin `supplierEmail`.
- `src/context/AccountingContext.tsx`, función `addPurchase`, crea el registro de compra y emite los comprobantes asociados.
- El comprobante IVA se crea como `VatRetentionVoucher`; copia datos del proveedor y toma una instantánea de nombre, RIF y dirección del agente.
- El comprobante ISLR se crea como `IslrRetentionVoucher`; copia nombre, RIF y dirección del proveedor, pero no correo del proveedor ni instantánea de nombre/RIF/dirección del agente.
- El correlativo ISLR actual se construye como `ISLR-YYYYMM-000001`; no tiene el formato futuro de catorce dígitos. El correlativo IVA utiliza `formatVoucherNumber`, cuya salida debe cotejarse con el formato requerido antes de reutilizarla para ISLR.

### Visualización y entrega

- `src/components/Retenciones/RetencionesIslrView.tsx` lista comprobantes y abre `IslrVoucherModal`.
- `src/components/Retenciones/IslrVoucherModal.tsx` imprime el comprobante; no registra entrega.
- `src/components/Retenciones/RetencionesIvaView.tsx` y `VatVoucherModal.tsx` ya ofrecen registro de fecha y medio de entrega, y exigen acuerdo previo para marcar entrega electrónica.
- `AccountingContext.recordVatVoucherDelivery` valida la fecha, impide sobrescribir una entrega ya registrada y espera confirmación de persistencia antes de informar éxito. No existe el equivalente ISLR.

## 3. Persistencia y compatibilidad comprobadas en el código

- En escritorio, el estado contable completo se guarda mediante `window.sicovenStore.save` en SQLite. La instantánea incluye `vatVouchers` e `islrVouchers`.
- En el modo web de desarrollo, ambos arreglos tienen persistencia local separada.
- La exportación del respaldo incluye ambas colecciones; la importación las valida como colecciones y las restaura.
- La hidratación SQLite carga las colecciones existentes sin reconstruir ni completar campos de comprobantes históricos.

Por tanto, agregar propiedades opcionales a los tipos y escribirlas en los objetos nuevos permite compatibilidad estructural con registros antiguos. Aun así, cualquier implementación deberá probar expresamente el ciclo guardar → cerrar/abrir → exportar → importar → reimprimir, y no depender únicamente de la compatibilidad TypeScript.

## 4. Brechas concretas

1. No existe campo de correo electrónico del proveedor en `PurchaseRecord` ni control para capturarlo en el alta de compra.
2. El comprobante IVA no conserva actualmente el correo del proveedor como dato de emisión, aunque sí registra fecha y medio de entrega.
3. El comprobante ISLR carece de correo del proveedor, fecha de entrega, medio de entrega y acuerdo de entrega electrónica.
4. El comprobante ISLR no conserva una instantánea de los datos identificativos del agente; su modal consulta el objeto `Company` actual. Una modificación posterior del perfil podría cambiar una reimpresión histórica.
5. El correlativo ISLR vigente no coincide con el formato de catorce caracteres previsto para el régimen futuro.
6. No se ha demostrado todavía que los archivos de intercambio SENIAT actuales reflejen todos los campos del artículo 18 ni que el manual técnico vigente acepte el esquema generado.

## 5. Diseño de implementación propuesto

### Datos de origen

- Añadir `supplierEmail?` a `PurchaseRecord` como dato opcional.
- Capturarlo en `NewPurchaseModal`, sin inventarlo ni deducirlo del nombre/RIF.
- Validar sintaxis básica si se informa; permitir vacío mientras el requisito futuro no sea exigible y hasta que la revisión normativa defina la regla de transición aplicable.
- No sobrescribir compras antiguas ni rellenar correos ficticios.

### Instantánea de emisión

Añadir campos opcionales a los tipos de comprobante para conservar, al emitir, los datos que deben permanecer estables:
- correo del proveedor;
- nombre, RIF y domicilio fiscal del agente;
- fecha de emisión ya registrada;
- referencia al documento fuente ya existente.

El correo debe copiarse desde la compra fuente al comprobante al momento de emisión. La instantánea no debe actualizarse cuando posteriormente se edite el proveedor o la empresa.

### Registro de entrega

- Crear un flujo ISLR equivalente al flujo de entrega IVA.
- Guardar fecha efectiva y medio de entrega; si se registra medio electrónico, exigir constancia expresa de acuerdo con el proveedor.
- Impedir sobrescribir una entrega ya confirmada. Una corrección debe generar una incidencia/evento trazable, no mutar silenciosamente el registro.
- Esperar confirmación SQLite antes de mostrar éxito.
- Mostrar fecha y medio en la vista imprimible y permitir reimpresión con los datos históricos.
- Evaluar si el dato de entrega debe permanecer fuera del documento emitido originalmente o generar una copia/constancia de entrega, para no reescribir el comprobante ya emitido.

### Numeración

- No reescribir correlativos históricos.
- Antes de la fecha de vigencia, definir la fecha exacta de corte y la regla de transición con revisión normativa.
- Para comprobantes nuevos sujetos al artículo 18, usar un secuencial de ocho dígitos con año y mes, consecutivo conforme al formato y al ámbito de control que defina la norma y el manual técnico. No generalizar a todos los agentes la regla adicional de numeración única por agente prevista para los supuestos especiales enumerados al final del artículo 18.
- Añadir controles de unicidad, reinicio al superar el máximo, concurrencia y restauración de respaldo.
- No reutilizar automáticamente el correlativo IVA sin verificar que su ámbito de unicidad coincida con el de ISLR y con el agente emisor.

## 6. Pruebas obligatorias antes de cerrar la fase

1. Compra histórica sin correo: abre, guarda, exporta, importa e imprime sin cambios.
2. Compra nueva con correo válido: el correo queda en el comprobante IVA y/o ISLR correspondiente.
3. Edición posterior del correo del proveedor: no cambia la instantánea del comprobante ya emitido.
4. Edición posterior de razón social, RIF o domicilio del agente: no cambia la reimpresión histórica.
5. Entrega física ISLR: registra fecha y medio una sola vez.
6. Entrega electrónica ISLR sin acuerdo: se rechaza.
7. Entrega electrónica ISLR con acuerdo explícito: se persiste.
8. Fecha inválida o anterior a la emisión: se rechaza.
9. Error de SQLite: no se informa éxito ni se pierde el estado previo.
10. Reintento de entrega ya registrada: se rechaza sin mutación.
11. Respaldo antiguo sin los campos nuevos: se restaura sin migración destructiva.
12. Numeración ISLR de 14 caracteres, secuencia, unicidad, concurrencia y restauración.
13. Reimpresión del comprobante después de modificar datos maestros.
14. Exportaciones XML/TXT contrastadas con el manual técnico SENIAT aplicable, sin inventar columnas ni asumir que el formato legado es aceptado.

## 7. Condiciones de cierre

No declarar terminada esta adaptación hasta:
- cotejar el facsímil de la Gaceta y el manual técnico SENIAT vigente;
- implementar los campos y snapshots en IVA e ISLR;
- implementar y probar la entrega ISLR;
- definir y probar numeración futura y transición sin alterar históricos;
- completar pruebas SQLite, respaldo/restauración y reimpresión;
- validar profesionalmente la aplicabilidad de cada requisito.

Este documento es un diseño de auditoría, no una declaración de cumplimiento ni una modificación del comportamiento de producción.


## Correlativo ISLR de 14 dígitos — implementación en PR #95

- El código conserva el formato histórico ISLR antes del 19-04-2027 y genera seis dígitos AAAAMM más ocho dígitos correlativos desde la fecha de vigencia indicada.
- La secuencia se recupera desde el mayor correlativo de los comprobantes del período, no desde el número de registros; se bloquea al superar 99.999.999.
- No se renumeran comprobantes históricos ni se reinicia la secuencia ante desbordamiento.
- La implementación actual toma el período de `accountCreditDate`, siguiendo el período fiscal que usa el flujo ISLR existente. **Antes de declarar cumplimiento**, debe cotejarse con el manual técnico SENIAT si el AAAAMM debe referirse al período del evento fiscal o al mes de emisión material del comprobante, especialmente para emisiones tardías o registros retroactivos.
- Los tests unitarios están añadidos, pero no se han ejecutado con éxito en el HEAD actual; GitHub Actions falla antes de iniciar steps.
