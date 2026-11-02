import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSeniatIvaTxt as generateSeniatIvaTxtRaw, generateSeniatIvaZeroOperationsTxt, generateSeniatIslrOperationsXml, generateSeniatIslrOperationsTxt } from './seniatGenerators';
import type { Company, PurchaseRecord, IslrRetentionVoucher, VatRetentionVoucher } from '../types/accounting';
import type { IslrFiscalEvent } from '../types/islrFiscalEvent';
import { resolvePurchaseVatFiscalEvent } from '../types/vatFiscalEvent';

const company = { id: 'c1', rif: 'J-12345678-9', name: 'Empresa', address: '', phone: '', email: '', taxpayerType: 'ORDINARIO', defaultIvaRetentionRate: 75, fiscalYear: 2026, bcvRate: 1 } as Company;
const purchase = (overrides: Partial<PurchaseRecord> = {}) => ({
  id: 'p1', companyId: 'c1', opNumber: 1, invoiceDate: '2026-10-05',
  supplierRif: 'J-98765432-1', supplierName: 'Proveedor', invoiceNumber: 'F-001',
  controlNumber: '00-123', documentType: '01', totalAmountBs: 1000,
  exemptAmountBs: 0, taxableBaseBs: 1000, taxRate: 16, vatAmountBs: 160,
  retentionRate: 0, vatWithheldBs: 0, bcvRate: 1, totalAmountUsd: 1000,
  taxableBaseUsd: 1000, vatAmountUsd: 160, vatWithheldUsd: 0,
  islrConceptCode: '002', islrConceptName: 'Honorarios', islrRate: 3,
  islrWithheldBs: 0, islrSubtrahendBs: 107.5, islrBeneficiaryType: 'PN',
  islrResidency: 'RESIDENT', islrBasePercentage: 100,
  ...overrides
} as PurchaseRecord);
const voucher = (overrides: Partial<IslrRetentionVoucher> = {}) => ({
  id: 'v1', companyId: 'c1', voucherNumber: 'ISLR-202610-000001',
  date: '2026-10-05', period: '202610', supplierRif: 'J-98765432-1',
  supplierName: 'Proveedor', supplierAddress: '', isPersonNatural: true, isResident: true,
  conceptCode: '002', conceptDescription: 'Honorarios', invoiceNumber: 'F-001',
  controlNumber: '00-123', invoiceDate: '2026-10-05', baseAmountBs: 1000,
  retentionRate: 3, subtrahendBs: 107.5, withheldAmountBs: 0,
  bcvRate: 1, baseAmountUsd: 1000, withheldAmountUsd: 0, ...overrides
} as IslrRetentionVoucher);

test('SENIAT XML includes a declared ISLR operation even when withholding is zero', () => {
  const xml = generateSeniatIslrOperationsXml(company, [purchase()], [], '202610');
  assert.match(xml, /<CodigoConcepto>002<\/CodigoConcepto>/);
  assert.match(xml, /<MontoOperacion>1000\.00<\/MontoOperacion>/);
  assert.match(xml, /<PorcentajeRetencion>3\.00<\/PorcentajeRetencion>/);
  assert.match(xml, /<RelacionRetencionesISLR RifAgente="J123456789" Periodo="202610">/);
});

test('SENIAT XML excludes cancelled purchase operations pending fiscal correction', () => {
  const xml = generateSeniatIslrOperationsXml(company, [purchase({ isCancelled: true })], [], '202610');
  assert.doesNotMatch(xml, /<DetalleRetencion>/);
});

test('SENIAT XML preserves legacy voucher-only records without duplicating linked purchases', () => {
  const xml = generateSeniatIslrOperationsXml(company, [purchase()], [voucher()], '202610');
  assert.equal((xml.match(/<DetalleRetencion>/g) || []).length, 1);
  const legacy = generateSeniatIslrOperationsXml(company, [], [voucher()], '202610');
  assert.equal((legacy.match(/<DetalleRetencion>/g) || []).length, 1);
});

test('SENIAT XML escapes invoice text and limits output to selected period', () => {
  const xml = generateSeniatIslrOperationsXml(company, [
    purchase({ invoiceNumber: 'F&<002>' }),
    purchase({ id: 'p2', invoiceDate: '2026-09-30', invoiceNumber: 'SEP' })
  ], [], '202610');
  assert.match(xml, /F&amp;&lt;002&gt;/);
  assert.doesNotMatch(xml, /SEP/);
});

test('ISLR TXT includes zero-withholding operations', () => {
  const txt = generateSeniatIslrOperationsTxt(company, [purchase()], [], '202610');
  assert.match(txt, /\t1000\.00\t3\.00\t107\.50\t0\.00$/);
});


test('SENIAT XML uses fiscal event date and allocation instead of invoice date', () => {
  const event: IslrFiscalEvent = {
    id: 'e1', companyId: 'c1', supplierRif: 'J-98765432-1', conceptCode: '002',
    fiscalDate: '2026-10-10', sequence: 1, kind: 'ACCOUNT_CREDIT',
    allocations: [{ purchaseId: 'p1', baseAmountBs: 800 }],
    basePercentage: 100, unitTaxValueBs: 43, withheldAmountBs: 0,
    journalEntryId: 'j1', createdAt: '2026-10-10T10:00:00.000Z'
  };
  const xml = generateSeniatIslrOperationsXml(company, [purchase()], [], '202610', [event]);
  assert.ok(xml.includes('<FechaOperacion>10/10/2026</FechaOperacion>'));
  assert.ok(xml.includes('<MontoOperacion>800.00</MontoOperacion>'));
});

test('SENIAT event-backed purchase is not duplicated by its legacy voucher', () => {
  const event: IslrFiscalEvent = {
    id: 'e1', companyId: 'c1', supplierRif: 'J-98765432-1', conceptCode: '002',
    fiscalDate: '2026-10-05', sequence: 1, kind: 'ACCOUNT_CREDIT',
    allocations: [{ purchaseId: 'p1', baseAmountBs: 1000 }],
    basePercentage: 100, unitTaxValueBs: 43, withheldAmountBs: 0,
    journalEntryId: 'j1', voucherId: 'v1', createdAt: '2026-10-05T10:00:00.000Z'
  };
  const xml = generateSeniatIslrOperationsXml(company, [purchase()], [voucher()], '202610', [event]);
  assert.equal((xml.match(/<DetalleRetencion>/g) || []).length, 1);
});

test('SENIAT XML keeps legacy purchase and voucher fallback when no fiscal event exists', () => {
  const xml = generateSeniatIslrOperationsXml(company, [purchase()], [voucher({
    id: 'v2', invoiceNumber: 'LEGACY-2', supplierRif: 'J-11111111-1'
  })], '202610', []);
  assert.equal((xml.match(/<DetalleRetencion>/g) || []).length, 2);
});

test('SENIAT export does not reclassify an event-backed purchase into its invoice month', () => {
  const event: IslrFiscalEvent = {
    id: 'e-next-month', companyId: 'c1', supplierRif: 'J-98765432-1', conceptCode: '002',
    fiscalDate: '2026-11-10', sequence: 1, kind: 'ACCOUNT_CREDIT',
    allocations: [{ purchaseId: 'p1', baseAmountBs: 1000 }],
    basePercentage: 100, unitTaxValueBs: 43, withheldAmountBs: 30,
    journalEntryId: 'j1', createdAt: '2026-11-10T10:00:00.000Z'
  };
  const invoiceMonth = generateSeniatIslrOperationsXml(company, [purchase()], [], '202610', [event]);
  const eventMonth = generateSeniatIslrOperationsXml(company, [purchase()], [], '202611', [event]);
  assert.doesNotMatch(invoiceMonth, /<DetalleRetencion>/);
  assert.match(eventMonth, /<FechaOperacion>10\/11\/2026<\/FechaOperacion>/);
  assert.match(eventMonth, /<MontoOperacion>1000\.00<\/MontoOperacion>/);
});


test('SENIAT legacy purchase uses account-credit date to select and date the fiscal period', () => {
  const crossMonth = purchase({ invoiceDate: '2026-10-31', accountCreditDate: '2026-11-02' });
  const invoiceMonth = generateSeniatIslrOperationsXml(company, [crossMonth], [], '202610');
  const creditMonth = generateSeniatIslrOperationsXml(company, [crossMonth], [], '202611');
  assert.doesNotMatch(invoiceMonth, /<DetalleRetencion>/);
  assert.ok(creditMonth.includes('<FechaOperacion>02/11/2026</FechaOperacion>'));
  assert.ok(creditMonth.includes('<MontoOperacion>1000.00</MontoOperacion>'));
});

test('SENIAT legacy purchase without account-credit date falls back to invoice date', () => {
  const historical = purchase({ invoiceDate: '2026-10-05', accountCreditDate: undefined });
  const xml = generateSeniatIslrOperationsXml(company, [historical], [], '202610');
  assert.ok(xml.includes('<FechaOperacion>05/10/2026</FechaOperacion>'));
});


const ivaVoucher = (overrides: Partial<VatRetentionVoucher> = {}) => ({
  id: 'iva-v1', companyId: 'c1', voucherNumber: '20261000000001',
  date: '2026-10-05', period: '202610', supplierRif: 'J-98765432-1',
  supplierName: 'Proveedor', supplierAddress: 'Caracas', purchaseRecordId: 'p1',
  invoiceDate: '2026-10-05', invoiceNumber: 'F-001', controlNumber: '00-123',
  totalAmountBs: 1160, exemptAmountBs: 0, taxableBaseBs: 1000,
  taxRate: 16, vatAmountBs: 160, retentionRate: 75, vatWithheldBs: 120,
  bcvRate: 1, totalAmountUsd: 1160, vatWithheldUsd: 120,
  ...overrides
} as VatRetentionVoucher);

const generateSeniatIvaTxt = (
  companyArg: Company,
  vouchers: VatRetentionVoucher[],
  sourcePurchases?: PurchaseRecord[]
) => generateSeniatIvaTxtRaw(
  companyArg,
  vouchers,
  sourcePurchases ?? vouchers.map(v => purchase({
    id: v.purchaseRecordId,
    invoiceDate: v.invoiceDate,
    invoiceNumber: v.invoiceNumber,
    controlNumber: v.controlNumber,
    supplierRif: v.supplierRif
  }))
);

test('IVA TXT exports only real voucher identifiers and the supplied amounts', () => {
  const txt = generateSeniatIvaTxt(company, [ivaVoucher()], [purchase()]);
  assert.match(txt, /^J123456789\t202610\t2026-10-05\tC\t01\tJ987654321\tF-001\t00-123\t1160\.00\t1000\.00\t160\.00/);
  assert.match(txt, /20261000000001/);
  assert.equal(txt.split('\t').length, 16);
});

test('IVA TXT classifies a linked supplier debit note and includes its affected invoice', () => {
  const source = purchase({ id: 'p-note', originalPurchaseId: 'p-original', documentType: '02', debitNoteNumber: 'ND-001', affectedInvoiceNumber: 'F-001' });
  const fields = generateSeniatIvaTxt(company, [ivaVoucher({ purchaseRecordId: 'p-note', invoiceNumber: 'ND-001' })], [purchase({ id: 'p-original' }), source]).split('\t');
  assert.equal(fields[4], '02');
  assert.equal(fields[6], 'ND-001');
  assert.equal(fields[11], 'F-001');
});

test('IVA TXT classifies a linked supplier credit note and includes its affected invoice', () => {
  const source = purchase({ id: 'p-note', originalPurchaseId: 'p-original', documentType: '03', creditNoteNumber: 'NC-001', affectedInvoiceNumber: 'F-001' });
  const fields = generateSeniatIvaTxt(company, [ivaVoucher({ purchaseRecordId: 'p-note', invoiceNumber: 'NC-001' })], [purchase({ id: 'p-original' }), source]).split('\t');
  assert.equal(fields[4], '03');
  assert.equal(fields[6], 'NC-001');
  assert.equal(fields[11], 'F-001');
});

test('IVA TXT refuses to infer document type when source purchases are omitted', () => {
  assert.throws(() => generateSeniatIvaTxtRaw(company, [ivaVoucher()]), /requiere las compras fuente/);
});

test('IVA TXT rejects missing or unsupported source document types instead of defaulting to invoice', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ documentType: undefined })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ documentType: '04' as unknown as PurchaseRecord['documentType'] })]), /incompleto o inválido/);
});

test('IVA TXT rejects tab and newline injection in source document identifiers', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ invoiceNumber: 'F-001\tINJECT' })]), /incompleto o inválido|16 columnas/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ controlNumber: '00-123\r\nINJECT' })]), /incompleto o inválido|16 columnas/);
});

test('IVA TXT rejects an empty supplied purchase collection instead of silently downgrading to legacy mode', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], []), /compra fuente/);
});

test('IVA TXT rejects cancelled source documents, cancelled affected invoices and zero-value documents', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ isCancelled: true })]), /incompleto o inválido/);
  const note = purchase({ id: 'p-note', documentType: '03', creditNoteNumber: 'NC-004', affectedInvoiceNumber: 'F-001', originalPurchaseId: 'p-original' });
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ purchaseRecordId: 'p-note', invoiceNumber: 'NC-004' })], [
    purchase({ id: 'p-original', isCancelled: true }), note
  ]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ totalAmountBs: 0, taxableBaseBs: 0, vatAmountBs: 0, vatWithheldBs: 0 })]), /incompleto o inválido/);
});

test('IVA TXT refuses to borrow the voucher invoice number when the source purchase has none', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ invoiceNumber: '' })]), /incompleto o inválido/);
});

test('IVA TXT rejects linked purchase identifiers that disagree with the retention voucher', () => {
  const source = purchase({ invoiceNumber: 'OTHER-INVOICE' });
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [source]), /incompleto o inválido/);
});

test('IVA TXT refuses an unlinked voucher or a note without its affected invoice', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ id: 'unrelated-purchase' })]), /compra fuente/);
  const note = purchase({ documentType: '02', debitNoteNumber: 'ND-002', affectedInvoiceNumber: undefined });
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ invoiceNumber: 'ND-002' })], [note]), /incompleto o inválido/);
});

test('IVA TXT rejects debit or credit notes whose affected invoice is not a source invoice of the same supplier', () => {
  const note = purchase({ id: 'p-note', originalPurchaseId: 'p-original', documentType: '03', creditNoteNumber: 'NC-003', affectedInvoiceNumber: 'MISSING' });
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ purchaseRecordId: 'p-note', invoiceNumber: 'NC-003' })], [purchase({ id: 'p-original' }), note]), /incompleto o inválido/);
  const otherSupplierInvoice = purchase({ id: 'p-original', supplierRif: 'J-11111111-1', invoiceNumber: 'F-OTHER' });
  const linkedNote = purchase({ documentType: '02', debitNoteNumber: 'ND-003', affectedInvoiceNumber: 'F-OTHER', originalPurchaseId: 'p-original' });
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ invoiceNumber: 'ND-003' })], [otherSupplierInvoice, linkedNote]), /incompleto o inválido/);
});

test('IVA TXT rejects supplier, issue-date and control mismatches against the source purchase', () => {
  const base = purchase();
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ supplierRif: 'J-11111111-1' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ invoiceDate: '2026-10-06' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher()], [purchase({ controlNumber: '00-999' })]), /incompleto o inválido/);
  assert.equal(base.id, 'p1');
});

test('IVA TXT rejects a document date after its declared period', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({
    invoiceDate: '2026-11-01',
    voucherNumber: '20261000000002'
  })]), /incompleto o inválido/);
});

test('IVA TXT rejects missing invoice/control identifiers instead of inventing replacements', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ invoiceNumber: '' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ controlNumber: '' })]), /incompleto o inválido/);
});

test('IVA TXT rejects invalid period, sequence, date, RIF and inconsistent retention amounts', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ period: '202699' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ supplierRif: 'ABC' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ companyId: 'other-company' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt({ ...company, rif: 'ABC' }, [ivaVoucher()]), /RIF del agente/);
  assert.throws(() => generateSeniatIvaTxt(company, []), /TXT vacío/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ voucherNumber: '1' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ voucherNumber: '20260900000001' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ invoiceDate: '2026-02-30' })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ vatWithheldBs: 161 })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ vatAmountBs: 159 })]), /incompleto o inválido/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ retentionRate: 50 })]), /incompleto o inválido/);
});



test('IVA TXT without operations emits one 16-column zero row with agent RIF and period', () => {
  const txt = generateSeniatIvaZeroOperationsTxt(company, '202610');
  const fields = txt.split('\t');
  assert.equal(fields.length, 16);
  assert.equal(fields[0], 'J123456789');
  assert.equal(fields[1], '202610');
  assert.ok(fields.slice(2).every(value => value === '0'));
  assert.doesNotMatch(txt, /\r|\n/);
});

test('IVA zero-operations TXT rejects invalid agent RIF and fiscal period', () => {
  assert.throws(() => generateSeniatIvaZeroOperationsTxt({ ...company, rif: 'BAD' }, '202610'), /RIF del agente/);
  assert.throws(() => generateSeniatIvaZeroOperationsTxt(company, '202613'), /período fiscal válido/);
});

test('IVA fiscal event uses effective payment date for cash purchases, not invoice issue date', () => {
  const event = resolvePurchaseVatFiscalEvent('CONTADO', '2026-11-02');
  assert.deepEqual(event, { trigger: 'PAYMENT', fiscalDate: '2026-11-02', period: '202611' });
});

test('IVA fiscal event uses account-credit date for credit purchases, not invoice issue date', () => {
  const event = resolvePurchaseVatFiscalEvent('CREDITO', '2026-11-02');
  assert.deepEqual(event, { trigger: 'ACCOUNT_CREDIT', fiscalDate: '2026-11-02', period: '202611' });
});

test('IVA fiscal event rejects missing payment mode and impossible effective dates', () => {
  assert.throws(() => resolvePurchaseVatFiscalEvent(undefined, '2026-11-02'), /modalidad de pago/);
  assert.throws(() => resolvePurchaseVatFiscalEvent('CONTADO', '2026-02-30'), /no existe en el calendario/);
  assert.throws(() => resolvePurchaseVatFiscalEvent('CREDITO', ''), /fecha efectiva/);
});


test('IVA TXT rejects a document total that does not reconcile with exempt base, taxable base and VAT', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [
    ivaVoucher({ totalAmountBs: 1159.98 })
  ]), /incompleto o inválido/);
});

test('IVA TXT refuses to mix fiscal periods in one export file', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [
    ivaVoucher(),
    ivaVoucher({ id: 'iva-v2', voucherNumber: '20261100000002', period: '202611', date: '2026-11-05', invoiceDate: '2026-11-05' })
  ]), /un único período fiscal/);
});


test('IVA TXT rejects duplicated voucher IDs or numbers and fiscal corrections still pending', () => {
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher(), ivaVoucher({ id: 'voucher-2' })]), /comprobantes duplicados/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher(), ivaVoucher({ voucherNumber: '20261000000001', id: 'voucher-2' })]), /comprobantes duplicados/);
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({ requiresFiscalCorrection: true })]), /corrección fiscal pendiente/);
});


// Estas pruebas fijan el mapeo técnico histórico de 16 campos (instructivo SENIAT
// RI_DRIVA2020-IT01V3_0_0). No equivalen a homologación ni sustituyen el contraste
// con la especificación primaria vigente y una prueba de carga del Portal Fiscal.
test('IVA TXT conserva el orden y significado de los 16 campos del instructivo histórico', () => {
  const fields = generateSeniatIvaTxt(company, [ivaVoucher()], [purchase()]).split('\t');
  assert.deepEqual(fields, [
    'J123456789',       // 1 RIF agente
    '202610',           // 2 período de imposición
    '2026-10-05',       // 3 fecha del documento
    'C',                // 4 compra
    '01',               // 5 factura
    'J987654321',       // 6 RIF proveedor
    'F-001',            // 7 número de documento
    '00-123',           // 8 número de control
    '1160.00',          // 9 monto del documento
    '1000.00',          // 10 base imponible
    '160.00',           // 11 Monto IVA total causado
    '0',                // 12 documento afectado: no aplica a factura
    '20261000000001',   // 13 número de comprobante
    '0.00',             // 14 monto exento
    '16.00',            // 15 alícuota
    '0'                 // 16 expediente de importación: no aplica
  ]);
});

test('IVA TXT genera una línea CRLF por comprobante y exactamente 16 campos por línea', () => {
  const txt = generateSeniatIvaTxt(company, [
    ivaVoucher(),
    ivaVoucher({
      id: 'iva-v2',
      purchaseRecordId: 'p2',
      voucherNumber: '20261000000002',
      invoiceNumber: 'F-002',
      controlNumber: '00-124'
    })
  ], [purchase(), purchase({ id: 'p2', invoiceNumber: 'F-002', controlNumber: '00-124' })]);
  const rows = txt.split('\r\n');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.split('\t').length, 16);
  }
  assert.equal(rows[1].split('\t')[12], '20261000000002');
});


test('IVA TXT output is deterministic by voucher sequence, UTF-8 text without BOM or trailing newline', () => {
  const first = ivaVoucher({ id: 'iva-a', voucherNumber: '20261000000001', invoiceNumber: 'F-001' });
  const second = ivaVoucher({ id: 'iva-b', voucherNumber: '20261000000002', invoiceNumber: 'F-002', purchaseRecordId: 'p2' });
  const source = [purchase(), purchase({ id: 'p2', invoiceNumber: 'F-002' })];
  const forward = generateSeniatIvaTxt(company, [second, first], source);
  const reverse = generateSeniatIvaTxt(company, [first, second], source);
  assert.equal(forward, reverse);
  assert.equal(forward.split('\r\n')[0].split('\t')[12], '20261000000001');
  assert.equal(forward.charCodeAt(0), 'J'.charCodeAt(0));
  assert.ok(!forward.endsWith('\r') && !forward.endsWith('\n'));
});

test('IVA TXT accepts a supplier without RIF only when withholding is 100 percent', () => {
  const fields = generateSeniatIvaTxt(company, [ivaVoucher({
    supplierRif: '0', retentionRate: 100, vatWithheldBs: 160, vatWithheldUsd: 160
  })], [purchase({ supplierRif: '0' })]).split('\t');
  assert.equal(fields[5], '0');
  assert.equal(fields[10], '160.00');
  assert.throws(() => generateSeniatIvaTxt(company, [ivaVoucher({
    supplierRif: '0', retentionRate: 75, vatWithheldBs: 120
  })], [purchase({ supplierRif: '0' })]), /incompleto o inválido/);
});

test('IVA TXT covers reduced rate with 75% retention and general rate with 100% retention', () => {
  const reduced = generateSeniatIvaTxt(company, [ivaVoucher({
    id: 'iva-reduced', purchaseRecordId: 'p-reduced', voucherNumber: '20261000000011',
    taxableBaseBs: 1250, taxRate: 8, vatAmountBs: 100,
    retentionRate: 75, vatWithheldBs: 75, totalAmountBs: 1350
  })], [purchase({ id: 'p-reduced', invoiceNumber: 'F-001' })]).split('\t');
  assert.equal(reduced[9], '1250.00');
  assert.equal(reduced[10], '100.00'); // Monto IVA total, no el 75% retenido.
  assert.equal(reduced[14], '8.00');

  const full = generateSeniatIvaTxt(company, [ivaVoucher({
    id: 'iva-full', purchaseRecordId: 'p-full', voucherNumber: '20261000000012',
    taxableBaseBs: 500, taxRate: 16, vatAmountBs: 80,
    retentionRate: 100, vatWithheldBs: 80, totalAmountBs: 580
  })], [purchase({ id: 'p-full', invoiceNumber: 'F-001' })]).split('\t');
  assert.equal(full[10], '80.00');
  assert.equal(full[14], '16.00');
});

test('IVA TXT column 11 exports total VAT, not the withheld percentage amount', () => {
  const fields = generateSeniatIvaTxt(company, [ivaVoucher({
    taxableBaseBs: 1000, taxRate: 16, vatAmountBs: 160,
    retentionRate: 75, vatWithheldBs: 120, totalAmountBs: 1160
  })], [purchase()]).split('\t');
  assert.equal(fields[10], '160.00');
  assert.notEqual(fields[10], '120.00');
});

test('IVA TXT permits an exempt document with zero taxable base and zero withholding', () => {
  const fields = generateSeniatIvaTxt(company, [ivaVoucher({
    id: 'iva-exempt', purchaseRecordId: 'p-exempt', voucherNumber: '20261000000013',
    totalAmountBs: 450, exemptAmountBs: 450, taxableBaseBs: 0,
    taxRate: 0, vatAmountBs: 0, retentionRate: 75, vatWithheldBs: 0
  })], [purchase({ id: 'p-exempt', invoiceNumber: 'F-001' })]).split('\t');
  assert.equal(fields[8], '450.00');
  assert.equal(fields[9], '0.00');
  assert.equal(fields[10], '0.00');
  assert.equal(fields[13], '450.00');
  assert.equal(fields[14], '0.00');
});
