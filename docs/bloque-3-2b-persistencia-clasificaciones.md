# Bloque 3.2B — Persistencia SQLite de clasificaciones

**Estado:** implementación validada; CI de escritorio e instalador Windows aprobados en el commit de código revisado. La interfaz de usuario y los casos profesionales permanecen en los subbloques 3.2C y 3.2D.

## Alcance
- Decisiones de clasificación por empresa, ejercicio, cuenta imputable y componente.
- Persistencia independiente del estado contable general.
- Importes históricos Bs./USD almacenados como texto decimal para evitar pérdida de precisión.
- Registro inicial siempre pendiente de revisión.
- Aprobaciones y rechazos en una tabla separada, inmutable, con actor, fecha y justificación.
- Correcciones mediante nuevas versiones enlazadas a la última decisión revisada.
- Triggers SQLite para impedir actualización/eliminación y proteger la cadena de versiones.
- Escritura de decisión + auditoría y revisión + auditoría dentro de una transacción.
- IPC de consulta para sesión válida; creación y revisión solo para administrador.
- Validación del companyId y de la cuenta imputable contra el estado contable persistido.
- No modifica asientos, saldos, cuentas ni históricos.

## Tablas
- `inflation_classification_decisions`: contenido profesional inmutable y versionado.
- `inflation_classification_reviews`: una revisión final por versión; APPROVED o REJECTED.

La situación vigente se deriva de la revisión asociada. Una decisión sin revisión permanece PENDING_REVIEW. La aprobación/rechazo no modifica la fila original.

## Seguridad y preservación
- No se cambia el administrador semilla ni el esquema de autenticación.
- No se habilita clasificación automática.
- No se activa cálculo REME.
- No se generan asientos.
- Las tablas nuevas son aditivas y separadas de app_state.
- La validación del proceso principal no confía en el renderer.

## Pruebas previstas
- Empresa inexistente y cuenta inexistente/no imputable.
- Incompatibilidad entre tipo de cuenta y clasificación.
- Componentes con moneda, fechas y referencias requeridas.
- Precisión decimal dual.
- Aprobación/rechazo inmutables.
- Corrección enlazada a versión previa revisada.
- Bloqueo por triggers de SQLite.
- Reversión transaccional si falla la auditoría.
- Sesión inválida y rol no administrador.
- Aislamiento por empresa.

## Fuera de alcance
Interfaz de usuario (3.2C), casos profesionales (3.2D), índices verificados (3.1C), cálculos de factores, REME y asientos.
