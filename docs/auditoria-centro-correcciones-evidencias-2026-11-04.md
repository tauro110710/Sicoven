# Centro Integral de Correcciones — evidencias ligadas al expediente
Fecha: 04/11/2026

## Integración añadida

- El archivo documental admite ahora `CORRECTION_CASE` como entidad asociada y valida el expediente por ID y empresa directamente contra SQLite.
- La vista de Reversión Fiscal permite adjuntar soporte al expediente, abrirlo, verificarlo u observarlo.
- El contexto contable incorpora el tipo `CORRECTION_CASE` para las operaciones documentales.
- El cierre del expediente exige al menos un soporte documental asociado directamente al expediente y cuyo último evento de revisión sea `REVIEWED`.
- Quien adjuntó la evidencia no puede verificarla ni observarla. La revisión exige una identidad distinta y queda registrada en los eventos append-only del archivo documental y en la auditoría general.
- Los archivos conservan huella SHA-256, tamaño, autor, fecha y eventos de acceso/revisión; no se sobrescribe ni elimina el soporte anterior.

## Pruebas incorporadas

El archivo `electron/supporting-documents.test.cjs` contiene nueve pruebas, incluidas:
- Adjuntar evidencia a un expediente específico y a su empresa.
- Rechazar enlaces a empresas ajenas.
- Impedir que el propio usuario que adjuntó la evidencia la verifique.
- Permitir la verificación por otro administrador.

El workflow de expedientes conserva ocho pruebas. Ninguna de estas suites se ha ejecutado en esta sesión; su incorporación no equivale a resultado aprobado.

## Protección del cierre

La ejecución ahora requiere simultáneamente:
1. Expediente aprobado.
2. Ejecutor distinto del solicitante y del aprobador.
3. Referencia correctiva distinta de la referencia fuente y coincidente con la declarada, cuando se haya declarado.
4. Documento correctivo persistido en la misma empresa, con referencia coincidente y vínculo explícito al registro fuente.
5. Al menos un soporte documental asociado al expediente y verificado por una identidad distinta de quien lo adjuntó.

Si cualquiera de estas condiciones falla, el expediente permanece aprobado y abierto.

## Pendientes

Falta validar en ejecución los nombres reales de relaciones de cada generador de documentos; la integración completa de los efectos de NC/ND, contraasientos, CxC/CxP, bancos, retenciones, Kardex y declaraciones; las pruebas completas de SQLite, concurrencia, respaldo/restauración, TypeScript y empaquetado Electron.

No se ha ejecutado CI ni se ha publicado un release. No se modificó el administrador semilla ni se alteraron registros fuente.


## Continuación incorporada: observación y subsanación formal

Se agregó un ciclo formal de expediente sin sobrescribir su historial:
- `IN_REVIEW`: pendiente de revisión independiente.
- `OBSERVATION_REQUIRED`: devuelto al solicitante con motivo obligatorio.
- `READY_FOR_EXECUTION`: aprobado y sin observaciones pendientes.
- `COMPLETED`: ejecución confirmada.
- `CLOSED`: rechazado.

La observación puede ocurrir durante revisión y también después de aprobar, antes de ejecutar. Solo el solicitante original puede subsanar y reenviar; el expediente vuelve a revisión y pierde la aprobación anterior. Cada observación y reenvío se registra en una tabla de eventos separada, append-only, y en la bitácora general. Si falla la bitácora, la transacción completa revierte. Se conserva el historial de aprobaciones/observaciones y se exige una nueva revisión independiente antes de ejecutar.

La migración es aditiva: incorpora `workflow_stage` y normaliza las etapas de expedientes existentes según su estado, sin borrar documentos ni expedientes.

## Contraste de relaciones reales y alcance habilitado

Se contrastaron los vínculos con los tipos persistidos:
- Ventas: NC/ND con `originalSaleId` y tipo fiscal `03`/`02`.
- Compras: NC/ND con `originalPurchaseId` y tipo fiscal `03`/`02`.
- Asientos: reversos con `reversalOfEntryId` y ajustes con `adjustmentForEntryId`.
- Kardex: corrección con `correctionForMovementId`.
- Comprobantes IVA/ISLR: la evidencia es el asiento correctivo referenciado por `correctionEntryId` / `correctionEntryIds` en el comprobante original.

El formulario de expedientes solo permite estas seis clases de origen, para evitar abrir casos ejecutables sobre entidades que todavía no persisten un vínculo correctivo verificable. Los otros escenarios no se consideran terminados; deben recibir su relación explícita antes de habilitarse.

La suite del workflow contiene ahora **13 pruebas definidas** que cubren segregación, rollback, vínculos de NC/ND de compra y venta, reversos/ajustes de asientos, comprobantes de retención y ciclo de observación/subsanación. No se han ejecutado en esta sesión. La suite documental mantiene nueve pruebas definidas, tampoco ejecutadas.
