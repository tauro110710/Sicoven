# Integración gradual del runtime SQLite por empresa

Fecha: 2026-11-08  
Repositorio: `tauro78/Sicoven`  
Rama: `feat/sqlite-local-per-company-rebased`

## Avance de esta fase

Se incorporó `electron/tenant-runtime.cjs` como fachada de acceso a las bases locales por empresa. Recibe la conexión SQLite de control ya abierta y construye el gestor local usando el esquema operativo tenant. Expone contratos explícitos para:

- listar empresas registradas;
- abrir la base operativa de una empresa por su ID validado;
- cargar el snapshot agregado y guardar cambios mediante la persistencia tenant-aware existente;
- crear una empresa con su archivo SQLite, esquema, metadatos de identidad y snapshot inicial;
- actualizar metadatos de empresa;
- cerrar una base o todas las conexiones operativas;
- obtener la ruta local calculada por el gestor, sin aceptar rutas del renderer.

La creación de empresa no sobrescribe registros existentes. Si la inicialización falla después de crear el archivo, el archivo se conserva y se informa que requiere recuperación; no se borra para ocultar un fallo parcial.

Se agregaron pruebas en `electron/tenant-runtime.test.cjs` para separar control y operación, impedir duplicados, comprobar aislamiento de archivos y verificar cierre sin eliminación.

## Estado de activación

Este runtime todavía no se conecta al arranque de `electron/main.cjs`, al preload ni al contexto React. El archivo heredado `userData/sicoven.sqlite` sigue siendo la base operativa activa. No se ha ejecutado ninguna migración sobre datos reales y no se ha creado un registro de empresas en una instalación del usuario.

Esta separación deliberada evita que una instalación existente abra bases vacías o muestre empresas sin haber migrado y validado previamente sus datos.

## Próximos trabajos obligatorios

1. Ejecutar y corregir CI para el commit que incorpora runtime y pruebas.
2. Implementar el orquestador de migración reversible: backup consistente con `.backup()`, SHA-256, preflight, staging, copia de snapshot/auxiliares/documentos, validación global, registro coordinado y rollback.
3. Añadir una resolución segura de empresa activa en IPC, sin aceptar rutas ni confiar en identificadores arbitrarios del renderer.
4. Migrar handlers y módulos especializados para que cada operación use la base de su empresa; mantener autenticación, sesiones y licencia en control.
5. Adaptar respaldos/restauraciones por empresa y de instalación completa.
6. Adaptar el contexto React y el cambio de empresa con espera de persistencia, bloqueo de escrituras, cierre y rehidratación.
7. Ejecutar pruebas de instalación y actualización en Windows, preservando el archivo heredado como rollback.

No fusionar la PR ni publicar una versión hasta completar esas fases y verificar el instalador sobre el mismo SHA.
