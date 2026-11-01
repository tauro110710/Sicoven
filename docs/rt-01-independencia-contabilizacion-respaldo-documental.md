# RT-01 — Independencia entre contabilización y respaldo documental

**Estado:** política funcional aprobada e integrada parcialmente. Los adjuntos son voluntarios; la contabilización no depende de ellos.  
**Alcance:** transversal a los módulos que registran operaciones, comprobantes y movimientos contables.  
**Persistencia:** SQLite local, sin servicios remotos obligatorios.

## 1. Regla principal

La existencia de un archivo adjunto nunca será condición para registrar, guardar, contabilizar, procesar, conciliar, pagar, cobrar o cerrar una operación válida. El respaldo digital es voluntario y complementario. La ausencia de un archivo no crea un estado pendiente, una alerta, una calificación negativa, una advertencia de incumplimiento ni un bloqueo.

Esta regla no elimina las obligaciones legales de emisión, conservación, exhibición o custodia que correspondan al contribuyente. SICOVEN facilita el control del contador, pero no sustituye la responsabilidad legal del contribuyente.

## 2. Validaciones que sí deben mantenerse

La independencia documental no reduce las validaciones de negocio. Cada operación debe exigir los datos fiscales y contables que correspondan a su naturaleza, por ejemplo:

- Fecha y tipo de documento.
- Número de factura y número de control cuando sean aplicables.
- RIF y datos de identificación de la contraparte.
- Base imponible, montos exentos, alícuotas, IVA y total.
- Cuentas, tasas, período y demás datos necesarios para el registro.
- Reglas de consistencia, duplicidad, período, partida doble y tratamiento fiscal.

Los campos serán condicionales al tipo de operación y a la normativa aplicable. No se deben convertir datos no aplicables en requisitos artificiales.

## 3. Estados documentales

Cuando exista gestión de adjuntos, el sistema distinguirá al menos:

- `PENDING_SUPPORT`: operación registrada sin respaldo digital incorporado.
- `ATTACHED_UNREVIEWED`: documento incorporado, todavía no revisado.
- `VERIFIED`: documento revisado por un usuario autorizado.
- `OBSERVATION_REQUIRED`: existe una observación documental.
- `REPLACED`: documento sustituido; la versión anterior permanece en el historial.

La ausencia de archivo no debe etiquetarse como fraude, incumplimiento probado ni invalidez fiscal. Tampoco la presencia de un archivo equivale a verificación.

## 4. Incorporación posterior del respaldo

La futura gestión documental debe permitir:

- Incorporar PDF e imágenes después de registrar la operación.
- Asociar varios documentos a una misma operación.
- Registrar tipo, nombre original, tamaño, MIME, fecha de incorporación y usuario.
- Mantener hash SHA-256 para identificar integridad y duplicados.
- Sustituir un archivo sin destruir el anterior ni modificar silenciosamente el asiento.
- Registrar revisión, observaciones y usuario responsable.
- Consultar y exportar listados de soportes pendientes por empresa, período, módulo y contraparte.

Los archivos deben almacenarse localmente bajo el control de la aplicación y con rutas seguras. No guardar rutas arbitrarias proporcionadas por el renderer. La apertura debe impedir path traversal y validar tamaño, tipo y contenido permitido.

## 5. Separación de responsabilidades y auditoría

SICOVEN debe distinguir entre:

1. Datos estructurados registrados.
2. Validaciones fiscales y contables ejecutadas.
3. Existencia o ausencia de archivo digital.
4. Revisión documental efectuada por el contador.
5. Custodia del soporte físico o digital por el contribuyente.

La incorporación, sustitución, revisión y observación de documentos deben dejar eventos de auditoría append-only con operación relacionada, empresa, usuario y fecha. Ninguna acción documental debe alterar automáticamente los importes, fechas fiscales ni asientos originales.

## 6. Auditoría inicial del código en main

Revisión efectuada sobre el HEAD `ea7fd869fc5d9afc8e6264b5df5ad997dc41613d`:

- `src/components/LibroCompras/NewPurchaseModal.tsx`: exige datos estructurados de la compra; no contiene un control de archivo adjunto obligatorio.
- `src/components/LibroVentas/NewSaleModal.tsx`: exige datos estructurados de la venta; no contiene un control de archivo adjunto obligatorio.
- `src/components/LibroDiario/NewEntryModal.tsx`: permite referencia documental textual opcional; no exige archivo adjunto.
- `src/types/accounting.ts`: los modelos revisados no establecen una propiedad universal de archivo como requisito para compras, ventas o asientos.

Por tanto, no se encontró una restricción de archivo adjunto que actualmente bloquee estos tres flujos. No se modifican sus validaciones fiscales existentes ni se elimina la obligatoriedad legítima de campos como RIF, número de factura, importes o referencia de pago cuando aplique.

## 7. Pruebas de aceptación para la implementación documental

- Una compra válida sin archivo se guarda y contabiliza.
- Una venta válida sin archivo se guarda y contabiliza.
- Un asiento manual válido sin archivo se guarda y contabiliza.
- Datos fiscales obligatorios ausentes o inconsistentes siguen siendo rechazados.
- Un archivo puede incorporarse después sin recrear ni duplicar la operación.
- Incorporar un archivo no modifica importes ni asientos.
- Sustituir un archivo conserva la versión anterior y su auditoría.
- No se generan listados de faltantes, alertas ni calificaciones por ausencia de adjuntos.
- Un archivo inválido, demasiado grande o con ruta manipulada es rechazado sin afectar la operación contable.
- Los adjuntos y su auditoría sobreviven al cierre y reapertura de SICOVEN y a la actualización de la aplicación.

## 8. Secuencia de implementación

1. Mantener desde ahora la regla de no exigir adjuntos para contabilizar.
2. Diseñar tabla SQLite dedicada a documentos y eventos, evitando almacenar binarios dentro del JSON general de estado contable.
3. Implementar IPC Electron validado para incorporar, consultar, abrir y sustituir archivos en almacenamiento local.
4. Añadir interfaz opcional en compras, ventas, asientos y demás módulos según su pertinencia.
5. Mantener la interfaz de adjuntos como una herramienta opcional de organización, sin bandejas de faltantes ni tareas obligatorias.
6. Incorporar pruebas automatizadas de persistencia, seguridad, auditoría y actualización.
7. Fusionar por etapas después de validar TypeScript, pruebas automatizadas, auditoría de recursos y compilación.

**Límite de esta entrega:** se formaliza el requisito y se audita que los tres formularios principales no exigen archivos adjuntos. No se afirma que exista ya un repositorio documental digital ni una interfaz de carga de archivos; esa implementación queda expresamente pendiente.


## 9. Motor local de documentos — segunda fase

Se añadió el módulo `electron/supporting-documents.cjs` con:
- Metadatos SQLite y eventos documentales append-only.
- Almacenamiento local privado fuera de la base de datos.
- Selector nativo de archivos; nunca se acepta una ruta de archivo enviada por el renderer.
- Validación de PDF/JPG/PNG/WEBP mediante extensión y firma binaria.
- Límite de 20 MB por archivo.
- Hash SHA-256 y comprobación de integridad al abrir.
- Asociación obligatoria a una empresa y operación que ya exista en SQLite.
- Revisión, observación, sustitución y acceso auditados.
- IPC protegido por licencia y sesión.

La API quedó expuesta por Electron preload y tipada en `src/electron.d.ts`.

## 10. Límites actuales

El motor y sus pruebas automatizadas están añadidos en la rama de implementación, pero aún requieren CI aprobada y fusión. La interfaz visual para adjuntar, consultar, revisar y sustituir documentos todavía no está integrada en las pantallas contables. La ausencia de documento sigue sin bloquear ninguna operación.


## 11. Política funcional definitiva — 01/11/2026

Esta política prevalece sobre cualquier texto anterior de este documento que pueda interpretarse como obligación de adjuntar soportes:

- Adjuntar documentos es completamente opcional.
- Ningún registro, asiento, factura, pago, cobro, conciliación, ajuste o cierre podrá bloquearse por no tener un archivo adjunto.
- El usuario podrá registrar y procesar sus operaciones normalmente.
- Cuando exista un soporte, SICOVEN ofrecerá la posibilidad de adjuntarlo voluntariamente.
- Los documentos adjuntos sirven para organizar y centralizar información de la empresa y facilitar consultas posteriores.
- El usuario podrá consultar, descargar, sustituir o eliminar adjuntos conforme a sus permisos y a las reglas de conservación que correspondan.
- La ausencia de adjuntos no generará alertas de incumplimiento, sanciones, bloqueos ni calificaciones negativas.
- La conservación documental y la justificación ante las autoridades corresponden a la empresa y al profesional contable.

**Texto de interfaz:** “Documentos adjuntos (opcional). Puedes adjuntar facturas, comprobantes o recibos para mantener la información organizada en un solo lugar. Es totalmente voluntario y no afecta el registro ni el procesamiento de esta operación.”

SICOVEN es una herramienta de apoyo contable, no un órgano policial, fiscalizador o investigador. Las pruebas técnicas y fixtures sintéticos son responsabilidad interna del desarrollo y nunca se trasladan al contador como carga documental.

### Estado de implementación observado en esta rama

- Compras, ventas y asientos principales no contienen controles de archivo obligatorio según la auditoría de sus formularios y el contexto contable.
- El panel de documentos se simplificó para ofrecer adjuntar, abrir y sustituir voluntariamente, sin estados de revisión, observaciones ni lenguaje de expediente.
- La API de almacenamiento documental mantiene validaciones de seguridad sobre los archivos que el usuario decida adjuntar. Estas validaciones solo se ejecutan al adjuntar y no intervienen en la contabilización.
- La eliminación lógica de adjuntos y su política de retención deben quedar alineadas con permisos; no se afirmará que esa acción está implementada hasta verificarla en el código.
