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


## 6. Segunda pasada de inspección de código (04-11-2026)

### 6.1 Configuración de marco contable — brecha confirmada
La interfaz `Company` de `src/types/accounting.ts` contiene RIF, tipo de contribuyente, ejercicio fiscal, tasa BCV y datos generales, pero no contiene un selector/identificador persistido del marco VEN-NIF GE o VEN-NIF PYME ni su versión normativa. Por tanto, los reportes no pueden demostrar desde la configuración de la entidad qué marco y versión se aplicaron. No se añadió aún un campo porque falta rastrear creación/edición, persistencia SQLite, importación/exportación y compatibilidad de empresas existentes. La solución debe ser opcional/retrocompatible durante migración y exigir selección explícita para nuevos cierres, sin asignar un marco por inferencia.

### 6.2 Impuesto diferido — no demostrado
La interfaz `Company` y los tipos revisados no evidencian un registro completo de diferencias temporarias, bases fiscales, activos/pasivos por impuesto diferido, movimientos y revelaciones. Esto no basta para declarar ausencia en todo el sistema; queda pendiente búsqueda transversal y contraste con BA VEN-NIF 11 v1. No se habilitarán asientos automáticos con tasas no documentadas ni recuperabilidad presumida.

### 6.3 Conversión y ajustes cambiarios
`src/types/fxFiscalAdjustment.ts` implementa una propuesta proporcional de ajuste de base/exentos/IVA ante liquidaciones parciales. El propio motor exige revisión del contador en el modo de conservar IVA original y no emite documentos por sí solo. Esto es una salvaguarda útil, pero no sustituye el motor contable general de moneda funcional, medición de partidas monetarias/no monetarias y conversión de estados. Se debe evitar reutilizar este cálculo fiscal como regla general de diferencias de cambio.

### 6.4 Exportaciones ISLR
La ruta de exportación mensual usada por las pruebas es `generateSeniatIslrOperationsXml`: escapa caracteres XML, limita por período y contempla eventos fiscales, operaciones con retención cero y reversos/legado según sus constructores. La función heredada `generateSeniatIslrXml` serializa valores directamente sin escape ni validación equivalente; debe rastrearse su uso antes de retirarla o endurecerla para no romper consumidores. La exportación TXT heredada también carece de validaciones comparables a las del flujo de operaciones. No se declara homologación oficial de ninguno de los formatos.

### 6.5 Cobertura automatizada ya existente
`src/utils/seniatGenerators.test.ts` contiene pruebas de fechas de evento fiscal ISLR, selección mensual, deduplicación de eventos/comprobantes, escape XML, y validaciones del TXT IVA de 16 campos. Estas pruebas son evidencia técnica de comportamiento local, no evidencia de aceptación del Portal Fiscal ni de vigencia normativa de la estructura histórica. Se deben ampliar únicamente después de fijar especificaciones oficiales aplicables.

### 6.6 Decisión de implementación
No se introduce todavía un cambio de esquema ni un asiento automático: el siguiente bloque seguro es rastrear el ciclo completo de configuración de empresa y localizar todos los consumidores de los generadores ISLR heredados; en paralelo, obtener la fuente primaria FCCPV de BA VEN-NIF 8 v11 y BA VEN-NIF 11 v1, y la especificación primaria SENIAT vigente. La brecha de marco contable queda confirmada y registrada como defecto de trazabilidad normativa, no como prueba de que los estados actuales estén matemáticamente errados.


## 7. Trazabilidad de configuración y persistencia (04-11-2026)

### 7.1 Persistencia de Company
La interfaz `Company` se encuentra en `src/types/accounting.ts`. El estado completo de contabilidad se serializa como JSON en `app_state.state_json` mediante `electron/accounting-persistence.cjs` dentro de una transacción SQLite; el guardado agrega evento `state_saved` a la bitácora. No se encontró una tabla relacional independiente de empresas en esta ruta. Por ello, agregar campos opcionales a `Company` es técnicamente compatible con el modelo de snapshot, pero aún exige revisar restauración de respaldos, importación/migración y consumidores que construyen empresas.
 
### 7.2 Flujos de alta y edición
El alta se ejecuta en `src/components/CompanyModal.tsx` y llama `addCompany`; la edición se ejecuta en `src/components/Configuracion/ConfiguracionView.tsx` y llama `updateCompany`. Ambos formularios construyen/actualizan explícitamente las propiedades de empresa. Para no perder una futura selección normativa, se debe incluir el campo en ambos y mantenerlo en el spread de edición. En una pasada posterior se implementaron los tres campos opcionales y los formularios de alta/edición; ver sección 8.

### 7.3 Datos iniciales y restauración
`src/data/initialData.ts` declara `INITIAL_COMPANIES = []` en la configuración limpia de producción. La persistencia lee el snapshot previo con `JSON.parse` y guarda el nuevo snapshot íntegro. Los campos opcionales ausentes en empresas antiguas deben seguir ausentes y nunca convertirse silenciosamente en GE o PYME. La restauración de respaldo debe preservar valores conocidos y no inferir el marco por el tipo tributario, tamaño, RIF o nombre.

### 7.4 Generadores ISLR: riesgo técnico acotado
El generador heredado `generateSeniatIslrXml` interpola directamente RIF, período, factura, control y fecha en XML sin escape. También deriva el período de la primera retención y, cuando no hay comprobantes, usa un período predeterminado construido con el año fiscal y el literal `10`. Esto es comportamiento inseguro para entradas no confiables y semánticamente riesgoso para una declaración mensual vacía. El generador de operaciones `generateSeniatIslrOperationsXml` sí escapa contenido XML y recibe período explícito. La búsqueda automatizada del índice del repositorio no devolvió consumidores (el buscador consulta la rama por defecto, no esta rama de auditoría); por tanto el estado de uso del generador heredado permanece **no verificado**. No se debe retirar ni declarar muerto hasta una búsqueda en checkout de la rama y compilación completa.

### 7.5 Próxima implementación segura
1. Añadir un tipo discriminado explícito para marco contable, versión normativa y fecha de adopción, manteniendo opcionales los datos históricos.
2. Agregar selección obligatoria únicamente al crear nuevas empresas y al preparar el primer cierre nuevo; nunca inferir ni reescribir históricos.
3. Añadir pruebas para alta, edición, cambio de empresa, persistencia SQLite, exportación/restauración de respaldo y compatibilidad de snapshots sin marco.
4. Rastrear consumidores ISLR en el checkout de la rama; si se mantiene el generador heredado, hacer que valide período explícito y escape XML sin alterar el formato aprobado, con pruebas de regresión.
5. Bloquear la emisión de estados identificados como conformes VEN-NIF cuando no exista marco/version seleccionados y evidencia de adopción; no bloquear el registro contable diario solo por falta de metadatos históricos.

## 8. Implementación inicial de trazabilidad VEN-NIF (04-11-2026)

### 8.1 Cambios aplicados en rama de trabajo
- `Company` incorpora `accountingFramework?: 'VEN_NIF_GE' | 'VEN_NIF_PYME'`, `accountingFrameworkVersion?: string` y `accountingFrameworkAdoptionDate?: string`.
- `CompanyModal` solicita marco, referencia normativa y fecha documentada al crear una empresa. No preselecciona GE/PYME ni inventa la versión.
- `ConfiguracionView` permite registrar o editar los tres campos. Si se inicia la edición de la adopción, exige completar el conjunto; también permite dejarla pendiente en empresas históricas.
- No se cambió `addCompany` ni `updateCompany`: ambos conservan propiedades por spread/estado; el snapshot SQLite serializa el objeto completo. No se cambió esquema SQL.
- El respaldo de escritorio usa una copia consistente de SQLite y verifica integridad; como el metadato vive dentro del snapshot `state_json`, no requiere migración de tablas. Aun así falta una prueba de restauración de un respaldo real legado.
- La PR #95 se abrió como borrador para activar CI: https://github.com/fenixlife1978/Sicoven/pull/95. No se ha fusionado ni desplegado.

### 8.2 Límites de validación
- La ejecución de GitHub Actions `41859134391` (`SICOVEN Windows installer`) está en curso. Al último chequeo solo habían terminado checkout; instalación de Node, tests, TypeScript, build y prueba de actualización seguían pendientes. No declarar CI aprobado.
- No se han ejecutado localmente `npm test`, `npm run check:types` ni `npm run build` en esta sesión.
- No se han agregado todavía pruebas específicas para creación/edición/restauración de metadatos VEN-NIF.
- La metadata permite registrar una versión indicada por el usuario/contador; no certifica por sí misma que esa versión sea la aplicable al ejercicio. Se requiere catálogo normativo versionado y revisión profesional antes de habilitar la etiqueta de estados conformes.

### 8.3 Hallazgo normativo fiscal: Providencia SNAT/2025/000054
La Providencia SNAT/2025/000054 fue publicada en Gaceta Oficial 43.171 del 16-07-2025 y entró en vigor el 01-08-2025 según alertas legales profesionales. Deroga la SNAT/2015/0049. Amplía el artículo 1 a personas naturales calificadas y notificadas como sujetos pasivos especiales que estén constituidas como firma personal; conserva retención general del 75%, supuestos de retención del 100%, oportunidad al pago o abono en cuenta (lo primero), declaración incluso sin operaciones y comprobante de 14 caracteres AAAAMMSSSSSSSS. El código ya incluye campos para firma personal, condición de agente y fecha del evento fiscal; debe contrastarse cada excepción con el texto íntegro de la Gaceta y comprobar la vigencia de la norma antes de cambiar reglas.
Fuentes consultadas: IVECOFI con transcripción de la providencia (fuente secundaria) y alertas de Grant Thornton/Baker McKenzie; no se halló todavía una URL primaria SENIAT estable con el texto oficial.

## 9. Verificación de fuentes normativas y ajustes de alcance (04-11-2026)

### 9.1 Precisión obligatoria sobre BA VEN-NIF 11, versión 01
La Biblioteca Virtual oficial de la FCCPV identifica BA VEN-NIF 11 v01 con su alcance específico: reconocimiento del pasivo por impuesto diferido originado por la supresión del sistema de ajuste por inflación fiscal en Venezuela. No debe describirse como si, por sí solo, fuera una norma general que cubre todas las diferencias temporarias e impuestos diferidos de cualquier origen. La evaluación debe distinguir ese supuesto particular de los requerimientos generales de la norma internacional aplicable al marco GE/PYME y del resto de diferencias temporarias. La aplicabilidad se documentará por entidad y período, sin contabilización automática hasta validar el texto completo y las reglas de transición.
Fuente primaria de identificación: Biblioteca Virtual FCCPV, entradas 25–27 (BA VEN-NIF 12 v01, BA VEN-NIF 11 v01 y BA VEN-NIF 8 v11): https://biblioteca.fccpv.org/

### 9.2 Nueva norma de facturación: Providencia SNAT/2026/00093
Se detectó la Providencia Administrativa SNAT/2026/00093, publicada según la fuente consultada en Gaceta Oficial N° 43.484 del 21-10-2026. La fuente secundaria consultada transcribe, entre otros, los siguientes puntos:
- Artículos 4–6: medios digitales/electrónicos, imprentas autorizadas y máquinas fiscales; elección del medio y uso de formatos físicos de contingencia bajo supuestos específicos.
- Artículo 18: comprobantes de retención IVA e ISLR con numeración de 14 caracteres AAAAMMSSSSSSSS, datos de agente/proveedor, RIF, domicilio, correo electrónico del proveedor, fechas de emisión y entrega, documento, período, base e impuesto retenido.
- Disposiciones transitorias y derogatorias: cambios relevantes al régimen previo de facturación, con derogaciones parciales/totales de providencias anteriores.
- Disposición final octava: entrada en vigencia 180 días continuos contados desde su publicación. Si la fecha de publicación indicada se confirma en la Gaceta, la fecha calculada sería 19-04-2027; el sistema debe conservar el régimen anterior para operaciones previas y preparar una configuración normativa con vigencia futura, no activar la nueva regla anticipadamente.
Fuente secundaria para revisión técnica: https://tributos.ivecofi.net/informacion/legislacion/providencias/pa-2026-93
La publicación y el cómputo de vigencia deben confirmarse contra el ejemplar íntegro de la Gaceta Oficial y cualquier instructivo/manual técnico SENIAT antes de declarar cumplimiento. No se cambian aún los generadores ni la numeración histórica.

### 9.3 Calendario de obligaciones 2026
La Providencia SNAT/2025/000091 y el calendario 2026 de sujetos pasivos especiales/agentes de retención aparecen publicados en la Gaceta Oficial N° 43.273 de 09-12-2025. El calendario debe tratarse como una matriz anual versionada por último dígito del RIF, tipo de obligación y condición del contribuyente; no como una regla mensual uniforme. La copia consultada es la Gaceta reproducida por Acceso a la Justicia; se requiere conservar la fuente primaria SENIAT/Gaceta y sus eventuales correcciones.
Fuente: https://accesoalajusticia.org/wp-content/uploads/2025/12/Calendarios_Fiscales_SENIAT_2026.pdf

### 9.4 Ajuste de alcance de la captura VEN-NIF
La selección del marco y su evidencia de adopción no debe impedir el alta administrativa de una entidad cuando el contador aún no haya documentado formalmente la clasificación. Por ello, en la rama de auditoría se ajustó el formulario de alta para permitir metadatos ausentes y exigir el conjunto completo solo cuando se empieza a registrar una adopción. La edición de una empresa conserva los metadatos previamente persistidos si el formulario queda vacío; no los elimina por omisión accidental. Los reportes no podrán presentarse como conformes a un marco específico mientras falte la evidencia: el bloqueo de emisión conforme queda pendiente de rastrear e implementar en el punto común de generación de estados.

### 9.5 Próxima validación
1. Obtener y archivar los PDF completos FCCPV de BA VEN-NIF 8 v11, 11 v01 y 12 v01; extraer alcance, transición, vigencia y referencias exactas.
2. Obtener el ejemplar oficial completo de Gaceta 43.484 y el manual técnico SENIAT que desarrolle SNAT/2026/00093.
3. Revisar requisitos del comprobante de retención y los datos actuales del modelo; comprobar correo/domicilio del proveedor y fecha efectiva de entrega sin reescribir documentos históricos.
4. Implementar calendario 2026 con tests de fechas por último dígito y tipo de sujeto, preservando reglas históricas.
5. Rastrear el generador ISLR heredado en el árbol completo de la rama y probar restauración real de respaldos previos.
