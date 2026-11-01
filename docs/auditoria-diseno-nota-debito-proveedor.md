# Auditoría técnica y diseño de control — Nota de débito de proveedor (tipo 02)

**Estado: diseño documentado; implementación bloqueada.**  
**Alcance:** compras y Libro de Compras de SICOVEN. Esta especificación no declara una interpretación tributaria ni habilita el registro de notas de débito.

## 1. Resultado de la auditoría del código actual

Archivos inspeccionados en `main`:

- `src/components/LibroCompras/NewPurchaseModal.tsx`
- `src/types/accounting.ts`
- `src/context/AccountingContext.tsx`
- `src/components/LibroCompras/LibroComprasView.tsx`
- `electron/accounting-integrity.cjs`
- `electron/accounting-integrity.test.cjs`

Hallazgos verificables:

1. El modelo `PurchaseRecord` admite el discriminante `documentType: '01' | '02' | '03'`, los campos `debitNoteNumber` y `affectedInvoiceNumber`. Que el tipo exista en TypeScript no significa que el flujo esté implementado.
2. El selector de `NewPurchaseModal` muestra el tipo 02 deshabilitado y lo identifica expresamente como flujo contable pendiente. También mantiene deshabilitado el tipo 03 para el alta genérica, que debe tramitarse por el flujo especializado de devolución.
3. `AccountingContext.addPurchase` rechaza en la capa de dominio todo documento cuyo tipo no sea 01. La protección evita que una ND se contabilice accidentalmente como una factura ordinaria positiva.
4. La integridad SQLite rechaza nuevas notas que no sean factura 01 o nota de crédito 03. El control de asientos genérico está diseñado alrededor de facturas 01; no existe un validador integral específico de ND.
5. La vista del Libro de Compras reconoce visualmente el prefijo ND para registros que ya existan, pero esa presentación no proporciona creación, cálculo, asiento ni validación.
6. El tipo de documento por sí solo no distingue si la ND incrementa mercancía, corrige precio, incorpora gastos, intereses u otro concepto. No debe inferirse el hecho económico a partir del número o del tipo 02.

**Conclusión:** el bloqueo actual es deliberado y correcto. No habilitar el selector ni retirar las defensas de dominio/SQLite como arreglo aislado.

## 2. Principio de diseño

La nota de débito es un documento relacionado que incrementa o ajusta un importe asociado a una operación anterior, pero su efecto contable concreto depende de la causa documentada y de la situación de la factura original. El sistema debe registrar el documento fuente, la relación y la decisión contable del profesional; no debe asumir automáticamente que todo importe aumenta inventario, IVA crédito fiscal o CxP.

El flujo debe ser separado del alta genérica de factura y no debe reutilizar `addPurchase` sin un contrato específico.

## 3. Datos mínimos propuestos

Una entidad específica de ND de proveedor (o una extensión tipada inequívoca de `PurchaseRecord`) debe conservar, como mínimo:

- Identidad inmutable: ID, empresa, proveedor/RIF, número de ND, número de control, fecha de emisión y fecha efectiva de reconocimiento cuando corresponda.
- Referencia obligatoria a la factura de compra original mediante ID interno, además del número documental afectado conservado como dato de origen.
- Evidencia del documento: origen/medio de recepción, descripción de la causa y referencia de soporte; adjuntar archivo no debe ser obligatorio para cada operación.
- Clasificación económica explícita elegida y justificada por el contador: diferencia de precio, gasto/cargo adicional, interés/financiamiento, ajuste de cantidad/mercancía u otra categoría controlada. No inferirla por texto libre.
- Importes en Bs. y USD, tasa BCV histórica usada y método de redondeo, sin sobrescribir los importes originales de la factura.
- Desglose separado de base imponible, exento, alícuota(s), IVA, IGTF y retenciones únicamente cuando el contador haya determinado que aplican y los parámetros estén verificados. Una sola tasa no debe forzar documentos con alícuotas mixtas.
- Estado de pago de la factura original, saldo CxP previo, saldo posterior y aplicación de anticipos, si la decisión contable lo requiere.
- Enlaces a asiento, eventos/comprobantes fiscales e incidencias relacionadas; conservar los IDs y versiones de origen.
- Auditoría append-only: autor, fecha de registro, decisión, justificación y cualquier revisión posterior.

Los datos originales de la factura y sus asientos no se modifican. La ND se registra como un evento documental separado y trazable.

## 4. Tratamiento contable: reglas que deben resolverse por caso

No codificar una contrapartida universal. El flujo debe pedir la causa económica y una clasificación contable aprobada por el contador:

- **Cargo que aumenta el costo de mercancía:** solo podrá afectar inventario/costo si el documento y el hecho acreditan que el cargo forma parte del costo de adquisición y se puede asignar de manera verificable a artículos/capas existentes. No crear cantidades ni entradas ficticias de Kardex por una diferencia monetaria.
- **Gasto o servicio adicional:** se debe reconocer en la cuenta de gasto/costo correspondiente, no en inventario por defecto.
- **Intereses o financiamiento:** mantener separados del costo de mercancía y someter la cuenta, período y tratamiento fiscal a decisión profesional.
- **Factura original pendiente:** cualquier aumento de la obligación debe quedar conciliado con la cuenta auxiliar real del proveedor y el saldo pendiente, sin reemplazar el asiento original.
- **Factura original pagada:** el sistema no debe simular una salida de caja ni crear un pago. Debe determinarse si nace una obligación adicional con el proveedor, si existe un anticipo aplicable o si se requiere otro tratamiento documentado. La aplicación de un anticipo exige una operación separada, con saldo disponible y trazabilidad.
- **Devolución, descuento o reducción:** no tramitar como ND; revisar si corresponde al flujo de NC u otro documento.

La aplicación concreta, incluso la cuenta contable, queda sujeta al plan de cuentas de la empresa y a la revisión del contador. No se fijan códigos de cuenta por suposición.

## 5. Kardex: solo cuando exista movimiento físico o ajuste de costo demostrable

- Una ND exclusivamente monetaria no genera movimiento de cantidad.
- Una diferencia de precio/costo sin cambio de cantidad requiere un mecanismo explícito de ajuste de costo, con referencia a las capas/movimientos afectados y cálculo del costo promedio/PEPS según el método configurado. No debe inventarse una entrada o salida física.
- Una cantidad adicional realmente recibida requiere documento y líneas de mercancía, control de duplicados, fecha cronológica, cantidades/costos y entrada de Kardex conciliada con el asiento.
- Si el método de costeo no puede reproducir el ajuste o las capas históricas no están disponibles, se bloquea la automatización y se deriva a revisión manual documentada.

## 6. Salvaguardas obligatorias en dominio y SQLite

Antes de habilitar el tipo 02, las validaciones deben cubrir:

1. Empresa activa y aislamiento estricto de factura, proveedor, cuentas, productos, movimientos, asiento y expediente.
2. Factura original existente, tipo 01, no anulada, mismo proveedor y empresa; coincidencia exacta entre ID de origen y número afectado.
3. Unicidad del número de ND por empresa/proveedor (normalización definida y probada); no permitir reutilización ni doble importación.
4. Fecha válida, relación cronológica razonable con la factura y bloqueo de períodos cerrados.
5. Importes finitos, no negativos y positivos donde corresponda; conciliación de desglose y total; Bs./USD coherentes con la tasa histórica almacenada.
6. Asiento nuevo, balanceado en Bs. y USD, empresa/fecha/referencia correctas y contrapartidas compatibles con el motivo seleccionado.
7. Saldo de CxP y anticipos conciliados; no permitir reducción o aumento que produzca saldos imposibles ni pagos ficticios.
8. Kardex solo cuando aplique, con integridad de cada línea y del método de costo; no aceptar movimientos sin ND o ND con movimientos huérfanos.
9. Retenciones y comprobantes: no generar comprobantes ni alterar comprobantes originales por inferencia. Cualquier efecto debe estar habilitado por regla primaria vigente, disparador fiscal y decisión documentada. Si no se puede determinar, bloquear esa parte del flujo.
10. Enlace al expediente de incidencia IVA cuando exista una declaración, comprobante o pago relacionado; el expediente no cambia el tratamiento fiscal.
11. Idempotencia, protección contra doble envío y persistencia de toda la operación en una única transacción SQLite.
12. Append-only de documento, referencias y eventos; correcciones posteriores mediante nuevos eventos/asientos vinculados, nunca reescritura de la fuente.

La validación debe residir tanto en el contexto de dominio como en `electron/accounting-integrity.cjs`; la interfaz no es una frontera de seguridad.

## 7. Pruebas de aceptación antes de activar el tipo 02

- ND válida por diferencia monetaria sin inventario: asiento balanceado y sin movimiento de Kardex.
- ND por mercancía adicional realmente recibida: entrada física exacta y asiento conciliado.
- Ajuste de costo sin cambio de cantidad: capas/costo recalculados con el método soportado, o rechazo seguro si no puede probarse.
- Factura a crédito con saldo pendiente, factura totalmente pagada y factura parcialmente pagada.
- Anticipo del proveedor disponible, insuficiente, ya consumido y aplicación duplicada.
- Proveedor distinto, factura de otra empresa, factura inexistente, factura anulada y número de ND duplicado.
- Fecha inválida, período cerrado, secuencia temporal de Kardex incorrecta y tasa histórica ausente.
- IVA con alícuota única, mixta, exento y sin IVA, solo en escenarios cuya regla haya sido validada; retención IVA/ISLR con evento fiscal y comprobante correctamente vinculados o bloqueo seguro.
- Declaración IVA no presentada, presentada sin enteramiento, con enteramiento parcial y total; no alterar snapshots ni eventos históricos.
- Fallos a mitad de transacción, doble clic, repetición IPC y reinicio; no debe quedar asiento, ND o movimiento huérfano.
- Migración/lectura de bases existentes sin modificar datos históricos.
- Aislamiento multiempresa y validación de manipulación directa del snapshot.
- Prueba real de instalación/actualización SQLite en Windows, sin publicar release.

## 8. Condiciones de salida del bloqueo

El tipo 02 seguirá deshabilitado hasta que se cumplan todas:

- contrato de datos y clasificación económica aprobados;
- tratamiento contable revisado por profesional;
- reglas tributarias respaldadas por fuente primaria vigente o marcadas expresamente como no automatizadas;
- implementación especializada UI + dominio + IPC/SQLite;
- pruebas automatizadas y casos SQLite de manipulación negativa;
- CI de escritorio e instalador Windows SUCCESS;
- revisión de que el administrador semilla no cambió.

No se considera terminado por compilar, por mostrar ND en el libro ni por guardar un registro genérico. No se publica instalador/release sin autorización expresa.

## 9. Decisiones pendientes que no deben resolverse por inferencia

- Catálogo de causas y evidencia mínima de cada tipo de cargo.
- Tratamiento exacto de cargos que alteran costo de inventario y de diferencias de precio sin cantidad.
- Efecto de ND sobre retención IVA/ISLR y comprobantes emitidos previamente.
- Disparador y fecha fiscal aplicable a cada supuesto.
- Tratamiento de documentos con varias alícuotas, exenciones o retenciones.
- Reglas de presentación/libro fiscal y formato TXT vigente.
- Cuentas contables concretas según plan de cuentas y política de la empresa.

**Conclusión:** SICOVEN conserva el bloqueo preventivo. La siguiente implementación debe ser un flujo específico de ND, con decisiones explícitas y trazabilidad, no una habilitación del formulario genérico.
