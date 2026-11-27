import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoricalBcvRate } from '../utils/historicalBcvRate';
import type { InventoryBcvHistoryEntry } from './inventoryBcvRate';
import { validatePurchaseAmounts } from './purchaseAmountValidation';
import { getInternalRegistrations, registerPurchaseInternal, resetInternalRegistrations } from './purchaseRegistration';

const inventoryRate = (effectiveDate: string, rate: number): InventoryBcvHistoryEntry => ({
  id: `inventory-${effectiveDate}-${rate}`,
  effectiveDate,
  rate,
  fetchedAt: `${effectiveDate}T12:00:00.000Z`,
  source: 'https://bcv.today/api/v1/history.json',
  provider: 'bcv.today',
  mode: 'AUTOMATIC'
});

test('registra una compra histórica con la tasa vigente del historial de Inventario', () => {
  resetInternalRegistrations();
  const company = {
    accountingBcvRateHistory: undefined,
    inventoryBcvRateHistory: [
      inventoryRate('2024-05-01', 38.25),
      inventoryRate('2024-05-18', 39.4)
    ]
  };
  const invoiceDate = '2024-05-15';

  const resolved = resolveHistoricalBcvRate(company, invoiceDate);
  assert.deepEqual(resolved, { rate: 38.25, effectiveDate: '2024-05-01', origin: 'INVENTORY' });

  const purchase = {
    totalAmountBs: 1160,
    taxableBaseBs: 1000,
    exemptAmountBs: 0,
    vatAmountBs: 160,
    additionalLuxuryTaxBs: 0,
    igtfAmountBs: 0,
    vatWithheldBs: 120,
    islrWithheldBs: 30,
    retentionRate: 75,
    islrRate: 5,
    taxRate: 16,
    bcvRate: resolved?.rate,
    totalAmountUsd: 30.33,
    taxableBaseUsd: 26.14,
    exemptAmountUsd: 0,
    vatAmountUsd: 4.18,
    additionalLuxuryTaxUsd: 0,
    vatWithheldUsd: 3.14,
    islrWithheldUsd: 0.78,
    igtfAmountUsd: 0,
    supplierRif: 'J-12345678-9',
    invoiceNumber: 'F-2024-001',
    documentType: '01' as const,
    invoiceDate,
    paymentTerm: 'CONTADO' as const,
    paymentAccountCode: '1.1.1.01',
    vatCreditTreatment: 'TAXABLE' as const
  };

  assert.doesNotThrow(() => validatePurchaseAmounts(purchase));
  const registered = registerPurchaseInternal(purchase);

  assert.equal(registered.invoiceDate, invoiceDate);
  assert.equal(registered.bcvRate, 38.25);
  assert.equal(registered.totalAmountUsd, 30.33);
  assert.equal(getInternalRegistrations().length, 1);
});
