# SICOVEN — Hoja de ruta y reglas arquitectónicas permanentes

## Alcance del producto

SICOVEN es exclusivamente un software de escritorio autónomo. No es una aplicación web ni un servicio alojado.

## Fuente única de verdad

- SQLite local es la única base de datos y fuente de verdad del sistema.
- Las operaciones, validaciones, auditorías, reportes y pruebas deben ejecutarse contra la base SQLite local.
- No introducir Firebase, Firestore, Turso, Vercel, bases de datos remotas ni servicios externos como dependencia operativa.
- No convertir cachés, archivos temporales ni almacenamiento auxiliar en fuentes de verdad.

## Exclusión expresa de Vercel

Vercel no forma parte de la arquitectura ni de la operación de SICOVEN. Sus despliegues, cuotas, límites, estados de compilación y fallos no son bloqueantes, criterios de aceptación ni tareas de la hoja de ruta. No se deben ejecutar despliegues Vercel ni esperar disponibilidad de Vercel para validar o completar SICOVEN.

## Validación y distribución

La validación del producto se realiza mediante:
- Pruebas automatizadas locales y CI del repositorio.
- Comprobación de tipos y compilación del escritorio.
- Pruebas de persistencia, integridad y migraciones SQLite.
- Construcción y verificación del instalador de escritorio.
- Pruebas reales de actualización entre versiones y conservación de los datos SQLite.
- Pruebas funcionales de los flujos contables y fiscales.

## Reglas de trabajo

- Trabajar exclusivamente en el repositorio `fenixlife1978/Sicoven`.
- No mezclar cambios con CRM-SICOVEN ni con otros proyectos.
- Mantener `main` intacta y trabajar en la rama/PR autorizada; no fusionar sin autorización expresa.
- No modificar el flujo del administrador semilla salvo solicitud expresa.
- No declarar homologación o certificación SENIAT sin contrastar la norma primaria vigente y completar la validación que corresponda en el entorno oficial.

## Estado de continuidad — bloque TXT IVA

- Rama de trabajo: `feature/txt-iva-structural-audit`.
- PR de seguimiento: #88.
- Commit de corrección de conciliación: `06a9f2a11084c1db0897a7698bf9aeb03efda9c5`.
- SICOVEN CI #40: correcto (pruebas automatizadas, TypeScript y build).
- Desktop Validation #1251: correcto.
- Windows installer #1368: correcto; instalador generado y actualización 1.0.6 → 1.0.7 verificada conservando SQLite.
- Próximo trabajo: terminar auditoría estructural del TXT de retenciones IVA (clasificación documental, integridad de los 16 campos, sanitización, codificación, orden determinista y casos límite); después contrastar la especificación SENIAT vigente y documentar con precisión qué queda probado y qué requiere homologación oficial.
- Vercel queda expresamente fuera de alcance y no debe volver a aparecer como bloqueo o criterio de avance.
