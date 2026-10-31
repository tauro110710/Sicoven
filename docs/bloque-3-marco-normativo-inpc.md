# Bloque 3 — Base normativa y gobierno de índices para el ajuste por inflación

**Estado:** especificación preparatoria; no implementa cálculos ni contabilizaciones.  
**Base:** `main` posterior a PR #41.  
**Objetivo:** fijar reglas verificables antes de incorporar índices, reexpresión, REME/resultado monetario o asientos.

## 1. Fuentes normativas y jerarquía

1. **FCCPV — BA VEN-NIF N.º 2, versión 4**, “Criterios para el Reconocimiento de la Inflación en los Estados Financieros preparados de acuerdo con los VEN-NIF”. Es la regla local que determina el procedimiento y las fuentes de índices/estimaciones:
   - Grandes entidades: procedimiento de NIC 29.
   - Pequeñas y medianas entidades: Sección 31 de la NIIF para las PYMES.
   - Reconocimiento cuando la inflación acumulada del ejercicio sobrepasa un dígito; si es de un dígito, la gerencia evalúa materialidad, comparabilidad y revelación suficiente.
   - Para cifras originadas en ejercicios finalizados antes del 31-12-2007: IPC del Área Metropolitana de Caracas con base diciembre 2007 y los INPC emitidos desde enero 2008. Para transacciones originadas después de diciembre de 2007: únicamente INPC mensuales emitidos por el BCV.
   - No se aceptan estados reexpresados con valores desagregados del INPC ni con otro índice emitido por el BCV.
   - Ante ausencia del INPC: aplicar el orden y condiciones de los párrafos 17, 18 y 19; nunca reemplazarlo con una serie inventada o con una extrapolación automática del sistema.
   - Si el BCV publica posteriormente los índices estimados, evaluar BA VEN-NIF 4 y NIC 10 / Sección 32.
   - Los cambios en el método de estimación se reconocen prospectivamente.

2. **FCCPV — Guía de aplicación del BA VEN-NIF N.º 2, versión 4.** Aclara que el promedio simple de los tres últimos INPC de la versión anterior fue eliminado. Las estimaciones expertas deben estudiar un amplio rango de bienes y servicios, aplicar metodología mensual uniforme, estar libres de sesgo y actualizarse mensualmente. También aclara la necesidad de juicio profesional, revelaciones y análisis de sensibilidad.

3. **NIC 29 / Sección 31 NIIF para las PYMES.** Se aplicará la norma correspondiente al marco de la entidad, sin mezclar procedimientos entre marcos.

## 2. Orden permitido de fuentes de índices

Para cada mes/período, SICOVEN deberá conservar el origen exacto del dato y aplicar esta jerarquía:

1. INPC general oficial publicado por el BCV, cuando esté disponible y corresponda al período.
2. Si faltan meses y se requiere información ajustada: estimación sustentada en estudio de profesional experto conforme al párrafo 17 del BA VEN-NIF 2, con metodología mensual, amplia cobertura, ausencia de sesgo, actualización y revelaciones.
3. Estudio público de profesional, firma u organismo calificado indicado por la FCCPV, conforme al párrafo 18, con las revelaciones requeridas.
4. Estimación propia de la entidad solo en el supuesto restringido del párrafo 19: imposibilidad de aplicar el párrafo 17 por costo o esfuerzo desproporcionado y, simultáneamente, ausencia de publicación FCCPV del párrafo 18. Debe sustentarse en información macroeconómica externa verificable, periódica y metodológicamente consistente, y conservar el análisis interno documentado.

El sistema no decidirá por sí solo que una estimación cumple estos requisitos. La fuente y su aceptación requieren revisión y aprobación profesional documentada.

## 3. Reglas de datos y trazabilidad

Cada observación de índice o estimación deberá conservar, como mínimo:

- código y tipo de índice (IPC-AMC histórico, INPC oficial, estimación experta, estudio FCCPV o estimación propia excepcional);
- período económico al que corresponde (año/mes);
- valor publicado y unidad/escala, sin alterar el valor fuente;
- variación mensual/acumulada solo cuando esté explícitamente publicada o calculada por una función matemática identificada y probada;
- emisor, documento, URL o referencia bibliográfica, fecha de publicación y fecha de consulta/importación;
- archivo fuente original y huella SHA-256 cuando se importe un documento;
- condición del dato: oficial, estimado, sustituido o pendiente de validación;
- motivo de ausencia y fundamento normativo de cualquier estimación;
- usuario, fecha y evidencia de aprobación;
- versión de la serie y registro de correcciones, sin sobrescribir observaciones utilizadas en cierres anteriores.

Los datos se almacenarán localmente en SQLite. La importación de fuentes podrá requerir una acción del usuario, pero la operación contable no dependerá de servicios en nube. No se incorporarán valores de ejemplo como datos contables reales.

## 4. Controles obligatorios

- No mezclar IPC-AMC histórico e INPC sin respetar los períodos y reglas del párrafo 16.
- No aceptar índices regionales, sectoriales o desagregados como sustitutos del INPC general para reexpresión VEN-NIF.
- No aplicar el promedio de los tres últimos índices publicados.
- No completar meses faltantes mediante interpolación, proyección o scraping automático sin una fuente y fundamento admitidos por el BA VEN-NIF 2.
- No recalcular ni reescribir asientos históricos al cambiar una serie; conservar la versión utilizada y registrar los ajustes autorizados como operaciones nuevas.
- Diferenciar datos oficiales de estimaciones y presentar la incertidumbre/revelación que corresponda.
- Evaluar el deterioro de activos no monetarios después de reexpresarlos.
- La decisión de aplicar el ajuste debe considerar marco contable, período, inflación acumulada y evaluación de materialidad cuando corresponda.
- Toda cifra reexpresada deberá poder rastrearse hasta partida original, fecha de origen, índice inicial/final, factor, fórmula, redondeo, papel de trabajo y asiento propuesto/aprobado.

## 5. Alcance de esta especificación

Esta rama **no**:
- importa una serie de índices sin evidencia documental de su autenticidad y período;
- calcula factores de reexpresión;
- clasifica automáticamente cuentas como monetarias/no monetarias;
- genera resultados monetarios ni asientos;
- modifica saldos, históricos, asientos, cierres, autenticación o administrador semilla;
- declara cumplimiento o certificación VEN-NIF.

La implementación funcional del Bloque 3 se dividirá en subbloques posteriores, cada uno con pruebas reproducibles y revisión profesional.

## 6. Fuentes consultadas

- FCCPV, BA VEN-NIF N.º 2, versión 4 (texto y numerales 11–29): https://contadores.ivecofi.net/informacion/normativa/fccpv/ven-nif/ba-ven-nif-2
- FCCPV, registro de la Biblioteca Virtual para BA VEN-NIF N.º 2, versión 4: https://campusvirtual.fccpv.org/mod/data/view.php?d=18&rid=92
- FCCPV, Guía de aplicación del BA VEN-NIF N.º 2, versión 4 (PDF): https://assets.kpmg.com/content/dam/kpmg/ve/pdf/2026/3/Gu%C3%ADa%20de%20Aplicaci%C3%B3n%20del%20BA%20VEN%20NIF%20N%C2%B0%202%20%28versi%C3%B3n%204%29.pdf
- FCCPV, Tips para cierres contables 2025: https://campusvirtual.fccpv.org/pluginfile.php/89034/mod_data/content/988/Tips_para_cierres_contables_2025_CPPC_VFF.pdf

## 7. Condición para iniciar la implementación

Antes de codificar el motor de cálculo se debe:
1. confirmar con la FCCPV la versión normativa vigente a la fecha de cada ejercicio y cualquier modificación posterior;
2. obtener y verificar la serie oficial INPC/IPC-AMC disponible, identificando meses ausentes;
3. documentar qué fuente de estimación reconoce la FCCPV para cada intervalo sin INPC;
4. definir el modelo de datos SQLite y su migración aditiva;
5. aprobar la matriz de partidas monetarias/no monetarias y el tratamiento por marco (GE/ PYME);
6. preparar casos de referencia con resultados esperados revisados por profesional.

Hasta completar la verificación documental de las series, la funcionalidad permanece en administración de evidencia y no se generarán cálculos contables.


## 8. Subbloque 3.1A — almacenamiento local y protocolo de importación

Se incorporó una primera capa técnica para recibir series documentales sin convertirlas automáticamente en índices aprobados ni en datos utilizables por el motor contable.

### Arquitectura integrada

- Persistencia directa en la base local `sicoven.sqlite`, mediante `better-sqlite3`.
- Tablas separadas para fuentes documentales, series, observaciones mensuales y decisiones de revisión.
- Conservación del texto CSV original y su huella SHA-256.
- Versionado incremental por código de serie y tipo de medición.
- Conservación de los períodos faltantes detectados entre la primera y última observación.
- Valores decimales almacenados como texto normalizado, sin conversión a coma flotante para conservar la precisión publicada.
- Tablas y decisiones append-only: no se permite modificar ni borrar la evidencia importada.
- Auditoría de importaciones y revisiones.
- Acceso mediante IPC de Electron, protegido por sesión válida; importación y aprobación restringidas al administrador.
- La serie se registra inicialmente como `PENDING_REVIEW`; solo una decisión administrativa documentada puede aprobarla o rechazarla.
- Una serie aprobada no se sobrescribe. Una corrección requiere importar una nueva versión.

### Formato de importación de esta fase

CSV UTF-8 con encabezados de período y valor, por ejemplo:

```csv
period;value
AAAA-MM;valor
```

El ejemplo anterior es únicamente una plantilla estructural; no constituye una serie real ni debe importarse como dato contable.

Las observaciones conservan además su naturaleza: los índices BCV/IPC-AMC se marcan OBSERVED; las estimaciones de expertos o propias, ESTIMATED; y las series de estudios FCCPV exigen una columna status explícita para separar ESTIMATED de PROJECTED. Una proyección nunca se confunde con un dato observado.\n\nSe admiten dos magnitudes separadas:
- `INDEX_LEVEL`: nivel de índice, positivo, con período base obligatorio.
- `MONTHLY_VARIATION_PCT`: variación porcentual mensual, expresada en puntos porcentuales; no puede ser igual o inferior a -100%.

Se validan fechas, duplicados, valores, columnas, tamaño máximo de 5 MB y hasta 600 observaciones por archivo. Las lagunas se reportan; el sistema no interpola, proyecta ni completa meses ausentes.

### Límites deliberados

- Esta fase no contiene cifras históricas oficiales ni estimadas.
- No se descargan datos automáticamente ni se consulta un servicio remoto durante la operación.
- La plataforma Federación Virtual puede requerir credenciales gremiales para consultar determinados índices; no se elude ese control ni se incorporan datos de terceros sin autorización.
- Una huella SHA-256 acredita la identidad del archivo importado, no la autenticidad de su emisor. La aprobación exige revisión documental humana.
- La aprobación de una serie no habilita todavía cálculos de factores, reexpresión o REME.
- La interfaz de administración de índices y la importación asistida desde archivos se completarán en el siguiente subbloque de interfaz.

### Archivos técnicos

- `electron/inflation-indexes.cjs`
- `electron/inflation-indexes.test.cjs`
- `electron/main.cjs`
- `electron/preload.cjs`
- `src/electron.d.ts`

**Estado 3.1A:** COMPLETADO e integrado mediante PR #44. CI de escritorio e instalador aprobados. No se han cargado índices reales.

## 9. Subbloque 3.1B — interfaz de administración e importación

**Estado: COMPLETADO mediante PR #45** (commit de fusión `fe641deaae6eb13660986cd0d814a021143fbdeb`).

- Vista de escritorio «Inflación y REME» integrada en la navegación.
- Consulta de series desde SQLite por IPC autenticado.
- Selección de CSV UTF-8 y captura de metadatos de fuente, emisor, referencia, fecha de publicación y URL opcional.
- Validación preliminar antes de guardar; muestra cobertura, observaciones, estados, meses faltantes y SHA-256.
- Importación como nueva versión inmutable y pendiente de revisión.
- Aprobación/rechazo documental con justificación.
- La aprobación no activa factores, reexpresión, REME ni asientos.
- CI de escritorio aprobado; CI Windows aprobó build del instalador, verificación del artefacto y actualización 1.0.6 → 1.0.7 conservando SQLite. El artefacto fue generado en CI y no publicado como release.

## 10. Subbloque 3.1C — verificación y adquisición de series auténticas

**Estado: INVESTIGACIÓN DE FUENTES REALIZADA; IMPORTACIÓN DE DATOS BLOQUEADA POR FALTA DEL ARCHIVO FUENTE PRIMARIO VERIFICABLE.**

### Evidencia pública localizada

- La FCCPV anunció que el BCV publicó los índices y variaciones mensuales del INPC desde diciembre de 2007 hasta agosto de 2026, disponibles en la sección Estadísticas del BCV y en Federación Virtual, sección Valor Agregado.
- La FCCPV anunció que la variación porcentual mensual FCCPV/Econométrica cubre enero de 2016 a agosto de 2026 y que septiembre de 2026 se presenta como proyección. Esta última serie debe clasificarse como estimación/proyección según la observación; nunca como INPC observado del BCV.
- Una fuente secundaria identifica el archivo estadístico BCV como `4_5_7`, pero esta referencia no sustituye la descarga ni la verificación del archivo original.

### Bloqueo de adquisición

- La consulta automatizada a `https://www.bcv.org.ve/estadisticas/consumidor` respondió HTTP 502 durante la investigación.
- La publicación de FCCPV remite a Federación Virtual para consultar el material de valor agregado; el acceso a algunos documentos puede requerir autenticación gremial.
- No se obtuvo el archivo fuente BCV ni el libro/archivo original FCCPV-Econométrica en esta etapa.
- No se importaron valores de sitios secundarios, capturas, extractos parciales ni tablas copiadas sin poder verificar el documento primario.

### Condición para cerrar 3.1C

1. Obtener el archivo original desde BCV o desde el canal oficial autorizado de Federación Virtual.
2. Conservar el archivo original y registrar URL, emisor, fecha de publicación/consulta, nombre, período, base, unidad y SHA-256.
3. Comprobar continuidad y cobertura contra el documento original; documentar meses faltantes y revisiones.
4. Separar INPC oficial observado, IPC-AMC histórico, estimaciones expertas, estudios FCCPV y proyecciones.
5. Importar en SICOVEN usando la interfaz 3.1B, revisar la previsualización y aprobar documentalmente solo tras validación humana.
6. Mantener pendientes las series o períodos sin respaldo primario suficiente.

**No se declara 3.1C completado.** No se cargaron cifras reales en SQLite en esta etapa y no se habilita el motor REME. El siguiente trabajo puede continuar en la preparación de la matriz de clasificación 3.2 sin asumir que los índices faltantes están disponibles.
