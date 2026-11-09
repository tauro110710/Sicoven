import React, { useEffect, useRef } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { fetchInventoryBcvHistory, fetchInventoryBcvRate } from '../../services/inventoryBcvService';
import { appendDailyInventoryBcvRate, resolveInventoryBcvRate } from '../../types/inventoryBcvRate';

/** Synchronizes the inventory-only BCV rate for the active company, independent of the selected module. */
export const InventoryBcvGlobalSync: React.FC = () => {
  const { currentCompany, updateCompany, waitForPersistence, isStorageReady } = useAccounting();
  const companyRef = useRef(currentCompany);
  const updateRef = useRef(updateCompany);
  const persistRef = useRef(waitForPersistence);
  useEffect(() => { companyRef.current = currentCompany; updateRef.current = updateCompany; persistRef.current = waitForPersistence; }, [currentCompany, updateCompany, waitForPersistence]);

  useEffect(() => {
    if (!isStorageReady || !currentCompany.id) return;
    let active = true;
    let running = false;
    const refresh = async () => {
      if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
      running = true;
      try {
        const [result, providerHistory] = await Promise.all([fetchInventoryBcvRate(), fetchInventoryBcvHistory()]);
        if (!active || companyRef.current.id !== currentCompany.id) return;
        const company = companyRef.current;
        const history = company.inventoryBcvRateHistory || [];
        const latestSavedDate = history.reduce((latest, entry) => entry.effectiveDate > latest ? entry.effectiveDate : latest, company.inventoryBcvRateEffectiveDate || '');
        if (latestSavedDate && result.effectiveDate < latestSavedDate) throw new Error('La fuente BCV devolvió una fecha anterior a la última guardada. Se conserva la tasa vigente.');
        let nextHistory = history;
        for (const item of providerHistory.filter(entry => entry.effectiveDate <= result.effectiveDate)) {
          nextHistory = appendDailyInventoryBcvRate(nextHistory, { rate: item.rate, effectiveDate: item.effectiveDate, fetchedAt: item.fetchedAt, source: item.sourceUrl, provider: item.provider, mode: 'AUTOMATIC' });
        }
        nextHistory = appendDailyInventoryBcvRate(nextHistory, { rate: result.rate, effectiveDate: result.effectiveDate, fetchedAt: result.fetchedAt, source: result.sourceUrl, provider: result.provider, mode: 'AUTOMATIC' });
        const savedForDate = resolveInventoryBcvRate(nextHistory, result.effectiveDate);
        const effectiveRate = savedForDate?.rate ?? result.rate;
        const effectiveFetchedAt = savedForDate?.fetchedAt ?? result.fetchedAt;
        const effectiveEurRate = result.eurRate ?? company.inventoryBcvEurRate;
        const changed = company.inventoryBcvRate !== effectiveRate || company.inventoryBcvEurRate !== effectiveEurRate || company.inventoryBcvRateEffectiveDate !== result.effectiveDate || company.inventoryBcvRateFetchedAt !== effectiveFetchedAt || nextHistory.length !== history.length;
        if (!changed) return;
        if (!window.sicovenStore?.save) throw new Error('La actualización BCV requiere SQLite local disponible.');
        updateRef.current({ ...company, inventoryBcvRate: effectiveRate, inventoryBcvEurRate: effectiveEurRate, inventoryBcvRateEffectiveDate: result.effectiveDate, inventoryBcvRateFetchedAt: effectiveFetchedAt, inventoryBcvRateHistory: nextHistory });
        try { await persistRef.current(); }
        catch (error) { updateRef.current(company); await persistRef.current().catch(() => undefined); throw error; }
      } catch (error) {
        console.warn('Sincronización global de tasa BCV de Inventario:', error instanceof Error ? error.message : error);
      } finally { running = false; }
    };
    void refresh();
    const onOnline = () => { void refresh(); };
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => { void refresh(); }, 60 * 60 * 1000);
    return () => { active = false; window.removeEventListener('online', onOnline); window.clearInterval(timer); };
  }, [currentCompany.id, isStorageReady]);
  return null;
};
