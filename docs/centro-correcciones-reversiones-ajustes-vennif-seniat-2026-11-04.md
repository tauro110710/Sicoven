# Centro de Correcciones, Reversiones y Ajustes — diseño e implementación incremental

**Fecha:** 04/11/2026  
**Rama:** audit/contabilidad-vennif-fiscal-seniat-1.0.14  
**Estado:** primera entrada operativa de reversión desde Libro Diario; circuito integral en desarrollo.

## 1. Objetivo
El usuario autorizado debe localizar el documento o asiento origen, revisar relaciones, solicitar corrección y seguir el expediente. Cadena verificable: origen → causa → revisión → autorización → documento correctivo → asiento(s) → auxiliares → efecto fiscal documentado → soportes.

No todas las correcciones producen los mismos efectos. Revertir un asiento no equivale a anular factura, cancelar compra, devolver dinero, revertir inventario ni rectificar declaración.

## 2. Flujos obligatorios
### Antes de contabilizar o emitir
- Editar o descartar borradores que no hayan generado número fiscal, asiento, inventario, pago, retención ni otro efecto irreversible.
- Si ya existe numeración fiscal asignada, conservar número y aplicar el procedimiento de anulación exigible para el medio de emisión; nunca reciclar correlativos.
- Auditar creación, edición, descarte y emisión con actor y fecha/hora.

### Después de contabilizar
- Bloquear edición directa y borrado físico de documentos y asientos contabilizados.
- Exigir motivo, fecha efectiva, papel de trabajo y soportes.
- Para asiento manual sin submayores enlazados: previsualizar y registrar contra-asiento balanceado, enlazado al asiento fuente.
- Para compra/venta, banco/caja, retenciones, impuestos, nómina, inventario, anticipos y liquidaciones: ejecutar flujo especializado que concilie primero los efectos dependientes. Si falta contrapartida o fuente documental, bloquear y explicar.
- La corrección parcial requiere documento de ajuste parcial; no usar reversión total para simular una nota de crédito parcial.
- La sustitución genera documento nuevo con identificador propio y referencia explícita al reemplazado; nunca reutiliza número ni reescribe el original.

### Período cerrado y errores anteriores
- No permitir asientos retroactivos dentro de períodos cerrados.
- Diferenciar error del período corriente, cambio de estimación y error material de período anterior.
- Evaluar errores anteriores conforme a NIC 8 / sección equivalente VEN-NIF aplicable, materialidad y marco GE/PYME adoptado. El AIA no debe aplicarse automáticamente a todo asiento antiguo.
- Exigir análisis profesional, fecha de detección, período afectado, materialidad, cuenta patrimonial apropiada cuando corresponda, aprobador y revelación. Reexpresión o ajuste de resultados acumulados depende del marco aplicable y de naturaleza/materialidad del error.

## 3. Expediente funcional
1. Bandeja por empresa, fecha, documento, asiento, estado, tipo y responsable.
2. Detalle del origen: documento, asientos, Kardex, caja/banco, CxC/CxP, retenciones, declaraciones, pagos y soportes.
3. Solicitud: categoría, causa, fecha de detección, fecha efectiva propuesta, importe y alcance total/parcial.
4. Análisis de impacto: simulación Debe/Haber Bs./USD, inventario/costos, auxiliares, conciliación bancaria y efectos fiscales identificados.
5. Aprobación segregada entre preparador y aprobador según rol/materialidad.
6. Ejecución atómica SQLite de documento correctivo y asientos enlazados.
7. Cierre documental: soportes, referencia externa, acuse/recibo, declaración y pago; estado de gestión no significa aceptación automática del SENIAT.

## 4. Integridad no negociable
- Append-only para documentos emitidos, asientos contabilizados, eventos y snapshots fiscales.
- No UPDATE/DELETE de historia económica; agregar eventos compensatorios.
- Toda referencia debe pertenecer a la misma empresa y existir.
- Idempotencia: reintentos no crean contra-asientos ni movimientos duplicados.
- Un asiento fuente admite una reversión total; correcciones parciales se modelan como ajustes separados.
- Contra-asiento balanceado en cada moneda; validar redondeo y tasa/snapshot de origen.
- No reversar un contra-asiento como si fuera origen; nueva corrección debe enlazarse.
- Respetar períodos cerrados, secuencias fiscales, conciliaciones y dependencias.
- Persistencia confirmada en SQLite antes de mostrar éxito; fallo no puede dejar estado parcial.
- Auditoría con usuario/rol, fecha/hora, empresa, acción, entidad, IDs origen/destino, motivo, papel de trabajo y resultado.

## 5. Normativa venezolana y límites
### Documentos fiscales
La Providencia SNAT/2011/00071 regula facturas y otros documentos; sus artículos 22–24 contemplan notas de débito/crédito cuando la operación queda sin efecto o se ajusta, con referencia al documento que soportó la operación. Sus artículos 36, 41 y 42 sustentan conservación y prohibición de alterar datos emitidos. La aplicación exacta debe cotejarse con norma vigente y medio autorizado.

La Providencia SNAT/2026/00093 (Gaceta Oficial 43.484) establece en su artículo 12 que las notas de débito/crédito se emiten por el mismo medio utilizado en la factura modificada y deben referenciar datos de la factura original. La vigencia general indicada en el expediente de auditoría es 19-04-2027; antes de esa fecha no adelantar su aplicación.

### VEN-NIF
- Distinguir período corriente y anteriores, error material, cambio de estimación y política.
- Aplicar el texto VEN-NIF adoptado por la entidad (GE o PYME), BA VEN-NIF vigente y versión incorporada al marco venezolano; no asumir adopción automática de toda norma NIIF internacional.
- AIA, reexpresión y revelaciones requieren validación de contador público colegiado para el caso concreto.

### Código Orgánico Tributario

El Código Orgánico Tributario publicado en Gaceta Oficial N° 6.507 Extraordinario (29-01-2020) debe ser considerado en el circuito fiscal. Su artículo 27 establece la responsabilidad del agente por los importes retenidos/percibidos y contempla, bajo sus supuestos, la solicitud de reintegro o compensación cuando se enteró una retención efectuada sin base legal. El artículo 195 regula la presentación de declaración omitida o rectificación de la presentada dentro de los quince días hábiles siguientes a la notificación de un Acta de Reparo. **Ese artículo no debe convertirse en una regla genérica de rectificación voluntaria automática dentro del software**: el flujo debe identificar el procedimiento legal concreto aplicable al tributo y situación.

### Retenciones y declaraciones
- Una reversión contable no elimina comprobante de retención, no deshace enteramiento ni rectifica declaración.
- Si documento fue declarado o pagado, conservar snapshot, período, acuse, pago/conciliación y decisión fiscal. No calcular reintegro/compensación ni marcar resuelto sin procedimiento y fuente primaria vigente.
- Mantener bloqueada presentación si existen comprobantes con corrección fiscal pendiente, hasta registrar tratamiento y soportes conforme a normativa aplicable.

## 6. Implementado en esta entrega
- Se incorpora JournalReversalModal en Libro Diario y acción contextual Reversar asiento para asientos fuente no reversados.
- Se habilita el mismo flujo desde Libro de Compras y Libro de Ventas: el botón Anular localiza el asiento de origen y abre el expediente de reversión; no ejecuta borrado ni reversión directa.
- Solicita fecha efectiva, motivo y papel de trabajo; para asientos de períodos cerrados solicita cuenta de resultados acumulados y usa el flujo AIA existente.
- Reutiliza reverseJournalEntry en AccountingContext: valida empresa, SQLite, duplicidad, fecha, período, dependencias, cuadre bimonetario y conciliación bancaria. Para facturas vinculadas, conserva importes/documento fuente y registra indicadores de anulación con el ID del contra-asiento; actualiza los estados de liquidaciones vinculadas y marca comprobantes de retención con corrección fiscal pendiente cuando corresponde.
- Contra-asiento conserva reversalOfEntryId, motivo y papel de trabajo. El asiento original no se reescribe; la UI deriva la relación buscando el contra-asiento enlazado. Se reconocen vínculos reversedByEntryId heredados solo por compatibilidad.
- Excluye contra-asientos y asientos ya reversados.

## 7. Pendientes antes de declarar completo
1. Expediente único de corrección con estados, permisos y aprobación segregada.
2. Edición/descarte seguro de borradores antes de contabilizar o emitir.
3. Sustitución de documentos con vínculo al original.
4. Correcciones parciales por documento.
5. NC/ND de ventas y NC de compras de servicios/sin líneas de inventario, con efectos completos en auxiliares, Kardex cuando aplique, caja/banco, CxC/CxP e impuestos. La reversión total existente no sustituye la emisión fiscal de NC/ND.
6. Devolución de compras contado conciliada contra salida de fondos o saldo a favor.
7. Rectificación fiscal conectada a declaración, comprobante, enteramiento y acuse; sin reglas fiscales supuestas. La incidencia IVA actual es solo expediente de revisión/actuación, no ejecuta rectificación ni determina reintegros.
8. Matriz de permisos, doble aprobación y límites por materialidad.
9. Auditoría de backup/restore y persistencia SQLite.
10. Pruebas de integración: duplicados, idempotencia, períodos cerrados, multiempresa, referencias faltantes, fallos de persistencia, Bs./USD, bancos, inventario y retenciones.
11. Se agregan pruebas unitarias para verificar que construir un contra-asiento no muta el asiento fuente y rechaza asientos que no cuadran en ambas monedas.
12. Incorporar autorización por roles y doble control real en backend; los formularios actuales solicitan motivo y papel de trabajo, pero todavía no implementan una matriz de aprobaciones ni segregación efectiva de funciones.

## 8. Criterio de aceptación
No declarar completa esta capacidad hasta que cada tipo documental con efecto contable tenga ruta especializada, la cadena pueda reconstruirse desde origen hasta documento/contra-asiento y evidencia fiscal, las pruebas de integridad/persistencia estén verdes y la normativa haya sido cotejada con fuentes primarias. Esta entrega abre la reversión desde la UI, pero no afirma que todos los flujos de corrección fiscal/documental estén terminados.

## 8. Revisión adicional de seguridad de auxiliares — 04/11/2026

### Hallazgo corregido
- El auxiliar de cobros/pagos ya bloqueaba en la capa de dominio una factura marcada como reversada mediante `getCreditBalance`, pero los Libros de Ventas y Compras todavía mostraban el botón Cobrar/Pagar en esas filas.
- Al abrir el modal, el cálculo de saldo podía lanzar el bloqueo durante el renderizado, generando una experiencia inconsistente.
- Se ocultó la acción de liquidación para facturas reversadas en ambos libros. La restricción del dominio permanece como defensa adicional; no se reactivan cobros ni pagos sobre documentos reversados.
- Cambios en `LibroVentasView.tsx` y `LibroComprasView.tsx`.

### Límites confirmados en código
- `addSale` rechaza expresamente documentos de venta tipo 02/03; el formulario no constituye una implementación de notas de débito/crédito aunque exponga el tipo documental en su estado local.
- `addPurchase` también rechaza documentos de compra tipo 02/03.
- La nota de crédito de proveedor implementada exige líneas de inventario y conciliación completa factura → Kardex → asiento; por tanto, no cubre compras de servicios sin inventario.
- El preflight de reversión bloquea facturas de compra con notas de crédito hijas y evita la reversión genérica de una nota de crédito de proveedor.
- No se debe habilitar un selector de NC/ND hasta que exista un flujo que cree documento fiscal correlativo, valide referencia original, calcule base/IVA/retenciones/IGTF, actualice CxC/CxP, gestione devolución o reintegro y contabilice en ambas monedas de forma atómica.

### Pendientes que siguen siendo bloqueantes
1. Notas de crédito y débito de ventas, incluyendo servicios, ventas a crédito/contado, cobros previos, devolución de inventario y efecto sobre IVA/IGTF.
2. Notas de crédito de compras de servicios sin inventario, con tratamiento separado para CxP, pagos ya ejecutados, retenciones y eventuales saldos a favor del proveedor.
3. Expediente de rectificación fiscal enlazado a declaraciones, comprobantes, enteramientos, acuses y pagos; un indicador `requiresFiscalCorrection` no equivale a rectificación presentada.
4. Segregación de funciones y doble aprobación aplicada en backend/SQLite, no solo en la interfaz.
5. Pruebas automatizadas de persistencia atómica, fallo SQLite, restauración y reportes sobre documentos reversados.

**Estado:** la reversión general y los controles de cobro/pago sobre documentos reversados tienen avances implementados, pero las correcciones fiscales parciales y las notas de venta/servicios no están terminadas. No declarar la Fase 5 completa ni aptitud SENIAT por esta entrega.


### Pruebas de idempotencia de reversión — 04/11/2026
- Se añadieron pruebas unitarias que simulan un asiento fuente con un contra-asiento enlazado y verifican que la segunda reversión quede bloqueada.
- Se añadió una prueba que verifica que un contra-asiento no puede seleccionarse como documento fuente para una nueva reversión genérica.
- Estas pruebas cubren la evaluación de dominio `assessJournalReversal`; no sustituyen una prueba de concurrencia real de dos solicitudes simultáneas contra SQLite ni una prueba de persistencia/restore.
- Las pruebas fueron incorporadas al repositorio, pero no se han ejecutado correctamente en CI por el bloqueo externo de GitHub Actions. No se declara resultado verde.


### Persistencia local y ventas contado — revisión 04/11/2026
- Se detectó que las funciones de dominio `addPurchase` y `addSale` no comprobaban el estado de la persistencia antes de aceptar una nueva factura, a diferencia de otros circuitos contables.
- Se incorporó una guarda en ambas funciones: si la persistencia SQLite reportó un fallo o la instancia de escritorio todavía no está lista, el alta se rechaza con error explícito. El cambio no convierte LocalStorage/caché en autoridad ni permite continuar sin SQLite cuando el almacén de escritorio está presente.
- Hallazgo pendiente que bloquea el diseño de NC/ND de ventas: el formulario deshabilita la opción Contado y `validateSaleSettlementMode` también la rechaza en `addSale`, porque el asiento de ventas aún no identifica la cuenta de caja/banco receptora. Por tanto, actualmente solo se permite registrar ventas a crédito; no se genera una CxC ficticia para una venta contado.
- Para habilitar ventas contado en el futuro se requiere añadir cuenta/medio/referencia de cobro, validar una cuenta de activo imputable, contabilizar el ingreso en la cuenta elegida y conservar el origen del cobro para devoluciones/reembolsos. No se debe convertir una factura contado en CxC ni generar reembolsos ficticios.
- SICOVEN es una aplicación de escritorio cuya persistencia operativa es SQLite local. La validación pertinente para estos cambios es pruebas de dominio, integración con el almacén SQLite de escritorio, restauración de respaldos y build/paquete de escritorio; no requiere despliegues web.


### Endurecimiento de escritura SQLite — continuación
- Se endurecieron las guardas de `addPurchase`, `addSale`, `addPurchaseCreditNote` y `addSupplierDebitNote`: las cuatro operaciones ahora exigen que exista el puente `window.sicovenStore.save`, que `storageReady` sea verdadero y que no exista un fallo de persistencia.
- Antes, la condición permitía continuar si `window.sicovenStore` no existía; ese comportamiento no es aceptable para el producto de escritorio y podía aceptar cambios sin el almacén local.
- La guarda se ejecuta antes de validar o mutar documentos y bloquea explícitamente si la instancia SQLite de escritorio no está lista.
- Este cambio no acredita todavía atomicidad de toda la operación ni reemplaza pruebas de integración del puente Electron/SQLite. Deben verificarse rollback ante fallo intermedio, persistencia de documento+asiento+auxiliares y restauración de backup en una instalación de escritorio.



### Confirmación de persistencia en formularios — revisión posterior a la fusión

- Se comprobó que el proceso de guardado de escritorio no persiste documento, asiento y auxiliares en escrituras SQLite separadas: `persistAccountingSnapshot` valida el snapshot completo y escribe el estado contable y sus eventos de auditoría dentro de una única transacción `better-sqlite3`. Si falla la validación o una inserción de auditoría, la transacción revierte también la actualización de `app_state`.
- `electron/accounting-integrity.test.cjs` ya contiene una prueba de integración que provoca deliberadamente un fallo de auditoría, comprueba que el snapshot anterior permanece intacto, luego guarda correctamente y reabre el archivo SQLite para verificar la nota de crédito, Kardex, asiento y correcciones de retención enlazadas. La prueba está en el repositorio; no se declara ejecutada en esta sesión.
- Se detectó una brecha de interfaz: los formularios de compra, venta y asiento manual cerraban inmediatamente después de actualizar el estado React, sin esperar la respuesta de SQLite. Ahora esperan `waitForPersistence()` antes de cerrar y muestran el estado “Confirmando SQLite...”; también bloquean el doble envío y el cierre manual mientras la confirmación está pendiente.
- El alta de asientos manuales ahora exige el puente `window.sicovenStore.save`, `storageReady` y ausencia de fallo previo, igual que las operaciones de factura y devolución.
- Si SQLite rechaza un snapshot, el proveedor marca la persistencia como fallida y bloquea nuevas escrituras. El estado visual en memoria no se revierte automáticamente después de un fallo asíncrono; se requiere reiniciar SICOVEN para volver a hidratar el último snapshot confirmado. Esto evita seguir operando con datos no confirmados, pero sigue siendo un punto de mejora de experiencia y recuperación.
- La atomicidad demostrada es la del snapshot completo y su ledger de auditoría en una transacción SQLite. No equivale todavía a una transacción por tablas relacionales independientes, ni demuestra concurrencia real de dos operaciones de negocio simultáneas.
- Se añadió un cerrojo compartido en el proveedor para impedir que una nota de crédito de proveedor, una nota de débito de proveedor y una reversión genérica se ejecuten concurrentemente. El bloqueo se mantiene hasta que la promesa de persistencia SQLite finaliza y se libera en `finally`, incluso cuando la operación falla.
- Este cerrojo evita carreras entre esos tres circuitos de corrección; no sustituye una prueba de estrés de concurrencia del proceso Electron ni bloquea todas las demás operaciones contables ordinarias.

- Se reforzó la prueba de rollback SQLite: ahora el trigger simulado falla en la inserción final `state_saved`, que ocurre después del `UPSERT` de `app_state`. La expectativa es que la transacción revierta tanto el snapshot ya actualizado como los eventos de auditoría insertados previamente. Prueba incorporada; ejecución pendiente.



### Tesorería y conciliación: confirmación SQLite — revisión posterior

- Se detectó la misma brecha de confirmación en operaciones bancarias: alta de cuenta/auxiliar, movimiento del extracto, ingreso/egreso/transferencia de tesorería y asiento de ajuste desde conciliación podían mostrar éxito antes de que el snapshot SQLite terminara.
- Los formularios de alta bancaria y movimiento de extracto ahora esperan `waitForPersistence()` antes de limpiar/cerrar, bloquean doble envío y bloquean sus controles de cierre durante la confirmación.
- Tesorería solo muestra “SQLite confirmó...” después de guardar el asiento; la conciliación bancaria muestra éxito del ajuste solo después de persistir conjuntamente asiento y vínculo de conciliación.
- `addBankAccount` y `addBankStatementMovement` ahora rechazan operaciones si falta el puente de SQLite, la base no está lista o ya existe un fallo de persistencia.
- Las operaciones se guardan como parte del snapshot contable transaccional. No se ejecutaron `npm test`, `npm run check:types` ni `npm run build` en esta sesión; la prueba automatizada sigue pendiente por la limitación del runner de GitHub Actions.


### Tesorería y conciliación bancaria — confirmación SQLite

- El alta de cuentas bancarias y de movimientos de extracto exige el puente SQLite local, estado listo y ausencia de fallo previo.
- Los formularios de cuenta bancaria y movimiento de extracto esperan `waitForPersistence()` antes de cerrarse; bloquean doble envío y cierre mientras SQLite confirma.
- El registro de movimientos contables de tesorería espera confirmación antes de informar el número del asiento como guardado.
- La creación de ajustes desde la conciliación bancaria espera confirmación SQLite antes de mostrar éxito.
- El cotejo manual, la desconciliación individual, la desconciliación masiva y la conciliación automática esperan la confirmación cuando realmente producen cambios.
- Se evita esperar un snapshot cuando la conciliación automática no encuentra coincidencias y no modifica registros, para no dejar el formulario en espera indefinida.
- Los métodos de dominio de tesorería y conciliación también rechazan operaciones si SQLite no está disponible, aunque se invoquen desde otro componente.
- La interfaz serializa las operaciones de conciliación y evita dobles acciones durante el guardado.
- Validación de esta continuación: revisión estática de los archivos y de los contratos de persistencia; no se ejecutó compilación ni pruebas automatizadas. La confirmación real en SQLite debe verificarse con la aplicación de escritorio y su archivo de base de datos.

### Catálogo, empresa, BCV, inventario y clasificación del flujo de efectivo

- Se centralizó `assertSQLitePersistenceReady` para bloquear escrituras sin el puente `window.sicovenStore.save`, con SQLite no inicializada o después de un fallo de persistencia.
- Se aplicó al alta/actualización de empresa, registro de cuentas contables, actualización manual de tasa BCV, alta/edición de artículos, anticipos y liquidaciones a proveedores, cobros/pagos, declaraciones y eventos de retención IVA, y registro de entrega de comprobantes IVA/ISLR.
- La clasificación de cuentas para flujo de efectivo (método directo e indirecto) también exige SQLite.
- Los formularios de empresa, BCV, artículo, movimiento de inventario y catálogo contable ahora esperan `waitForPersistence()` antes de cerrar o informar éxito; bloquean doble envío y cierre mientras se guarda.
- La edición de parámetros de empresa y expedientes NIC 21/convertibilidad espera la confirmación SQLite antes de mostrar el mensaje de guardado exitoso.
- Se conserva el modelo de snapshot completo y transacción SQLite ya documentado. Las modificaciones del estado React no se revierten automáticamente si la escritura falla; el proveedor bloquea nuevas escrituras y el reinicio vuelve a hidratar el último snapshot confirmado.
- La revisión estática identificó además que el módulo de configuración y catálogo contable no deben considerar el estado React como confirmación de persistencia. Los cambios anteriores eliminan esa señal prematura.
- No se certifica todavía el flujo de edición de artículos desde interfaces no localizadas ni se afirma que todos los formularios de importación/migración hayan sido sometidos a pruebas de integración.

- Se aplicó el mismo requisito estricto de SQLite a cierre/reapertura de períodos y asiento de apertura anual; el cierre y la apertura esperan la confirmación persistente antes de terminar.
- Se revisaron anticipos directos, liquidaciones de anticipos, cobros/pagos, creación de declaraciones de retención IVA, eventos de declaración y entregas de comprobantes IVA/ISLR: sus funciones de dominio ahora usan la guarda común y sus operaciones asíncronas esperan el snapshot confirmado antes de devolver éxito.
- Las clasificaciones del Estado de Flujos de Efectivo (método directo e indirecto) también rechazan la modificación sin SQLite y sus formularios ya esperan confirmación.

### Catálogo, empresa, BCV, inventario y clasificación del flujo de efectivo

- Se centralizó `assertSQLitePersistenceReady` para bloquear escrituras sin el puente `window.sicovenStore.save`, con SQLite no inicializada o después de un fallo de persistencia.
- Se aplicó al alta/actualización de empresa, registro de cuentas contables, actualización manual de tasa BCV, alta/edición de artículos, anticipos y liquidaciones a proveedores, cobros/pagos, declaraciones y eventos de retención IVA, y registro de entrega de comprobantes IVA/ISLR.
- La clasificación de cuentas para flujo de efectivo (método directo e indirecto) también exige SQLite.
- Los formularios de empresa, BCV, artículo, movimiento de inventario y catálogo contable ahora esperan `waitForPersistence()` antes de cerrar o informar éxito; bloquean doble envío y cierre mientras se guarda.
- La edición de parámetros de empresa y expedientes NIC 21/convertibilidad espera la confirmación SQLite antes de mostrar el mensaje de guardado exitoso.
- Se conserva el modelo de snapshot completo y transacción SQLite ya documentado. Las modificaciones del estado React no se revierten automáticamente si la escritura falla; el proveedor bloquea nuevas escrituras y el reinicio vuelve a hidratar el último snapshot confirmado.
- La revisión estática identificó además que el módulo de configuración y catálogo contable no deben considerar el estado React como confirmación de persistencia. Los cambios anteriores eliminan esa señal prematura.
- No se certifica todavía el flujo de edición de artículos desde interfaces no localizadas ni se afirma que todos los formularios de importación/migración hayan sido sometidos a pruebas de integración.
- Se aplicó el mismo requisito estricto de SQLite a cierre/reapertura de períodos y asiento de apertura anual; el cierre y la apertura esperan la confirmación persistente antes de terminar.
- Se revisaron anticipos directos, liquidaciones de anticipos, cobros/pagos, creación de declaraciones de retención IVA, eventos de declaración y entregas de comprobantes IVA/ISLR: sus funciones de dominio ahora usan la guarda común y sus operaciones asíncronas esperan el snapshot confirmado antes de devolver éxito.
- Las clasificaciones del Estado de Flujos de Efectivo (método directo e indirecto) también rechazan la modificación sin SQLite y sus formularios ya esperan confirmación.

### Reinicios y restauración de respaldos

- Se cerró una vía adicional de escritura no confirmada: el importador JSON de bajo nivel dejó de exponerse directamente por el contexto; solo se utiliza internamente desde la restauración controlada, que valida, persiste y revierte a la copia previa si SQLite rechaza el snapshot.
- Los restablecimientos de datos de muestra y de fábrica ahora exigen el puente SQLite y esperan la confirmación del nuevo estado vacío. La interfaz no informa éxito antes de la confirmación.
- La restauración de respaldo también exige SQLite local antes de aplicar cambios y conserva su recuperación del snapshot previo ante fallo de persistencia.
