import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from './accounting';
import { resolveNonInventoryPurchaseDebitAccount } from './purchaseAccounting';

const accounts: Account[] = [
  { code: '6.1.1.04', name: 'Honorarios Profesionales', type: 'GASTOS', level: 4, isMovement: true },
  { code: '1.2.1.01', name: 'Mobiliario y Equipos', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.4.01', name: 'Inventario de Mercancías', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.1.06.01', name: 'Banco de la empresa', type: 'ACTIVO', level: 5, isMovement: true }
];

describe('purchase debit classification', () => {
  it('rejects an unclassified non-inventory purchase instead of defaulting to honorarios', () => {
    assert.throws(() => resolveNonInventoryPurchaseDebitAccount(accounts, undefined, 100), /no se asignará Honorarios/);
  });
  it('uses honorarios only when the accountant explicitly selects that expense account', () => {
    assert.equal(resolveNonInventoryPurchaseDebitAccount(accounts, '6.1.1.04', 100)?.code, '6.1.1.04');
  });
  it('allows an explicitly selected fixed-asset account', () => {
    assert.equal(resolveNonInventoryPurchaseDebitAccount(accounts, '1.2.1.01', 100)?.code, '1.2.1.01');
  });
  it('does not allow inventory or bank accounts as a non-inventory debit account', () => {
    assert.throws(() => resolveNonInventoryPurchaseDebitAccount(accounts, '1.1.4.01', 100));
    assert.throws(() => resolveNonInventoryPurchaseDebitAccount(accounts, '1.1.1.06.01', 100));
  });
});
