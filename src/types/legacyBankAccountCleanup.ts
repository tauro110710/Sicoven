import type { Account, BankAccount, JournalEntry } from './accounting';

const LEGACY_BANKS: Array<{ code: string; name: RegExp }> = [
  { code: '1.1.1.03', name: /Banco Nacional de Crédito/i },
  { code: '1.1.1.04', name: /Banesco Banco Universal/i },
  { code: '1.1.1.05', name: /Banco Mercantil/i }
];

/**
 * Retira únicamente los tres auxiliares históricos que venían sembrados
 * como bancos predeterminados. Si existe una cuenta bancaria registrada o
 * cualquier asiento que la utilice, se conserva íntegramente.
 */
export function removeUnusedLegacyDefaultBanks(
  accounts: Account[],
  journalEntries: JournalEntry[] = [],
  bankAccounts: BankAccount[] = []
): Account[] {
  const referencedCodes = new Set<string>();
  for (const bank of bankAccounts) {
    if (bank.accountCode) referencedCodes.add(bank.accountCode);
  }
  for (const entry of journalEntries) {
    for (const item of entry.items || []) {
      if (item.accountCode) referencedCodes.add(item.accountCode);
    }
  }

  return accounts.filter(account => {
    const legacy = LEGACY_BANKS.find(item => item.code === account.code && item.name.test(account.name));
    return !legacy || referencedCodes.has(account.code);
  });
}
