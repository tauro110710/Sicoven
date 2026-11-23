# PRIORIDAD ABSOLUTA — POLÍTICA BCV HISTÓRICA UNIFICADA (PR #190 Y ALCANCE TRANSVERSAL)

Esta regla tiene prioridad absoluta en SICOVEN y debe aplicarse coherentemente en todos los módulos, formularios, modales, validadores, cálculos, reportes, importaciones, guardado, edición y procesos contables. Es la corrección de la PR #190 y no debe quedar limitada al Libro Diario.

## Política obligatoria de fechas y tasa

- **Antes del 01/01/2018:** la tasa BCV NO es obligatoria, aunque existieran tasas históricas. El contador decide si registra una tasa y cuándo la necesita para su criterio contable. No bloquear una operación Bs. por falta de tasa.
- **Desde el 01/01/2018:** exigir tasa BCV válida solo en operaciones y flujos donde corresponda por la política contable y por la necesidad de conversión USD; nunca exigirla indiscriminadamente en operaciones exclusivamente en Bs. que no necesitan equivalencia.
- Una tasa omitida significa que la equivalencia USD está pendiente/no disponible; nunca se inventa, aproxima, sustituye por 1:1 ni se copia el importe Bs. al campo USD.
- Mantener los importes nominales en Bs. válidos e íntegros aunque no haya tasa.
- Sin tasa válida, los USD derivados de Bs. deben permanecer en cero/pendientes (según presentación del módulo) y no conservar equivalencias obsoletas.
- Al ingresar una tasa válida, calcular conversiones y conciliaciones duales conforme a las reglas del módulo. Al retirar o cambiar una tasa, limpiar/recalcular de forma segura los importes USD derivados de ella.
- Validaciones de interfaz y servidor, botones de guardar/confirmar, importadores, edición, cierres, reportes y prevalidaciones deben compartir el mismo criterio y no contradecirse.
- Respetar la fecha efectiva de la operación/documento para decidir la exigencia; no usar la fecha actual como sustituto.
- No alterar documentos originales, fechas, trazabilidad ni inventar datos. No realizar conversiones ficticias ni perder montos Bs. para forzar cuadre USD.
- Agregar pruebas de regresión por módulo y pruebas de coherencia transversal para fechas antes del corte, el día de corte y fechas posteriores, tasa vacía, tasa válida, tasa inválida y retiro de tasa.

## Ejecución

- Continuar sobre la PR #190 y las PR posteriores relacionadas, en orden y sin rehacer cambios ya implementados e integrados.
- Auditar SICOVEN completo para localizar validaciones, bloqueos, conversiones, valores por defecto o USD derivados que contradigan esta política; corregir todos los casos encontrados y añadir/actualizar pruebas.
- Mantener arquitectura, reglas contables, cronología, cierres y demás invariantes existentes; esta política no autoriza modos ni motores de reconstrucción histórica.
- Trabajar en ramas y PRs; **no hacer commits directos a `main`**.
- Ejecutar las validaciones relevantes, corregir fallos y repetirlas. No declarar completo algo no verificado.
- Mantener evidencias y, al terminar el alcance, generar un artefacto descargable de GitHub Actions con resultados y hashes; verificar workflow `Success` y artefacto disponible.

**No publicar versiones, no crear GitHub Releases ni desplegar a producción.** No iniciar tareas ajenas a esta política hasta autorización expresa del administrador.

Esta directiva reemplaza instrucciones previas de alcance que impedían continuar la corrección transversal.