# Plan de migración a SQLite local por empresa

Este documento desarrolla la ADR de SQLite local por empresa. No habilita todavía el modo multiarchivo en producción. La aplicación continúa usando la base local heredada hasta completar todas las fases y superar las pruebas de actualización y restauración.

## Estado de la implementación de la base técnica

- Gestor local de bases: creado y probado en la rama de trabajo.
- Identidad interna y versión de esquema por archivo: creadas y probadas.
- Inicializador del esquema operativo por empresa: creado.
- Partición y unión de snapshots: creadas y probadas.
- Integración con el arranque Electron, los IPC, el contexto React y el backup/restore: pendiente.
- Migración de la base heredada: pendiente.
- Separación conservadora de auditoría: helper creado en `electron/tenant-audit-migration.cjs`; asigna eventos únicamente por coincidencia exacta de `details_json.companyId`. Eventos globales, malformados o con empresa desconocida permanecen en control y se reportan como no resueltos.
- Copia relacional auxiliar: helper creado en `electron/tenant-relational-migration.cjs`; replica referencias globales de índices y copia tablas de empresa y sus hijos por relaciones explícitas, dentro de una transacción y con comprobación de claves foráneas.
- Copia de documentos físicos: helper creado en `electron/tenant-document-migration.cjs`; valida clave, archivo regular, tamaño y SHA-256, crea el destino sin sobrescribir archivos y revierte los archivos creados por el lote si falla una validación.
- Estos tres helpers tienen pruebas unitarias, pero aún no están conectados a un orquestador de migración ni al arranque Electron. No habilitan ni ejecutan una migración por sí solos.
- Inventario previo estricto: helper creado en `electron/tenant-migration-preflight.cjs`; clasifica tablas de control, snapshot, auditoría, referencias globales, tablas de empresa e hijas. Bloquea la migración si aparece una tabla persistente desconocida, falta una tabla crítica, el snapshot no es único/válido o existen empresas/RIF ambiguos.
- El preflight es de solo lectura y no activa la nueva arquitectura. Su lista de clasificación debe mantenerse sincronizada con cada nueva tabla persistente que se incorpore al producto.
- Journal durable: helper creado en `electron/tenant-migration-journal.cjs`; guarda las fases PREPARED/STAGING/VALIDATING/REGISTERING/COMMITTED y los estados de rollback/error mediante escritura atómica y sincronización a disco. Verifica el SHA-256 del backup de origen, bloquea journals duplicados y transiciones obsoletas, y no reinicia automáticamente un journal dañado.
- El journal y el preflight aún son componentes aislados: todavía no existe un ejecutor que cree el backup SQLite consistente, copie cada empresa, valide los archivos y registre el conjunto de bases de forma coordinada.
- No se ha fusionado ni activado el modo multiarchivo en main.

## Archivos locales

userData/
- sicoven.sqlite: auth_users, auth_sessions, license_state, company_database_registry y app_control_state.
- companies/<company-id>/accounting.sqlite: datos contables y operativos de esa empresa.
- companies/<company-id>/documents/: documentos de esa empresa.
- companies/<company-id>/backups/: respaldos individuales.
- migration/legacy-sicoven.sqlite: copia intacta durante la migración.

El archivo de control conserva autenticación, sesiones, licencia y registro de empresas. Los datos contables y operativos viven en el archivo de la empresa.

## Datos que se deben particionar

El snapshot de React contiene una colección global por compatibilidad. Antes de persistir, cada colección se filtra por companyId:

- journalEntries
- purchases
- sales
- products, customers y suppliers
- movements
- fixedAssets
- vatVouchers
- vatWithholdingDeclarations
- islrVouchers
- bankAccounts y bankStatementMovements
- creditSettlements
- supplierAdvanceSettlements y supplierDirectAdvances
- islrFiscalEvents
- financialDisclosures

Los eventos de retenciones IVA no contienen necesariamente companyId; se asignan mediante declarationId a su declaración propietaria. Si falta la declaración o la empresa propietaria, la migración se detiene. No se asignan registros huérfanos por aproximación.

El catálogo de cuentas actual es global en la interfaz. Durante la primera migración se replica en cada base y la unión de snapshots comprueba que sea idéntico en todas. No se permite que una base cargue un plan de cuentas diferente silenciosamente. Si posteriormente se decide que cada empresa tendrá un plan independiente, se requerirá una modificación explícita del modelo de datos y de la interfaz.

## Esquema operativo por empresa

El inicializador de tenant debe crear, sin tablas de autenticación ni licencia:

- app_state y audit_events con triggers append-only.
- accounting_exercise_links, party_masters y period_reopenings.
- accounting_correction_cases, accounting_correction_case_events y accounting_correction_case_workflow_events.
- inflation_classification_decisions y inflation_classification_reviews.
- inflation_source_dossiers, inflation_source_dossier_evidence y inflation_source_dossier_reviews.
- supporting_documents y supporting_document_events.
- vat_fiscal_incidents, vat_fiscal_incident_events y vat_fiscal_incident_references.
- Las tablas de series/observaciones de índices de inflación se deben decidir entre referencia local replicada por empresa o catálogo local compartido; no se deben dejar accidentalmente en una base distinta de la prevista.

El registro de autenticación, las sesiones y la licencia permanecen exclusivamente en sicoven.sqlite. No se vuelve a ejecutar ni se modifica el administrador semilla al crear una base de empresa.

## Contrato de carga y guardado

1. load-state lee el registro de empresas, abre cada base activa, verifica identidad y esquema, lee un snapshot con una sola empresa y une las colecciones.
2. La unión comprueba que cada registro pertenezca a la empresa del archivo y que los eventos IVA estén vinculados a declaraciones de esa misma empresa.
3. save-state particiona el snapshot y persiste cada empresa en su archivo. No acepta registros huérfanos ni snapshots mezclados.
4. Cambiar currentCompanyId solo actualiza la selección local; no cambia ni copia datos entre archivos.
5. Las escrituras de un asiento, compra, venta, movimiento o activo se realizan dentro de la transacción de la base propietaria.
6. Las escrituras que afecten más de una base (por ejemplo, cambio global del catálogo de cuentas) requieren un coordinador de backup/rollback con journal verificable. No se simulan transacciones distribuidas.
7. Las operaciones de auditoría se consultan desde la base de la empresa; los eventos de autenticación/licencia permanecen en la base de control.

## Guardado multiempresa y cambios globales

El helper de persistencia de esta fase guarda una empresa modificada por operación y verifica el snapshot después de escribirlo. Si detecta cambios simultáneos en varias empresas —por ejemplo, modificar el catálogo de cuentas global o la preferencia global de moneda— rechaza el guardado antes de escribir. No se permite una actualización parcial entre archivos.

Antes de habilitar esos cambios debe existir un coordinador transaccional recuperable con:
- copias SQLite consistentes de todos los archivos afectados;
- journal durable en la base de control antes de iniciar las escrituras;
- verificación posterior de cada archivo;
- recuperación automática al iniciar si el proceso se interrumpe;
- restauración de todos los archivos si falla una sola escritura;
- pruebas de corte de energía/proceso, corrupción de respaldo y recuperación.

## IPC que deben resolver la base propietaria

- load-state / save-state: unión y partición del snapshot.
- audit-list: consulta combinada de auditoría por empresa y control de sesión.
- reopen-accounting-period: resolver la base usando companyId y actualizar solo el estado de esa empresa.
- correction-case-*: resolver la base de la empresa del caso.
- inflation-classification-*, inflation-source-dossier-* y vat-fiscal-incident-*: resolver la base de la empresa indicada y comprobar su propiedad.
- supporting-document-*: guardar metadata y archivos bajo companies/<company-id>/documents.
- backup/restore: respaldo individual de una empresa y respaldo completo de instalación, con registro de control y manifiesto de hashes.
- reset-accounting: reset controlado de los archivos operativos, sin eliminar auth_users, auth_sessions ni license_state.

Los handlers no deben confiar en rutas proporcionadas por el renderer. El proceso principal resuelve el companyId contra el registro local.

## Migración del legado

- Crear copia byte a byte de sicoven.sqlite y verificar integridad antes de leerla.
- Inventariar todas las tablas, triggers, registros, documentos y claves foráneas.
- Particionar app_state por companyId y migrar tablas operativas según su company_id.
- Mantener el historial de auditoría; clasificar eventos globales frente a eventos con companyId.
- Migrar documentos a directorios de empresa conservando SHA-256, storage_key e IDs.
- Crear cada archivo en staging, validar conteos y relaciones, comprobar asientos balanceados y validar integridad.
- Registrar cada empresa en el catálogo local solo después de verificar su archivo.
- Mantener el legado intacto y un journal de migración hasta completar pruebas de actualización y restore.
- Si cualquier empresa falla, no activar el modo multiarchivo y no borrar la base anterior.


## Migración de tablas auxiliares y auditoría

La partición del JSON no basta. Antes de activar una empresa se deben trasladar también las tablas relacionales y sus relaciones:

- **Correcciones:** copiar `accounting_correction_cases` por `company_id`; copiar `accounting_correction_case_events` y `accounting_correction_case_workflow_events` únicamente por los `case_id` de esa empresa. Conservar IDs, estados, actor, fechas y eventos append-only.
- **Clasificación de inflación:** copiar `inflation_classification_decisions` y `inflation_classification_reviews` por `company_id`, preservando cadenas de versiones y revisiones.
- **Expedientes de inflación:** copiar `inflation_source_dossiers` por `company_id`, luego sus evidencias y revisiones por `dossier_id`. Los expedientes dependen de series de índices.
- **Índices de referencia:** copiar a cada archivo de empresa las tablas `inflation_index_sources`, `inflation_index_series`, `inflation_index_observations` e `inflation_index_approvals` completas, porque los expedientes de cada empresa referencian `series_id`. No se debe dejar una FK apuntando a otra base SQLite.
- **Documentos:** copiar `supporting_documents` por `company_id` y sus eventos por `document_id`. Copiar también los archivos físicos desde el almacén legado al directorio de la empresa, conservando `storage_key`, nombre original, tamaño y SHA-256. Validar hash antes de registrar el nuevo archivo.
- **Incidencias fiscales IVA:** copiar `vat_fiscal_incidents` por `company_id`; trasladar eventos y referencias por `incident_id`, validando que cada referencia pertenezca a la misma empresa.
- **Auditoría:** separar `audit_events` mediante `companyId` en el JSON de detalles. Copiar a la base de empresa las filas con empresa propietaria inequívoca, conservando ID, tipo, detalles y fecha. Los eventos globales de autenticación, licencia, administrador semilla y mantenimiento permanecen en el archivo de control. Un evento con empresa desconocida no se asigna por aproximación: se conserva en control y se reporta en el manifiesto.
- **Historiales contables:** el snapshot conserva las relaciones entre asientos, compras, ventas, activos fijos, depreciaciones, conciliaciones, retenciones, cierres y anticipos. Después de escribirlo, comprobar vínculos de origen, balance de asientos, unicidad de períodos y pertenencia de cada registro a la empresa.

La copia de tablas auxiliares debe respetar el orden de dependencias y ejecutarse dentro de una transacción de la base destino. El proceso completo se prepara en staging; el registro central solo se actualiza cuando todas las bases y documentos superan sus verificaciones. La base heredada nunca se modifica durante la migración.

## Pruebas de aceptación

- Varias empresas con operaciones de todos los módulos.
- Cambiar de empresa y comprobar que cada base solo contiene su propio companyId.
- Intentar inyectar un registro huérfano o de otra empresa y comprobar bloqueo.
- Corromper o retirar un archivo y comprobar que no se recrea vacío ni afecta a otras empresas.
- Restaurar una empresa y comprobar que las otras permanecen idénticas.
- Respaldar/restaurar toda la instalación.
- Actualizar una instalación real desde la versión anterior conservando login, licencia, administrador semilla y datos.
- Probar cierre de sesión, reinicio, fallo de escritura, interrupción durante migración y recuperación del journal.
- Build Windows NSIS y pruebas de instalación/actualización; no basta con generar el instalador.


## Alta de empresa: inicialización antes del registro

La provisión de una empresa debe crear su archivo y esquema, escribir y validar el snapshot inicial y solo entonces hacer visible la empresa en `company_database_registry`. El callback de inicialización de datos se ejecuta dentro de la transacción de creación del esquema; si falla, se revierte el esquema y el registro central no recibe una fila ACTIVE. El archivo huérfano se conserva para inspección/recuperación y nunca se sobrescribe automáticamente.

Esta protección está implementada en `company-database-manager.cjs` y `tenant-runtime.cjs`. La prueba correspondiente simula un fallo al sembrar los datos y comprueba que no queda una empresa activa ni filas parciales en la base.

## Contexto operativo y cambio de empresa

El módulo `electron/tenant-operation-context.cjs` define el contrato de coordinación que debe utilizar el proceso principal al activar una empresa:

1. Esperar la cola de persistencia pendiente del renderer.
2. Bloquear nuevas operaciones IPC que intenten acceder a datos operativos durante el cambio.
3. Esperar a que finalicen las operaciones que ya estaban en curso.
4. Comprobar que la empresa destino está registrada y ACTIVE.
5. Abrir su archivo SQLite y validar la identidad del snapshot antes de publicar el nuevo contexto.
6. Solo después de validar el destino, cerrar la conexión operativa anterior y cambiar el identificador activo.
7. Si falla la validación o el cierre anterior, conservar el contexto previo y cerrar únicamente la conexión destino abierta por el intento fallido.
8. Al cerrar sesión, vaciar el contexto operativo después de esperar los guardados y operaciones en curso.

El módulo es una pieza aislada y probada; **todavía no está conectado a `main.cjs`, a los handlers IPC ni a `AccountingContext`**. No activa aún el modo multiempresa en la aplicación y no autoriza migrar datos reales. La integración debe validar la sesión en el proceso principal y nunca aceptar rutas SQLite ni confiar en un ID de empresa arbitrario del renderer.
