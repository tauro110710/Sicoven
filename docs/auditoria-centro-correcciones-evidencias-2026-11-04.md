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

Si cualquiera de estas condiciones falla, el expediente permanece aprobado y abierto. El motor de estados también exige que la función de ejecución reciba el ID y la colección exacta de evidencia; no permite completar expedientes desde una llamada sin identidad documental.

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
- `WITHDRAWN`: retirado por el solicitante antes de ejecutar.

La observación puede ocurrir durante revisión y también después de aprobar, antes de ejecutar. Solo el solicitante original puede subsanar y reenviar; el expediente vuelve a revisión y pierde la aprobación anterior. Cada observación y reenvío se registra en una tabla de eventos separada, append-only, y en la bitácora general. Si falla la bitácora, la transacción completa revierte. Se conserva el historial de aprobaciones/observaciones y se exige una nueva revisión independiente antes de ejecutar.

La migración es aditiva: incorpora `workflow_stage` y normaliza las etapas de expedientes existentes según su estado, sin borrar documentos ni expedientes.

## Contraste de relaciones reales y alcance habilitado

Se contrastaron los vínculos que persisten los generadores:
- Ventas: NC/ND con `originalSaleId` y tipo fiscal `03`/`02`.
- Compras: NC/ND con `originalPurchaseId` y tipo fiscal `03`/`02`.
- Asientos: reversos con `reversalOfEntryId` y ajustes con `adjustmentForEntryId`.
- Kardex: corrección física con `correctionForMovementId`.
- Los efectos sobre comprobantes IVA/ISLR y eventos ISLR se gobiernan desde el expediente de compra o asiento que origina el contraasiento; no se abren expedientes independientes para subregistros que no tienen generador autónomo.

El formulario formal solo permite cuatro clases de origen: venta, compra, asiento contable y movimiento de inventario. Se retiraron los tipos que no tenían un generador autónomo conectado al ciclo de aprobación/ejecución. Esto evita aprobar un expediente que después no pueda ejecutarse por el flujo real.

## Ciclo formal, autorización y retiro

El workflow conserva el expediente y registra eventos append-only:
- `IN_REVIEW`: pendiente de revisión independiente.
- `OBSERVATION_REQUIRED`: devuelto al solicitante con motivo obligatorio.
- `READY_FOR_EXECUTION`: aprobado y sin observaciones pendientes.
- `COMPLETED`: ejecución confirmada.
- `CLOSED`: rechazado.
- `WITHDRAWN`: retirado por el solicitante antes de ejecutar.

Solo el solicitante original puede subsanar y reenviar una observación, o retirar el expediente antes de su ejecución. El reenvío invalida la aprobación anterior y exige nueva revisión. El retiro bloquea aprobación, reenvío y ejecución posteriores. La migración de casos y la reconstrucción del ledger de eventos se realizan de forma transaccional y conservan los eventos anteriores.

Los generadores de NC/ND de venta y compra, ND de proveedor y reversión de asientos exigen ahora un expediente único aprobado que coincida con empresa, registro fuente y referencia correctiva; el operador debe ser distinto del solicitante y del aprobador. La devolución física desde el centro de reversión exige la misma autorización antes de crear el movimiento. La confirmación final vuelve a validar evidencia correctiva vinculada, ID/colección exactos y soporte `EVIDENCIA_CORRECCION` verificado. Después de una observación, el soporte debe volver a verificarse con fecha posterior a la observación más reciente.

## Pruebas definidas y límites de verificación

La suite del workflow contiene **21 pruebas definidas** para segregación, rollback, migración, retiro, observación/subsanación, autorización previa, vínculos de NC/ND, asientos y Kardex. La suite documental conserva nueve pruebas definidas. La suite de liquidaciones/auxiliares contiene **21 pruebas definidas**, incluyendo el incremento de CxP por ND de proveedor. Ninguna de estas suites se ejecutó en esta sesión; no se declara que estén aprobadas.

## Ajuste adicional de CxP por notas de débito de proveedor

Se corrigió un defecto detectado en el auxiliar: antes se restaban las NC de proveedor, pero no se sumaban las ND tipo `02` vinculadas por `originalPurchaseId`. Ahora las ND aumentan el saldo CxP por su total fiscal en Bs/USD; las NC lo reducen por la porción aplicada a CxP y mantienen el excedente como anticipo. En CxC, las ND de venta siguen usando el ajuste neto de la cuenta por cobrar y no el total bruto del documento.

Se incorporó el helper `summarizeCreditDocumentAdjustments` y sus pruebas unitarias correspondientes.

## Pendientes reales

No se declara terminado el centro. Aún falta integrar/validar:
- Rectificativas/sustitutivas de declaraciones IVA/ISLR, libros fiscales rectificados y acuses/enteramientos.
- Corrección formal autónoma de movimientos bancarios y tasa BCV, si se decide que deben tener expediente propio.
- Reconciliación integral de efectos de todas las variantes de NC/ND sobre caja/bancos, retenciones, IGTF, costos, inventario y CxC/CxP, incluyendo pruebas de datos reales.
- Pruebas de SQLite real, concurrencia, respaldo/restauración, TypeScript, build y empaquetado Electron.

No se ejecutó CI ni se publicó release. No se modificó el administrador semilla ni se borraron registros fuente.
