# SICOVEN — Auditoría contable VEN-NIF y fiscal SENIAT
**Fecha de inicio:** 04-11-2026  
**Rama:** `audit/contabilidad-vennif-fiscal-seniat-1.0.14`  
**Base:** `main` en commit `6efaf5c8bf3a9766ee95526cdfe23c22719c980c`  
**Alcance:** exclusivamente Fase 4 (contabilidad integral bimonetaria) y Fase 5 (cumplimiento fiscal venezolano).  
**Fuera de alcance:** fases 2, 3, 6 y 7, aceptadas por el titular como probadas; administrador semilla y módulos ajenos a defectos contables/fiscales demostrados.

## 1. Hallazgos iniciales comprobados

### 1.1 Base contable existente
El repositorio ya contiene Diario, Mayor, balances, apertura/cierre de ejercicios, reversiones, estado de cambios en patrimonio, flujo de efectivo directo e indirecto, notas/anexos, valoración de inventario y controles bimonetarios. No se debe reconstruir ni duplicar esos módulos.

La auditoría inicial documentada en `docs/auditoria-inicial-nucleo-contable.md` dejó expresamente pendiente la validación normativa integral y la suficiencia de estados/revelaciones. La hoja maestra también deja abiertos los bloques 1 y 2 para validación profesional integral.

### 1.2 Actualización normativa 2026
La investigación preliminar identifica la actualización de FCCPV de abril de 2026:
- BA VEN-NIF 8, versión 11.
- BA VEN-NIF 11, versión 01, reconocimiento del impuesto diferido.
- BA VEN-NIF 12, versión 01, tenencia de criptoactivos propios.

La implementación no debe asumir aplicabilidad universal: primero debe determinarse el marco contable configurado para cada entidad (VEN-NIF GE o VEN-NIF PYME), ejercicio y actividad. Se debe obtener y archivar el texto íntegro vigente de cada boletín y definir transición/fecha efectiva antes de programar reglas.

### 1.3 Estados financieros y revelaciones
Los motores de estados financieros existentes presentan importes separados Bs./USD y disponen de conciliaciones y clasificación explícita. Sin embargo, el código por sí solo no demuestra cumplimiento total de presentación y revelación VEN-NIF. Deben cotejarse:
- Estado de situación financiera.
- Estado de resultados y resultado integral (incluyendo BA VEN-NIF 5).
- Estado de cambios en el patrimonio.
- Estado de flujos de efectivo directo e indirecto.
- Notas, políticas contables, juicios, estimaciones, riesgos y comparativos.
- Fecha de autorización para publicación y hechos posteriores.
- Marco GE/PYME y período de vigencia de cada norma.

### 1.4 Inflación / REME
El plan maestro documenta que el Bloque 3 sigue parcialmente implementado y el motor REME permanece bloqueado por falta de series oficiales auténticas, resolvedor mensual completo, conciliación y validación profesional. No se debe habilitar reexpresión ni generar asientos con índices estimados, interpolados o fixtures. Este frente forma parte de la evaluación de presentación VEN-NIF, pero no se declarará resuelto hasta satisfacer esos gates.

### 1.5 Inventario y costos
El motor dispone de promedio ponderado, PEPS, control de capas, costo histórico dual y valor neto realizable. Pendiente: validar el circuito integral de costo de ventas, deterioro, devoluciones, producción/transformación y conciliación Kardex–mayor–estados financieros por empresa y período. No crear capas históricas estimadas ni reconstruir costos faltantes.

### 1.6 Diferencias de cambio y moneda
Existen modelos de ajustes cambiarios y snapshots de tasas. Pendiente: matriz normativa y funcional para moneda funcional, moneda de presentación, partidas monetarias/no monetarias, reconocimiento inicial, medición posterior, liquidación, conversión de estados y efectos en resultados/patrimonio. No asumir que toda diferencia se contabiliza igual ni mezclar saldos Bs. y USD como si fueran una sola moneda.

### 1.7 Impuesto diferido
No se encontró en el inventario revisado un motor funcional completo de impuesto diferido alineado con BA VEN-NIF 11 v1. Debe verificarse en todo el árbol antes de concluir ausencia. Si no existe, diseñar registro de bases contables/fiscales, diferencias temporarias, tasas promulgadas, activos por impuesto diferido sujetos a recuperabilidad, pasivos, movimientos y revelaciones, sin contabilización automática hasta contar con reglas y revisión profesional.

### 1.8 Criptoactivos
BA VEN-NIF 12 v1 debe tratarse como aplicabilidad condicional. No activar un módulo genérico: primero identificar si la entidad posee criptoactivos propios, clasificación, reconocimiento, medición y revelaciones conforme al texto oficial. Si la entidad no mantiene criptoactivos, documentar no aplicabilidad.

## 2. Hallazgos fiscales SENIAT pendientes
La auditoría del Bloque 4 ya registra componentes implementados y límites explícitos:
- TXT IVA preliminar de 16 columnas, aún sin homologación/aceptación demostrada en Portal Fiscal.
- Declaraciones sin operaciones: requieren presentación según la regla aplicable; el registro interno no sustituye el acuse.
- Notas de crédito/débito y rectificaciones: existen flujos parciales, pero falta cerrar tratamiento de retenciones enteradas/no enteradas y el circuito posterior a la declaración.
- Conciliación de eventos de pago con movimientos bancarios importados integrada; esto no autentica la recepción del pago por SENIAT.
- Pendiente validación primaria de especificación TXT, calendario oficial y feriados, comprobantes/plazo del artículo 16, elegibilidad y reglas de agente/proveedor, parámetros históricos UT/ISLR y conciliación integral libro→documento→comprobante→declaración→acuse→enteramiento→asiento.
- No afirmar homologación ni aceptación de archivos sin evidencia del Portal Fiscal.

## 3. Orden de ejecución

### Fase 4 — Contabilidad integral bimonetaria
1. Matriz de aplicabilidad normativa por entidad: GE/PYME, actividad, ejercicio y moneda funcional/presentación.
2. Validación matemática y de presentación de los cuatro estados financieros y notas/revelaciones.
3. BA VEN-NIF 2 / NIC 29: gobierno de índices auténticos, períodos, clasificación monetaria y REME; mantener bloqueos si falta fuente.
4. Moneda extranjera: reconocimiento inicial, medición posterior, liquidación y conversión; reconciliar Bs./USD.
5. Inventarios: costo, PEPS/promedio, costo de ventas, deterioro/VNR y conciliación con mayor.
6. BA VEN-NIF 11: análisis e implementación del impuesto diferido si aplica.
7. BA VEN-NIF 12: evaluación condicional de criptoactivos propios.
8. Cierre técnico con casos de referencia, pruebas y revisión profesional.

### Fase 5 — Fiscal venezolano
1. Matriz normativa vigente por tributo, sujeto, documento y período; fijar fuentes primarias.
2. IVA: débitos/créditos, retenciones, notas, rectificaciones, pagos parciales y enteramientos.
3. SENIAT: comprobantes, calendario/plazos, declaración sin operaciones, formatos y acuses.
4. ISLR: conceptos habilitados, Decreto 1.808, UT histórica, bases/sustraendos, pagos y reversos.
5. IGTF: supuestos, base, tasa, sujeto, moneda, exenciones y conciliación.
6. Conciliación fiscal-contable y diferencias temporarias con el módulo contable.
7. Pruebas por período histórico y revisión profesional independiente.

## 4. Salvaguardas
- No modificar el administrador semilla.
- No borrar, reescribir ni recalcular automáticamente documentos, asientos o declaraciones históricas.
- SQLite local continúa como fuente de verdad.
- No usar tasas, índices, feriados, formatos ni reglas fiscales inventadas.
- Mantener ramas y PR separadas por bloque; no fusionar hasta pasar pruebas focalizadas y regresión.
- La validación técnica no equivale a opinión profesional ni certificación legal/fiscal.
- Los cuatro frentes que el titular indicó como probados quedan fuera de alcance; solo se reabren ante defecto contable/fiscal demostrado.

## 5. Criterio de salida
La Fase 4 se cierra cuando la matriz GE/PYME, estados, revelaciones, inflación, moneda, inventario, impuesto diferido y aplicabilidad de criptoactivos tengan resultados documentados, reglas trazables y pruebas aprobadas, con revisión profesional de las conclusiones normativas.

La Fase 5 se cierra cuando cada obligación aplicable tenga fuente, vigencia, cálculo, documento, presentación/acuse cuando corresponda, pago/enteramiento, asiento y conciliación trazables; cualquier formato no probado ante SENIAT seguirá etiquetado como preliminar, no homologado.
