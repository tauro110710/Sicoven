import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBankStatementRows, parseBankStatementCsv, parseOfxBankStatement } from './bankStatementImport';

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

test('flags missing historical rate, invalid date and incomplete reference without inventing values', () => {
  const result=normalizeBankStatementRows([
    {Fecha:'2026-11-06',Referencia:'',Descripción:'Comisión',Tipo:'Débito',Importe:'5,00',Moneda:'BS',Tasa_BCV:'',Fecha_vigencia_BCV:''}
  ],'BS');
  assert.ok(result[0].errors.some(error=>error.includes('referencia')));
  assert.ok(result[0].errors.some(error=>error.includes('tasa BCV')));
  assert.ok(result[0].errors.some(error=>error.includes('vigencia BCV')));
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
