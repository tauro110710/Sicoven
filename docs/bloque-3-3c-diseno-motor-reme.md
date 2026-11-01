# Bloque 3.3C — Auditoría y diseño seguro del motor REME

**Estado:** fase de auditoría y contrato técnico; el motor operativo NO está implementado ni habilitado.  
**Base:** `main` posterior a PR #53.  
**Regla permanente:** `calculationEnabled=false`; no calcular importes contables, proponer asientos, modificar saldos ni cierres.

## 1. Resultado de la auditoría del código integrado

Se revisaron los módulos de índices, preparación, clasificación y expedientes de fuentes que ya existen en `main`.

### 1.1 Control de preparación de índices

`electron/inflation-reme-readiness.cjs`:
- Resuelve IPC-AMC hasta 2007-12 e INPC-BCV desde 2008-01.
- Exige nivel de índice, aprobación, cobertura, meses observados, emisor, URL BCV, hash y metadatos.
- Devuelve `calculationEnabled: false` incluso cuando `ready=true`.
- Es un control preliminar del conjunto oficial; no es un motor de cálculo ni una aprobación de cumplimiento.

**Límite detectado:** el control exige emisor BCV y dominio BCV para ambas familias. Esa regla no demuestra por sí misma la autenticidad ni la procedencia del IPC-AMC histórico. No se modifica PR #51 en este bloque. La procedencia histórica debe resolverse mediante documentación primaria antes de que cualquier motor consuma esa serie.

### 1.2 Fuentes alternativas

`electron/inflation-source-dossiers.cjs` registra expedientes y decisiones profesionales inmutables, con alcance por empresa, ejercicio, período, marco y finalidad.

**Límite detectado:** el expediente documental no constituye todavía un resolvedor de observaciones mensuales admisibles para un cálculo. No existe una selección automatizada, mes a mes, que vincule cada observación alternativa aprobada con su versión, hash y alcance. Una aprobación de expediente no se debe interpretar como disponibilidad de una serie ni como autorización general de cálculo.

### 1.3 Clasificación monetaria

`electron/inflation-classifications.cjs` conserva decisiones y revisiones append-only, incluyendo tratamiento propuesto por tipo de partida y base de medición.

**Límite detectado:** las clasificaciones aprobadas no forman todavía un inventario de componentes contables conciliado y consumible por un motor. No existe una unión verificada entre componente, saldo histórico, fecha de origen/medición, moneda, índice aplicable y expediente de fuente. La etiqueta de tratamiento no es una fórmula ejecutable.

### 1.4 Ausencia deliberada de cálculo

En los módulos auditados no existe un motor que:
- determine por sí solo si corresponde aplicar el ajuste al ejercicio y marco de la entidad;
- calcule y conserve factores por cada fecha y observación;
- determine el tratamiento de componentes y partidas mixtas;
- calcule el resultado monetario;
- genere asientos o modifique saldos.

Esta ausencia se mantiene hasta cerrar los prerrequisitos normativos, documentales y profesionales.

## 2. Decisión de arquitectura

El futuro REME se separará en capas con contratos explícitos:

1. **Contexto contable inmutable:** empresa, ejercicio, marco (VEN-NIF General o PYMES), fecha de reporte y snapshot de saldos/componentes extraídos de SQLite.
2. **Elegibilidad normativa:** decisión documentada sobre aplicación del ajuste para ese marco y ejercicio; nunca inferida solo por disponer de índices.
3. **Clasificación aprobada:** decisiones y componentes vigentes, con revisión profesional y conciliación contra el catálogo y balance.
4. **Resolución de fuentes por período:** observación exacta y versión elegible para cada fecha; fuente oficial o supuesto alternativo que haya superado su flujo propio. Nunca mezclar clases silenciosamente.
5. **Motor matemático puro:** recibe entradas explícitas, validadas y versionadas; no conoce IPC, Electron, UI ni tablas contables; no realiza I/O.
6. **Papeles de trabajo reproducibles:** fórmula identificada, valores fuente, fechas, factor, precisión, redondeo, resultados intermedios y advertencias.
7. **Revisión profesional:** revisión independiente del papel de trabajo, con decisión y alcance inmutables.
8. **Propuesta contable separada:** solo después de autorización expresa futura; nunca escribir directamente desde el motor matemático.

## 3. Contrato de datos requerido antes de codificar fórmulas

Cada ejecución futura deberá quedar identificada por un UUID y un hash del conjunto de entradas. Como mínimo, el expediente de cálculo deberá fijar:

- Empresa y ejercicio.
- Marco contable y versión normativa aplicable.
- Fecha de reporte.
- Decisión de aplicabilidad del ajuste y su evidencia.
- Snapshot de cuentas y componentes, con identificadores estables.
- Saldo histórico y moneda, almacenados sin pérdida de precisión.
- Fecha de origen o fecha de medición que corresponda a cada componente.
- Clasificación y revisión profesional exactas.
- Código, versión y tipo de cada serie/fuente.
- Observación mensual exacta, valor original, estado (observado/estimado/proyectado), documento y SHA-256.
- Regla normativa aplicada a cada fuente y alcance de aprobación.
- Versión del algoritmo, fórmula, escala decimal y regla de redondeo.
- Todos los resultados intermedios, advertencias, bloqueos y revisión profesional.

Los datos de una ejecución cerrada no se sobrescriben. Una corrección genera una ejecución nueva que referencia la anterior y explica la diferencia.

## 4. Reglas de seguridad del futuro motor

- El motor matemático será determinista y puro: mismos inputs y versión producen exactamente los mismos resultados.
- No utilizar aritmética binaria de punto flotante para importes contables ni factores persistidos.
- Definir precisión decimal, escala y redondeo por norma y papel de trabajo antes de implementar; no elegirlos por conveniencia técnica.
- Rechazar índices faltantes, no positivos, duplicados, no aprobados o fuera de cobertura.
- Rechazar datos `PROJECTED` para cualquier ruta que no los admita expresamente; nunca degradarlos a observados.
- No interpolar, extrapolar ni retroceder a una versión previa de forma silenciosa.
- Rechazar clasificaciones pendientes, vencidas, rechazadas o de alcance distinto.
- Rechazar componentes sin fecha, moneda, saldo o soporte conciliable.
- No calcular con cuentas mixtas sin desglose documentado de componentes.
- Separar los resultados por marco contable; no mezclar reglas de NIC 29 con Sección 31.
- No recalcular ni reescribir períodos cerrados.
- El motor no tendrá acceso de escritura a tablas contables.
- La aprobación del papel de trabajo no activa por sí misma la contabilización.

## 5. Prerrequisitos que bloquean el motor operativo

1. Verificar el texto oficial vigente del BA VEN-NIF 2 y su guía para el ejercicio al que se aplicará.
2. Cerrar 3.1C: obtener y verificar documentos primarios de IPC-AMC e INPC; la investigación actual no acredita que los archivos originales estén incorporados.
3. Cerrar 3.1D: importar series auténticas y cubrir cada mes necesario sin lagunas.
4. Definir el flujo alternativo completo de selección mensual para párrafos 17, 18 y 19, sin convertir expedientes en índices oficiales.
5. Validar profesionalmente la matriz de clasificación y su vínculo con componentes reales de saldos.
6. Definir casos de referencia con resultados esperados firmados/revisados por profesional para cada marco y tipo de partida.
7. Documentar precisión, redondeos, tratamiento de diferencias y revelaciones.
8. Completar 3.4 y obtener autorización expresa antes de cualquier activación operativa.

La investigación normativa existente describe NIC 29 para grandes entidades y Sección 31 para pequeñas y medianas entidades. Esa descripción no sustituye la verificación de la versión vigente ni proporciona por sí sola todos los casos de cálculo y contabilización.

## 6. Pruebas obligatorias para la futura implementación

- Determinismo: repetir la misma ejecución y comparar hash/resultados.
- Trazabilidad: reconstruir cada resultado desde la partida y observaciones exactas.
- Integridad decimal: importes grandes, fracciones, límites de escala y redondeos.
- Cobertura: falta de mes, cambio IPC-AMC/INPC, origen y medición fuera de cobertura.
- Versiones: nueva versión de índice no altera una ejecución histórica.
- Fuentes alternativas: aprobación fuera de alcance, evidencia cambiada, mes sin decisión y observación proyectada.
- Clasificación: cuenta no imputable, decisión pendiente, componente mixto no desglosado y cambio de versión.
- Marcos: casos independientes para VEN-NIF General y VEN-NIF PYMES.
- Contabilidad: ejecución no modifica diario, mayor, balance, cierres ni auditoría contable.
- Seguridad: usuario sin permiso, licencia/sesión inválida y acceso a empresa ajena.
- Actualización: preservar bases SQLite existentes.
- Fixtures: exclusivamente sintéticos, aislados en SQLite en memoria y claramente identificados como pruebas.

## 7. Alcance de esta fase

Este documento registra auditoría y arquitectura. No introduce fórmulas de reexpresión no verificadas, no calcula factores, no calcula REME, no genera asientos, no modifica datos contables y no habilita la funcionalidad.

**Criterio de salida de esta fase:** contrato técnico revisado y aceptado. La implementación matemática solo podrá comenzar cuando los prerrequisitos de la sección 5 estén resueltos y existan casos de referencia profesionales verificables.
