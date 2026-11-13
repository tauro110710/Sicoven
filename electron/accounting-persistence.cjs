const crypto = require('node:crypto');
const { validateAccountingSnapshot } = require('./accounting-integrity.cjs');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { partitionAccountingSnapshot } = require('./tenant-snapshot.cjs');

function syncPartyMasterRows(db, state) {
  if (!Array.isArray(state.customers) && !Array.isArray(state.suppliers)) return;
  const companies = new Set((Array.isArray(state.companies) ? state.companies : []).map(company => String(company.id)));
  const rows = [
    ...(Array.isArray(state.customers) ? state.customers.map(item => ({ ...item, partyType: 'CUSTOMER' })) : []),
    ...(Array.isArray(state.suppliers) ? state.suppliers.map(item => ({ ...item, partyType: 'SUPPLIER' })) : [])
  ];
  const ids = new Set();
  const fiscalKeys = new Set();
  const prepared = rows.map(item => {
    const id = String(item.id || '').trim();
    const companyId = String(item.companyId || '').trim();
    const name = String(item.name || '').trim();
    const fiscalId = String(item.fiscalId || '').trim();
    const normalizedFiscalId = fiscalId.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!id || !companyId || !companies.has(companyId) || !name) throw new Error('Un maestro de cliente/proveedor tiene ID, empresa o nombre inválido; se canceló la persistencia.');
    if (!['CUSTOMER', 'SUPPLIER'].includes(item.partyType)) throw new Error('Tipo de maestro no reconocido.');
    if (ids.has(id)) throw new Error('Hay identificadores duplicados entre maestros de clientes y proveedores.');
    ids.add(id);
    if (normalizedFiscalId) { const key = companyId + '|' + item.partyType + '|' + normalizedFiscalId; if (fiscalKeys.has(key)) throw new Error('Hay identificadores fiscales duplicados en los maestros de la empresa.'); fiscalKeys.add(key); }
    return { id, companyId, partyType: item.partyType, name, fiscalId: fiscalId || null, fiscalIdType: item.fiscalIdType || null, normalizedFiscalId: normalizedFiscalId || null, address: String(item.address || '').trim() || null, phone: String(item.phone || '').trim() || null, email: String(item.email || '').trim() || null, active: item.active === false ? 0 : 1 };
  });
  const nextIds = new Set(prepared.map(row => row.id));
  const existingIds = db.prepare('SELECT id FROM party_masters').all();
  const remove = db.prepare('DELETE FROM party_masters WHERE id=?');
  for (const existing of existingIds) {
    if (!nextIds.has(String(existing.id))) remove.run(String(existing.id));
  }
  const insert = db.prepare(`INSERT INTO party_masters
    (id, company_id, party_type, name, fiscal_id, fiscal_id_type, normalized_fiscal_id, address, phone, email, active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      company_id=excluded.company_id, party_type=excluded.party_type, name=excluded.name,
      fiscal_id=excluded.fiscal_id, fiscal_id_type=excluded.fiscal_id_type,
      normalized_fiscal_id=excluded.normalized_fiscal_id, address=excluded.address,
      phone=excluded.phone, email=excluded.email, active=excluded.active,
      updated_at=datetime('now')`);
  for (const row of prepared) insert.run(row.id, row.companyId, row.partyType, row.name, row.fiscalId, row.fiscalIdType, row.normalizedFiscalId, row.address, row.phone, row.email, row.active);
}
function persistAccountingSnapshot(db, state, actor = null) {
  const json = JSON.stringify(state);
  if (json.length > 50 * 1024 * 1024) throw new Error('El respaldo supera el límite permitido');
  const save = db.transaction(() => {
    const priorRow = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    let priorState = {};
    if (priorRow) {
      try { priorState = JSON.parse(priorRow.state_json) || {}; }
      catch { throw new Error('La base SQLite contiene un estado contable ilegible; se bloqueó la escritura para proteger el historial.'); }
    }
    const { nextEntries, priorById } = validateAccountingSnapshot(priorState, state);
    const auditInsert = db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)');
    for (const entry of nextEntries) {
      if (priorById.has(String(entry.id))) continue;
      const totals = entry.items.reduce((sum, item) => ({
        debitBs: sum.debitBs + Number(item.debitBs || 0),
        creditBs: sum.creditBs + Number(item.creditBs || 0),
        debitUsd: sum.debitUsd + Number(item.debitUsd || 0),
        creditUsd: sum.creditUsd + Number(item.creditUsd || 0)
      }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
      if (entry.type === 'APERTURA' && String(entry.referenceDoc || '').startsWith('APERTURA:')) {
        const link = entry.exerciseLink;
        const validDate = value => {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const parsed = new Date(value + 'T00:00:00.000Z');
          return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        };
        if (!link || !validDate(link.priorPeriodStartDate) || !validDate(link.priorPeriodEndDate) ||
            !validDate(link.nextPeriodStartDate) || link.priorPeriodStartDate > link.priorPeriodEndDate) {
          throw new Error('La apertura del ejercicio requiere un vínculo válido con el período anterior.');
        }
        const nextDay = new Date(link.priorPeriodEndDate + 'T00:00:00.000Z');
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const expectedNextStart = nextDay.toISOString().slice(0, 10);
        if (link.nextPeriodStartDate !== expectedNextStart || entry.date !== expectedNextStart) {
          throw new Error('La apertura debe iniciar exactamente el día siguiente al cierre del ejercicio anterior.');
        }
        const company = (Array.isArray(state.companies) ? state.companies : [])
          .find(item => String(item.id) === String(entry.companyId));
        if (!company || String(company.closedThroughDate || '') !== link.priorPeriodEndDate) {
          throw new Error('El ejercicio anterior debe permanecer cerrado hasta su fecha final para vincular la apertura.');
        }
        const duplicate = (Array.isArray(state.journalEntries) ? state.journalEntries : []).some(item =>
          String(item.id) !== String(entry.id) && String(item.companyId) === String(entry.companyId) &&
          item.type === 'APERTURA' && (
            item.date === link.nextPeriodStartDate ||
            (item.exerciseLink &&
              item.exerciseLink.priorPeriodStartDate === link.priorPeriodStartDate &&
              item.exerciseLink.priorPeriodEndDate === link.priorPeriodEndDate &&
              item.exerciseLink.nextPeriodStartDate === link.nextPeriodStartDate)
          ));
        if (duplicate) throw new Error('Ya existe una apertura vinculada a este ejercicio anterior y no se permite duplicarla.');
        db.prepare(`INSERT INTO accounting_exercise_links
          (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id)
          VALUES(?,?,?,?,?,?)`)
          .run(crypto.randomUUID(), String(entry.companyId), link.priorPeriodStartDate,
            link.priorPeriodEndDate, link.nextPeriodStartDate, String(entry.id));
        auditInsert.run('accounting_exercise_opening_linked', JSON.stringify({
          companyId: entry.companyId, journalEntryId: entry.id,
          priorPeriodStartDate: link.priorPeriodStartDate,
          priorPeriodEndDate: link.priorPeriodEndDate,
          nextPeriodStartDate: link.nextPeriodStartDate,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
      auditInsert.run(entry.reversalOfEntryId ? 'journal_entry_reversed' : 'journal_entry_posted', JSON.stringify({
        entryId: entry.id, companyId: entry.companyId, entryNumber: entry.entryNumber,
        date: entry.date, type: entry.type, referenceDoc: entry.referenceDoc || null,
        description: entry.description, reversalOfEntryId: entry.reversalOfEntryId || null,
        reversalReason: entry.reversalReason || null, workpaperNote: entry.workpaperNote || null,
        priorPeriodAdjustment: Boolean(entry.priorPeriodAdjustment), totals
      }));
      if (entry.type === 'CIERRE' && String(entry.referenceDoc || '').startsWith('CIERRE:')) {
        const opening = nextEntries.find(candidate => candidate.companyId === entry.companyId &&
          candidate.type === 'APERTURA' && candidate.exerciseLink?.priorPeriodEndDate === entry.date);
        auditInsert.run('accounting_year_closed', JSON.stringify({
          closingEntryId: entry.id, closingEntryNumber: entry.entryNumber,
          openingEntryId: opening?.id || null, openingEntryNumber: opening?.entryNumber || null,
          companyId: entry.companyId, closingDate: entry.date,
          resultAccountCodes: entry.items.map(item => item.accountCode),
          annualCloseState: entry.annualCloseState || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null,
          totals
        }));
      }
      if (entry.type === 'APERTURA') {
        auditInsert.run('accounting_year_opening_posted', JSON.stringify({
          entryId: entry.id, companyId: entry.companyId, entryNumber: entry.entryNumber,
          openingDate: entry.date, referenceDoc: entry.referenceDoc || null,
          description: entry.description,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null,
          totals
        }));
      }
    }
    for (const collectionName of ['purchases', 'sales']) {
      const oldDocuments = new Map((Array.isArray(priorState[collectionName]) ? priorState[collectionName] : [])
        .map(document => [String(document.id), document]));
      for (const document of (Array.isArray(state[collectionName]) ? state[collectionName] : [])) {
        const oldDocument = oldDocuments.get(String(document.id));
        if (oldDocument && !oldDocument.isCancelled && document.isCancelled) {
          auditInsert.run('fiscal_document_reversal_marked', JSON.stringify({
            collection: collectionName, documentId: document.id, companyId: document.companyId,
            invoiceNumber: document.invoiceNumber, documentType: document.documentType,
            cancelledByJournalEntryId: document.cancelledByJournalEntryId || null,
            cancellationReason: document.cancellationReason || null,
            cancellationNote: document.cancellationNote || null
          }));
        }
      }
    }
    const oldPurchaseIds = new Set((Array.isArray(priorState.purchases) ? priorState.purchases : [])
      .map(document => String(document.id)));
    for (const note of (Array.isArray(state.purchases) ? state.purchases : [])) {
      if (oldPurchaseIds.has(String(note.id)) || note.documentType !== '03') continue;
      auditInsert.run('supplier_credit_note_posted', JSON.stringify({
        documentId: note.id, companyId: note.companyId,
        creditNoteNumber: note.creditNoteNumber || note.invoiceNumber,
        controlNumber: note.controlNumber, invoiceDate: note.invoiceDate,
        supplierRif: note.supplierRif, supplierName: note.supplierName,
        originalPurchaseId: note.originalPurchaseId || null,
        affectedInvoiceNumber: note.affectedInvoiceNumber || null,
        journalEntryId: note.journalEntryId || null,
        netPayableReductionBs: note.netPayableReductionBs || 0,
        netPayableReductionUsd: note.netPayableReductionUsd || 0,
        creditNoteLines: Array.isArray(note.creditNoteLines) ? note.creditNoteLines : []
      }));
    }
    for (const purchase of (Array.isArray(state.purchases) ? state.purchases : [])) {
      if (!oldPurchaseIds.has(String(purchase.id)) && purchase.ivaRetentionDecision) {
        const decision = purchase.ivaRetentionDecision;
        auditInsert.run('purchase_iva_retention_decision_recorded', JSON.stringify({
          purchaseId: purchase.id, companyId: purchase.companyId,
          invoiceNumber: purchase.invoiceNumber || null,
          supplierRif: purchase.supplierRif || null,
          supplierName: purchase.supplierName || null,
          decisionStatus: decision.decisionStatus || null,
          decisionReason: decision.decisionReason || null,
          legalBasis: decision.legalBasis || null,
          buyerAgentStatus: decision.buyerAgentStatus || null,
          supplierTaxStatus: decision.supplierTaxStatus || null,
          article2Transaction: Boolean(decision.article2Transaction),
          article3Exclusions: Array.isArray(decision.article3Exclusions) ? decision.article3Exclusions : [],
          portalArticle3ExclusionConfirmed: Boolean(decision.portalArticle3ExclusionConfirmed),
          supplierImportPerceptionConfirmed: Boolean(decision.supplierImportPerceptionConfirmed),
          invoiceFormalDefect: Boolean(decision.invoiceFormalDefect),
          portalRetentionRate: decision.portalRetentionRate ?? null,
          vatNotDiscriminated: Boolean(decision.vatNotDiscriminated),
          taxableAmountIncludingVatBs: decision.taxableAmountIncludingVatBs ?? null,
          operationAmountBs: decision.operationAmountBs ?? null,
          unitTaxValueBs: decision.unitTaxValueBs ?? null,
          evaluatedAt: decision.evaluatedAt || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
    }
    const oldInventoryMovements = new Map((Array.isArray(priorState.movements) ? priorState.movements : [])
      .map(item => [String(item.id), item]));
    for (const movement of (Array.isArray(state.movements) ? state.movements : [])) {
      if (oldInventoryMovements.has(String(movement.id))) continue;
      auditInsert.run(movement.correctionForMovementId ? 'inventory_correction_posted' : 'inventory_movement_posted', JSON.stringify({
        movementId: movement.id, companyId: movement.companyId, productId: movement.productId,
        productCode: movement.productCode, productName: movement.productName, date: movement.date,
        type: movement.type, concept: movement.concept, documentRef: movement.documentRef,
        quantity: movement.quantity, totalCostBs: movement.totalCostBs, totalCostUsd: movement.totalCostUsd,
        journalEntryId: movement.journalEntryId || null,
        correctionForMovementId: movement.correctionForMovementId || null
      }));
    }
    const oldBankRows = new Map((Array.isArray(priorState.bankStatementMovements) ? priorState.bankStatementMovements : [])
      .map(item => [String(item.id), item]));
    for (const row of (Array.isArray(state.bankStatementMovements) ? state.bankStatementMovements : [])) {
      const oldRow = oldBankRows.get(String(row.id));
      if (!oldRow) {
        auditInsert.run('bank_statement_imported', JSON.stringify({
          statementMovementId: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
          date: row.date, reference: row.reference, description: row.description,
          type: row.type, amountBs: row.amountBs, amountUsd: row.amountUsd,
          bcvRate: row.bcvRate ?? null, bcvRateEffectiveDate: row.bcvRateEffectiveDate || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
        continue;
      }
      if (oldRow.isReconciled && !row.isReconciled) {
        auditInsert.run('bank_statement_unreconciled', JSON.stringify({
          statementMovementId: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
          previousJournalEntryId: oldRow.reconciledWithJournalEntryId || null,
          reconciliationHistory: oldRow.reconciledJournalEntryIds || [],
          reference: row.reference, date: row.date, amountBs: row.amountBs, amountUsd: row.amountUsd
        }));
      }
      const oldLinks = Array.isArray(oldRow.reconciledJournalEntryIds) ? oldRow.reconciledJournalEntryIds : [];
      const nextLinks = Array.isArray(row.reconciledJournalEntryIds) ? row.reconciledJournalEntryIds : [];
      for (const journalEntryId of nextLinks) {
        if (oldLinks.includes(journalEntryId)) continue;
        auditInsert.run('bank_statement_reconciled', JSON.stringify({
          statementMovementId: row.id, companyId: row.companyId, bankAccountId: row.bankAccountId,
          journalEntryId, reference: row.reference, date: row.date, amountBs: row.amountBs,
          amountUsd: row.amountUsd, matchedBy: row.matchedBy || null
        }));
      }
    }
    const oldSettlements = new Map((Array.isArray(priorState.creditSettlements) ? priorState.creditSettlements : [])
      .map(item => [String(item.id), item]));
    for (const settlement of (Array.isArray(state.creditSettlements) ? state.creditSettlements : [])) {
      const oldSettlement = oldSettlements.get(String(settlement.id));
      if (!oldSettlement) {
        auditInsert.run('credit_settlement_posted', JSON.stringify({
          settlementId: settlement.id, companyId: settlement.companyId,
          documentId: settlement.documentId, kind: settlement.kind,
          settlementDate: settlement.settlementDate,
          amountBs: settlement.amountBs, amountUsd: settlement.amountUsd,
          method: settlement.method, bankAccountId: settlement.bankAccountId || null,
          reference: settlement.reference || null, bcvRate: settlement.bcvRate,
          journalEntryId: settlement.journalEntryId
        }));
      } else if (!oldSettlement.isReversed && settlement.isReversed) {
        auditInsert.run('credit_settlement_reversed', JSON.stringify({
          settlementId: settlement.id, companyId: settlement.companyId,
          documentId: settlement.documentId, journalEntryId: settlement.journalEntryId,
          reversedByJournalEntryId: settlement.reversedByJournalEntryId || null
        }));
      }
    }
    const oldDirectAdvances = new Map((Array.isArray(priorState.supplierDirectAdvances) ? priorState.supplierDirectAdvances : [])
      .map(item => [String(item.id), item]));
    for (const advance of (Array.isArray(state.supplierDirectAdvances) ? state.supplierDirectAdvances : [])) {
      const oldAdvance = oldDirectAdvances.get(String(advance.id));
      if (!oldAdvance) {
        auditInsert.run('supplier_direct_advance_posted', JSON.stringify({
          directAdvanceId: advance.id, companyId: advance.companyId,
          supplierRif: advance.supplierRif, supplierName: advance.supplierName,
          date: advance.date, amountUsd: advance.amountUsd, bookValueBs: advance.bookValueBs,
          paymentCurrency: advance.paymentCurrency, paidAmount: advance.paidAmount,
          treasuryAccountCode: advance.treasuryAccountCode,
          reference: advance.reference, support: advance.support,
          journalEntryId: advance.journalEntryId
        }));
      } else if (!oldAdvance.isReversed && advance.isReversed) {
        auditInsert.run('supplier_direct_advance_reversed', JSON.stringify({
          directAdvanceId: advance.id, companyId: advance.companyId,
          journalEntryId: advance.journalEntryId,
          reversedByJournalEntryId: advance.reversedByJournalEntryId || null
        }));
      }
    }
    const oldAdvanceSettlements = new Map((Array.isArray(priorState.supplierAdvanceSettlements) ? priorState.supplierAdvanceSettlements : []).map(item => [String(item.id), item]));
    for (const settlement of (Array.isArray(state.supplierAdvanceSettlements) ? state.supplierAdvanceSettlements : [])) {
      const oldSettlement = oldAdvanceSettlements.get(String(settlement.id));
      if (!oldSettlement) {
        auditInsert.run('supplier_advance_settlement_posted', JSON.stringify({
          settlementId: settlement.id, companyId: settlement.companyId, supplierRif: settlement.supplierRif,
          kind: settlement.kind, amountBs: settlement.amountBs, amountUsd: settlement.amountUsd,
          journalEntryId: settlement.journalEntryId, targetPurchaseId: settlement.targetPurchaseId || null,
          sourceCreditNoteIds: settlement.sourceCreditNoteIds || [],
          sourceCreditNoteAllocations: settlement.sourceCreditNoteAllocations || [],
          sourceDirectAdvanceIds: settlement.sourceDirectAdvanceIds || [],
          sourceDirectAdvanceAllocations: settlement.sourceDirectAdvanceAllocations || []
        }));
      } else if (!oldSettlement.isReversed && settlement.isReversed) {
        auditInsert.run('supplier_advance_settlement_reversed', JSON.stringify({
          settlementId: settlement.id, companyId: settlement.companyId,
          journalEntryId: settlement.journalEntryId, reversedByJournalEntryId: settlement.reversedByJournalEntryId || null
        }));
      }
    }

    const oldFixedAssets = new Map((Array.isArray(priorState.fixedAssets) ? priorState.fixedAssets : [])
      .map(item => [String(item.id), item]));
    for (const asset of (Array.isArray(state.fixedAssets) ? state.fixedAssets : [])) {
      const oldAsset = oldFixedAssets.get(String(asset.id));
      if (!oldAsset) {
        auditInsert.run('fixed_asset_registered', JSON.stringify({
          assetId: asset.id, companyId: asset.companyId, assetCode: asset.assetCode,
          description: asset.description, category: asset.category,
          acquisitionDate: asset.acquisitionDate, serviceDate: asset.serviceDate,
          acquisitionCostBs: asset.acquisitionCostBs, acquisitionCostUsd: asset.acquisitionCostUsd,
          acquisitionBcvRate: asset.acquisitionBcvRate,
          residualValueBs: asset.residualValueBs, residualValueUsd: asset.residualValueUsd,
          usefulLifeMonths: asset.usefulLifeMonths, depreciationMethod: asset.depreciationMethod,
          sourceJournalEntryId: asset.sourceJournalEntryId,
          sourceJournalLineIndex: asset.sourceJournalLineIndex,
          assetAccountCode: asset.assetAccountCode,
          accumulatedDepreciationAccountCode: asset.accumulatedDepreciationAccountCode,
          depreciationExpenseAccountCode: asset.depreciationExpenseAccountCode,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
      const oldEvents = new Map((Array.isArray(oldAsset?.depreciationEvents) ? oldAsset.depreciationEvents : [])
        .map(event => [String(event.id), event]));
      for (const event of (Array.isArray(asset.depreciationEvents) ? asset.depreciationEvents : [])) {
        const oldEvent = oldEvents.get(String(event.id));
        if (!oldEvent) {
          auditInsert.run('fixed_asset_depreciation_posted', JSON.stringify({
            assetId: asset.id, companyId: asset.companyId, assetCode: asset.assetCode,
            depreciationEventId: event.id, period: event.period, date: event.date,
            days: event.days, amountBs: event.amountBs, amountUsd: event.amountUsd,
            journalEntryId: event.journalEntryId,
            actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
          }));
        } else if (!oldEvent.reversedByJournalEntryId && event.reversedByJournalEntryId) {
          auditInsert.run('fixed_asset_depreciation_reversed', JSON.stringify({
            assetId: asset.id, companyId: asset.companyId, assetCode: asset.assetCode,
            depreciationEventId: event.id, period: event.period,
            journalEntryId: event.journalEntryId,
            reversedByJournalEntryId: event.reversedByJournalEntryId,
            actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
          }));
        }
      }
    }

    const oldVatVouchers = new Map((Array.isArray(priorState.vatVouchers) ? priorState.vatVouchers : [])
      .map(item => [String(item.id), item]));
    for (const voucher of (Array.isArray(state.vatVouchers) ? state.vatVouchers : [])) {
      const oldVoucher = oldVatVouchers.get(String(voucher.id));
      if (!oldVoucher) {
        auditInsert.run('vat_retention_voucher_issued', JSON.stringify({
          voucherId: voucher.id, voucherNumber: voucher.voucherNumber || null,
          companyId: voucher.companyId, purchaseRecordId: voucher.purchaseRecordId || null,
          agentName: voucher.agentNameSnapshot || null, agentRif: voucher.agentRifSnapshot || null,
          agentAddress: voucher.agentAddressSnapshot || null,
          supplierRif: voucher.supplierRif || null, supplierName: voucher.supplierName || null,
          issueDate: voucher.date || null, fiscalDate: voucher.fiscalDate || null,
          period: voucher.period || null, taxableBaseBs: voucher.taxableBaseBs ?? null,
          vatAmountBs: voucher.vatAmountBs ?? null, vatWithheldBs: voucher.vatWithheldBs ?? null,
          retentionRate: voucher.retentionRate ?? null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
      const oldCorrectionIds = new Set(oldVoucher?.correctionEntryIds || (oldVoucher?.correctionEntryId ? [oldVoucher.correctionEntryId] : []));
      const newCorrectionIds = (voucher.correctionEntryIds || (voucher.correctionEntryId ? [voucher.correctionEntryId] : []))
        .filter(id => !oldCorrectionIds.has(id));
      if (voucher.requiresFiscalCorrection && (!oldVoucher?.requiresFiscalCorrection || newCorrectionIds.length > 0)) {
        auditInsert.run('vat_retention_voucher_correction_required', JSON.stringify({
          voucherId: voucher.id, voucherNumber: voucher.voucherNumber || null,
          companyId: voucher.companyId, purchaseRecordId: voucher.purchaseRecordId || null,
          correctionEntryIds: newCorrectionIds,
          correctionNote: voucher.correctionNote || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
      if ((!oldVoucher || !oldVoucher.deliveryDate) && voucher.deliveryDate) {
        auditInsert.run('vat_retention_voucher_delivered', JSON.stringify({
          voucherId: voucher.id, voucherNumber: voucher.voucherNumber || null,
          companyId: voucher.companyId, purchaseRecordId: voucher.purchaseRecordId || null,
          supplierRif: voucher.supplierRif || null, supplierName: voucher.supplierName || null,
          deliveryDate: voucher.deliveryDate, deliveryMethod: voucher.deliveryMethod,
          electronicDeliveryAgreed: Boolean(voucher.electronicDeliveryAgreed),
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
    }
    const oldVatDeclarationIds = new Set((Array.isArray(priorState.vatWithholdingDeclarations) ? priorState.vatWithholdingDeclarations : [])
      .map(item => String(item.id)));
    for (const declaration of (Array.isArray(state.vatWithholdingDeclarations) ? state.vatWithholdingDeclarations : [])) {
      if (oldVatDeclarationIds.has(String(declaration.id))) continue;
      auditInsert.run('vat_withholding_declaration_prepared', JSON.stringify({
        declarationId: declaration.id, companyId: declaration.companyId,
        period: declaration.period, window: declaration.window,
        startDate: declaration.startDate, endDate: declaration.endDate,
        zeroOperations: Boolean(declaration.zeroOperations),
        voucherIds: Array.isArray(declaration.voucherIds) ? declaration.voucherIds : [],
        legacyDateAssignments: Array.isArray(declaration.legacyDateAssignments) ? declaration.legacyDateAssignments : [],
        voucherSnapshots: Array.isArray(declaration.voucherSnapshots) ? declaration.voucherSnapshots : [],
        totalTaxableBaseBs: declaration.totalTaxableBaseBs,
        totalVatAmountBs: declaration.totalVatAmountBs,
        totalWithheldBs: declaration.totalWithheldBs,
        createdAt: declaration.createdAt,
        actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
      }));
    }
    const oldVatDeclarationEventIds = new Set((Array.isArray(priorState.vatWithholdingDeclarationEvents) ? priorState.vatWithholdingDeclarationEvents : [])
      .map(item => String(item.id)));
    for (const event of (Array.isArray(state.vatWithholdingDeclarationEvents) ? state.vatWithholdingDeclarationEvents : [])) {
      if (oldVatDeclarationEventIds.has(String(event.id))) continue;
      auditInsert.run('vat_withholding_declaration_event', JSON.stringify({
        eventId: event.id, declarationId: event.declarationId,
        eventType: event.eventType, occurredAt: event.occurredAt,
        note: event.note || null,
        acknowledgedLegacyDates: Boolean(event.acknowledgedLegacyDates),
        declarationNumber: event.declarationNumber || null,
        receiptReference: event.receiptReference || null,
        amountBs: event.amountBs ?? null,
        paymentReference: event.paymentReference || null,
        journalEntryId: event.journalEntryId || null,
        amountUsd: event.amountUsd ?? null,
        bankStatementMovementIds: Array.isArray(event.bankStatementMovementIds) ? event.bankStatementMovementIds : [],
        evidenceReference: event.evidenceReference || null,
        dueDate: event.dueDate || null,
        officialSourceTitle: event.officialSourceTitle || null,
        officialSourceUrl: event.officialSourceUrl || null,
        officialReference: event.officialReference || null,
        actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
      }));
    }
    const previousCompaniesForInventoryRates = new Map((Array.isArray(priorState.companies) ? priorState.companies : []).map(company => [String(company.id), company]));
    const nextCompanyIdsForInventoryRates = new Set((Array.isArray(state.companies) ? state.companies : []).map(company => String(company.id)));
    for (const [companyId, previousCompany] of previousCompaniesForInventoryRates) {
      if ((Array.isArray(previousCompany.inventoryBcvRateHistory) ? previousCompany.inventoryBcvRateHistory.length : 0) > 0 && !nextCompanyIdsForInventoryRates.has(companyId)) {
        throw new Error('No se puede eliminar una empresa que conserva historial diario de tasas BCV de Inventario.');
      }
    }
    for (const company of (Array.isArray(state.companies) ? state.companies : [])) {
      const previousCompany = previousCompaniesForInventoryRates.get(String(company.id));
      const previousHistory = Array.isArray(previousCompany?.inventoryBcvRateHistory) ? previousCompany.inventoryBcvRateHistory : [];
      const nextHistory = Array.isArray(company.inventoryBcvRateHistory) ? company.inventoryBcvRateHistory : [];
      const nextById = new Map(nextHistory.map(entry => [String(entry.id), entry]));
      for (const oldEntry of previousHistory) {
        const retained = nextById.get(String(oldEntry.id));
        if (!retained || JSON.stringify(retained) !== JSON.stringify(oldEntry)) {
          throw new Error('El historial diario de tasas BCV de Inventario es inmutable; no se permite modificar ni eliminar registros anteriores.');
        }
      }
      const previousIds = new Set(previousHistory.map(entry => String(entry.id)));
      const knownEntriesById = new Map(previousHistory.map(entry => [String(entry.id), entry]));
      const nextIds = new Set();
      const automaticDates = new Set(previousHistory.filter(entry => entry.mode === 'AUTOMATIC').map(entry => String(entry.effectiveDate)));
      for (const entry of nextHistory) {
        const entryId = String(entry.id || '');
        if (!entryId || nextIds.has(entryId)) throw new Error('El historial BCV de Inventario contiene identificadores vacíos o duplicados.');
        nextIds.add(entryId);
        if (previousIds.has(entryId)) continue;
        const effectiveDate = String(entry.effectiveDate || '');
        const fetchedAt = String(entry.fetchedAt || '');
        const rate = Number(entry.rate);
        const fetchedAtTime = Date.parse(fetchedAt);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ||
            !Number.isFinite(new Date(effectiveDate + 'T00:00:00.000Z').getTime()) ||
            new Date(effectiveDate + 'T00:00:00.000Z').toISOString().slice(0, 10) !== effectiveDate ||
            !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000_000_000 ||
            !Number.isFinite(fetchedAtTime) ||
            !['AUTOMATIC', 'MANUAL'].includes(String(entry.mode)) ||
            !['bcv.today', 'manual'].includes(String(entry.provider)) ||
            typeof entry.source !== 'string' || !entry.source.trim() ||
            (entry.mode === 'MANUAL' && entry.provider !== 'manual') ||
            (entry.mode === 'AUTOMATIC' && entry.provider !== 'bcv.today')) {
          throw new Error('El registro histórico de tasa BCV de Inventario contiene datos inválidos.');
        }
        if (entry.mode === 'AUTOMATIC') {
          if (automaticDates.has(effectiveDate)) throw new Error('El historial BCV no admite dos registros automáticos para la misma fecha.');
          automaticDates.add(effectiveDate);
        }
        if (entry.correctionOfId) {
          const correctedEntry = knownEntriesById.get(String(entry.correctionOfId));
          if (entry.mode !== 'MANUAL' || !correctedEntry ||
              String(correctedEntry.effectiveDate) !== effectiveDate ||
              String(entry.note || '').trim().length < 5) {
            throw new Error('La corrección manual BCV debe vincularse a una tasa previa de la misma fecha e indicar un motivo de al menos 5 caracteres.');
          }
        }
        auditInsert.run('inventory_bcv_rate_recorded', JSON.stringify({
          companyId: company.id,
          companyName: company.name || null,
          rate,
          effectiveDate,
          fetchedAt,
          source: entry.source,
          provider: entry.provider,
          mode: entry.mode,
          note: entry.note || null,
          correctionOfId: entry.correctionOfId || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null, role: actor.role || null } : null
        }));
        knownEntriesById.set(entryId, entry);
      }
    }
    const oldCompanies = new Map((Array.isArray(priorState.companies) ? priorState.companies : []).map(company => [String(company.id), company]));
    for (const company of (Array.isArray(state.companies) ? state.companies : [])) {
      const oldCompany = oldCompanies.get(String(company.id));
      if (oldCompany) {
        const profileFields = ['name', 'tradeName', 'rif', 'address', 'phone', 'email'];
        const changedFields = profileFields
          .filter(field => String(oldCompany[field] ?? '') !== String(company[field] ?? ''))
          .map(field => ({
            field,
            previousValue: oldCompany[field] ?? null,
            newValue: company[field] ?? null
          }));
        if (changedFields.length) {
          auditInsert.run('company_profile_updated', JSON.stringify({
            companyId: company.id,
            companyName: company.name,
            changedFields,
            reason: 'Rectificación de datos maestros desde Configuración',
            actor: actor ? { userId: actor.id ?? null, username: actor.username || null, role: actor.role || null } : null,
            occurredAt: new Date().toISOString()
          }));
        }
      }
      const previousBcvRate = Number(oldCompany?.bcvRate);
      const nextBcvRate = Number(company.bcvRate);
      if (oldCompany && Number.isFinite(previousBcvRate) && Number.isFinite(nextBcvRate) && previousBcvRate !== nextBcvRate) {
        auditInsert.run('company_bcv_rate_updated', JSON.stringify({
          companyId: company.id, companyName: company.name,
          previousRate: previousBcvRate, newRate: nextBcvRate,
          effectiveDate: company.lastRateUpdate || null,
          actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
        }));
      }
      if (company.closedThroughDate && company.closedThroughDate !== oldCompany?.closedThroughDate) {
        auditInsert.run('accounting_period_closed', JSON.stringify({
          companyId: company.id, companyName: company.name,
          previousClosedThroughDate: oldCompany?.closedThroughDate || null,
          closedThroughDate: company.closedThroughDate
        }));
      }
    }
    syncPartyMasterRows(db, state);
    db.prepare(`INSERT INTO app_state(state_key,state_json,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(state_key) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
      .run('accounting', json);
    auditInsert.run('state_saved', JSON.stringify({ bytes: Buffer.byteLength(json) }));
  });
  save();
  return { ok: true, savedAt: new Date().toISOString() };
}

function initializeAccountingPersistenceSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('Se requiere una conexión SQLite para inicializar el esquema contable.');
db.exec(`
  CREATE TABLE IF NOT EXISTS accounting_exercise_links (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    prior_period_start_date TEXT NOT NULL,
    prior_period_end_date TEXT NOT NULL,
    next_period_start_date TEXT NOT NULL,
    journal_entry_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, prior_period_start_date, prior_period_end_date, next_period_start_date)
  );
  CREATE TRIGGER IF NOT EXISTS accounting_exercise_links_no_update
    BEFORE UPDATE ON accounting_exercise_links
    BEGIN SELECT RAISE(ABORT, 'accounting_exercise_links is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS accounting_exercise_links_no_delete
    BEFORE DELETE ON accounting_exercise_links
    BEGIN SELECT RAISE(ABORT, 'accounting_exercise_links is append-only'); END;
  CREATE TABLE IF NOT EXISTS party_masters (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    party_type TEXT NOT NULL CHECK(party_type IN ('CUSTOMER','SUPPLIER')),
    name TEXT NOT NULL,
    fiscal_id TEXT,
    fiscal_id_type TEXT,
    normalized_fiscal_id TEXT,
    address TEXT,
    phone TEXT,
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(company_id, party_type, normalized_fiscal_id)
  );
  CREATE INDEX IF NOT EXISTS party_masters_company_type_name_idx ON party_masters(company_id, party_type, name);
  CREATE TABLE IF NOT EXISTS period_reopenings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    previous_closed_through_date TEXT NOT NULL,
    reopened_through_date TEXT,
    reason TEXT NOT NULL,
    actor_user_id INTEGER NOT NULL,
    actor_username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TRIGGER IF NOT EXISTS period_reopenings_no_update
    BEFORE UPDATE ON period_reopenings
    BEGIN SELECT RAISE(ABORT, 'period_reopenings is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS period_reopenings_no_delete
    BEFORE DELETE ON period_reopenings
    BEGIN SELECT RAISE(ABORT, 'period_reopenings is append-only'); END;
`);
}

function registerAccountingPersistenceHandler({ ipcMain, db, licenseView, getActiveSession, withDatabase = null }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      (withDatabase !== null && typeof withDatabase !== 'function')) {
    throw new Error('No se pudo registrar el puente de persistencia contable de SICOVEN.');
  }
  if (!withDatabase) initializeAccountingPersistenceSchema(db);
  const runWithDatabase = (token, operation) => withDatabase
    ? withDatabase(token, (activeDb, companyId) => operation(activeDb, companyId))
    : operation(db, null);
  ipcMain.handle('sicoven:reopen-accounting-period', (_event, token, input) => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida. Inicie sesión para reabrir un período.');
    if (!hasFullSystemAccess(actor)) throw new Error('Permiso insuficiente: se requiere rol contable (admin o contador) para reabrir períodos contables.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud de reapertura inválida.');
    const companyId = String(input.companyId || '').trim();
    const reason = String(input.reason || '').trim();
    const reopenedThroughDate = input.reopenedThroughDate === null || input.reopenedThroughDate === ''
      ? null : String(input.reopenedThroughDate);
    if (!companyId) throw new Error('Seleccione una empresa para reabrir el período.');
    if (reason.length < 10 || reason.length > 1000) throw new Error('El motivo de reapertura es obligatorio y debe tener entre 10 y 1000 caracteres.');
    if (reopenedThroughDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(reopenedThroughDate)) {
      throw new Error('La nueva fecha de cierre debe ser una fecha ISO válida o quedar vacía para reabrir todo el período.');
    }
    if (reopenedThroughDate !== null) {
      const parsed = new Date(reopenedThroughDate + 'T00:00:00.000Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== reopenedThroughDate) {
        throw new Error('La nueva fecha de cierre no existe en el calendario.');
      }
    }
    return runWithDatabase(token, (activeDb, selectedCompanyId) => {
    if (selectedCompanyId && selectedCompanyId !== companyId) {
      throw new Error('La reapertura solicitada no pertenece a la empresa activa.');
    }
    const reopen = activeDb.transaction(() => {
      const row = activeDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
      if (!row) throw new Error('No existe un estado contable persistido para reabrir.');
      let state;
      try { state = JSON.parse(row.state_json); }
      catch { throw new Error('El estado contable SQLite es ilegible; se bloqueó la reapertura para proteger el historial.'); }
      if (!state || !Array.isArray(state.companies)) throw new Error('El estado contable no contiene empresas válidas.');
      const company = state.companies.find(item => String(item.id) === companyId);
      if (!company) throw new Error('La empresa seleccionada no existe en SQLite.');
      const previousClosedThroughDate = String(company.closedThroughDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(previousClosedThroughDate)) {
        throw new Error('La empresa no tiene un cierre contable vigente para reabrir.');
      }
      if (reopenedThroughDate !== null && reopenedThroughDate >= previousClosedThroughDate) {
        throw new Error('La nueva fecha debe ser anterior al cierre vigente para que exista una reapertura efectiva.');
      }
      if (reopenedThroughDate === null && !previousClosedThroughDate) {
        throw new Error('No existe un período cerrado que pueda reabrirse.');
      }
      const reopeningId = crypto.randomUUID();
      const nextState = {
        ...state,
        companies: state.companies.map(item => String(item.id) === companyId
          ? { ...item, ...(reopenedThroughDate ? { closedThroughDate: reopenedThroughDate } : { closedThroughDate: undefined }) }
          : item)
      };
      const json = JSON.stringify(nextState);
      if (json.length > 50 * 1024 * 1024) throw new Error('El estado contable supera el límite permitido.');
      activeDb.prepare("UPDATE app_state SET state_json=?, updated_at=datetime('now') WHERE state_key='accounting'").run(json);
      const details = {
        reopeningId, companyId, companyName: String(company.name || ''),
        previousClosedThroughDate, reopenedThroughDate,
        reason, actor: { userId: actor.id, username: actor.username }
      };
      activeDb.prepare(`INSERT INTO period_reopenings
        (id,company_id,company_name,previous_closed_through_date,reopened_through_date,reason,actor_user_id,actor_username)
        VALUES(?,?,?,?,?,?,?,?)`)
        .run(reopeningId, companyId, String(company.name || ''), previousClosedThroughDate,
          reopenedThroughDate, reason, Number(actor.id), String(actor.username || ''));
      activeDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('accounting_period_reopened', JSON.stringify(details));
      return { ok: true, company: nextState.companies.find(item => String(item.id) === companyId), reopeningId };
    });
    return reopen();
    });
  });
  ipcMain.handle('sicoven:save-state', (_event, token, state) => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida. Inicie sesión para guardar datos contables.');
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Estado contable inválido');
    return runWithDatabase(token, (activeDb, selectedCompanyId) => {
      if (selectedCompanyId) {
        const partitions = partitionAccountingSnapshot(state);
        if (partitions.length !== 1 ||
            String(partitions[0]?.companies?.[0]?.id || '') !== selectedCompanyId ||
            String(state.currentCompanyId || '') !== selectedCompanyId) {
          throw new Error('El snapshot no pertenece exclusivamente a la empresa activa. Se bloqueó el guardado para evitar mezclar datos.');
        }
      }
      return persistAccountingSnapshot(activeDb, state, actor);
    });
  });
}

module.exports = { persistAccountingSnapshot, initializeAccountingPersistenceSchema, registerAccountingPersistenceHandler };
