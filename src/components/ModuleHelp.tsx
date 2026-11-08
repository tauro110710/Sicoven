import React, { useState } from 'react';
import { AlertCircle, BookOpenCheck, ChevronDown, HelpCircle } from 'lucide-react';

type HelpItem = {
  question: string;
  answer: string;
  kind?: 'guide' | 'normative' | 'warning';
};

const MODULE_HELP: Record<string, { title: string; intro: string; items: HelpItem[] }> = {
  diario: {
    title: 'Libro Diario',
    intro: 'Orientación para registrar, consultar y revisar asientos contables.',
    items: [
      { question: '¿Cómo registro un asiento contable?', answer: 'Abra Libro Diario y utilice la opción de nuevo asiento. Identifique la fecha y el concepto, agregue las cuentas y sus importes, y compruebe que el total del Debe coincida con el total del Haber antes de guardar. Revise que las cuentas y el período correspondan a la operación real.', kind: 'guide' },
      { question: '¿Cómo corrijo un asiento que ya fue contabilizado?', answer: 'Localice el asiento en Libro Diario y revise su fecha, cuentas, documentos relacionados y si pertenece a un período cerrado. No altere silenciosamente el registro original: la corrección debe conservar la trazabilidad y reflejar el efecto contable que corresponda. Utilice la función de corrección o reversión disponible en la versión instalada; si no existe una opción adecuada, no improvise una modificación directa de la base de datos.', kind: 'warning' },
      { question: '¿Puedo borrar un asiento de un período cerrado?', answer: 'No debe eliminarse ni modificarse sin dejar rastro. El tratamiento depende de la naturaleza del error, la fecha en que se detectó y las normas aplicables al período. Una corrección trazable o un ajuste en el período que corresponda suele ser distinto de borrar el registro original. No se debe atribuir una prohibición específica a VEN-NIF sin identificar la norma y el caso concreto.', kind: 'normative' }
    ]
  },
  mayor: {
    title: 'Libro Mayor',
    intro: 'Consulte movimientos, saldos y composición de cada cuenta.',
    items: [
      { question: '¿Cómo consulto los movimientos de una cuenta?', answer: 'Abra Libro Mayor, seleccione la cuenta y delimite el período. Revise los saldos iniciales, débitos, créditos y saldo final, y utilice el detalle del movimiento para rastrear su asiento de origen.', kind: 'guide' },
      { question: '¿Por qué el saldo del Mayor no coincide con el balance?', answer: 'Compruebe que ambos informes utilicen la misma empresa, período, moneda y criterios de inclusión. Verifique también que no existan asientos pendientes, fechas fuera del rango o cuentas con clasificación incorrecta. No ajuste cifras manualmente para forzar una coincidencia: identifique primero la causa.', kind: 'warning' }
    ]
  },
  balances: {
    title: 'Balances y estados financieros',
    intro: 'Guía para preparar, revisar y presentar información financiera.',
    items: [
      { question: '¿Qué debo revisar antes de emitir estados financieros?', answer: 'Confirme el período, que los asientos estén completos, que los saldos cuadren, que las cuentas estén clasificadas correctamente y que se hayan evaluado los ajustes necesarios. Revise políticas contables, moneda funcional, inflación y revelaciones que resulten aplicables a la entidad.', kind: 'guide' },
      { question: '¿Puedo cambiar cifras directamente en un estado financiero?', answer: 'Los estados deben derivarse de los registros y ajustes contables, no de cambios manuales que oculten diferencias. Corrija el asiento o proceso de origen y vuelva a generar el informe. Las reclasificaciones y ajustes deben quedar sustentados y trazables.', kind: 'warning' }
    ]
  },
  tesoreria: {
    title: 'Tesorería',
    intro: 'Orientación para administrar fondos, cuentas y movimientos de tesorería.',
    items: [
      { question: '¿Cómo registro un ingreso o egreso?', answer: 'Seleccione la cuenta de tesorería correspondiente, indique fecha, importe, moneda, concepto y contraparte cuando aplique. Antes de confirmar, compruebe que el movimiento represente una entrada o salida real y que no esté registrado previamente.', kind: 'guide' },
      { question: '¿Qué hago si registré un pago en la cuenta bancaria equivocada?', answer: 'Localice el movimiento y verifique si ya fue conciliado o vinculado a otro registro. Corrija mediante la función disponible, conservando el historial y evitando duplicar el pago. Si el movimiento ya produjo efectos en otros módulos, revise esas relaciones antes de corregir.', kind: 'warning' }
    ]
  },
  conciliacion: {
    title: 'Conciliación bancaria',
    intro: 'Compare los registros contables con los movimientos informados por el banco.',
    items: [
      { question: '¿Cómo comienzo una conciliación?', answer: 'Seleccione la cuenta bancaria y el período, indique el saldo del estado de cuenta y compare cada movimiento bancario con su registro contable. Marque coincidencias y analice por separado depósitos en tránsito, cheques pendientes, comisiones y diferencias.', kind: 'guide' },
      { question: '¿Debo forzar la conciliación cuando existe una diferencia?', answer: 'No. Mantenga identificada la diferencia hasta determinar su causa. Puede deberse a fechas de corte, movimientos no registrados, duplicados, comisiones o errores de importe. Registre el ajuste que corresponda y conserve la explicación de la diferencia.', kind: 'warning' }
    ]
  },
  compras: {
    title: 'Libro de Compras',
    intro: 'Registro y consulta de facturas, notas y operaciones de compra.',
    items: [
      { question: '¿Cómo registro una factura de compra?', answer: 'Ingrese los datos del proveedor y del comprobante, fecha, bases imponibles, impuestos, retenciones si corresponden y total. Compruebe la consistencia aritmética y el tratamiento fiscal según la operación y la condición del contribuyente.', kind: 'guide' },
      { question: '¿Puedo modificar una compra después de declararla?', answer: 'Primero determine si la operación fue incluida en un libro, declaración, retención, pago o asiento. No cambie el registro como si esos efectos no existieran. Utilice el mecanismo de corrección que corresponda y revise los períodos y obligaciones relacionados. El tratamiento fiscal concreto debe validarse con la normativa vigente.', kind: 'normative' }
    ]
  },
  cxp: {
    title: 'Cuentas por pagar',
    intro: 'Seguimiento de obligaciones con proveedores y sus pagos.',
    items: [
      { question: '¿Cómo registro un abono a un proveedor?', answer: 'Localice la obligación, verifique su saldo y aplique el pago indicando fecha, importe, cuenta de tesorería y referencia. Confirme que el abono no se haya aplicado anteriormente y que la moneda sea consistente con la obligación.', kind: 'guide' },
      { question: '¿Qué hago si pagué dos veces una factura?', answer: 'Revise ambos movimientos bancarios y la aplicación de pagos. No elimine uno sin comprobar si realmente hubo una segunda salida de fondos. Registre la situación como corresponda (por ejemplo, anticipo o saldo a favor, si procede) y conserve la trazabilidad.', kind: 'warning' }
    ]
  },
  ventas: {
    title: 'Libro de Ventas',
    intro: 'Registro y control de comprobantes y operaciones de venta.',
    items: [
      { question: '¿Qué datos debo verificar al registrar una venta?', answer: 'Revise identificación del cliente cuando aplique, fecha, número y tipo de comprobante, conceptos, bases imponibles, alícuotas, exenciones, retenciones y total. Asegúrese de que el registro corresponda al comprobante efectivamente emitido.', kind: 'guide' },
      { question: '¿Cómo corrijo una venta ya emitida?', answer: 'Identifique el comprobante y sus efectos contables y fiscales. La solución puede requerir una nota de crédito, débito u otro procedimiento permitido según el motivo y la normativa vigente. No altere el comprobante original ni genere otro documento sin verificar la secuencia y el tratamiento fiscal aplicable.', kind: 'normative' }
    ]
  },
  cxc: {
    title: 'Cuentas por cobrar',
    intro: 'Control de saldos de clientes, cobros y anticipos.',
    items: [
      { question: '¿Cómo registro un cobro parcial?', answer: 'Localice la cuenta por cobrar, compruebe el saldo pendiente y registre el importe recibido, fecha, medio y cuenta de destino. Aplique el cobro a la factura correcta y revise el saldo remanente.', kind: 'guide' },
      { question: '¿Qué hago con un cobro recibido sin identificar?', answer: 'Registre y mantenga identificada la recepción según las opciones disponibles, sin aplicarla arbitrariamente a una factura. Investigue la referencia y la contraparte; luego aplique el importe cuando exista información suficiente.', kind: 'warning' }
    ]
  },
  inventario: {
    title: 'Inventario',
    intro: 'Control de existencias, costos y movimientos de inventario.',
    items: [
      { question: '¿Cómo registro una entrada o salida de inventario?', answer: 'Seleccione el artículo y el tipo de movimiento, indique fecha, cantidad, costo o referencia de origen y verifique el efecto sobre las existencias. Compruebe que el movimiento corresponda a una compra, venta, devolución, traslado o ajuste real.', kind: 'guide' },
      { question: '¿Puedo cambiar el costo de un artículo con movimientos históricos?', answer: 'No sustituya el costo histórico sin analizar sus efectos. Revise el método de valoración, las capas o movimientos que originaron el saldo y el impacto en costo de ventas y estados financieros. Corrija el origen del error mediante un ajuste trazable.', kind: 'warning' }
    ]
  },
  'activos-fijos': {
    title: 'Activos fijos',
    intro: 'Registro de bienes capitalizados y depreciación financiera vinculada al Libro Diario.',
    items: [
      { question: '¿Cómo registro un activo?', answer: 'Seleccione una línea de adquisición que ya esté contabilizada en una cuenta de Propiedades, Planta y Equipos (1.2). El registro del activo enlaza esa línea y no crea un segundo asiento de compra. Complete la fecha en que estuvo disponible para uso, la vida útil, el estimado de valor residual y las cuentas de depreciación.', kind: 'guide' },
      { question: '¿Cómo se calcula la depreciación?', answer: 'La primera etapa utiliza el método lineal financiero, prorrateado por los días exactos de disponibilidad para uso y con ajuste de redondeo en el período final. Cada período genera un asiento en Libro Diario en Bs. y USD. Revise vida útil, residual y patrón de consumo antes de contabilizar.', kind: 'guide' },
      { question: '¿El módulo calcula depreciación fiscal o bajas de activos?', answer: 'Todavía no. La depreciación fiscal, bajas/ventas, deterioro, revaluaciones y efectos de inflación requieren flujos y políticas separados. No utilice el cálculo financiero como deducción fiscal ni registre una baja manual sin el procedimiento contable correspondiente.', kind: 'warning' }
    ]
  },
  'ret-iva': {
    title: 'Retenciones de IVA',
    intro: 'Ayuda para revisar comprobantes, períodos y archivos de retenciones.',
    items: [
      { question: '¿Qué debo comprobar antes de generar el archivo de retenciones?', answer: 'Verifique el período, los comprobantes incluidos, identificación fiscal, fechas, bases, alícuotas, montos retenidos y totales. Compare el resultado con los comprobantes y con el diseño oficial vigente exigido por el SENIAT antes de transmitirlo.', kind: 'guide' },
      { question: '¿Puedo corregir una retención después de entregar la declaración?', answer: 'Determine primero qué comprobante y período fueron afectados y qué mecanismo de rectificación admite la normativa vigente. No suponga que basta con editar el archivo local: revise los efectos en el libro, la declaración y el comprobante entregado.', kind: 'normative' }
    ]
  },
  'ret-islr': {
    title: 'Retenciones de ISLR',
    intro: 'Orientación para registrar, consultar y preparar retenciones de ISLR.',
    items: [
      { question: '¿Cómo determino si una operación está sujeta a retención?', answer: 'Identifique la naturaleza del pago, el beneficiario, su condición fiscal, la base y el supuesto normativo aplicable. Consulte la providencia y tarifas vigentes para ese concepto; no aplique un porcentaje por analogía con otra operación.', kind: 'normative' },
      { question: '¿Qué reviso antes de emitir un comprobante?', answer: 'Compruebe los datos del agente y beneficiario, concepto, fecha, base, porcentaje, monto retenido y período. Compare el comprobante con el registro de origen y conserve su referencia para futuras consultas.', kind: 'guide' }
    ]
  },
  catalogo: {
    title: 'Plan de Cuentas',
    intro: 'Consulte y mantenga la estructura de cuentas contables.',
    items: [
      { question: '¿Cómo agrego una cuenta contable?', answer: 'Revise primero si existe una cuenta equivalente. Si necesita crearla, seleccione el nivel y la naturaleza adecuados, asigne un código único y una descripción clara, y compruebe que su clasificación sea coherente con la estructura contable de la entidad.', kind: 'guide' },
      { question: '¿Puedo eliminar una cuenta que ya tiene movimientos?', answer: 'Antes de cualquier cambio, compruebe si la cuenta tiene asientos, saldos o informes relacionados. Una cuenta utilizada normalmente debe conservarse para mantener la historia; evalúe inactivarla o reclasificarla mediante un procedimiento trazable, en lugar de borrar sus antecedentes.', kind: 'warning' }
    ]
  },
  reversiones: {
    title: 'Reversiones, cierres y correcciones',
    intro: 'Consulte las consecuencias de los cierres y cómo abordar errores con trazabilidad.',
    items: [
      { question: '¿Qué debo revisar antes de cerrar un período?', answer: 'Compruebe que los registros del período estén completos, que los auxiliares concilien con el Mayor, que se hayan revisado impuestos, inventario, tesorería y ajustes, y que los informes reflejen la información disponible. Realice una copia de seguridad antes de una operación de cierre cuando la función esté disponible.', kind: 'guide' },
      { question: '¿Qué hago si detecto un error después del cierre?', answer: 'Identifique el período, el asiento o documento afectado y sus relaciones con impuestos, cobros, pagos e informes. Determine el tratamiento contable y fiscal aplicable y utilice el mecanismo de corrección trazable disponible. No borre el original ni reabra períodos sin evaluar las consecuencias.', kind: 'warning' },
      { question: '¿Todo error obliga a reabrir el período?', answer: 'No necesariamente. La respuesta depende de la materialidad, naturaleza del error, fecha de detección, marco contable y reglas de presentación aplicables. Evalúe si corresponde corregir en el período actual, reexpresar información comparativa u otro tratamiento; no existe una respuesta única para todos los casos.', kind: 'normative' }
    ]
  },
  inflacion: {
    title: 'Inflación y REME',
    intro: 'Ayuda para el proceso de reexpresión y revisión de efectos de inflación.',
    items: [
      { question: '¿Qué información debo revisar antes de ejecutar una reexpresión?', answer: 'Verifique el período, índices aplicables, fechas de origen de partidas, clasificación monetaria y no monetaria, saldos de apertura y movimientos. Confirme que los índices y criterios correspondan al marco contable y período evaluado.', kind: 'guide' },
      { question: '¿Puedo cambiar un índice después de generar el REME?', answer: 'No sustituya el índice sin evaluar qué cálculos y estados dependen de él. Documente la fuente y vigencia, revise el impacto y vuelva a ejecutar el proceso controlado si corresponde, manteniendo evidencia de la versión utilizada.', kind: 'warning' }
    ]
  },
  config: {
    title: 'Configuración',
    intro: 'Orientación para los datos de la entidad, ejercicios y parámetros del sistema.',
    items: [
      { question: '¿Qué debo configurar al crear una empresa?', answer: 'Revise razón social, RIF, domicilio, actividad, condición tributaria, ejercicio económico, moneda funcional y demás datos que utilicen los módulos. Una configuración incorrecta puede propagarse a libros, comprobantes e informes.', kind: 'guide' },
      { question: '¿Puedo cambiar la moneda funcional cuando quiera?', answer: 'No es un simple cambio de visualización. La moneda funcional se determina según el entorno económico de la entidad y los criterios de la NIC 21; un cambio requiere sustento en un cambio de circunstancias económicas y tratamiento prospectivo cuando corresponda. La moneda de presentación es un concepto distinto.', kind: 'normative' }
    ]
  }
};

const FALLBACK_HELP: HelpItem[] = [
  { question: '¿Cómo utilizo este módulo?', answer: 'Revise primero el propósito de cada sección, complete los datos de la operación real y compruebe los importes antes de guardar. Consulte esta ayuda cuando tenga dudas y verifique las relaciones con otros módulos.', kind: 'guide' },
  { question: '¿Debo adjuntar documentos para continuar?', answer: 'Los adjuntos son opcionales en SICOVEN por regla general. Puede conservar soportes cuando sean útiles para justificar una operación; solo una obligación legal específica y aplicable podría exigirlos.', kind: 'warning' }
];

const kindLabel = (kind?: HelpItem['kind']) => kind === 'normative'
  ? 'Criterio normativo'
  : kind === 'warning' ? 'Precaución' : 'Cómo hacerlo';

export const ModuleHelp: React.FC<{ moduleId: string }> = ({ moduleId }) => {
  const [expanded, setExpanded] = useState<number | null>(0);
  const module = MODULE_HELP[moduleId];
  const items = module?.items ?? FALLBACK_HELP;
  const title = module?.title ?? 'Ayuda del módulo';
  const intro = module?.intro ?? 'Orientación práctica para trabajar en esta sección de SICOVEN.';

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm no-print" aria-labelledby="module-help-title">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-sky-50 to-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-100 p-2.5 text-sky-700"><BookOpenCheck className="h-5 w-5" /></div>
          <div>
            <h2 id="module-help-title" className="text-base font-bold text-slate-900 sm:text-lg">Ayuda y preguntas frecuentes · {title}</h2>
            <p className="mt-1 text-sm text-slate-600">{intro}</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800">
          <HelpCircle className="h-3.5 w-3.5" /> Ayuda del módulo
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="mt-3 space-y-2">
          {items.map((item, index) => {
            const isOpen = expanded === index;
            return (
              <article key={item.question} className="overflow-hidden rounded-xl border border-slate-200">
                <button type="button" onClick={() => setExpanded(isOpen ? null : index)} aria-expanded={isOpen} className="flex w-full items-start justify-between gap-3 p-3.5 text-left transition hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-sky-700">{kindLabel(item.kind)}</span>
                    <span className="block text-sm font-semibold text-slate-800">{item.question}</span>
                  </span>
                  <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/70 px-3.5 py-3 text-sm leading-6 text-slate-700">
                    {item.answer}
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          Las respuestas orientan el uso del sistema. La aplicación de VEN-NIF y normas tributarias depende de los hechos de cada operación y de la normativa vigente; SICOVEN no presenta una recomendación como prohibición legal sin fundamento específico. Los adjuntos y soportes no se convierten en trámites obligatorios por esta ayuda.
        </p>
      </div>
    </section>
  );
};
