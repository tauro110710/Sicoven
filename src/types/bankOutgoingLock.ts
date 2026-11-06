export type BankOutgoingLock = {
  acquire: (key: string) => () => void;
  isLocked: (key: string) => boolean;
};

/**
 * Prevents two outgoing operations from consuming the same stale bank balance
 * while the corresponding SQLite snapshot is still being committed.
 */
export const createBankOutgoingLock = (): BankOutgoingLock => {
  const locked = new Set<string>();

  return {
    acquire(key: string): () => void {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) throw new Error('No se pudo identificar la cuenta bancaria para reservar sus fondos.');
      if (locked.has(normalizedKey)) {
        throw new Error('Ya hay un egreso o transferencia de esta cuenta pendiente de confirmación en SQLite. Espere antes de registrar otro movimiento.');
      }
      locked.add(normalizedKey);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        locked.delete(normalizedKey);
      };
    },
    isLocked(key: string): boolean {
      return locked.has(String(key || '').trim());
    }
  };
};
