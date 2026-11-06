# Auditoría de Bloques 1, 2 y 5–12 — avance
**Fecha:** 06-11-2026  
**Repositorio:** `freelancer1978/Sicoven`  
**Base inspeccionada:** `main` — `721c481d99d1ef1cc898f07c4cdd87a6362a17cb`  
**Versión:** 1.0.17

## Alcance de esta pasada
Primera pasada del Bloque 1 (núcleo de Contabilidad General). No se modificó código funcional, datos SQLite, autenticación semilla ni instaladores. La hoja de ruta conserva su estructura, numeración y alcance; solo se tachó una sub-tarea cuya implementación y pruebas ya existen.

## Bloque 1 — hallazgo verificado

### Validación estructural de cuentas — implementada y probada
Evidencia:
- `src/types/chartOfAccounts.ts`: valida formato y duplicidad de códigos, clasificación, padre existente, nivel, relación agrupadora/imputable y evita insertar niveles intermedios que reestructuren cuentas históricas.
- `src/context/AccountingContext.tsx`: `addAccount` ejecuta `prepareAccountForCatalog` antes de añadir la cuenta al estado.
- `src/types/journalEntryValidation.ts`: rechaza asientos que utilicen cuentas inexistentes o agrupadoras.
- `electron/accounting-integrity.cjs`: vuelve a validar la estructura de cuentas nuevas en la capa SQLite.
- Pruebas: `src/types/chartOfAccounts.test.ts`, `src/types/journalEntryValidation.test.ts` y `electron/chart-of-accounts-integrity.test.cjs`.

La sub-tarea «validación de códigos, padres, niveles y cuentas imputables» del Bloque 1 se marca como terminada en la hoja de ruta. Esto no cierra el requisito completo de plan de cuentas configurable por empresa.

### Brecha confirmada: catálogo contable no está separado por empresa
Evidencia observada en `src/types/accounting.ts` y `src/context/AccountingContext.tsx`:
- `Account` no contiene `companyId`.
- El contexto mantiene un único arreglo `accounts` en el snapshot de estado.
- `addAccount` valida contra ese arreglo global y no recibe la empresa activa.
- El cambio de empresa no selecciona un catálogo de cuentas propio.

Impacto: el requisito del Bloque 1 «plan de cuentas jerárquico configurable por empresa» no está demostrado; las cuentas personalizadas se mantienen en un catálogo compartido por la instalación. Esto también requiere validación de aislamiento frente al Bloque 11. No se concluye que los asientos históricos estén mezclados: cada `JournalEntry` sí conserva `companyId`.

Decisión preventiva: no añadir `companyId` ni migrar catálogos en esta pasada. Primero se debe diseñar una migración aditiva que preserve los códigos, saldos, referencias de asientos, importaciones y restauraciones; definir el tratamiento de cuentas base compartidas; y probar empresas antiguas con catálogos personalizados antes de tocar persistencia.

## Validación de integración
La línea base `main` tiene CI y Windows Release exitosos en SHA `721c481d99d1ef1cc898f07c4cdd87a6362a17cb`:
- CI run `42245517711`: pruebas automatizadas, TypeScript y build de producción, SUCCESS.
- Windows run `42245517753`: SUCCESS.

Estos resultados prueban la línea base general, no sustituyen la validación funcional multiempresa descrita arriba.

## Estado de esta pasada
- Validación estructural de códigos, padres, niveles e imputabilidad: **terminada**.
- Plan de cuentas configurable por empresa: **pendiente**.
- Auditoría integral de Diario, Mayor, balance de comprobación, moneda funcional, cierres y reversión del Bloque 1: **pendiente**.
- Bloques 2 y 5–12: **pendientes de esta secuencia de auditoría**.

No se marca como terminado ningún bloque completo ni se declara certificación VEN-NIF.
