import { Company, VatRetentionVoucher, IslrRetentionVoucher, PurchaseRecord } from '../types/accounting';
import type { IslrFiscalEvent } from '../types/islrFiscalEvent';
import { cleanRif, validateVenezuelanRif } from './formatters';
import { getPurchaseAccountCreditDate } from '../types/accounting';

/**
 * Prepara un TXT de relación de retenciones IVA con estructura histórica de 16 columnas.
 * Su conformidad con las especificaciones técnicas vigentes del SENIAT debe validarse
 * antes de presentarlo en el Portal Fiscal; esta función no acredita aceptación oficial.
 */
export function generateSeniatIvaTxt(company: Company, vouchers: VatRetentionVoucher[], purchases?: PurchaseRecord[]): string {
  const agentRif = cleanRif(company.rif);
  const lines: string[] = [];

  if (!Array.isArray(vouchers)) throw new Error('La exportación IVA requiere una colección válida de comprobantes.');
  if (!validateVenezuelanRif(company.rif).isValid) throw new Error('El RIF del agente de retención no cumple la estructura venezolana válida.');
  if (vouchers.length === 0) throw new Error('No se genera un TXT vacío: registre la declaración sin operaciones mediante el flujo correspondiente y valide el procedimiento vigente del SENIAT.');
  if (new Set(vouchers.map(voucher => String(voucher.period || ''))).size > 1) {
    throw new Error('La exportación TXT de retenciones IVA debe contener un único período fiscal.');
  }
  if (new Set(vouchers.map(voucher => String(voucher.id || ''))).size !== vouchers.length ||
      new Set(vouchers.map(voucher => String(voucher.voucherNumber || ''))).size !== vouchers.length) {
    throw new Error('La exportación contiene comprobantes duplicados; revise los identificadores y correlativos antes de continuar.');
  }
  if (vouchers.some(voucher => voucher.requiresFiscalCorrection)) {
    throw new Error('La exportación está bloqueada: existen comprobantes con corrección fiscal pendiente.');
  }

  // La clasificación fiscal no puede inferirse desde el número de factura ni
  // degradarse silenciosamente a factura 01. Se exige la compra fuente para
  // distinguir factura, nota de débito y nota de crédito con trazabilidad.
  if (!Array.isArray(purchases)) {
    throw new Error('La exportación TXT IVA requiere las compras fuente para validar el tipo documental; no se permite clasificar documentos por defecto.');
  }
  const companyPurchases = purchases.filter(purchase => purchase.companyId === company.id);
  const purchasesById = new Map(companyPurchases.map(purchase => [purchase.id, purchase]));
  if (purchasesById.size !== companyPurchases.length) {
    throw new Error('La compra fuente contiene identificadores duplicados; revise la integridad de los documentos antes de exportar.');
  }

  for (const v of vouchers) {
    const linkedPurchase = purchasesById.get(v.purchaseRecordId);
    if (!linkedPurchase) {
      throw new Error(`El comprobante ${v.voucherNumber} no tiene una compra fuente válida vinculada; no se puede clasificar el documento.`);
    }
    const supplierRif = cleanRif(v.supplierRif);
    const invoiceDate = String(v.invoiceDate || '');
    const period = String(v.period || '');
    const invoiceNum = String(v.invoiceNumber || '').trim();
    const controlNum = String(v.controlNumber || '').trim();
    const voucherNum = String(v.voucherNumber || '').trim();
    const date = new Date(invoiceDate + 'T00:00:00.000Z');
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) &&
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === invoiceDate;
    const amounts = [v.totalAmountBs, v.exemptAmountBs ?? 0, v.taxableBaseBs, v.vatAmountBs, v.vatWithheldBs, v.taxRate, v.retentionRate];
    const validPeriod = /^\d{4}(0[1-9]|1[0-2])$/.test(period);
    const validRetentionRate = Number(v.retentionRate) === 75 || Number(v.retentionRate) === 100;
    const documentPeriod = invoiceDate.slice(0, 7).replace('-', '');
    const documentType = linkedPurchase?.documentType || '';
    const documentNumber = documentType === '02'
      ? String(linkedPurchase?.debitNoteNumber || '')
      : documentType === '03'
        ? String(linkedPurchase?.creditNoteNumber || '')
        : String(linkedPurchase?.invoiceNumber || v.invoiceNumber || '');
    const affectedDocument = documentType === '01' ? '0' : String(linkedPurchase?.affectedInvoiceNumber || '').trim();
    const expectedVat = Math.round(Number(v.taxableBaseBs) * Number(v.taxRate)) / 100;
    const expectedWithheld = Math.round(expectedVat * Number(v.retentionRate)) / 100;
    if (v.companyId !== company.id || !validateVenezuelanRif(v.supplierRif).isValid || !validPeriod || !validDate || !/^\d{14}$/.test(voucherNum) || voucherNum.slice(0, 6) !== period ||
        !supplierRif || !invoiceNum || !controlNum ||
        (documentPeriod && documentPeriod > period) ||
        !['01', '02', '03'].includes(documentType) ||
        (cleanRif(linkedPurchase.supplierRif) !== supplierRif || linkedPurchase.invoiceDate !== v.invoiceDate || String(linkedPurchase.controlNumber || '').trim() !== controlNum || documentNumber.trim() !== invoiceNum) ||
        (documentType !== '01' && (!documentNumber || !affectedDocument ||
          !companyPurchases.some(source => source.documentType === '01' &&
            source.supplierRif === linkedPurchase.supplierRif &&
            source.invoiceNumber === affectedDocument &&
            (!linkedPurchase.originalPurchaseId || source.id === linkedPurchase.originalPurchaseId)))) ||
        [invoiceNum, controlNum, voucherNum].some(value => /[\t\r\n]/.test(value)) ||
        amounts.some(value => !Number.isFinite(Number(value)) || Number(value) < 0) ||
        Number(v.taxRate) > 100 || !validRetentionRate ||
        Math.abs(Number(v.vatAmountBs) - expectedVat) > 0.01 ||
        Math.abs(Number(v.vatWithheldBs) - expectedWithheld) > 0.01 ||
        Math.abs(Number(v.totalAmountBs) - (Number(v.exemptAmountBs || 0) + Number(v.taxableBaseBs) + Number(v.vatAmountBs))) > 0.01) {
      throw new Error('Comprobante de retención IVA incompleto o inválido. Revise período, fecha, RIF, numeración, alícuota e importes; no se generan valores sustitutos.');
    }
    const docType = documentType;
    const totalAmount = Number(v.totalAmountBs).toFixed(2);
    const baseAmount = Number(v.taxableBaseBs).toFixed(2);
    const withheldAmount = Number(v.vatWithheldBs).toFixed(2);
    const affectedDoc = documentType === '01' ? '0' : affectedDocument;
    const exemptAmount = Number(v.exemptAmountBs || 0).toFixed(2);
    const rate = Number(v.taxRate).toFixed(2);
    const expeditionNum = '0';

    // Fila estándar SENIAT
    const fields = [
      agentRif,
      period,
      invoiceDate,
      'C', // Operación: Compras
      docType,
      supplierRif,
      documentType === '01' ? invoiceNum : documentNumber,
      controlNum,
      totalAmount,
      baseAmount,
      withheldAmount,
      affectedDoc,
      voucherNum,
      exemptAmount,
      rate,
      expeditionNum
    ];
    const maxLengths = [10, 6, 10, 1, 2, 10, 20, 20, 15, 15, 15, 20, 14, 15, 5, 15];
    if (fields.length !== 16 ||
        fields.some((value, index) => /[\t\r\n]/.test(value) || value.length > maxLengths[index]) ||
        [invoiceNum, controlNum].some(value => /\s/.test(value))) {
      throw new Error('El comprobante contiene campos incompatibles con el formato TXT de 16 columnas (longitud, espacios o separadores); se bloqueó la exportación para evitar desplazar datos.');
    }
    lines.push(fields.join('\t'));
  }

  return lines.join('\r\n');
}

/**
 * Registro de declaración informativa sin operaciones sujetas a retención.
 * La obligación de declarar en cero deriva del art. 15 de la Providencia
 * SNAT/2025/000054. La fila de 16 columnas es una adaptación conservadora
 * del modelo TXT histórico; debe validarse en el ambiente oficial SENIAT.
 */
export function generateSeniatIvaZeroOperationsTxt(company: Company, period: string): string {
  const agentRif = cleanRif(company.rif);
  if (!validateVenezuelanRif(company.rif).isValid) {
    throw new Error('El RIF del agente de retención no cumple la estructura venezolana válida.');
  }
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error('Seleccione un período fiscal válido para la declaración sin operaciones.');
  }
  return [agentRif, period, ...Array(14).fill('0')].join('\t');
}

/**
 * Genera el archivo XML oficial de Retenciones de ISLR para el portal SENIAT
 */
export function generateSeniatIslrXml(company: Company, vouchers: IslrRetentionVoucher[]): string {
  const agentRif = cleanRif(company.rif);
  const period = vouchers.length > 0 ? vouchers[0].period : `${company.fiscalYear}10`;

  let xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n`;
  xml += `<RelacionRetencionesISLR RifAgente="${agentRif}" Periodo="${period}">\n`;

  for (const v of vouchers) {
    const retRif = cleanRif(v.supplierRif);
    const dateParts = v.invoiceDate.split('-');
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : v.invoiceDate;

    xml += `  <DetalleRetencion>\n`;
    xml += `    <RifRetenido>${retRif}</RifRetenido>\n`;
    xml += `    <NumeroFactura>${v.invoiceNumber}</NumeroFactura>\n`;
    xml += `    <NumeroControl>${v.controlNumber}</NumeroControl>\n`;
    xml += `    <FechaOperacion>${formattedDate}</FechaOperacion>\n`;
    xml += `    <CodigoConcepto>${v.conceptCode.padStart(3, '0')}</CodigoConcepto>\n`;
    xml += `    <MontoOperacion>${v.baseAmountBs.toFixed(2)}</MontoOperacion>\n`;
    xml += `    <PorcentajeRetencion>${v.retentionRate.toFixed(2)}</PorcentajeRetencion>\n`;
    xml += `  </DetalleRetencion>\n`;
  }

  xml += `</RelacionRetencionesISLR>`;
  return xml;
}

/**
 * Construye la relación fiscal mensual desde compras con concepto ISLR declarado.
 * Incluye operaciones con retención cero; los comprobantes históricos se usan
 * como respaldo cuando la compra original no conserva metadatos ISLR.
 */
type IslrOperationRow = {
  supplierRif: string; invoiceNumber: string; controlNumber: string; invoiceDate: string;
  conceptCode: string; baseAmountBs: number; retentionRate: number;
  subtrahendBs: number; withheldAmountBs: number; key: string;
};

/** Eventos inmutables primero; compras y comprobantes completan únicamente el legado. */
function buildIslrOperationRows(
  company: Company, purchases: PurchaseRecord[], vouchers: IslrRetentionVoucher[],
  period: string, events?: IslrFiscalEvent[]
): IslrOperationRow[] {
  const purchaseById = new Map(purchases.map(p => [p.id, p]));
  const eventPurchaseIds = new Set((events || [])
    .filter(event => event.companyId === company.id)
    .flatMap(event => event.allocations.map(allocation => allocation.purchaseId)));
  const rows: IslrOperationRow[] = [];
  for (const event of events || []) {
    if (event.companyId !== company.id || event.fiscalDate.slice(0, 7).replace('-', '') !== period || event.kind === 'REVERSAL') continue;
    for (const allocation of event.allocations) {
      const purchase = purchaseById.get(allocation.purchaseId);
      if (!purchase) continue;
      const eventBaseTotal = event.allocations.reduce((sum, item) => sum + Number(item.baseAmountBs), 0);
      const allocationWithheld = eventBaseTotal > 0
        ? Math.round((Number(event.withheldAmountBs) * Number(allocation.baseAmountBs) / eventBaseTotal + Number.EPSILON) * 100) / 100
        : 0;
      rows.push({
        supplierRif: event.supplierRif, invoiceNumber: purchase.invoiceNumber,
        controlNumber: purchase.controlNumber, invoiceDate: event.fiscalDate,
        conceptCode: event.conceptCode, baseAmountBs: Number(allocation.baseAmountBs),
        retentionRate: Number(purchase.islrRate || 0),
        subtrahendBs: Number(purchase.islrSubtrahendBs || 0),
        withheldAmountBs: allocationWithheld,
        key: 'EVENT:' + event.id + ':' + allocation.purchaseId
      });
    }
  }
  for (const purchase of purchases) {
    if (purchase.companyId !== company.id || purchase.documentType !== '01' ||
        getPurchaseAccountCreditDate(purchase).slice(0, 7).replace('-', '') !== period ||
        !purchase.islrConceptCode || purchase.isCancelled || eventPurchaseIds.has(purchase.id)) continue;
    rows.push({
      supplierRif: purchase.supplierRif, invoiceNumber: purchase.invoiceNumber,
      controlNumber: purchase.controlNumber, invoiceDate: getPurchaseAccountCreditDate(purchase),
      conceptCode: purchase.islrConceptCode, baseAmountBs: Number(purchase.taxableBaseBs),
      retentionRate: Number(purchase.islrRate || 0),
      subtrahendBs: Number(purchase.islrSubtrahendBs || 0),
      withheldAmountBs: Number(purchase.islrWithheldBs || 0),
      key: [purchase.supplierRif, purchase.invoiceNumber, purchase.invoiceDate, purchase.islrConceptCode].join('|')
    });
  }
  const known = new Set(rows.map(row => row.key));
  const eventVoucherIds = new Set((events || []).filter(event => event.companyId === company.id && event.voucherId).map(event => event.voucherId));
  for (const voucher of vouchers) {
    const key = [voucher.supplierRif, voucher.invoiceNumber, voucher.invoiceDate, voucher.conceptCode].join('|');
    const linkedPurchase = purchases.find(p => p.companyId === company.id && p.supplierRif === voucher.supplierRif &&
      p.invoiceNumber === voucher.invoiceNumber && p.invoiceDate === voucher.invoiceDate && p.islrConceptCode === voucher.conceptCode);
    if (voucher.companyId !== company.id || voucher.period !== period || known.has(key) ||
        eventVoucherIds.has(voucher.id) || (linkedPurchase && eventPurchaseIds.has(linkedPurchase.id))) continue;
    rows.push({
      supplierRif: voucher.supplierRif, invoiceNumber: voucher.invoiceNumber,
      controlNumber: voucher.controlNumber, invoiceDate: voucher.invoiceDate,
      conceptCode: voucher.conceptCode, baseAmountBs: Number(voucher.baseAmountBs),
      retentionRate: Number(voucher.retentionRate), subtrahendBs: Number(voucher.subtrahendBs),
      withheldAmountBs: Number(voucher.withheldAmountBs), key
    });
    known.add(key);
  }
  return rows.sort((x, y) => x.invoiceDate.localeCompare(y.invoiceDate) || x.invoiceNumber.localeCompare(y.invoiceNumber));
}

export function generateSeniatIslrOperationsXml(
  company: Company, purchases: PurchaseRecord[], vouchers: IslrRetentionVoucher[],
  period: string, events?: IslrFiscalEvent[]
): string {
  const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  let xml = '<?xml version="1.0" encoding="ISO-8859-1"?>\n';
  xml += '<RelacionRetencionesISLR RifAgente="' + esc(cleanRif(company.rif)) + '" Periodo="' + esc(period) + '">\n';
  for (const row of buildIslrOperationRows(company, purchases, vouchers, period, events)) {
    const parts = row.invoiceDate.split('-');
    const date = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : row.invoiceDate;
    xml += '  <DetalleRetencion>\n';
    xml += '    <RifRetenido>' + esc(cleanRif(row.supplierRif)) + '</RifRetenido>\n';
    xml += '    <NumeroFactura>' + esc(row.invoiceNumber) + '</NumeroFactura>\n';
    xml += '    <NumeroControl>' + esc(row.controlNumber) + '</NumeroControl>\n';
    xml += '    <FechaOperacion>' + esc(date) + '</FechaOperacion>\n';
    xml += '    <CodigoConcepto>' + esc(row.conceptCode.padStart(3, '0')) + '</CodigoConcepto>\n';
    xml += '    <MontoOperacion>' + row.baseAmountBs.toFixed(2) + '</MontoOperacion>\n';
    xml += '    <PorcentajeRetencion>' + row.retentionRate.toFixed(2) + '</PorcentajeRetencion>\n';
    xml += '  </DetalleRetencion>\n';
  }
  return xml + '</RelacionRetencionesISLR>';
}

/**
 * Genera el archivo TXT oficial de Retenciones de ISLR para el portal SENIAT
 */
export function generateSeniatIslrTxt(company: Company, vouchers: IslrRetentionVoucher[]): string {
  const agentRif = cleanRif(company.rif);
  const lines: string[] = [];

  for (const v of vouchers) {
    const retRif = cleanRif(v.supplierRif);
    const dateParts = v.invoiceDate.split('-');
    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : v.invoiceDate;
    
    // Tab separated values
    const line = [
      agentRif,
      v.period,
      retRif,
      v.conceptCode.padStart(3, '0'),
      v.invoiceNumber,
      v.controlNumber,
      formattedDate,
      v.baseAmountBs.toFixed(2),
      v.retentionRate.toFixed(2),
      v.subtrahendBs.toFixed(2),
      v.withheldAmountBs.toFixed(2)
    ].join('\t');

    lines.push(line);
  }

  return lines.join('\r\n');
}

/**
 * TXT auxiliar de operaciones ISLR: conserva la misma población del XML mensual,
 * incluidas las operaciones cuyo importe retenido sea cero.
 */
export function generateSeniatIslrOperationsTxt(
  company: Company, purchases: PurchaseRecord[], vouchers: IslrRetentionVoucher[],
  period: string, events?: IslrFiscalEvent[]
): string {
  return buildIslrOperationRows(company, purchases, vouchers, period, events).map(row => {
    const parts = row.invoiceDate.split('-');
    const date = parts.length === 3 ? parts[2] + '/' + parts[1] + '/' + parts[0] : row.invoiceDate;
    return [
      cleanRif(company.rif), period, cleanRif(row.supplierRif), row.conceptCode.padStart(3, '0'),
      row.invoiceNumber, row.controlNumber, date, row.baseAmountBs.toFixed(2),
      row.retentionRate.toFixed(2), row.subtrahendBs.toFixed(2), row.withheldAmountBs.toFixed(2)
    ].join('\t');
  }).join('\r\n');
}

/**
 * Descarga un archivo de texto en el navegador del usuario
 */
export function downloadFile(content: string, fileName: string, contentType: string = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
