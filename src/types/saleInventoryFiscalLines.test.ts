import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaleInventoryFiscalLines } from './saleInventoryFiscalLines';
import { calculateFiscalBreakdown, roundFiscalBs } from './vatFiscalEngine';

const draft = (productId: string, quantity: number, unitPriceBs: number) => ({
  productId,
  productCode: 'COD-' + productId,
  productName: 'Artículo ' + productId,
  quantity,
  unitPriceBs
});

test('31 %: separa IVA 16 % y suntuario 15 % por línea y concilia con la factura', () => {
  const invoice = calculateFiscalBreakdown({ taxableBaseBs: 1500, exemptAmountBs: 0, taxRate: 31 });
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 1000), draft('b', 1, 500)],
    {
      taxRate: 31,
      taxableBaseBs: 1500,
      exemptAmountBs: 0,
      vatAmountBs: invoice.vatAmountBs,
      additionalLuxuryTaxBs: invoice.additionalLuxuryTaxBs
    }
  );
  assert.equal(invoice.vatAmountBs, 240);
  assert.equal(invoice.additionalLuxuryTaxBs, 225);
  assert.equal(invoice.subtotalBs, 1965);
  assert.deepEqual(result.lines.map(line => line.taxRate), [31, 31]);
  assert.deepEqual(result.lines.map(line => line.vatAmountBs), [160, 80]);
  assert.deepEqual(result.lines.map(line => line.additionalLuxuryTaxBs), [150, 75]);
  assert.deepEqual(result.lines.map(line => line.totalBs), [1310, 655]);
  assert.equal(result.vatAmountBs, 240);
  assert.equal(result.additionalLuxuryTaxBs, 225);
  assert.equal(result.totalBs, 1965);
  // El 31 % nunca se contabiliza entero como IVA.
  for (const line of result.lines) {
    assert.equal(line.vatAmountBs, roundFiscalBs(line.netAmountBs * 0.16));
    assert.notEqual(line.vatAmountBs, roundFiscalBs(line.netAmountBs * 0.31));
  }
});

test('31 %: el ajuste de redondeo mantiene la conciliación exacta de las líneas', () => {
  const invoice = calculateFiscalBreakdown({ taxableBaseBs: 999.99, exemptAmountBs: 0, taxRate: 31 });
  assert.equal(invoice.vatAmountBs, 160);
  assert.equal(invoice.additionalLuxuryTaxBs, 150);
  assert.equal(invoice.subtotalBs, 1309.99);
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 333.33), draft('b', 1, 333.33), draft('c', 1, 333.33)],
    {
      taxRate: 31,
      taxableBaseBs: 999.99,
      exemptAmountBs: 0,
      vatAmountBs: 160,
      additionalLuxuryTaxBs: 150
    }
  );
  // Cada línea redondea 53,33 de IVA (159,99 en total): el centavo restante
  // se aplica a la primera línea para igualar el IVA de la factura.
  assert.deepEqual(result.lines.map(line => line.vatAmountBs), [53.34, 53.33, 53.33]);
  assert.equal(result.totalBs, 1309.99);
  assert.equal(result.vatAmountBs, 160);
  assert.equal(result.additionalLuxuryTaxBs, 150);
});

test('16 %: conserva la alícuota y el IVA por línea', () => {
  const invoice = calculateFiscalBreakdown({ taxableBaseBs: 300, exemptAmountBs: 0, taxRate: 16 });
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 100), draft('b', 1, 200)],
    {
      taxRate: 16,
      taxableBaseBs: 300,
      exemptAmountBs: 0,
      vatAmountBs: invoice.vatAmountBs,
      additionalLuxuryTaxBs: invoice.additionalLuxuryTaxBs
    }
  );
  assert.deepEqual(result.lines.map(line => line.vatAmountBs), [16, 32]);
  assert.deepEqual(result.lines.map(line => line.additionalLuxuryTaxBs), [0, 0]);
  assert.deepEqual(result.lines.map(line => line.totalBs), [116, 232]);
  assert.equal(result.totalBs, invoice.subtotalBs);
});

test('8 %: conserva la alícuota reducida y concilia', () => {
  const invoice = calculateFiscalBreakdown({ taxableBaseBs: 150.25, exemptAmountBs: 0, taxRate: 8 });
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 100), draft('b', 1, 50.25)],
    {
      taxRate: 8,
      taxableBaseBs: 150.25,
      exemptAmountBs: 0,
      vatAmountBs: invoice.vatAmountBs,
      additionalLuxuryTaxBs: invoice.additionalLuxuryTaxBs
    }
  );
  assert.equal(invoice.vatAmountBs, 12.02);
  assert.deepEqual(result.lines.map(line => line.vatAmountBs), [8, 4.02]);
  assert.deepEqual(result.lines.map(line => line.totalBs), [108, 54.27]);
  assert.equal(result.totalBs, invoice.subtotalBs);
});

test('0 % exento: las líneas quedan exentas y concilian con el monto exento', () => {
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 100), draft('b', 1, 50)],
    {
      taxRate: 0,
      taxableBaseBs: 0,
      exemptAmountBs: 150,
      vatAmountBs: 0,
      additionalLuxuryTaxBs: 0
    }
  );
  assert.deepEqual(result.lines.map(line => line.taxRate), [0, 0]);
  assert.deepEqual(result.lines.map(line => line.vatAmountBs), [0, 0]);
  assert.deepEqual(result.lines.map(line => line.exemptAmountBs), [100, 50]);
  assert.deepEqual(result.lines.map(line => line.totalBs), [100, 50]);
  assert.equal(result.exemptAmountBs, 150);
  assert.equal(result.totalBs, 150);
});

test('0 % con base declarada: no inventa exento ni impuestos', () => {
  const result = buildSaleInventoryFiscalLines(
    [draft('a', 1, 100), draft('b', 1, 50)],
    {
      taxRate: 0,
      taxableBaseBs: 150,
      exemptAmountBs: 0,
      vatAmountBs: 0,
      additionalLuxuryTaxBs: 0
    }
  );
  assert.deepEqual(result.lines.map(line => line.exemptAmountBs), [0, 0]);
  assert.equal(result.vatAmountBs, 0);
  assert.equal(result.totalBs, 150);
});

test('rechaza una factura 31 % que contabiliza el 31 % completo como IVA', () => {
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [draft('a', 1, 1000)],
      {
        taxRate: 31,
        taxableBaseBs: 1000,
        exemptAmountBs: 0,
        vatAmountBs: 310,
        additionalLuxuryTaxBs: 0
      }
    ),
    /IVA no coincide/i
  );
});

test('rechaza una factura 31 % sin el componente suntuario', () => {
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [draft('a', 1, 1000)],
      {
        taxRate: 31,
        taxableBaseBs: 1000,
        exemptAmountBs: 0,
        vatAmountBs: 160,
        additionalLuxuryTaxBs: 0
      }
    ),
    /suntuario/i
  );
});

test('rechaza vincular inventario cuando la factura mezcla base gravada y exento', () => {
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [draft('a', 1, 100)],
      {
        taxRate: 16,
        taxableBaseBs: 100,
        exemptAmountBs: 20,
        vatAmountBs: 16,
        additionalLuxuryTaxBs: 0
      }
    ),
    /monto exento/i
  );
});

test('rechaza líneas cuya base no cuadra con la factura', () => {
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [draft('a', 1, 90)],
      {
        taxRate: 16,
        taxableBaseBs: 100,
        exemptAmountBs: 0,
        vatAmountBs: 16,
        additionalLuxuryTaxBs: 0
      }
    ),
    /no coincide con la base imponible/i
  );
});

test('rechaza artículos duplicados y cantidades inválidas', () => {
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [draft('a', 1, 50), draft('a', 1, 50)],
      {
        taxRate: 16,
        taxableBaseBs: 100,
        exemptAmountBs: 0,
        vatAmountBs: 16,
        additionalLuxuryTaxBs: 0
      }
    ),
    /más de una línea/i
  );
  assert.throws(
    () => buildSaleInventoryFiscalLines(
      [{ ...draft('a', 0, 100) }],
      {
        taxRate: 16,
        taxableBaseBs: 0,
        exemptAmountBs: 0,
        vatAmountBs: 0,
        additionalLuxuryTaxBs: 0
      }
    ),
    /cantidad mayor que cero/i
  );
});
