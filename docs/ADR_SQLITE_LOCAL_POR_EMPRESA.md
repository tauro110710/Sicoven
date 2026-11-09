# ADR — SQLite local independiente por empresa

- Estado: Aprobado para implementación por etapas; todavía no implementado.
- Fecha: 2026-11-08.
- Repositorio: `tauro78/Sicoven`.
- Rama de trabajo: `feat/sqlite-local-per-company`.

## Contexto y decisión

SICOVEN es una aplicación de escritorio. La fuente de verdad operativa seguirá siendo SQLite en el equipo donde se ejecuta SICOVEN. No se incorporará sincronización externa, replicación, base de datos alojada ni servidor remoto como requisito de operación.

Se adopta una base SQLite física independiente por empresa, administrada desde una sola instalación de SICOVEN.

Estructura local propuesta:

```text
userData/
  sicoven.sqlite                 # control local: autenticación, licencia y registro de empresas
  companies/
    <company-id>/
      accounting.sqlite          # contabilidad y operaciones de esa empresa
      documents/                 # documentos vinculados a esa empresa
      backups/                   # respaldos de esa empresa (si se habilita almacenamiento local)
  migration/
    legacy-sicoven.sqlite         # copia de seguridad preservada durante la migración
```

El registro de control solo conserva la identidad y estado de cada empresa, su ruta relativa, versión de esquema y metadatos necesarios para abrir su base. No contiene asientos, saldos, inventario ni documentos contables.

## Límites obligatorios

1. No usar Turso, Firebase, Firestore, Vercel, PostgreSQL ni otro almacenamiento remoto para datos contables.
2. No implementar sincronización entre instalaciones ni replicación.
3. No abrir archivos SQLite de empresas desde carpetas compartidas de red ni exponerlos por SMB.
4. Cada operación contable debe ejecutarse dentro de una transacción de la base de su empresa.
5. Toda consulta y escritura debe resolver una empresa autorizada y validar que los registros pertenecen a esa empresa.
6. Un fallo al abrir o validar una base debe bloquear esa empresa sin afectar las demás.
7. No eliminar ni sobrescribir automáticamente el archivo legado durante la migración.
8. Mantener intactos el administrador semilla, el flujo de autenticación y las reglas actuales de licencia; cualquier cambio posterior requerirá autorización separada.
9. Mantener el bloqueo de instancia única hasta que exista un diseño y pruebas específicas para concurrencia local. No habilitar múltiples procesos contra el mismo snapshot.
10. El acceso remoto, si se usa, será control remoto de la sesión de la PC anfitriona mediante una solución de escritorio remoto segura. No equivale a sincronización ni a dos copias independientes trabajando simultáneamente.

## Separación de responsabilidades

### Base local de control: `sicoven.sqlite`

- `auth_users`, `auth_sessions` y el estado de licencia existente.
- Registro local de empresas: ID estable, RIF, nombre, estado, ruta relativa, fecha de alta y versión de esquema.
- Auditoría de administración de empresas y eventos de apertura/cierre de bases.
- No guardar datos contables operativos.

### Base de cada empresa: `accounting.sqlite`

- Estado contable y fiscal de esa empresa.
- Plan de cuentas, asientos, compras, ventas, inventario y Kardex.
- CxC, CxP, bancos, conciliaciones, retenciones, cierres y ejercicios.
- Activos fijos, depreciaciones y sus asientos.
- Auditoría contable append-only, expedientes y vínculos de documentos.
- Metadatos y versión de esquema propios de la empresa.

## Contrato de acceso

- El renderer mantiene una sola empresa activa a la vez.
- Cambiar de empresa debe esperar a que termine la cola de persistencia de la empresa actual, bloquear nuevas escrituras durante el cambio, cerrar recursos de la empresa anterior y cargar la nueva base.
- La interfaz no debe presentar datos de la empresa nueva hasta que su SQLite haya superado las comprobaciones de integridad y la hidratación.
- Los comandos IPC de persistencia deben recibir o resolver un ID de empresa validado en el proceso principal; nunca confiar en una ruta enviada por el renderer.
- Una escritura debe validar que todas las entidades del snapshot pertenecen a la empresa activa. No aceptar snapshots mezclados.
- Los identificadores y numeraciones pueden repetirse entre empresas porque cada base es independiente.
- Las operaciones que cambian varias empresas no se permiten como una única operación contable distribuida.

## Migración del archivo legado

La migración debe ser reversible y no destructiva:

1. Detectar y validar el `sicoven.sqlite` legado y su snapshot completo.
2. Crear una copia íntegra y verificable del archivo legado antes de modificar cualquier dato.
3. Inventariar empresas y clasificar cada registro por `companyId`; detener la migración si existen registros huérfanos, empresas duplicadas o relaciones cruzadas.
4. Crear cada base nueva en una carpeta temporal; ejecutar migraciones versionadas y copiar únicamente registros de esa empresa.
5. Migrar documentos y adjuntos conservando hashes, IDs y relaciones.
6. Validar integridad SQLite, conteos, relaciones, asientos balanceados, vínculos de auditoría, activos fijos y referencias documentales.
7. Confirmar cada base y registrar el manifiesto de migración en el registro local.
8. Solo después de una verificación global permitir que SICOVEN opere en modo multiarchivo.
9. Conservar el legado intacto como recuperación hasta que se hayan completado pruebas de instalación, actualización, backup y restore. No borrarlo automáticamente.

Si cualquier etapa falla, SICOVEN debe volver al modo legado o bloquear la migración sin descartar datos. Nunca se permite una migración parcial silenciosa.

## Respaldo y restauración

- Respaldo individual por empresa, con manifiesto, integridad SQLite y hashes.
- Respaldo completo de la instalación que incluya el registro local y todas las bases de empresa.
- Restaurar una empresa no debe reemplazar ni modificar las bases de las otras.
- Restaurar el registro de control debe comprobar que cada ruta apunta a una base íntegra y perteneciente a la empresa registrada.
- Los documentos deben incluirse en el respaldo de su empresa.
- Mantener el mecanismo de journal, staging y rollback existente, adaptándolo a un objetivo de restauración por empresa.

## Acceso remoto sin sincronización

Cuando un contador de la PC B necesite usar SICOVEN de la PC A, la modalidad compatible con esta decisión es el control remoto seguro de la sesión de Windows de la PC A. La base permanece local en A y SICOVEN se ejecuta en A.

Esto permite uso remoto de la misma sesión, pero no dos sesiones contables independientes simultáneas. No compartir el archivo SQLite mediante una carpeta de red. El bloqueo de instancia única y las protecciones actuales de persistencia deben mantenerse.

## Fases de implementación

1. **Inventario y contratos:** identificar todos los IPC y módulos que capturan la conexión SQLite actual; clasificar datos globales, por empresa y documentos.
2. **Registro local y gestor de bases:** provisionar, abrir, validar, cerrar y migrar bases por empresa con pruebas unitarias.
3. **Persistencia por empresa:** cambiar carga, guardado y todos los handlers para resolver la base correcta sin alterar el flujo de autenticación.
4. **Interfaz de cambio de empresa:** cambio controlado con espera de persistencia, hidratación aislada y recuperación ante fallos.
5. **Módulos complementarios:** auditoría, correcciones, inflación, activos fijos, documentos, respaldo y restauración por empresa.
6. **Migración legado:** ejecutar la conversión sobre fixtures y copias, nunca sobre el único original.
7. **Pruebas de escritorio:** instalación limpia, actualización desde versión anterior, varias empresas, aislamiento, restauración individual, recuperación de fallos y conservación del administrador semilla.
8. **Distribución:** solo publicar una versión cuando todos los jobs de CI y la prueba real de instalador/actualización pasen sobre el mismo SHA.

## Criterios de aceptación

- Cada empresa tiene un archivo SQLite distinto y verificable.
- Los datos de una empresa no aparecen al abrir otra, incluso si se omite accidentalmente un filtro de UI.
- La app opera sin conectividad a una base externa.
- Crear, cerrar, respaldar y restaurar una empresa no afecta a las demás.
- Una base corrupta no provoca reparación destructiva ni pérdida de las otras empresas.
- El cambio de empresa no permite escrituras sobre la base anterior ni mezcla snapshots.
- Los módulos contables existentes mantienen sus reglas y resultados.
- El administrador semilla y el inicio de sesión se mantienen sin cambios.
- La migración conserva todos los datos y deja una vía de retorno demostrable.
- No se declara terminado hasta verificar instalación y actualización conservando las bases locales.

## Estado actual verificado antes de implementar

- La rama principal usa actualmente un solo archivo `userData/sicoven.sqlite`.
- `app_state` almacena un snapshot contable que contiene el arreglo completo de empresas y colecciones de varias empresas.
- `electron/main.cjs` mantiene una conexión SQLite global y pasa esa conexión a múltiples módulos IPC.
- `AccountingContext` hidrata un único snapshot y guarda el snapshot completo mediante una cola de persistencia.
- El proceso principal tiene bloqueo de instancia única para evitar que dos procesos trabajen con snapshots obsoletos.
- El respaldo y la restauración actuales operan sobre una única base activa.
- Por tanto, esta separación requiere un cambio transversal y coordinado; no basta con crear archivos SQLite adicionales ni cambiar la ruta de `new Database()`.

## Exclusiones explícitas

- Sincronización entre PCs, nube, replicación o servidor de datos.
- Cambios al administrador semilla o autenticación.
- Cambio de proveedor de licencias o del mecanismo de actualización.
- Acceso simultáneo de dos procesos a una misma empresa.
