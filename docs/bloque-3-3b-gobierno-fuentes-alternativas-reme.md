# Bloque 3.3B — Gobierno de fuentes alternativas y estimaciones de índices REME

**Estado:** diseño técnico previo a implementación.  
**Base de trabajo:** `main` posterior a PR #51.  
**Objetivo:** especificar cómo SICOVEN debe registrar y evaluar fuentes alternativas ante ausencia de INPC, sin confundirlas con índices oficiales ni habilitar cálculos REME.

## 1. Alcance y límites

Este subbloque define el contrato documental y de control para las fuentes previstas en los párrafos 17, 18 y 19 del BA VEN-NIF N.º 2, versión 4, según la base normativa incorporada en `docs/bloque-3-marco-normativo-inpc.md`.

No declara que una fuente concreta esté reconocida por FCCPV, no califica automáticamente a un experto, no importa datos reales, no calcula índices ni factores, no reexpresa partidas y no genera asientos. La implementación deberá quedar separada del control de disponibilidad de la serie oficial BCV de PR #51.

## 2. Clases de fuente que no deben confundirse

| Clase | Identificación en SICOVEN | Condición documental que debe acreditarse |
|---|---|---|
| INPC oficial BCV | `INPC_BCV` | Documento original BCV, período, publicación, observación y evidencia verificable. |
| IPC-AMC histórico | `IPC_AMC` | Documento histórico original y correspondencia del período hasta diciembre de 2007. |
| Estudio de experto | `ESTIMACION_EXPERTO` | Identidad y calificación del profesional, estudio firmado, metodología, cobertura, periodicidad, ausencia de sesgo y revelaciones. |
| Estudio público indicado por FCCPV | `ESTUDIO_FCCPV` | Evidencia de que la FCCPV identificó o indicó al profesional, firma u organismo y documento/serie aplicable. La mera disponibilidad pública no demuestra esta condición. |
| Estimación propia excepcional de la entidad | `ESTIMACION_PROPIA_EXCEPCIONAL` | Evidencia acumulativa de las condiciones restrictivas del párrafo 19: costo/esfuerzo desproporcionado para aplicar el párrafo 17 y ausencia de publicación admisible conforme al párrafo 18; fuentes macroeconómicas externas verificables, método, cálculos y aprobación. |

La categoría describe la naturaleza documental de la fuente; no significa que la observación sea automáticamente admisible para cualquier entidad, ejercicio o marco contable.

## 3. Expediente mínimo por fuente

La futura implementación debe almacenar en SQLite local, de forma versionada y no destructiva:

- Identificador de fuente y clase normativa.
- Emisor, autor, profesional responsable, firma u organismo.
- Identificación de credenciales, registro o evidencia de calificación, cuando aplique; nunca inferir la calificación por nombre o cargo.
- Documento original íntegro, nombre, formato, tamaño y SHA-256.
- Referencia bibliográfica, URL HTTPS cuando exista, fecha de publicación y fecha de obtención.
- Período cubierto, periodicidad, unidad, base, cobertura de bienes y servicios y universo geográfico.
- Metodología detallada y versión; frecuencia de actualización y política de revisiones.
- Declaración/justificación de ausencia de sesgo y limitaciones conocidas.
- Para párrafo 19: análisis cuantificado de costo/esfuerzo desproporcionado y evidencia de búsqueda/ausencia de publicación FCCPV aplicable.
- Para cada observación: período, valor original, valor normalizado, estado `ESTIMATED` o `PROJECTED`, unidad y referencia a la fuente.
- Responsable de importación, revisores, decisión, fecha, justificación y referencias normativas.
- Historial de sustitución, corrección o retiro sin sobrescribir expedientes utilizados previamente.

No se aceptará un hash como prueba de autenticidad: solo identifica el archivo revisado. La autenticidad y pertinencia requieren cotejo humano contra el emisor y documento originales.

## 4. Reglas de admisibilidad por clase

### 4.1 Estudio de experto — párrafo 17

La revisión profesional debe comprobar, como mínimo, que el estudio:
- fue elaborado por profesional cuya idoneidad está acreditada en el expediente;
- cubre una amplia gama de bienes y servicios, no una selección sesgada;
- usa metodología consistente y explícita para cada mes;
- presenta estimaciones mensuales y actualización periódica;
- documenta datos, ponderaciones, fuentes, limitaciones y ausencia de sesgo;
- permite reproducir los valores y explicar las revelaciones requeridas.

La aplicación no sustituirá el juicio profesional por un simple check de metadatos.

### 4.2 Estudio público indicado por FCCPV — párrafo 18

Se debe conservar la evidencia específica de la indicación/publicación de FCCPV y vincularla con el estudio, autor/organismo, intervalo temporal y observaciones. Un estudio privado, una publicación académica o un archivo encontrado en Internet no se clasifica automáticamente como fuente del párrafo 18.

Si no se dispone de la evidencia de indicación de FCCPV, la fuente queda pendiente o se evalúa bajo otra categoría únicamente si cumple por separado sus condiciones.

### 4.3 Estimación excepcional de la entidad — párrafo 19

No es una alternativa libre ni una opción de conveniencia. La evaluación debe documentar conjuntamente:
1. por qué obtener/aplicar el estudio de experto del párrafo 17 implica costo o esfuerzo desproporcionado para la entidad;
2. qué procedimientos se realizaron para comprobar que no existe publicación aplicable indicada por FCCPV conforme al párrafo 18;
3. qué fuentes macroeconómicas externas verificables se utilizaron;
4. por qué la información es pertinente, periódica y metodológicamente consistente;
5. cálculos, supuestos, sensibilidad, responsables y aprobación profesional.

Si falta cualquiera de esas condiciones, la observación no supera el control. La interfaz no debe permitir convertir una estimación propia en INPC oficial.

## 5. Estados y flujo de revisión propuestos

Estados separados, sin equivalencias implícitas:
- `DRAFT`: expediente en preparación.
- `PENDING_REVIEW`: importado, no utilizable.
- `NEEDS_EVIDENCE`: revisión detectó evidencia faltante.
- `REJECTED`: fuente o período rechazado con motivo.
- `APPROVED_FOR_DOCUMENTED_USE`: revisión documental y profesional aprobada para el propósito/entidad/período expresamente identificados.
- `SUPERSEDED`: existe expediente posterior; el anterior permanece consultable para auditoría.

La aprobación debe estar limitada a entidad, ejercicio, período, marco contable, finalidad y observaciones específicas. No se permite una aprobación global de “toda la serie” sin alcance definido. La nueva versión requiere un expediente nuevo y una relación explícita con la versión anterior.

El flujo debe ser de doble control cuando los roles disponibles lo permitan: importador y revisor no deben confundirse; si el sistema no puede garantizar separación de funciones, debe advertirlo y exigir revisión profesional independiente documentada fuera de la aplicación.

## 6. Contrato con el control de preparación y el futuro motor

- PR #51 conserva un gate exclusivo para IPC-AMC/INPC oficial; no se debe debilitar para hacer pasar estimaciones.
- Un futuro gate alternativo debe devolver una decisión independiente, con bloqueos y referencias documentales, sin alterar el resultado del gate oficial.
- Una serie estimada nunca se presentará con emisor BCV, etiqueta “oficial” ni estado `OBSERVED`.
- `PROJECTED` nunca se convierte en `ESTIMATED` ni en dato observado por aprobación administrativa.
- La selección de fuente debe quedar fijada en el expediente de cálculo por observación/mes y conservar versión/hash.
- La falta de evidencia no se corrige interpolando, copiando meses vecinos, extrapolando ni retrocediendo a una versión anterior.
- Ningún gate de fuentes activa cálculo: `calculationEnabled` permanece `false` hasta que se diseñe y apruebe por separado el motor, su metodología y sus casos profesionales.
- No se modifican asientos, saldos históricos, cierres ni la autenticación semilla.

## 7. Pruebas obligatorias antes de implementar

1. Fuente experta sin calificación o sin documento firmado: bloqueada.
2. Estudio experto sin amplia cobertura, método mensual o evidencia de sesgo: bloqueado.
3. Estudio público sin evidencia de indicación FCCPV: no admitido bajo párrafo 18.
4. Estimación propia sin análisis de costo/esfuerzo desproporcionado: bloqueada.
5. Estimación propia sin evidencia de ausencia de publicación FCCPV: bloqueada.
6. Observación proyectada: nunca elegible como observada.
7. Documento alterado tras aprobación: hash distinto y nueva versión/revisión.
8. Aprobación para otro ejercicio/empresa: no reutilizable fuera del alcance.
9. Nueva versión: no modifica expedientes ni cierres previos.
10. Gate oficial BCV: permanece independiente y conserva sus reglas de PR #51.
11. Toda prueba usa SQLite en memoria y fixtures sintéticos claramente etiquetados; ningún fixture se importa a bases de clientes.

## 8. Criterios de cierre del subbloque

- Modelo de datos aditivo, migración SQLite compatible y reversible mediante respaldo/restauración (sin borrar historial).
- Contratos IPC/preload limitados a sesión/licencia y permisos.
- Importación conserva archivo original, hash y observaciones append-only.
- Revisión vinculada a alcance y roles; decisiones inmutables.
- Pruebas negativas para cada requisito normativo y de evidencia.
- UI distingue visualmente oficial, estimado y proyectado.
- Gate alternativo independiente del gate oficial.
- El motor REME sigue deshabilitado y no crea asientos.
- Documentación advierte que la validación de software no sustituye la aprobación del contador responsable ni certifica por sí sola cumplimiento VEN-NIF.

## 9. Fuentes y límites de evidencia

La especificación se basa en la descripción de los párrafos 17, 18 y 19 ya documentada en `docs/bloque-3-marco-normativo-inpc.md`. Antes de convertirla en reglas ejecutables se debe volver a contrastar el texto normativo oficial vigente y cualquier aclaratoria/guía FCCPV aplicable al ejercicio. No se afirma que exista actualmente una lista pública vigente de profesionales, estudios ni series aprobados por FCCPV.

**Resultado:** diseño de control para revisión; no hay importación de datos reales, cálculo, contabilización ni habilitación de REME.
