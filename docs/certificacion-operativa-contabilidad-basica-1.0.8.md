# Certificación operativa de contabilidad básica — SICOVEN 1.0.8

**Estado:** EN EJECUCIÓN — NO CERTIFICADO  
**Rama de trabajo:** certificacion/contabilidad-basica-1.0.8  
**SHA candidato verificado:** 9015f04e8a328f7900b95715c7ab4c7f4ac7cde4
**Base de código:** 3676dbef4513d7c6920cd1ec6b708a5ad84025d9  
**Versión objetivo:** 1.0.8  
**Base de datos:** SQLite local, única fuente de verdad.

## 1. Objetivo y decisión de alcance

Determinar, mediante pruebas reproducibles y criterios de aceptación, si SICOVEN puede distribuirse como software de **contabilidad básica empresarial**. Esta certificación no declara terminado el producto integral ni sustituye la revisión profesional que corresponda a cada empresa, marco contable y ejercicio.

El artefacto Windows x64 se generará únicamente cuando todos los gates obligatorios estén aprobados. La generación del artefacto de CI no equivale a publicar un release; no se publicará ni distribuirá externamente sin autorización expresa.

## 2. Alcance incluido

1. Configuración y aislamiento de empresas.
2. Plan de cuentas jerárquico, cuentas imputables y auxiliares.
3. Asientos manuales y automáticos; partida doble y correlativos.
4. Libro Diario, Libro Mayor y Balance de Comprobación.
5. Asiento de apertura, períodos, cierres, bloqueo y reapertura autorizada.
6. Compras y ventas con su integración contable básica.
7. Cuentas por cobrar y pagar, cobros/pagos parciales y anticipos dentro del alcance validado.
8. Caja, bancos y movimientos de tesorería.
9. Inventario y costo de ventas en los escenarios expresamente soportados.
10. Moneda dual Bs./USD, tasas históricas y consistencia de importes.
11. Estado de Situación Financiera, Estado de Resultados, Cambios en el Patrimonio y Flujos de Efectivo, con trazabilidad.
12. Respaldo, restauración, migraciones y actualización del instalador sin pérdida de SQLite.
13. Auditoría, reversión mediante contra-asientos e integridad histórica.

## 3. Fuera de alcance de esta certificación

- Homologación, presentación o aceptación automática por SENIAT.
- Certificación de archivos TXT fiscales, calendarios tributarios o interpretación normativa no respaldada por fuente primaria vigente.
- REME y cálculos asociados.
- Nómina integral y obligaciones laborales.
- Facturación electrónica homologada.
- Consolidación avanzada, automatizaciones fiscales no verificadas y funciones aún marcadas en desarrollo.
- Notas/revelaciones o dictámenes que requieran juicio profesional específico no acreditado por pruebas técnicas.

Estas limitaciones deberán comunicarse claramente en la ficha de versión y documentación de distribución. No se anunciará SICOVEN 1.0.8 como software fiscal homologado ni como sustituto del criterio profesional.

## 4. Gates obligatorios de certificación

| Gate | Criterio de aprobación | Evidencia requerida | Estado |
|---|---|---|---|
| G0 — Línea base | Identificar SHA, versión, inventario de pruebas y workflows activos | CI base y revisión de commits/workflows | APROBADO (base 1.0.7) |
| G1 — Plan de cuentas | Jerarquía, padres, niveles, cuentas imputables y aislamiento por empresa | Pruebas positivas/negativas ejecutadas en SQLite | APROBADO (dominio/SQLite; falta E2E UI) |
| G2 — Diario y partida doble | Asientos balanceados en Bs. y USD, correlativos, cuentas válidas, inmutabilidad y reversión | Partida doble y validación dual en SQLite; correlativos multiempresa y rechazo de duplicados | APROBADO PARCIAL (faltan E2E y cobertura completa de reversión) |
| G3 — Diario/Mayor/Balance | Saldos iniciales, movimientos, saldos finales y cuadre reproducible por empresa/período | Conciliación sintética de balance de comprobación; falta lectura E2E desde Mayor/Diario UI | EVIDENCIA PARCIAL |
| G4 — Apertura y períodos | Apertura, cierre, bloqueo retroactivo, reapertura autorizada y ejercicios enlazados | Tests IPC/SQLite: administrador autenticado, motivo y fecha efectiva, reapertura transaccional auditada, aislamiento por empresa, registros append-only, apertura enlazada y rechazo de duplicados | EVIDENCIA PARCIAL (falta E2E UI, bloqueo retroactivo integral y reinicio real) |
| G5 — Compras y CxP | Contado/crédito, pagos parciales, anticipos, notas de crédito y ND solo en alcance controlado | Tests de dominio/SQLite para compra contado/crédito, auxiliares CxP, IVA/retenciones, Kardex, notas de crédito/débito, anticipos y liquidaciones | EVIDENCIA PARCIAL (falta recorrido UI→SQLite y E2E de saldos auxiliares) |
| G6 — Ventas y CxC | Contado/crédito, cobros parciales, saldos y asientos sin duplicidad | Tests de dominio para modalidad contado/crédito y liquidaciones parciales, reversadas, tasas, referencias y límites de saldo; persistencia de asientos y liquidaciones validada por integridad SQLite | EVIDENCIA PARCIAL (falta E2E de facturación/cobro y conciliación completa del auxiliar CxC) |
| G7 — Inventario/costo | Entradas, salidas, devoluciones y costo solo en operaciones soportadas; Kardex y contabilidad conciliados | Tests de costo PEPS/promedio, movimientos, devoluciones, consistencia factura–Kardex–asiento y restricciones de stock; integridad SQLite rechaza movimientos no conciliados y conserva Kardex append-only | EVIDENCIA PARCIAL (falta recorrido E2E de inventario y costo en operación real) |
| G8 — Caja y bancos | Entradas, salidas, transferencias, conciliación y correspondencia con Diario | Tests de validación de conciliación bancaria, movimientos vinculados, reversión con línea opuesta exacta, trazabilidad de desconciliación y persistencia de vínculos históricos | EVIDENCIA PARCIAL (falta E2E de caja/banco y conciliación integral contra estado bancario) |
| G9 — Doble moneda | Tasas históricas, precisión, importes originales/equivalentes y no conversión cruzada indebida | Tests de asiento dual, conciliación Bs/USD, precisión de USD, validación de tasa BCV y rechazo de totales/retornos con tasa o equivalentes divergentes; integración sintética de compras, ventas y pagos | EVIDENCIA PARCIAL (falta matriz E2E de tasas históricas por documento y períodos) |
| G10 — Estados financieros | Ecuación contable, resultados, patrimonio y flujo reconciliados con Mayor | Tests de balance en Bs/USD, resultados históricos, patrimonio, flujo de efectivo, notas cuantitativas y una integración sintética que concilia balance de comprobación, situación, resultados, patrimonio, flujo y apertura siguiente | EVIDENCIA PARCIAL (falta recorrido E2E UI→SQLite→reportes) |
| G11 — Multiempresa | Cero filtraciones de lectura/escritura entre empresas | Tests de filtrado de informes, historial por empresa, correlativos independientes, compras/devoluciones y liquidaciones aisladas; filtro defensivo adicional en Libro Mayor | EVIDENCIA PARCIAL (falta E2E de cambio de empresa y operaciones cruzadas completas) |
| G12 — Persistencia | Reinicio de proceso, reapertura de SQLite, integridad y consistencia de snapshots | Tests de transacción SQLite, rollback ante fallo de auditoría, persistencia y reapertura de DB; PRAGMA quick_check y foreign_key_check bloquean DB dañada; snapshot de upgrade con hash idéntico | EVIDENCIA PARCIAL (falta reinicio integral de Electron y reconciliación amplia de datos tras reinicio) |
| G13 — Respaldo/restauración | Backup íntegro, restauración en instalación limpia y comprobación de saldos | Implementado backup consistente con `better-sqlite3`, documentos externos, manifiesto SHA-256 y verificación de integridad; IPC solo para administrador autenticado. Pruebas automatizadas y CI verdes en SHA `9015f04e8a328f7900b95715c7ab4c7f4ac7cde4`; backup consistente, verificación de manifiesto/SQLite/documentos y staging aislado verificado. Motor de instalación, rollback físico, recovery al arranque y comparación de saldos aún no implementados/verificados | PARCIAL |
| G14 — Instalador/actualización | Instalación limpia Windows x64 y upgrade 1.0.7 → 1.0.8 preservando base SQLite de prueba | CI Windows y NSIS verdes en SHA `9015f04e8a328f7900b95715c7ab4c7f4ac7cde4`; upgrade 1.0.7→1.0.8 conserva snapshot SQLite sintético y clean install en perfil Windows aislado | EVIDENCIA PARCIAL (falta validación operativa manual en equipo objetivo; Authenticode aplazado y no bloqueante para esta certificación técnica) |
| G15 — Aceptación funcional | Recorrido de extremo a extremo de una empresa de certificación, con resultados esperados | Acta de pruebas y evidencias | PENDIENTE |

Un gate no se marca aprobado por la mera existencia de componentes o pruebas unitarias. Debe existir evidencia ejecutada sobre el SHA candidato y los casos de aceptación que correspondan.


### Evidencia de línea base (G0)

- El commit `3676dbef4513d7c6920cd1ec6b708a5ad84025d9` modifica únicamente documentación respecto del código funcional validado en `3b957b0b717e92ad99a380578e8cf25cdf2baf81`; por tanto, las ejecuciones CI del segundo SHA representan la misma base funcional.
- Desktop Validation run `41327119839`: SUCCESS. Job `validate` completó instalación, hardening de autenticación, pruebas, TypeScript, auditoría de recursos, build y auditoría de assets.
- El log del job reporta **546 pruebas, 546 aprobadas, 0 fallidas, 0 omitidas**, en 15 suites.
- Windows Installer run `41327119811`: SUCCESS. Completó NSIS, verificación del instalador y prueba de actualización 1.0.6 → 1.0.7 conservando SQLite.
- Artefacto de CI 1.0.7: `SICOVEN-Windows-3b957b0b717e92ad99a380578e8cf25cdf2baf81`, ID `13091762381`, SHA-256 `868b46cbab835a7809d4afdce4ab7867fc09a27c43fbf72fa172e9f10bc8d93b`.
- Advertencia no bloqueante observada: Vite genera un chunk JavaScript principal de aproximadamente 2.7 MB y muestra aviso por superar 500 kB. Debe evaluarse como mejora de rendimiento, sin convertirla en requisito fiscal ni ocultar el aviso.
- **Límite:** G0 valida la línea base 1.0.7. No aprueba ningún gate funcional de aceptación 1.0.8 ni sustituye la futura actualización 1.0.7 → 1.0.8.

## 5. Dataset patrón de certificación

Crear un conjunto de datos sintético, explícitamente etiquetado como prueba y aislado de cualquier dato de usuario. Debe cubrir al menos:

- Una empresa A y una empresa B para pruebas de aislamiento.
- Plan de cuentas mínimo configurable, con cuentas de activo, pasivo, patrimonio, ingreso, costo y gasto.
- Asiento de apertura balanceado en Bs. y USD.
- Compra de contado y compra a crédito.
- Venta de contado y venta a crédito.
- Cobro y pago parcial; liquidación del saldo.
- Entrada y salida de inventario soportadas con costo calculable.
- Movimiento de caja, depósito/retiro bancario y transferencia entre cuentas.
- Ajuste y reversión documentada por contra-asiento.
- Cierre mensual, intento de operación retroactiva bloqueada y reapertura autorizada.
- Caso con dos períodos y apertura anual enlazada.
- Backup, restauración y verificación de saldos.

Para cada operación se documentarán: precondición, entrada, asiento esperado, auxiliar esperado, saldo esperado en ambas monedas, resultado observado y evidencia. No se utilizarán datos demo o fixtures como evidencia de producción.

## 6. Pruebas integrales obligatorias

La secuencia de aceptación debe demostrar, como mínimo:

1. Crear/seleccionar la empresa de prueba y configurar su plan de cuentas.
2. Registrar apertura y verificar Diario, Mayor y Balance de Comprobación.
3. Registrar compras y ventas de contado/crédito.
4. Ejecutar cobros y pagos parciales y verificar saldos CxC/CxP.
5. Registrar operaciones de inventario soportadas y conciliar costo/Kardex/asientos.
6. Registrar movimientos de caja y bancos y conciliarlos con el Diario.
7. Generar los cuatro estados financieros y rastrear sus cifras a cuentas y asientos.
8. Cerrar período, verificar bloqueo retroactivo y ejecutar reapertura autorizada.
9. Cerrar la aplicación, reabrirla y comparar todos los saldos con los resultados previos.
10. Restaurar un backup en un perfil limpio y comparar integridad, saldos y relaciones.
11. Repetir consultas y escrituras con empresa B y demostrar aislamiento total respecto de A.

La cobertura E2E debe atravesar interfaz, contexto/dominio, persistencia SQLite y lectura posterior al reinicio. Las pruebas de funciones puras no sustituyen este recorrido.

## 7. Gates técnicos del candidato 1.0.8

- npm ci --no-audit --no-fund exitoso.
- npm test exitoso.
- npm run check:types exitoso.
- npm run build exitoso.
- npm run audit:assets exitoso.
- Pruebas de integridad/autenticación existentes exitosas.
- NSIS genera exactamente SICOVEN-Setup-1.0.8-x64.exe.
- Instalación limpia y arranque real en Windows x64.
- Actualización real 1.0.7 → 1.0.8 con conservación de SQLite.
- Backup/restauración y lectura de datos después de reinicio.
- SHA-256 y tamaño del instalador registrados.
- Ningún gate crítico fallido, omitido o sin evidencia.

## 8. Reglas de seguridad y cambios

- SQLite local sigue siendo la única fuente de verdad; localStorage no puede convertirse en autoridad operativa.
- No se cambia el administrador semilla, su alta, credenciales, flujo ni lógica.
- No se eliminan ni reescriben asientos o documentos históricos para hacer pasar pruebas.
- Las correcciones se realizan en esta rama y mediante PR; no se escribe directamente en main.
- No se amplía el alcance a los bloques fiscales ni a otros módulos de la hoja de ruta.
- Los fallos se corrigen con pruebas de regresión específicas.
- No se simula aceptación fiscal ni se etiqueta como certificación profesional.

## 9. Regla de decisión final

**APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA** solo cuando G0–G15 estén aprobados con evidencia reproducible sobre el mismo SHA candidato, CI de escritorio y Windows estén verdes, el instalador 1.0.8 arranque y la actualización/restauración preserven SQLite.

Si un gate falla o carece de evidencia, la decisión será **NO APTO — CONTINUAR CERTIFICACIÓN**. No se compensan fallos críticos con promedios de pruebas.

La aprobación técnica habilita la generación del artefacto de CI. La publicación de release y su distribución pública requieren autorización expresa posterior.

## 10. Evidencia ejecutada del candidato 1.0.8

**SHA candidato:** `98120a90fa1fbe06d9e5dbbee0211c5e8f9df753`  
**Fecha CI:** 01/11/2026.

- Desktop Validation run `41329804409`: SUCCESS. Instalación de dependencias, guards de autenticación/sesión, pruebas, TypeScript, auditoría de recursos, build y auditoría de assets completados.
- Windows Installer run `41329804419`: SUCCESS. Las 15 etapas completadas, incluida compilación NSIS, instalación/arranque previo, actualización 1.0.7 → 1.0.8 y verificación SQLite.
- Suite automatizada en el job Windows: **550 pruebas, 550 aprobadas, 0 fallidas**. La suite de escritorio también finalizó satisfactoriamente.
- Instalador producido: `SICOVEN-Setup-1.0.8-x64.exe`, tamaño **136,698,054 bytes**.
- Prueba de actualización: snapshot sintético de la empresa `cert-upgrade-company`, asiento `cert-upgrade-opening-0001`; SHA-256 antes y después idéntico: `f4bde4773b6b8d655c873176779a5fd57ef984429499e17bfc55940c573a2b8c`. El proceso confirmó instalación anterior, arranque, actualización y conservación.
- Artefacto CI: `SICOVEN-Windows-5d975aacd833572e589393d1d8ee912bd76dd65e`, ID `13093165226`; SHA-256 del ZIP: `027f12b9dfc680ab5ee390c7b61c933e864795c18c4d1c9492a4a472927aa751`. Disponible como artefacto temporal de GitHub Actions; no es release público.
- El estado combinado reportó un check Vercel fallido por límite de compilación del plan. SICOVEN es una aplicación Electron/SQLite; los dos workflows propios de validación y empaquetado terminaron correctamente. No se interpreta el check Vercel como validación del instalador.
- El empaquetado informa que no hay certificado de firma de código configurado; el ejecutable queda **sin firma digital**. Esto debe resolverse o advertirse expresamente antes de distribución general.

### Estado de gates después de esta ejecución

- G0: APROBADO.
- G10: EVIDENCIA PARCIAL — conciliación de componentes e integración contable sintética; falta recorrido E2E de interfaz a SQLite.
- G11: EVIDENCIA PARCIAL — pruebas de aislamiento y correlativos multiempresa en SQLite y en informes; falta E2E de todas las operaciones.
- G12: EVIDENCIA PARCIAL — persistencia tras cierre/reapertura SQLite y hash del snapshot durante upgrade; falta reinicio integral y verificación amplia de la aplicación.
- G14: EVIDENCIA PARCIAL — upgrade real 1.0.7 → 1.0.8 y conservación del snapshot aprobados; falta evidencia separada de instalación limpia 1.0.8 y firma del instalador.
- G1–G9, G10–G12, G13 y G14: estados parciales detallados en la matriz vigente; G15 sigue pendiente. La prueba integral añadida no reemplaza el dataset completo ni el recorrido E2E.

**Decisión:** el artefacto de CI existe y los workflows propios están verdes, pero SICOVEN continúa **NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA** hasta cerrar todos los gates G0–G15. No publicar ni distribuir este artefacto como versión aprobada.

## 11. Verificación CI del SHA actual de certificación

**SHA verificado:** `9f063b046d5223fe7869a617e71859a5b22e0bee`  (01/11/2026).

- Desktop Validation run `41330411836`: SUCCESS. Job `validate` completado; suite: **554 pruebas, 554 aprobadas, 0 fallidas, 16 suites**. TypeScript, auditoría de recursos, build y auditoría de assets también finalizaron correctamente.
- Windows Installer run `41330411824`: SUCCESS. Suite: **554 pruebas, 554 aprobadas, 0 fallidas, 16 suites**; TypeScript y build renderer correctos; NSIS generó `SICOVEN-Setup-1.0.8-x64.exe` de **136,697,761 bytes**.
- La prueba de actualización 1.0.7 → 1.0.8 sembró el snapshot sintético `cert-upgrade-company` / `cert-upgrade-opening-0001` y confirmó el mismo SHA-256 antes/después: `f4bde4773b6b8d655c873176779a5fd57ef984429499e17bfc55940c573a2b8c`.
- Artefacto de CI: `SICOVEN-Windows-2beb2e9dcbfd2affa4dce06136f078fb0fc79782`, ID `13092654997`, tamaño ZIP **136,770,879 bytes**, SHA-256 `d661baa9094b8c0018b55d3d63a36c43f291a26026d3b75fb12a7c617bf5b5af`. URL de artefacto: https://github.com/fenixlife1978/Sicoven/actions/runs/41330411824/artifacts/13092654997. Es temporal de Actions, no un release.
- El log confirma que no hay certificado de firma de código configurado; la firma fue omitida. La instalación limpia en un perfil/equipo independiente sigue sin evidencia.
- Advertencias no bloqueantes observadas: chunk de Vite superior al umbral configurado; dependencias Node con avisos deprecados; acciones de GitHub que todavía apuntan a Node.js 20. Registrar para mantenimiento, sin confundirlas con fallos de las pruebas.

### Revisión de aislamiento de lectura

- `AccountingProvider` expone `journalEntries` filtrados por `currentCompany.id`; por tanto, el Libro Diario recibe asientos de la empresa activa desde el contexto.
- El Libro Mayor aplica además `filterEntriesByCompany(journalEntries, currentCompany.id)` al recorrer movimientos. El filtro redundante es defensivo y las pruebas unitarias de `filterEntriesByCompany` cubren dos empresas.
- La revisión de código no equivale a una prueba E2E de cambio de empresa desde la interfaz ni a una auditoría completa de cada informe.

### Estado actualizado tras CI del SHA actual

- G0: APROBADO (línea base 1.0.7).
- CI técnico del SHA candidato: APROBADO (Desktop y Windows Installer, 554/554 cada uno).
- G1–G3: evidencia parcial según la matriz; no se eleva a E2E.
- G14: EVIDENCIA PARCIAL (upgrade preserva snapshot; instalación limpia y firma pendientes).
- G4–G14: evidencia parcial conforme a la matriz vigente; G15 continúa pendiente.
- **Decisión: NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA.**

### Revisión adicional de G12–G13 y arranque seguro

- `electron/main.cjs` abre `sicoven.sqlite` dentro del directorio `userData` de Electron y ejecuta `assertSqliteIntegrity(db)` antes de continuar con el arranque.
- `assertSqliteIntegrity` ejecuta `PRAGMA quick_check` y `PRAGMA foreign_key_check`; ante resultado inválido o relaciones inconsistentes, lanza error y bloquea el inicio, sin borrar ni reemplazar la base.
- Hay tres pruebas dedicadas: base sana, violación de clave foránea sin alterar filas y fallo de quick_check.
- Se incorporó `electron/backup-restore.cjs`: respaldo consistente mediante `db.backup()`, copia de `supporting-documents`, manifiesto de tamaño/huellas SHA-256, validación `quick_check`/`foreign_key_check` y comprobación de integridad documental. La acción IPC exige licencia autorizada y sesión de administrador; `preload` expone solo la operación tipada. Se añadieron pruebas de backup completo, destino existente, manipulación de documentos y enlaces simbólicos. G13 pasa a PARCIAL: falta restauración segura con staging, rollback, recuperación de documentos y conciliación de saldos antes/después.
- G12 sube a evidencia parcial por integridad comprobada al arranque y pruebas de reapertura/rollback, pero no se ha probado un reinicio integral de Electron con conciliación de todos los módulos.

## 11. Bitácora

| Fecha | Cambio | Resultado |
|---|---|---|
| 2026-11-01 | Se define el alcance independiente de certificación 1.0.8 sobre main 3676dbef4513d7c6920cd1ec6b708a5ad84025d9 | Certificación iniciada; ningún gate declarado aprobado por anticipado |
| 2026-11-01 | G0: CI base 1.0.7 validado (546/546 pruebas; desktop y Windows SUCCESS). Se agrega prueba SQLite multiempresa; primera corrida detectó expectativa incorrecta del test sobre el evento state_saved (no defecto de persistencia), se corrige de 2 a 3 eventos totales y se relanza CI | Corrección incorporada; CI de la revisión corregida en ejecución; G12 sigue pendiente |


### Actualización G13 — respaldo completo implementado parcialmente

- El respaldo se genera como directorio independiente `SICOVEN-backup-*`, sin sobrescribir destinos existentes ni escribir dentro del `userData` activo.
- SQLite se copia con la API de backup de `better-sqlite3`; se valida la base resultante antes de finalizar.
- Se incluyen todos los archivos regulares de `supporting-documents`; se rechazan enlaces simbólicos y se comprueba el hash SHA-256 de cada documento copiado.
- El manifiesto identifica formato, aplicación, fecha, tamaño/hash de SQLite y lista/hash de documentos.
- La creación queda disponible solo para una sesión admin autenticada con licencia autorizada y registra evento de auditoría.
- Pendiente: restauración en staging, validación integral del paquete, swap atómico, rollback probado ante interrupción, recuperación de soportes y comparación de saldos/documentos tras restaurar. Hasta cerrar esos puntos, G13 no está aprobado y SICOVEN no está certificado.


## 12. Adenda de evidencia — SHA 89bc7cb61b62c7b72aeacc91f281640c772f3cb4

Esta sección prevalece sobre los estados de CI anteriores cuando exista contradicción. La evidencia corresponde exclusivamente al SHA indicado.

- PR #83 permanece abierto, en borrador y sin fusionar. Rama: `certificacion/contabilidad-basica-1.0.8`. `main` no fue modificada.
- Desktop Validation run `41332302325`: SUCCESS.
- Windows Installer run `41332302333`: SUCCESS. El job `build-windows` completó todas sus etapas.
- La actualización real de SICOVEN 1.0.7 a 1.0.8 terminó correctamente y conservó el snapshot SQLite sintético comprobado por el workflow.
- La instalación limpia de 1.0.8 en un perfil Windows aislado terminó correctamente.
- Se generó el artefacto temporal `SICOVEN-Windows-df96e0dc8d222f7f2fc56026dea3c0fd2a5eff6c`, ID `13093942986`, tamaño ZIP `136772944` bytes, SHA-256 `7b1f460852941caaf4c33ce0cd5f3854dd31d7bf849f4f835122c72b41f8850d`. No es un Release ni una autorización de distribución.
- G14 queda actualizado: instalación limpia y actualización 1.0.7→1.0.8 aprobadas en CI para este SHA; firma digital del instalador pendiente. Por tanto, G14 continúa PARCIAL.
- G13 sigue PARCIAL: el respaldo está implementado, pero la restauración diferida, rollback y reconciliación posterior aún no están implementados ni probados. El documento de diseño `docs/diseno-restauracion-segura-g13.md` es especificación, no evidencia de restauración funcional.
- G1–G12 mantienen sus estados parciales descritos en la matriz; G15 continúa PENDIENTE. El CI técnico verde no sustituye la aceptación contable E2E.

**Decisión vigente:** NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA. No se autoriza merge, Release ni distribución. La firma digital, la restauración segura y los recorridos E2E pendientes impiden cerrar la certificación.


## 13. Política vigente de propiedad y distribución de SICOVEN

Esta sección sustituye la política provisional de distribución privada controlada descrita en la versión anterior.

- El repositorio y el código fuente de SICOVEN permanecen **privados**. La consulta actual de GitHub confirma `private: true`.
- El instalador de SICOVEN será de **descarga pública y abierta** una vez finalizada y aprobada la certificación y el titular autorice la publicación.
- Cualquier persona podrá descargar e instalar SICOVEN desde la futura página web oficial de EFASfreelancer - Soluciones Digitales. No se exigirá autorización previa para descargar.
- La experiencia comercial prevista incluye una prueba gratuita de 24 horas, seguida de la posibilidad de adquirir una licencia. La lógica de prueba/licenciamiento debe superar sus propias pruebas de seguridad, persistencia y aceptación antes de comercializarse.
- El canal web tendrá una página de producto, requisitos, versión, notas de versión, botón de descarga Windows y hash SHA-256 del instalador. No se usará GitHub como repositorio público ni se publicará el código fuente.
- La publicación en Microsoft Store queda como posibilidad futura y no es requisito para completar la certificación contable 1.0.8.
- La firma digital Authenticode queda **aplazada por decisión del titular**. No será un bloqueo para continuar la certificación técnica/contable ni para completar las pruebas internas de instalador. Antes de distribuir públicamente un instalador Windows sin firma, se deberá informar claramente al usuario de las advertencias de Windows y evaluar el riesgo; la firma podrá incorporarse en una etapa posterior.
- Los artefactos de CI continúan siendo evidencia técnica interna y no autorizan por sí solos una publicación.
- No se publicará ningún instalador ni se habilitará el portal de descarga antes de completar los gates de certificación y recibir autorización expresa del titular.

### Estado vigente

- Privacidad del repositorio: **VERIFICADA** (GitHub devuelve `private: true`).
- Firma Authenticode: **APLAZADA**, fuera del alcance inmediato de certificación.
- Página web pública y botón de descarga: **FASE POSTERIOR A LA CERTIFICACIÓN**.
- Prueba gratuita de 24 horas y activación comercial: deben quedar verificadas antes de abrir la distribución.
- SICOVEN continúa **NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN** hasta aprobar los gates y pruebas de aceptación.


### Evidencia CI del SHA candidato `2302d533dbeacdfcdd9537cea06d258667228e8f`

- Desktop Validation run `41344453808`: SUCCESS. Checkout, instalación de dependencias bloqueadas, guards de autenticación/sesión, pruebas automatizadas, TypeScript, auditoría de recursos, build y auditoría de assets completados.
- Windows Installer run `41344453841`: SUCCESS. Checkout, descarga del instalador 1.0.7, instalación de dependencias, guards, pruebas automatizadas, TypeScript, build, auditoría de assets, NSIS, verificación del instalador, actualización 1.0.7 → 1.0.8 conservando SQLite y clean install en perfil Windows aislado completados.
- Ambos workflows corresponden exactamente al mismo SHA candidato. Esta evidencia no completa G13 ni G15 y no sustituye los recorridos E2E contables desde la interfaz.


## 14. Evidencia CI del SHA dc673e258cbd6bf0820eb432db9c8d9892706209

- Desktop Validation run [41345276710](https://github.com/fenixlife1978/Sicoven/actions/runs/41345276710): SUCCESS.
- Windows Installer run [41345276716](https://github.com/fenixlife1978/Sicoven/actions/runs/41345276716): SUCCESS. El job `build-windows` completó todas las etapas, incluida actualización 1.0.7→1.0.8 conservando SQLite y clean install 1.0.8 en perfil Windows aislado.
- Ambos workflows corresponden exactamente al SHA indicado. La suite, TypeScript, build renderer, auditoría de assets y NSIS completaron correctamente.
- G14 mantiene evidencia CI de instalación limpia y upgrade aprobados para este SHA; sigue parcial por falta de validación operativa manual en el equipo objetivo. Authenticode continúa aplazado y no bloquea la certificación técnica según el alcance acordado.
- G13 continúa PARCIAL. La revisión de journal/staging detectó que el journal aún no registra huellas del conjunto documental ni estados físicos suficientes para recuperar un swap DB+documentos. El motor de instalación, rollback físico, recovery previo a SQLite y reconciliación contable no están implementados.
- G1–G12 conservan sus estados parciales y G15 sigue pendiente. CI verde no equivale a certificación.

**Decisión:** NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA. PR #83 permanece abierto en borrador; no merge, Release ni publicación.


## 15. Evidencia CI del SHA candidato 9015f04e8a328f7900b95715c7ab4c7f4ac7cde4

- Desktop Validation run [41347639020](https://github.com/fenixlife1978/Sicoven/actions/runs/41347639020): SUCCESS.
- Windows Installer run [41347639014](https://github.com/fenixlife1978/Sicoven/actions/runs/41347639014): SUCCESS; el job `build-windows` completó la compilación NSIS, la actualización real 1.0.7→1.0.8 con conservación del snapshot SQLite sintético y la instalación limpia en perfil Windows aislado.
- Ambos workflows están asociados exactamente al SHA candidato indicado. En Windows finalizaron guards de autenticación/sesión, pruebas automatizadas, TypeScript, build renderer, auditoría de assets y validación del instalador.
- G14: evidencia CI de upgrade y clean install aprobada para este SHA; permanece parcial por falta de validación operativa manual en el equipo objetivo. Authenticode sigue aplazado conforme a la política vigente y no bloquea la certificación técnica.
- G13 continúa PARCIAL: staging y journal son preparatorios; no existe todavía motor de swap físico DB+documentos, rollback, recuperación idempotente antes de abrir SQLite ni reconciliación de saldos/documentos después de restaurar.
- G1–G12 conservan los límites E2E descritos en la matriz y G15 sigue pendiente. Los dos workflows verdes no constituyen certificación contable.

**Decisión de este SHA:** CI propio de Desktop y Windows APROBADO; certificación SICOVEN 1.0.8 NO EMITIDA. PR #83 permanece abierto y en borrador. No merge, Release ni distribución.


## 16. Evidencia actualizada — motor G13 y validación Windows — SHA aa9254a1cdf83df5a4b4d1dbd0477f3807036bf3

Fecha: 2026-11-01. Esta adenda prevalece sobre las declaraciones históricas anteriores cuando describan como no implementado el motor físico de restauración.

### Evidencia CI del mismo SHA

- Desktop Validation run [41350710895](https://github.com/fenixlife1978/Sicoven/actions/runs/41350710895): SUCCESS.
- Windows Installer run [41350710800](https://github.com/fenixlife1978/Sicoven/actions/runs/41350710800): SUCCESS.
- Ambos workflows corresponden exactamente al SHA `aa9254a1cdf83df5a4b4d1dbd0477f3807036bf3`.
- Windows completó guards de autenticación/sesión, suite automatizada, TypeScript, build renderer, auditoría de assets, generación NSIS, verificación del instalador, upgrade real 1.0.7→1.0.8 conservando el snapshot SQLite sintético e instalación limpia 1.0.8 en perfil Windows aislado.
- La firma Authenticode permanece aplazada por decisión del titular y no bloquea esta certificación técnica, conforme a la política de distribución vigente.

### G13 — motor físico implementado y probado por escenarios técnicos

Se incorporó `electron/restore-engine.cjs`, integrado al arranque Electron antes de abrir SQLite:

1. Verifica el paquete de respaldo y prepara staging aislado; comprueba SQLite, manifiesto y documentos.
2. Genera snapshot de retorno antes de cerrar la conexión activa.
3. Persiste journal de operación con estados y hashes SHA-256 de base/manifiestos de staging y retorno.
4. Cierra SQLite después de checkpoint WAL; retira sidecars WAL/SHM antes del swap físico.
5. Instala base y carpeta documental mediante renames dentro de `userData`, verificando la base instalada y el conjunto documental.
6. Ante fallo, ejecuta rollback; ante interrupción, `recoverPendingRestore` corre antes de `openDatabase()` y bloquea el arranque si no puede verificar/recuperar.
7. Mantiene un proxy SQLite estable para que los handlers IPC existentes usen la conexión reabierta tras restaurar.
8. La operación está protegida por licencia autorizada, sesión admin y confirmación explícita; el resultado se registra en auditoría.

Pruebas dedicadas del motor:
- Restauración física de SQLite y documentos con snapshot de retorno.
- Recuperación al arranque de un swap físico interrumpido, antes de abrir SQLite.
- Fallo de reapertura tras instalar el respaldo y recuperación de base/documentos originales.

### Estado de gates y límites de evidencia

- G13 deja de tener como pendiente la implementación del motor físico: **MOTOR IMPLEMENTADO; PRUEBAS TÉCNICAS CI APROBADAS**.
- G13 permanece **PARCIAL** hasta ejecutar aceptación contable con dataset representativo: capturar saldos y conteos por empresa/cuentas/documentos antes del backup, restaurar en perfil limpio, volver a leer desde SQLite y demostrar igualdad de saldos, auxiliares y documentos; incluir además un recorrido de restauración iniciado desde la UI Electron y reinicio posterior.
- G12 permanece PARCIAL: el recovery se prueba antes de abrir SQLite, pero falta reinicio integral de Electron y reconciliación amplia de módulos.
- G14: CI de upgrade y clean install APROBADA en este SHA; la validación manual en el equipo objetivo queda como evidencia operativa adicional, no como fallo del workflow.
- G15 sigue PENDIENTE: recorrido funcional de aceptación contable de extremo a extremo.

**Decisión:** la validación técnica de Desktop y Windows está APROBADA en el SHA indicado y el motor G13 ya está implementado. SICOVEN 1.0.8 continúa **NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA** hasta cerrar la reconciliación de saldos G13, G12 y los gates funcionales G0–G15. PR #83 permanece abierto en borrador; no merge, Release ni distribución.
