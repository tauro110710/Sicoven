# RT-01 — Independencia entre contabilización y respaldo documental

**Estado:** criterio arquitectónico aprobado; auditoría inicial completada; implementación de gestión de adjuntos pendiente de diseño e integración.  
**Alcance:** transversal a los módulos que registran operaciones, comprobantes y movimientos contables.  
**Persistencia:** SQLite local, sin servicios remotos obligatorios.

## 1. Regla principal

La existencia de un archivo adjunto nunca será una condición universal para registrar, guardar o contabilizar una operación válida. El respaldo documental digital es opcional y complementario. La ausencia de un archivo se registra como una condición documental pendiente, no como un error contable ni como evidencia de que la operación sea inválida.

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
- El estado documental pendiente aparece en consultas e informes.
- Un archivo inválido, demasiado grande o con ruta manipulada es rechazado sin afectar la operación contable.
- Los adjuntos y su auditoría sobreviven al cierre y reapertura de SICOVEN y a la actualización de la aplicación.

## 8. Secuencia de implementación

1. Mantener desde ahora la regla de no exigir adjuntos para contabilizar.
2. Diseñar tabla SQLite dedicada a documentos y eventos, evitando almacenar binarios dentro del JSON general de estado contable.
3. Implementar IPC Electron validado para incorporar, consultar, abrir y sustituir archivos en almacenamiento local.
4. Añadir interfaz opcional en compras, ventas, asientos y demás módulos según su pertinencia.
5. Añadir estados documentales e informes de pendientes.
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
