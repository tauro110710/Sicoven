# Centro de Correcciones, Reversiones y Ajustes — diseño e implementación incremental

**Fecha:** 04/11/2026  
**Rama:** audit/contabilidad-vennif-fiscal-seniat-1.0.14  
**Estado:** primera entrada operativa de reversión desde Libro Diario; circuito integral en desarrollo.

## 1. Objetivo
El usuario autorizado debe localizar el documento o asiento origen, revisar relaciones, solicitar corrección y seguir el expediente. Cadena verificable: origen → causa → revisión → autorización → documento correctivo → asiento(s) → auxiliares → efecto fiscal documentado → soportes.

No todas las correcciones producen los mismos efectos. Revertir un asiento no equivale a anular factura, cancelar compra, devolver dinero, revertir inventario ni rectificar declaración.

## 2. Flujos obligatorios
### Antes de contabilizar o emitir
- Editar o descartar borradores que no hayan generado número fiscal, asiento, inventario, pago, retención ni otro efecto irreversible.
- Si ya existe numeración fiscal asignada, conservar número y aplicar el procedimiento de anulación exigible para el medio de emisión; nunca reciclar correlativos.
- Auditar creación, edición, descarte y emisión con actor y fecha/hora.

### Después de contabilizar
- Bloquear edición directa y borrado físico de documentos y asientos contabilizados.
- Exigir motivo, fecha efectiva, papel de trabajo y soportes.
- Para asiento manual sin submayores enlazados: previsualizar y registrar contra-asiento balanceado, enlazado al asiento fuente.
- Para compra/venta, banco/caja, retenciones, impuestos, nómina, inventario, anticipos y liquidaciones: ejecutar flujo especializado que concilie primero los efectos dependientes. Si falta contrapartida o fuente documental, bloquear y explicar.
- La corrección parcial requiere documento de ajuste parcial; no usar reversión total para simular una nota de crédito parcial.
- La sustitución genera documento nuevo con identificador propio y referencia explícita al reemplazado; nunca reutiliza número ni reescribe el original.

### Período cerrado y errores anteriores
- No permitir asientos retroactivos dentro de períodos cerrados.
- Diferenciar error del período corriente, cambio de estimación y error material de período anterior.
- Evaluar errores anteriores conforme a NIC 8 / sección equivalente VEN-NIF aplicable, materialidad y marco GE/PYME adoptado. El AIA no debe aplicarse automáticamente a todo asiento antiguo.
- Exigir análisis profesional, fecha de detección, período afectado, materialidad, cuenta patrimonial apropiada cuando corresponda, aprobador y revelación. Reexpresión o ajuste de resultados acumulados depende del marco aplicable y de naturaleza/materialidad del error.

## 3. Expediente funcional
1. Bandeja por empresa, fecha, documento, asiento, estado, tipo y responsable.
2. Detalle del origen: documento, asientos, Kardex, caja/banco, CxC/CxP, retenciones, declaraciones, pagos y soportes.
3. Solicitud: categoría, causa, fecha de detección, fecha efectiva propuesta, importe y alcance total/parcial.
4. Análisis de impacto: simulación Debe/Haber Bs./USD, inventario/costos, auxiliares, conciliación bancaria y efectos fiscales identificados.
5. Aprobación segregada entre preparador y aprobador según rol/materialidad.
6. Ejecución atómica SQLite de documento correctivo y asientos enlazados.
7. Cierre documental: soportes, referencia externa, acuse/recibo, declaración y pago; estado de gestión no significa aceptación automática del SENIAT.

## 4. Integridad no negociable
- Append-only para documentos emitidos, asientos contabilizados, eventos y snapshots fiscales.
- No UPDATE/DELETE de historia económica; agregar eventos compensatorios.
- Toda referencia debe pertenecer a la misma empresa y existir.
- Idempotencia: reintentos no crean contra-asientos ni movimientos duplicados.
- Un asiento fuente admite una reversión total; correcciones parciales se modelan como ajustes separados.
- Contra-asiento balanceado en cada moneda; validar redondeo y tasa/snapshot de origen.
- No reversar un contra-asiento como si fuera origen; nueva corrección debe enlazarse.
- Respetar períodos cerrados, secuencias fiscales, conciliaciones y dependencias.
- Persistencia confirmada en SQLite antes de mostrar éxito; fallo no puede dejar estado parcial.
- Auditoría con usuario/rol, fecha/hora, empresa, acción, entidad, IDs origen/destino, motivo, papel de trabajo y resultado.

## 5. Normativa venezolana y límites
### Documentos fiscales
La Providencia SNAT/2011/00071 regula facturas y otros documentos; sus artículos 22–24 contemplan notas de débito/crédito cuando la operación queda sin efecto o se ajusta, con referencia al documento que soportó la operación. Sus artículos 36, 41 y 42 sustentan conservación y prohibición de alterar datos emitidos. La aplicación exacta debe cotejarse con norma vigente y medio autorizado.

La Providencia SNAT/2026/00093 (Gaceta Oficial 43.484) establece en su artículo 12 que las notas de débito/crédito se emiten por el mismo medio utilizado en la factura modificada y deben referenciar datos de la factura original. La vigencia general indicada en el expediente de auditoría es 19-04-2027; antes de esa fecha no adelantar su aplicación.

### VEN-NIF
- Distinguir período corriente y anteriores, error material, cambio de estimación y política.
- Aplicar el texto VEN-NIF adoptado por la entidad (GE o PYME), BA VEN-NIF vigente y versión incorporada al marco venezolano; no asumir adopción automática de toda norma NIIF internacional.
- AIA, reexpresión y revelaciones requieren validación de contador público colegiado para el caso concreto.

### Retenciones y declaraciones
- Una reversión contable no elimina comprobante de retención, no deshace enteramiento ni rectifica declaración.
- Si documento fue declarado o pagado, conservar snapshot, período, acuse, pago/conciliación y decisión fiscal. No calcular reintegro/compensación ni marcar resuelto sin procedimiento y fuente primaria vigente.
- Mantener bloqueada presentación si existen comprobantes con corrección fiscal pendiente, hasta registrar tratamiento y soportes conforme a normativa aplicable.

## 6. Implementado en esta entrega
- Se incorpora JournalReversalModal en Libro Diario y acción contextual Reversar asiento para asientos fuente no reversados.
- Se habilita el mismo flujo desde Libro de Compras y Libro de Ventas: el botón Anular localiza el asiento de origen y abre el expediente de reversión; no ejecuta borrado ni reversión directa.
- Solicita fecha efectiva, motivo y papel de trabajo; para asientos de períodos cerrados solicita cuenta de resultados acumulados y usa el flujo AIA existente.
- Reutiliza reverseJournalEntry en AccountingContext: valida empresa, SQLite, duplicidad, fecha, período, dependencias, cuadre bimonetario y conciliación bancaria. Para facturas vinculadas, conserva importes/documento fuente y registra indicadores de anulación con el ID del contra-asiento; actualiza los estados de liquidaciones vinculadas y marca comprobantes de retención con corrección fiscal pendiente cuando corresponde.
- Contra-asiento conserva reversalOfEntryId, motivo y papel de trabajo. El asiento original no se reescribe; la UI deriva la relación buscando el contra-asiento enlazado. Se reconocen vínculos reversedByEntryId heredados solo por compatibilidad.
- Excluye contra-asientos y asientos ya reversados.

## 7. Pendientes antes de declarar completo
1. Expediente único de corrección con estados, permisos y aprobación segregada.
2. Edición/descarte seguro de borradores antes de contabilizar o emitir.
3. Sustitución de documentos con vínculo al original.
4. Correcciones parciales por documento.
5. NC/ND de ventas y NC de compras de servicios/sin líneas de inventario, con efectos completos en auxiliares, Kardex cuando aplique, caja/banco, CxC/CxP e impuestos. La reversión total existente no sustituye la emisión fiscal de NC/ND.
6. Devolución de compras contado conciliada contra salida de fondos o saldo a favor.
7. Rectificación fiscal conectada a declaración, comprobante, enteramiento y acuse; sin reglas fiscales supuestas. La incidencia IVA actual es solo expediente de revisión/actuación, no ejecuta rectificación ni determina reintegros.
8. Matriz de permisos, doble aprobación y límites por materialidad.
9. Auditoría de backup/restore y persistencia SQLite.
10. Pruebas de integración: duplicados, idempotencia, períodos cerrados, multiempresa, referencias faltantes, fallos de persistencia, Bs./USD, bancos, inventario y retenciones.
11. Incorporar autorización por roles y doble control real en backend; los formularios actuales solicitan motivo y papel de trabajo, pero todavía no implementan una matriz de aprobaciones ni segregación efectiva de funciones.

## 8. Criterio de aceptación
No declarar completa esta capacidad hasta que cada tipo documental con efecto contable tenga ruta especializada, la cadena pueda reconstruirse desde origen hasta documento/contra-asiento y evidencia fiscal, las pruebas de integridad/persistencia estén verdes y la normativa haya sido cotejada con fuentes primarias. Esta entrega abre la reversión desde la UI, pero no afirma que todos los flujos de corrección fiscal/documental estén terminados.