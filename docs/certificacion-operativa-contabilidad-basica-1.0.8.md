# Certificación operativa de contabilidad básica — SICOVEN 1.0.8

**Estado:** EN EJECUCIÓN — NO CERTIFICADO  
**Rama de trabajo:** certificacion/contabilidad-basica-1.0.8  
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
| G1 — Plan de cuentas | Jerarquía, padres, niveles, cuentas imputables y aislamiento por empresa | Pruebas positivas/negativas | PENDIENTE |
| G2 — Diario y partida doble | Asientos balanceados en Bs. y USD, correlativos, cuentas válidas, inmutabilidad y reversión | Pruebas de dominio y SQLite | PENDIENTE |
| G3 — Diario/Mayor/Balance | Saldos iniciales, movimientos, saldos finales y cuadre reproducible por empresa/período | Conciliación independiente | PENDIENTE |
| G4 — Apertura y períodos | Apertura, cierre, bloqueo retroactivo, reapertura autorizada y ejercicios enlazados | Pruebas temporales y persistencia | PENDIENTE |
| G5 — Compras y CxP | Contado/crédito, pagos parciales, anticipos, notas de crédito y ND solo en alcance controlado | UI → dominio → SQLite → auxiliares | PENDIENTE |
| G6 — Ventas y CxC | Contado/crédito, cobros parciales, saldos y asientos sin duplicidad | UI → dominio → SQLite → auxiliares | PENDIENTE |
| G7 — Inventario/costo | Entradas, salidas, devoluciones y costo solo en operaciones soportadas; Kardex y contabilidad conciliados | Casos con cantidades y costos esperados | PENDIENTE |
| G8 — Caja y bancos | Entradas, salidas, transferencias, conciliación y correspondencia con Diario | Casos de tesorería y conciliación | PENDIENTE |
| G9 — Doble moneda | Tasas históricas, precisión, importes originales/equivalentes y no conversión cruzada indebida | Matriz Bs./USD y cálculos independientes | PENDIENTE |
| G10 — Estados financieros | Ecuación contable, resultados, patrimonio y flujo reconciliados con Mayor | Casos patrón y conciliación | PENDIENTE |
| G11 — Multiempresa | Cero filtraciones de lectura/escritura entre empresas | Pruebas cruzadas en dominio y SQLite | PENDIENTE |
| G12 — Persistencia | Reinicio de proceso, reapertura de SQLite, integridad y consistencia de snapshots | Pruebas de persistencia reales | PENDIENTE |
| G13 — Respaldo/restauración | Backup íntegro, restauración en instalación limpia y comprobación de saldos | Prueba de ida y vuelta | PENDIENTE |
| G14 — Instalador/actualización | Instalación limpia Windows x64 y upgrade 1.0.7 → 1.0.8 preservando base real de prueba | CI Windows, NSIS y marcador/dataset SQLite | PENDIENTE |
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
- G1–G9, G13 y G15: PENDIENTES de evidencia de aceptación específica según la matriz. La prueba integral añadida no reemplaza el dataset completo ni el recorrido E2E.

**Decisión:** el artefacto de CI existe y los workflows propios están verdes, pero SICOVEN continúa **NO CERTIFICADO / NO APTO PARA DISTRIBUCIÓN CONTABLE BÁSICA** hasta cerrar todos los gates G0–G15. No publicar ni distribuir este artefacto como versión aprobada.

## 11. Bitácora

| Fecha | Cambio | Resultado |
|---|---|---|
| 2026-11-01 | Se define el alcance independiente de certificación 1.0.8 sobre main 3676dbef4513d7c6920cd1ec6b708a5ad84025d9 | Certificación iniciada; ningún gate declarado aprobado por anticipado |
| 2026-11-01 | G0: CI base 1.0.7 validado (546/546 pruebas; desktop y Windows SUCCESS). Se agrega prueba SQLite multiempresa; primera corrida detectó expectativa incorrecta del test sobre el evento state_saved (no defecto de persistencia), se corrige de 2 a 3 eventos totales y se relanza CI | Corrección incorporada; CI de la revisión corregida en ejecución; G12 sigue pendiente |
