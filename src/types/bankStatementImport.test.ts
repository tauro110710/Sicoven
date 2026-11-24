import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBankStatementRows, parseBankStatementCsv, parseBankStatementTxt, parseBankStatementXlsx, parseOfxBankStatement } from './bankStatementImport';

test('parses quoted CSV and validates historical dual-currency snapshots', () => {
  const rows=parseBankStatementCsv('Fecha;Referencia;Descripción;Tipo;Importe;Moneda;Tasa BCV;Fecha vigencia BCV\n06/11/2026;TR-001;"Depósito, cliente";Crédito;100,00;BS;10,00;06/11/2026');
  const result=normalizeBankStatementRows(rows,'BS');
  assert.equal(result.length,1);
  assert.equal(result[0].date,'2026-11-06');
  assert.equal(result[0].description,'Depósito, cliente');
  assert.equal(result[0].type,'CREDIT');
  assert.equal(result[0].amountBs,100);
  assert.equal(result[0].amountUsd,10);
  assert.deepEqual(result[0].errors,[]);
});

test('parses pipe-delimited TXT statements and normalizes them like CSV', () => {
  const rows=parseBankStatementTxt('\uFEFFFecha|Referencia|Descripción|Tipo|Importe|Moneda|Tasa BCV|Fecha vigencia BCV\n06/11/2026|TXT-001|Depósito nómina|Crédito|250,00|BS|10,00|06/11/2026');
  const [row]=normalizeBankStatementRows(rows,'BS');
  assert.equal(row.reference,'TXT-001');
  assert.equal(row.type,'CREDIT');
  assert.equal(row.amountBs,250);
  assert.equal(row.amountUsd,25);
  assert.deepEqual(row.errors,[]);
});

test('flags missing historical rate, invalid date and incomplete reference without inventing values', () => {
  const result=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'',Descripción:'Comisión',Tipo:'Débito',Importe:'5,00',Moneda:'BS',Tasa_BCV:'',Fecha_vigencia_BCV:''}
  ],'BS');
  assert.ok(result[0].errors.some(error=>error.includes('referencia')));
  assert.ok(result[0].errors.some(error=>error.includes('tasa BCV')));
  assert.ok(result[0].errors.some(error=>error.includes('vigencia BCV')));
});

test('normalizes both Venezuelan and US thousands/decimal separators', () => {
  const rows=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'BS-1',Descripción:'Importe local',Tipo:'Crédito',Importe:'1.234,56',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'},
    {Fecha:'2026-11-06',Referencia:'US-1',Descripción:'US amount',Tipo:'Crédito',Importe:'1,234.56',Moneda:'USD',Tasa_BCV:'10.00',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.equal(rows[0].amountBs,1234.56);
  assert.equal(rows[1].amountUsd,1234.56);
  assert.deepEqual(rows.flatMap(row=>row.errors),[]);
});

test('recognizes US dollar notation as a USD currency label', () => {
  const [row]=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'USD-1',Descripción:'US dollar deposit',Tipo:'Crédito',Importe:'12.50',Moneda:'US',Tasa_BCV:'10.00',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.equal(row.currency,'USD');
  assert.equal(row.amountUsd,12.5);
  assert.equal(row.amountBs,125);
  assert.deepEqual(row.errors,[]);
});

test('rejects missing transaction nature instead of inferring it from the amount sign', () => {
  const rows=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'NO-TYPE-1',Descripción:'Positive amount without type',Importe:'5,00',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'},
    {Fecha:'2026-11-06',Referencia:'NO-TYPE-2',Descripción:'Negative amount without type',Importe:'-5,00',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.ok(rows.every(row=>row.errors.includes('Falta la naturaleza del movimiento; indique Débito o Crédito.')));
});

test('rejects unrecognized transaction nature', () => {
  const [row]=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'BAD-TYPE',Descripción:'Unknown movement',Tipo:'TRANSFER',Importe:'5,00',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.ok(row.errors.some(error=>error.includes('Naturaleza no reconocida')));
});

test('recognizes accented debit and credit labels in Spanish bank files', () => {
  const rows=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'D-1',Descripción:'Cargo bancario',Tipo:'Débito',Importe:'5,00',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'},
    {Fecha:'2026-11-06',Referencia:'C-1',Descripción:'Abono cliente',Tipo:'Crédito',Importe:'5,00',Moneda:'BS',Tasa_BCV:'10,00',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.equal(rows[0].type,'DEBIT');
  assert.equal(rows[1].type,'CREDIT');
  assert.deepEqual(rows.flatMap(row=>row.errors),[]);
});

test('rejects an unknown currency instead of treating it as bolívares', () => {
  const [row]=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'FX-1',Descripción:'Unknown currency',Tipo:'CREDIT',Importe:'10',Moneda:'EUR',Tasa_BCV:'10',Fecha_vigencia_BCV:'2026-11-06'}
  ],'BS');
  assert.ok(row.errors.includes('Moneda no reconocida.'));
});


test('rejects OFX transactions with missing or unknown TRNTYPE', () => {
  const build = (transactionType: string) => `OFXHEADER:100
DATA:OFXSGML
<OFX><CURDEF>USD
<BANKTRANLIST>
<STMTTRN>
${transactionType}
<DTPOSTED>20261106120000
<TRNAMT>-12.50
<FITID>OFX-NATURE
<NAME>Movement without reliable nature
<EXCHANGERATE>10.00
<EXCHANGERATEDATE>20261106
</BANKTRANLIST></OFX>`;
  for (const transactionType of ['', '<TRNTYPE>OTHER']) {
    const parsed = parseOfxBankStatement(build(transactionType));
    const [row] = normalizeBankStatementRows(parsed.rows, parsed.currency);
    assert.ok(row.errors.some(error => error.includes('naturaleza') || error.includes('Naturaleza')));
    // Negative TRNAMT must not silently turn a missing/unknown TRNTYPE into DEBIT.
    assert.equal(row.type, 'CREDIT');
  }
});

test('reads the first Excel worksheet and normalizes real date cells', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Extracto');
  sheet.addRow(['Fecha','Referencia','Descripción','Tipo','Importe','Moneda','Tasa BCV','Fecha vigencia BCV']);
  sheet.addRow([new Date('2026-11-06T00:00:00.000Z'),'XLS-001','Transferencia','Crédito',100,'BS',10,new Date('2026-11-06T00:00:00.000Z')]);
  const bytes = await workbook.xlsx.writeBuffer();
  const raw = await parseBankStatementXlsx(bytes as ArrayBuffer);
  const [row] = normalizeBankStatementRows(raw,'BS');
  assert.equal(row.date,'2026-11-06');
  assert.equal(row.reference,'XLS-001');
  assert.equal(row.amountBs,100);
  assert.equal(row.amountUsd,10);
  assert.deepEqual(row.errors,[]);
});

test('parses standard OFX SGML blocks without explicit closing STMTTRN tags', () => {
  const ofx=`OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261106120000
<TRNAMT>-12.50
<FITID>OFX-001
<NAME>Bank fee
<EXCHANGERATE>10.00
<EXCHANGERATEDATE>20261106
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261107120000
<TRNAMT>20.00
<FITID>OFX-002
<MEMO>Deposit
<EXCHANGERATE>10.00
<EXCHANGERATEDATE>20261106
</BANKTRANLIST>
</STMTRS></STMTTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const parsed=parseOfxBankStatement(ofx);
  assert.equal(parsed.currency,'USD');
  assert.equal(parsed.rows.length,2);
  const normalized=normalizeBankStatementRows(parsed.rows,parsed.currency);
  assert.equal(normalized[0].type,'DEBIT');
  assert.equal(normalized[0].amountUsd,12.5);
  assert.equal(normalized[0].amountBs,125);
  assert.equal(normalized[1].reference,'OFX-002');
  assert.deepEqual(normalized.flatMap(row=>row.errors),[]);
});


test('rejects malformed CSV quotes and trailing characters after quoted fields', () => {
  assert.throws(() => parseBankStatementCsv('Fecha,Importe,Descripcion\n2026-11-06,10,mal"formed'), /comillas en una posición inválida/);
  assert.throws(() => parseBankStatementCsv('Fecha,Importe,Descripcion\n2026-11-06,10,"texto"x'), /caracteres inválidos después de cerrar/);
  assert.throws(() => parseBankStatementCsv('Fecha,Importe,Descripcion\n2026-11-06,10,"sin cerrar'), /comillas sin cerrar/);
});

test('accepts escaped quotes, multiline fields, and whitespace after quoted fields', () => {
  const rows=parseBankStatementCsv('Fecha,Importe,Descripcion\n2026-11-06,10,"nota ""especial"""\n2026-11-07,20,"segunda\nlínea"');
  assert.equal(rows[0].descripcion,'nota "especial"');
  assert.equal(rows[1].descripcion,'segunda\nlínea');
});

test('rejects a delimited file that does not contain required headers', () => {
  assert.throws(() => parseBankStatementCsv('Nombre,Concepto\nAna,Deposito'), /columnas de fecha e importe/);
});


test('rejects rows with a different column count than the bank statement header', () => {
  assert.throws(() => parseBankStatementCsv('Fecha,Importe,Descripcion\n2026-11-06,10\n2026-11-07,20,segunda,extra'), /número de columnas diferente/);
});
