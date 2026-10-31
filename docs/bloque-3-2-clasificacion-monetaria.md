# Bloque 3.2 — Clasificación monetaria y no monetaria

**Estado:** 3.2A — reglas de dominio y validación pura; pendiente de persistencia SQLite, interfaz y validación profesional.  
**Alcance de esta fase:** definir cómo validar decisiones explícitas sin clasificar automáticamente cuentas ni modificar saldos.

## 1. Principio contable

La característica esencial de una partida monetaria es el derecho a recibir o la obligación de entregar una cantidad fija o determinable de unidades monetarias. El efectivo y las cuentas por cobrar/pagar en dinero son ejemplos típicos. Las partidas monetarias no se reexpresan por índice general como si fueran partidas históricas no monetarias; los saldos contractualmente indexados se ajustan según el contrato.

Las demás partidas de activo y pasivo son, en principio, no monetarias. Inventarios, propiedad, planta y equipo e intangibles son ejemplos frecuentes. Los importes históricos de partidas no monetarias se reexpresan desde su fecha de origen; las partidas medidas a valor razonable o valor neto realizable corriente no se vuelven a reexpresar por el mismo índice general.

Referencias de base:
- NIC 29, párrafos 11–18.
- NIIF para las PYMES, Sección 31, párrafos 31.5–31.8 (edición 2015); la edición 2025 de la NIIF para las PYMES tiene vigencia general desde períodos que comiencen el 1-1-2027, con aplicación anticipada permitida. La adopción local VEN-NIF y el marco aprobado para cada entidad/ejercicio deben confirmarse antes de usar una edición.
- BA VEN-NIF N.º 2, versión 4, conforme a la jerarquía y restricciones documentadas en `bloque-3-marco-normativo-inpc.md`.

## 2. Diseño deliberado: no inferir por código o nombre

El catálogo de cuentas no basta para clasificar todas las partidas. Una cuenta puede contener derechos de distinta naturaleza:
- Anticipos a proveedores reembolsables en efectivo pueden ser monetarios.
- Anticipos aplicables a bienes o servicios futuros normalmente representan derechos no monetarios.
- Una cuenta agrupadora puede contener partidas monetarias y no monetarias.
- Una misma cuenta de inventarios puede contener lotes con distintas fechas de adquisición.
- Activos revaluados o medidos a valor corriente requieren fecha y base de medición propias.

Por ello:
- La cuenta imputable puede tener una clasificación general de referencia.
- Una cuenta mixta debe dividirse en componentes de saldo.
- Cada componente no monetario histórico debe identificar su fecha de origen.
- Una partida indexada debe enlazar la cláusula/contrato que determina su importe.
- La clasificación debe quedar pendiente de revisión hasta que un profesional la apruebe.
- No se propone clasificación automática basada en el código, denominación o tipo de cuenta.

## 3. Modelo de dominio implementado en 3.2A

Archivo: `src/types/inflationClassification.ts`.

Clasificaciones:
- `MONETARY`: derecho/obligación en importe monetario fijo o determinable.
- `NON_MONETARY`: partida cuyo derecho/obligación no consiste en recibir o entregar una cantidad fija/determinable de moneda.
- `MIXED`: clasificación general de una cuenta cuyo saldo debe desglosarse.
- `NOT_APPLICABLE`: cuentas de ingresos, costos y gastos; son flujos del período y su reexpresión se resolverá por fecha de reconocimiento en una fase específica, no como saldos monetarios/no monetarios.

Bases de medición:
- Efectivo o moneda fija/determinable.
- Indexación contractual.
- Derecho a bienes/servicios.
- Costo histórico.
- Valor razonable.
- Valor neto realizable.
- Importe revaluado.
- Mixto.
- Flujo del período.

Tratamientos derivados de la clasificación explícita:
- Monetaria ordinaria: no reexpresar por índice general.
- Monetaria indexada: ajustar según contrato.
- No monetaria histórica: reexpresar desde fecha de origen.
- No monetaria a valor corriente (valor razonable/VNR): no volver a reexpresar por el índice general.
- Cuenta mixta: exige desglose de componentes.
- Flujos de resultados: fuera de la clasificación de saldos; se tratarán según fecha de reconocimiento.

Validaciones:
- Empresa y ejercicio obligatorios.
- Cuenta existente e imputable.
- Coherencia entre tipo de cuenta y clasificación.
- Justificación y referencia normativa/documental.
- Fecha de origen para componente no monetario a costo histórico, bienes/servicios o revaluado.
- Fecha de medición para valor razonable o VNR.
- Importe histórico y moneda declarada; DUAL requiere importes Bs. y USD.
- Referencia contractual para partidas indexadas.
- Revisor y fecha para aprobar; justificación para rechazar.
- Prevención de duplicidad de decisiones activas por empresa, ejercicio, cuenta y componente.

Pruebas: `src/types/inflationClassification.test.ts`.

## 4. Límites de 3.2A

Esta fase no:
- persiste clasificaciones en SQLite;
- cambia el catálogo contable existente;
- asigna automáticamente clases a las cuentas;
- reexpresa saldos ni calcula REME;
- genera asientos;
- modifica ejercicios cerrados, históricos, saldos o documentos;
- decide qué marco VEN-NIF aplica a una empresa.

## 5. Próximos subbloques

3.2B — Persistencia SQLite:
- tabla append-only de decisiones por empresa/ejercicio/cuenta/componente;
- versiones y correcciones sin sobrescribir decisiones usadas;
- auditoría de creación, aprobación y rechazo;
- migración aditiva y pruebas de integridad;
- IPC autenticado y autorización.

3.2C — Interfaz:
- matriz por empresa y ejercicio;
- filtros de cuentas sin clasificar, pendientes, aprobadas, rechazadas y mixtas;
- desglose de componentes con fecha de origen, importe y moneda;
- justificación y referencias;
- flujo de revisión y aprobación;
- alertas de componentes no monetarios sin fecha de origen;
- ninguna clasificación se activa para cálculo hasta aprobación.

3.2D — Revisión de casos:
- caja y bancos;
- cuentas por cobrar/pagar;
- anticipos reembolsables y anticipos aplicables a bienes/servicios;
- inventarios y lotes;
- propiedad, planta y equipo;
- intangibles;
- patrimonio y aportes;
- impuestos y créditos fiscales;
- partidas indexadas;
- saldos mixtos y mediciones a valor corriente.

Cada caso debe tener revisión profesional documentada y referencia al marco aplicable.

## 6. Fuentes consultadas

- IFRS Foundation, IAS 29: https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2021/issued/part-a/ias-29-financial-reporting-in-hyperinflationary-economies.pdf
- IFRS Foundation, módulo de apoyo Sección 31: https://www.ifrs.org/content/dam/ifrs/supporting-implementation/smes/module-31.pdf
- IFRS Foundation, página de la NIIF para las PYMES y vigencia de la edición 2025: https://www.ifrs.org/issued-standards/ifrs-for-smes/

La clasificación final y el tratamiento contable aplicable deben validarse con VEN-NIF adoptadas por FCCPV para el ejercicio de la entidad. Las referencias internacionales sustentan el modelo conceptual, pero no sustituyen la adopción local ni el juicio profesional.
