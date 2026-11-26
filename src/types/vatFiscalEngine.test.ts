import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateFiscalDocuments,
  assertFiscalBreakdown,
  calculateFiscalBreakdown,
  calculateFiscalBreakdownFromGross,
  calculateLineVat,
  getDocumentLuxuryTax,
  getInputVatAccountCode,
  getOutputVatAccountCode,
  resolveFiscalRates,
  roundFiscalBs,
  roundFiscalUsd,
  validateFiscalBreakdown
} from './vatFiscalEngine';
import { calculateFiscalZTaxBreakdown } from './fiscalZReport';
import { calculateSaleCorrectionNote } from './saleCorrectionNote';
import { isJournalEntryBalanced } from './journalEntryValidation';
import type { SaleRecord } from './accounting';

test('resuelve las alícuotas 0, 8, 16 y la combinada 31 con sus dos componentes', () => {
  assert.deepEqual(resolveFiscalRates(0), { declaredRate: 0, vatRate: 0, luxuryRate: 0, combined: false });
  assert.deepEqual(resolveFiscalRates(8), { declaredRate: 8, vatRate: 8, luxuryRate: 0, combined: false });
  assert.deepEqual(resolveFiscalRates(16), { declaredRate: 16, vatRate: 16, luxuryRate: 0, combined: false });
  assert.deepEqual(resolveFiscalRates(31), { declaredRate: 31, vatRate: 16, luxuryRate: 15, combined: true });
  assert.throws(() => resolveFiscalRates(-1), /alícuota fiscal/);
  assert.throws(() => resolveFiscalRates(101), /alícuota fiscal/);
});

test('calcula IVA 16 % sin impuesto suntuario', () => {
  const result = calculateFiscalBreakdown({ taxableBaseBs: 1160, taxRate: 16 });
  assert.equal(result.vatAmountBs, 185.6);
  assert.equal(result.additionalLuxuryTaxBs, 0);
  assert.equal(result.subtotalBs, 1345.6);
  assert.equal(result.totalAmountBs, 1345.6);
});

test('calcula IVA 8 % en la cuenta reducida y sin impuesto suntuario', () => {
  const result = calculateFiscalBreakdown({ taxableBaseBs: 500, taxRate: 8 });
  assert.equal(result.vatAmountBs, 40);
  assert.equal(result.additionalLuxuryTaxBs, 0);
  assert.equal(result.totalAmountBs, 540);
  assert.equal(getInputVatAccountCode(8), '1.1.3.02');
  assert.equal(getOutputVatAccountCode(8), '2.1.2.02');
  assert.equal(getInputVatAccountCode(16), '1.1.3.01');
  assert.equal(getOutputVatAccountCode(31), '2.1.2.01');
});

test('separa la tasa combinada 31 % en 16 % de IVA y 15 % suntuario, nunca en 31 % de IVA', () => {
  const result = calculateFiscalBreakdown({ taxableBaseBs: 1000, taxRate: 31 });
  assert.equal(result.vatRate, 16);
  assert.equal(result.luxuryRate, 15);
  assert.equal(result.vatAmountBs, 160);
  assert.equal(result.additionalLuxuryTaxBs, 150);
  assert.notEqual(result.vatAmountBs, 310);
  assert.equal(result.subtotalBs, 1310);
});

test('incluye exentos, redondea a dos decimales de bolívar y calcula IGTF sobre el subtotal fiscal', () => {
  const result = calculateFiscalBreakdown({
    taxableBaseBs: 333.33, exemptAmountBs: 66.67, taxRate: 16, igtfRatePercent: 3
  });
  assert.equal(result.vatAmountBs, 53.33);
  assert.equal(result.subtotalBs, 453.33);
  assert.equal(result.igtfAmountBs, 13.6);
  assert.equal(result.totalAmountBs, 466.93);
  assert.equal(roundFiscalBs(2.675), 2.68);
  assert.equal(roundFiscalBs(10.005), 10.01);
  assert.equal(roundFiscalUsd(1.2345675), 1.234568);
});

test('deriva la base desde un importe bruto con IVA no discriminado, incluida la tasa combinada', () => {
  const standard = calculateFiscalBreakdownFromGross({ grossAmountBs: 1160, taxRate: 16 });
  assert.equal(standard.taxableBaseBs, 1000);
  assert.equal(standard.vatAmountBs, 160);
  const combined = calculateFiscalBreakdownFromGross({ grossAmountBs: 1310, taxRate: 31 });
  assert.equal(combined.taxableBaseBs, 1000);
  assert.equal(combined.vatAmountBs, 160);
  assert.equal(combined.additionalLuxuryTaxBs, 150);
  assert.equal(combined.totalAmountBs, 1310);
});

test('valida el desglose, rechaza el 31 % completo como IVA y detecta totales inconsistentes', () => {
  assert.deepEqual(validateFiscalBreakdown({
    taxRate: 31, taxableBaseBs: 1000, vatAmountBs: 160, additionalLuxuryTaxBs: 150, totalAmountBs: 1310
  }, { requireTotal: true }), []);
  const wrong = validateFiscalBreakdown({
    taxRate: 31, taxableBaseBs: 1000, vatAmountBs: 310, additionalLuxuryTaxBs: 0, totalAmountBs: 1310
  }, { requireTotal: true });
  assert.ok(wrong.some(issue => /IVA/.test(issue) && /16 %/.test(issue)));
  assert.ok(wrong.some(issue => /suntuario/.test(issue)));
  assert.throws(() => assertFiscalBreakdown({
    taxRate: 16, taxableBaseBs: 100, vatAmountBs: 16, totalAmountBs: 200
  }, { requireTotal: true }), /total del documento/);
});

test('conserva el suntuario histórico y solo lo deriva cuando el documento no lo registra', () => {
  assert.equal(getDocumentLuxuryTax({ taxRate: 31, taxableBaseBs: 1000, additionalLuxuryTaxBs: 140 }), 140);
  assert.equal(getDocumentLuxuryTax({ taxRate: 31, taxableBaseBs: 1000 }), 150);
  assert.equal(getDocumentLuxuryTax({ taxRate: 16, taxableBaseBs: 1000 }), 0);
});

test('agrega documentos por alícuota sin mezclar IVA y suntuario', () => {
  const aggregate = aggregateFiscalDocuments([
    { taxRate: 16, taxableBaseBs: 1000, vatAmountBs: 160 },
    { taxRate: 8, taxableBaseBs: 500, vatAmountBs: 40 },
    { taxRate: 31, taxableBaseBs: 200, vatAmountBs: 32, additionalLuxuryTaxBs: 30 },
    { taxRate: 31, taxableBaseBs: 100, vatAmountBs: 16 },
    { taxRate: 0, taxableBaseBs: 0, exemptAmountBs: 50, vatAmountBs: 0 }
  ]);
  assert.equal(aggregate.taxableBase16Bs, 1000);
  assert.equal(aggregate.taxableBase8Bs, 500);
  assert.equal(aggregate.taxableBase31Bs, 300);
  assert.equal(aggregate.exemptAmountBs, 50);
  assert.equal(aggregate.vat16Bs, 160);
  assert.equal(aggregate.vat8Bs, 40);
  assert.equal(aggregate.vat31Bs, 48);
  assert.equal(aggregate.vatAmountBs, 248);
  assert.equal(aggregate.additionalLuxuryTaxBs, 45);
  assert.equal(aggregate.totalBs, 2143);
});

test('el cierre Z usa el motor fiscal: base 31 % con IVA 16 % y suntuario 15 % separados', () => {
  const z = calculateFiscalZTaxBreakdown({
    taxableBase16Bs: 1000, taxableBase8Bs: 500, taxableBase31Bs: 300, exemptSalesBs: 50, igtfBs: 12
  });
  assert.equal(z.vat16Bs, 160);
  assert.equal(z.vat8Bs, 40);
  assert.equal(z.vat31Bs, 48);
  assert.equal(z.additionalLuxuryTaxBs, 45);
  assert.equal(z.totalSalesBs, 2155);
  const aggregate = aggregateFiscalDocuments([
    { taxRate: 16, taxableBaseBs: 1000, vatAmountBs: 160 },
    { taxRate: 8, taxableBaseBs: 500, vatAmountBs: 40 },
    { taxRate: 31, taxableBaseBs: 300, vatAmountBs: 48, additionalLuxuryTaxBs: 45 },
    { taxRate: 0, taxableBaseBs: 0, exemptAmountBs: 50, vatAmountBs: 0, igtfAmountBs: 12 }
  ]);
  assert.equal(z.vat16Bs + z.vat8Bs + z.vat31Bs, aggregate.vatAmountBs);
  assert.equal(z.additionalLuxuryTaxBs, aggregate.additionalLuxuryTaxBs);
});

test('una nota de corrección al 31 % replica exactamente el desglose del motor fiscal', () => {
  const source: SaleRecord = {
    id: 'sale-31', companyId: 'company-1', opNumber: 1, invoiceDate: '2026-10-01',
    customerRif: 'J-12345678-9', customerName: 'Cliente', invoiceNumber: 'F-200',
    controlNumber: 'C-200', documentType: '01', totalAmountBs: 1310,
    exemptAmountBs: 0, taxableBaseBs: 1000, taxRate: 31, vatAmountBs: 160,
    additionalLuxuryTaxBs: 150, vatWithheldBs: 0, bcvRate: 100,
    totalAmountUsd: 13.1, taxableBaseUsd: 10, vatAmountUsd: 1.6,
    additionalLuxuryTaxUsd: 1.5, vatWithheldUsd: 0, paymentTerm: 'CREDITO'
  };
  const note = calculateSaleCorrectionNote({
    kind: 'CREDIT', sourceSale: source, noteDate: '2026-11-01',
    noteNumber: 'NC-031', controlNumber: 'CTRL-031',
    reason: 'Devolución parcial de mercancía gravada al 31 %',
    taxableBaseBs: 100, exemptAmountBs: 0, bcvRate: 110,
    fiscalEmissionMedium: 'DIGITAL', sameMediumAsOriginal: true, priorCreditNotes: []
  });
  const engine = calculateFiscalBreakdown({ taxableBaseBs: 100, taxRate: 31 });
  assert.equal(note.vatAmountBs, 16);
  assert.equal(note.additionalLuxuryTaxBs, 15);
  assert.equal(note.totalAmountBs, 131);
  assert.equal(note.vatAmountBs, engine.vatAmountBs);
  assert.equal(note.additionalLuxuryTaxBs, engine.additionalLuxuryTaxBs);
  assert.equal(note.totalAmountBs, engine.totalAmountBs);
  assert.equal(source.vatAmountBs, 160);
});

test('los asientos de venta y compra al 31 % cuadran con el IVA y el suntuario del motor', () => {
  const sale = calculateFiscalBreakdown({ taxableBaseBs: 1000, taxRate: 31 });
  const saleItems = [
    { account: '1.1.1.01', debit: sale.totalAmountBs, credit: 0 },
    { account: '4.1.1.01', debit: 0, credit: sale.taxableBaseBs },
    { account: getOutputVatAccountCode(31), debit: 0, credit: sale.vatAmountBs },
    { account: '2.1.2.08', debit: 0, credit: sale.additionalLuxuryTaxBs }
  ];
  const saleTotals = {
    debitBs: saleItems.reduce((sum, item) => sum + item.debit, 0),
    creditBs: saleItems.reduce((sum, item) => sum + item.credit, 0),
    debitUsd: 1,
    creditUsd: 1
  };
  assert.equal(isJournalEntryBalanced(saleTotals), true);
  assert.equal(saleItems[2].credit, 160);
  assert.equal(saleItems[3].credit, 150);

  const purchase = calculateFiscalBreakdown({ taxableBaseBs: 1000, taxRate: 31 });
  const purchaseItems = [
    { account: '5.1.1.01', debit: purchase.taxableBaseBs, credit: 0 },
    { account: getInputVatAccountCode(31), debit: purchase.vatAmountBs, credit: 0 },
    { account: '6.1.1.13', debit: purchase.additionalLuxuryTaxBs, credit: 0 },
    { account: '2.1.1.01', debit: 0, credit: purchase.totalAmountBs }
  ];
  assert.equal(isJournalEntryBalanced({
    debitBs: purchaseItems.reduce((sum, item) => sum + item.debit, 0),
    creditBs: purchaseItems.reduce((sum, item) => sum + item.credit, 0),
    debitUsd: 1,
    creditUsd: 1
  }), true);

  // Un asiento que registra el 31 % completo como IVA cuadra contablemente,
  // pero el motor fiscal lo rechaza: el 15 % no es crédito ni débito IVA.
  assert.equal(isJournalEntryBalanced({ debitBs: 1310, creditBs: 1310, debitUsd: 1, creditUsd: 1 }), true);
  assert.ok(validateFiscalBreakdown({
    taxRate: 31, taxableBaseBs: 1000, vatAmountBs: 310, additionalLuxuryTaxBs: 0
  }).length > 0);
});

test('el IVA por línea no admite la tasa combinada y usa el redondeo del motor', () => {
  const line = calculateLineVat({ quantity: 3, unitPriceBs: 33.33, taxRate: 16 });
  assert.equal(line.netAmountBs, 99.99);
  assert.equal(line.vatAmountBs, 16);
  assert.throws(() => calculateLineVat({ quantity: 1, unitPriceBs: 100, taxRate: 31 }), /no se aplica por línea/);
});
