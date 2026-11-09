# Inventario de integración IPC — SQLite local por empresa

Fecha: 2026-11-08  
Repositorio: `tauro78/Sicoven`  
Rama: `feat/sqlite-local-per-company-rebased`

## Propósito

Este inventario identifica los puntos de entrada confirmados que todavía dependen de la conexión SQLite heredada compartida en `electron/main.cjs`. Sirve como lista de control para integrar el runtime multiempresa sin cambiar el administrador semilla, autenticación ni licencia.

Este documento no activa la arquitectura ni autoriza una migración. La instalación sigue usando `userData/sicoven.sqlite` como base operativa y de control heredada.

## 1. Conexión y ciclo de vida actual

- `openDatabase()` crea y abre `userData/sicoven.sqlite` en una variable global `db`.
- La misma conexión inicializa `app_state`, `audit_events`, `auth_users`, `auth_sessions` y `license_state`.
- La conexión global se entrega a los módulos IPC de persistencia, inflación, documentos, IVA y respaldos.
- `dbHandle` es un proxy para respaldos que apunta a la conexión global actual tras una restauración.
- `closeDatabase()` y `reopenDatabase()` cierran/reabren el archivo único.
- El bloqueo de instancia única impide que dos procesos Electron trabajen con snapshots potencialmente obsoletos.

## 2. Datos de control que deben permanecer en la base local de control

Los siguientes datos no deben moverse a las bases operativas de empresas:

- `auth_users`, `auth_sessions`.
- `license_state` y los metadatos locales de instalación/licencia.
- Registro `company_database_registry` que administra `company-database-manager.cjs`.
- Eventos administrativos/globales de auditoría cuya propiedad no pueda atribuirse inequívocamente a una empresa.

El administrador semilla, el login, las sesiones y el mecanismo de licencia deben conservar su comportamiento actual. La integración no debe cambiar hashes, roles, reglas de activación, prueba ni revalidación.

## 3. Handlers confirmados que requieren resolución tenant-aware

### Control/autenticación — conservar en control

- `sicoven:auth-setup-status`
- `sicoven:auth-initialize`
- `sicoven:auth-login`
- `sicoven:auth-restore`
- `sicoven:auth-logout`
- `sicoven:auth-list-admins`
- `sicoven:auth-create-admin`
- `sicoven:auth-delete-seed`
- Handlers de licencia y consentimiento de mejora.

### Estado contable y auditoría — mover a la base de la empresa activa

- `sicoven:load-state`
- `sicoven:save-state` (registrado por `accounting-persistence.cjs`)
- `sicoven:reset-accounting`
- `sicoven:audit-list`
- `sicoven:audit-record-correction`
- `sicoven:reopen-accounting-period`
- `sicoven:correction-case-create`
- `sicoven:correction-case-authorize`
- `sicoven:correction-case-review` (actualmente retirado y debe continuar retirado)
- `sicoven:correction-case-observe` (actualmente retirado y debe continuar retirado)
- `sicoven:correction-case-resubmit` (actualmente retirado y debe continuar retirado)
- `sicoven:correction-case-withdraw` (actualmente retirado y debe continuar retirado)
- `sicoven:correction-case-execute`
- `sicoven:correction-case-list`

La propiedad de la empresa debe resolverse en el proceso principal a partir de la sesión y la empresa activa validada. No se debe confiar en una ruta SQLite ni en un `companyId` arbitrario enviado por el renderer.

### Módulos especializados — conexión actual compartida; destino por empresa

Registrados actualmente desde `main.cjs` con la conexión global:

- `registerInflationIndexIpc`
- `registerInflationClassificationIpc`
- `registerInflationRemeReadinessIpc`
- `registerInflationSourceDossierIpc`
- `registerDocumentVaultIpc`
- `registerVatFiscalIncidentIpc`

Sus tablas operativas y relaciones deben migrarse junto con sus handlers. Las series/fuentes/observaciones que sean referencias compartidas deben copiarse de manera controlada a cada base o rediseñarse explícitamente; nunca deben quedar consultas apuntando accidentalmente a la DB de control.

### Respaldos/restauración — rediseño separado

- `registerBackupIpc` actualmente recibe un proxy de la DB única.
- `registerRestoreIpc` actualmente cierra y vuelve a abrir la DB única.

Se requieren dos funciones distintas, sin duplicar el mecanismo de respaldo:
1. **Respaldo/restauración global de la instalación**, que incluye la DB de control, todas las bases SQLite de empresas y todos los documentos. La restauración global debe validar el manifiesto, el registro y la identidad de cada base antes de exponer la instalación.
2. **Exportación/entrega de una empresa seleccionada**, en SQLite o JSON, para entregar sus datos cuando cambie de contador. Esta exportación no es un respaldo operativo ni ofrece restauración individual dentro de SICOVEN.

No debe existir un flujo de backup/restore por empresa. La recuperación operativa se realiza mediante el respaldo global; la entrega individual es un paquete de datos independiente.

## 4. Renderer y preload

- `preload.cjs` expone `load(token)` y `save(token, state)`, pero no expone un contrato de listar/crear/seleccionar/cerrar empresas.
- `AccountingContext` mantiene un snapshot agregado con `companies` y `currentCompanyId`.
- El cambio de empresa actual es un cambio de estado del renderer; todavía no espera una cola de persistencia, bloquea escrituras, cierra una DB anterior ni hidrata una DB física nueva.
- `addCompany` todavía no invoca un flujo IPC de provisión y validación de una base física por empresa.

La interfaz solo podrá mostrar una empresa nueva como operativa después de que el proceso principal confirme creación, esquema, identidad y snapshot inicial.

## 5. Secuencia de integración obligatoria

1. Mantener el acceso de control aislado y crear un resolvedor de contexto de empresa activa dentro del proceso principal.
2. Exponer por preload contratos de listado, creación y cambio seguro de empresa; no exponer rutas.
3. Hacer que el cambio de empresa espere la cola de persistencia actual, bloquee escrituras, cierre recursos anteriores y cargue el snapshot nuevo.
4. Adaptar los handlers de estado, auditoría, correcciones y periodos.
5. Adaptar inflación, documentos e incidencias IVA junto con sus relaciones y archivos.
6. Implementar backup/restore por empresa y de instalación completa.
7. Integrar el orquestador reversible de migración heredada y registrar todas las bases únicamente después de validar el conjunto completo.
8. Probar aislamiento, operaciones simultáneas, fallos de cambio de empresa, corrupción, rollback, instalación limpia y actualización.

## 6. Criterios de bloqueo

- No fusionar esta PR mientras algún handler operativo siga escribiendo o leyendo datos de empresa desde la DB de control.
- No permitir snapshots con registros de varias empresas en una DB individual.
- No registrar bases incompletas en el catálogo de control.
- No borrar ni sobrescribir la base heredada ni documentos originales durante la migración.
- No alterar administrador semilla, login ni licencia.
- No publicar una versión hasta probar instalador y actualización real conservando las bases locales.

## Estado

Inventario inicial basado en la inspección de `electron/main.cjs`, `electron/preload.cjs`, `src/context/AccountingContext.tsx`, `electron/tenant-runtime.cjs` y módulos de persistencia de la rama indicada. Debe actualizarse en cada fase y no sustituye la inspección de cada handler antes de modificarlo.
