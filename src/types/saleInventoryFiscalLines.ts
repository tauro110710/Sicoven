/**
 * Construcción fiscal de las líneas de inventario de una venta.
 *
 * Las líneas conservan la alícuota declarada de la factura (0, 8, 16 o 31),
 * pero almacenan sus componentes reales: IVA y, en la tasa combinada del 31 %,
 * el 15 % del impuesto adicional al consumo suntuario. Nunca se aplica el 31 %
 * completo como IVA.
 *
 * La suma de las líneas se ajusta por redondeo para conciliar exactamente con
 * la base, el exento, el IVA, el suntuario y el subtotal fiscal de la factura.
 * El ajuste se aplica a la primera línea con base gravada y puede variar su
 * importe en un centavo, sin alterar la alícuota declarada ni duplicar tributos.
 */

import type { SaleInventoryLine } from './accounting';
import {
  calculateFiscalBreakdown,
  roundFiscalBs,
  validateFiscalBreakdown
} from './vatFiscalEngine';

export interface SaleInventoryFiscalLineDraft {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceBs: number;
  unitPriceUsd?: number;
}

export interface SaleInventoryFiscalInvoice {
  taxRate: number;
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  toleranceBs?: number;
}

export interface SaleInventoryFiscalLineResult {
  lines: SaleInventoryLine[];
  netAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  exemptAmountBs: number;
  totalBs: number;
}

const lineLuxuryTax = (line: SaleInventoryLine): number => Number(line.additionalLuxuryTaxBs || 0);
const lineTotal = (line: SaleInventoryLine): number =>
  roundFiscalBs(line.netAmountBs + line.vatAmountBs + lineLuxuryTax(line));

/**
 * Construye las líneas fiscales de inventario y valida la conciliación con la
 * factura. Lanza un error descriptivo cuando no es posible conciliar sin
 * inventar información por línea.
 */
export function buildSaleInventoryFiscalLines(
  lines: ReadonlyArray<SaleInventoryFiscalLineDraft>,
  invoice: SaleInventoryFiscalInvoice
): SaleInventoryFiscalLineResult {
  const tolerance = Number(invoice.toleranceBs ?? 0.02);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('La tolerancia de conciliación de las líneas de venta no es válida.');
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('La venta vinculada al inventario debe contener al menos una línea.');
  }
  const seenProducts = new Set<string>();
  for (const line of lines) {
    const productId = String(line.productId || '').trim();
    if (!productId) throw new Error('Cada línea de inventario debe identificar un artículo.');
    if (seenProducts.has(productId)) {
      throw new Error('El mismo artículo aparece en más de una línea de inventario. Consolide las cantidades.');
    }
    seenProducts.add(productId);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error('Cada línea de inventario debe tener una cantidad mayor que cero.');
    }
    if (!Number.isFinite(line.unitPriceBs) || line.unitPriceBs <= 0) {
      throw new Error('Cada línea de inventario debe tener un precio unitario en bolívares mayor que cero.');
    }
  }

  const invoiceIssues = validateFiscalBreakdown({
    taxRate: invoice.taxRate,
    taxableBaseBs: invoice.taxableBaseBs,
    exemptAmountBs: invoice.exemptAmountBs,
    vatAmountBs: invoice.vatAmountBs,
    additionalLuxuryTaxBs: invoice.additionalLuxuryTaxBs
  }, { toleranceBs: tolerance });
  if (invoiceIssues.length) throw new Error(invoiceIssues[0]);

  const breakdown = calculateFiscalBreakdown({
    taxRate: invoice.taxRate,
    taxableBaseBs: invoice.taxableBaseBs,
    exemptAmountBs: invoice.exemptAmountBs
  });

  if (Number(invoice.taxRate) > 0 && Number(invoice.exemptAmountBs) > tolerance) {
    throw new Error('La factura combina base gravada y monto exento. Las líneas de inventario no permiten asignar el exento por artículo sin un detalle fiscal por línea; registre la venta sin vincular inventario o separe los artículos exentos.');
  }

  // En la alícuota 0 % la factura puede declarar todo exento o una base al 0 %.
  // Se asigna el exento de la factura a las primeras líneas para conciliar sin
  // alterar los importes (a 0 % no se generan impuestos).
  let remainingExemptBs = Number(invoice.taxRate) === 0 ? Number(invoice.exemptAmountBs) : 0;
  const saleLines: SaleInventoryLine[] = lines.map(line => {
    const netAmountBs = roundFiscalBs(line.quantity * line.unitPriceBs);
    const exemptAmountBs = remainingExemptBs > 0
      ? roundFiscalBs(Math.min(netAmountBs, remainingExemptBs))
      : 0;
    remainingExemptBs = roundFiscalBs(remainingExemptBs - exemptAmountBs);
    const lineBreakdown = calculateFiscalBreakdown({
      taxRate: invoice.taxRate,
      taxableBaseBs: roundFiscalBs(netAmountBs - exemptAmountBs),
      exemptAmountBs
    });
    const additionalLuxuryTaxBs = lineBreakdown.additionalLuxuryTaxBs;
    return {
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      quantity: line.quantity,
      unitPriceBs: line.unitPriceBs,
      ...(line.unitPriceUsd !== undefined ? { unitPriceUsd: line.unitPriceUsd } : {}),
      netAmountBs,
      taxRate: Number(invoice.taxRate),
      vatAmountBs: lineBreakdown.vatAmountBs,
      additionalLuxuryTaxBs,
      exemptAmountBs: lineBreakdown.exemptAmountBs,
      totalBs: roundFiscalBs(netAmountBs + lineBreakdown.vatAmountBs + additionalLuxuryTaxBs)
    };
  });

  const sumNet = roundFiscalBs(saleLines.reduce((sum, line) => sum + line.netAmountBs, 0));
  if (Math.abs(sumNet - (Number(invoice.taxableBaseBs) + Number(invoice.exemptAmountBs))) > tolerance) {
    throw new Error('La suma de las bases de las líneas (' + sumNet.toFixed(2) +
      ' Bs.) no coincide con la base imponible más el monto exento de la factura (' +
      roundFiscalBs(Number(invoice.taxableBaseBs) + Number(invoice.exemptAmountBs)).toFixed(2) + ' Bs.).');
  }

  const sumVat = roundFiscalBs(saleLines.reduce((sum, line) => sum + line.vatAmountBs, 0));
  const sumLuxury = roundFiscalBs(saleLines.reduce((sum, line) => sum + lineLuxuryTax(line), 0));
  const vatDelta = roundFiscalBs(breakdown.vatAmountBs - sumVat);
  const luxuryDelta = roundFiscalBs(breakdown.additionalLuxuryTaxBs - sumLuxury);
  if ((Math.abs(vatDelta) > 0.005 || Math.abs(luxuryDelta) > 0.005) && Number(invoice.taxRate) === 0) {
    throw new Error('Las líneas exentas no pueden absorber diferencias de IVA o suntuario de la factura.');
  }
  if (Math.abs(vatDelta) > 0.005 || Math.abs(luxuryDelta) > 0.005) {
    const target = saleLines.find(line => line.netAmountBs > 0 && Number(line.taxRate) !== 0);
    if (!target) throw new Error('No existe una línea gravada para absorber el ajuste de redondeo fiscal.');
    target.vatAmountBs = roundFiscalBs(target.vatAmountBs + vatDelta);
    target.additionalLuxuryTaxBs = roundFiscalBs(lineLuxuryTax(target) + luxuryDelta);
    target.totalBs = lineTotal(target);
  }

  const finalVat = roundFiscalBs(saleLines.reduce((sum, line) => sum + line.vatAmountBs, 0));
  const finalLuxury = roundFiscalBs(saleLines.reduce((sum, line) => sum + lineLuxuryTax(line), 0));
  const finalExempt = roundFiscalBs(saleLines.reduce((sum, line) => sum + line.exemptAmountBs, 0));
  const finalTotal = roundFiscalBs(saleLines.reduce((sum, line) => sum + line.totalBs, 0));
  if (Math.abs(finalVat - breakdown.vatAmountBs) > 0.005 ||
      Math.abs(finalLuxury - breakdown.additionalLuxuryTaxBs) > 0.005 ||
      Math.abs(finalExempt - breakdown.exemptAmountBs) > 0.005 ||
      Math.abs(finalTotal - breakdown.subtotalBs) > 0.005) {
    throw new Error('Las líneas de inventario no concilian con el desglose fiscal de la factura; no se registró la venta.');
  }

  return {
    lines: saleLines,
    netAmountBs: sumNet,
    vatAmountBs: finalVat,
    additionalLuxuryTaxBs: finalLuxury,
    exemptAmountBs: finalExempt,
    totalBs: finalTotal
  };
}
