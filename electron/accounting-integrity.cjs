const { validateIslrFiscalEventLedger } = require('./islr-fiscal-integrity.cjs');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// CxP balances in USD are recorded and settled to cents; compare at that same precision.
function exceedsUsdPayable(applied, payable) {
  return money(applied) > money(payable);
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertAppendOnlyCollection(previousState, nextState, collectionName, mutableKeys = [], monotonicKeys = []) {
  const oldItems = asArray(previousState[collectionName]);
  const newItems = asArray(nextState[collectionName]);
  const newById = new Map(newItems.map(item => [String(item.id), item]));
  if (newById.size !== newItems.length) {
    throw new Error('Hay identificadores duplicados en el historial ' + collectionName + '.');
  }
  const stripMutable = item => {
    const copy = { ...item };
    for (const key of mutableKeys) delete copy[key];
    return copy;
  };
  for (const oldItem of oldItems) {
    const nextItem = newById.get(String(oldItem.id));
    if (!nextItem) {
      throw new Error('SQLite bloqueó la eliminación del registro histórico en ' + collectionName + ' (' + oldItem.id + '). Use una reversión o corrección trazable.');
    }
    if (JSON.stringify(stripMutable(oldItem)) !== JSON.stringify(stripMutable(nextItem))) {
      throw new Error('SQLite bloqueó la modificación de un registro histórico en ' + collectionName + ' (' + oldItem.id + ').');
    }
    for (const key of monotonicKeys) {
      if (oldItem[key] && nextItem[key] !== oldItem[key]) {
        throw new Error('No se puede retirar ni modificar la marca histórica ' + key + ' del registro ' + oldItem.id + '.');
      }
    }
    const freezeWhenActive = (flag, detailKeys) => {
      if (!oldItem[flag]) return;
      for (const key of detailKeys) {
        if ((oldItem[key] || null) !== (nextItem[key] || null)) {
          throw new Error('No se puede modificar el soporte histórico ' + key + ' del registro ' + oldItem.id + '.');
        }
      }
    };
    freezeWhenActive('isCancelled', ['cancelledByJournalEntryId', 'cancellationReason', 'cancellationNote']);
    freezeWhenActive('isReversed', ['reversedByJournalEntryId']);
    if (oldItem.requiresFiscalCorrection) {
      const oldCorrectionIds = Array.isArray(oldItem.correctionEntryIds) ? oldItem.correctionEntryIds : (oldItem.correctionEntryId ? [oldItem.correctionEntryId] : []);
      const nextCorrectionIds = Array.isArray(nextItem.correctionEntryIds) ? nextItem.correctionEntryIds : (nextItem.correctionEntryId ? [nextItem.correctionEntryId] : []);
      const oldCorrectionNote = String(oldItem.correctionNote || '');
      const nextCorrectionNote = String(nextItem.correctionNote || '');
      if (new Set(nextCorrectionIds).size !== nextCorrectionIds.length ||
          oldCorrectionIds.some(id => !nextCorrectionIds.includes(id)) ||
          (nextItem.correctionEntryId && !nextCorrectionIds.includes(nextItem.correctionEntryId)) ||
          (oldCorrectionNote && !nextCorrectionNote.startsWith(oldCorrectionNote))) {
        throw new Error('No se puede retirar ni alterar el historial de correcciones fiscales del comprobante ' + oldItem.id + '.');
      }
    }
  }
}

function purchaseJournalMatchesInvoice(purchase, entry, products = [], accounts = []) {
  if (!purchase || !entry || entry.type !== 'COMPRA' || entry.companyId !== purchase.companyId ||
      entry.date !== String(purchase.accountCreditDate || purchase.invoiceDate) ||
      String(entry.referenceDoc || '').trim().toUpperCase().replace(/\s+/g, '') !==
        ('FAC-' + String(purchase.invoiceNumber || '')).trim().toUpperCase().replace(/\s+/g, '')) return false;
  const taxableBase = Number(purchase.taxableBaseBs);
  const exemptBase = Number(purchase.exemptAmountBs);
  const vat = Number(purchase.vatAmountBs);
  const vatWithheld = Number(purchase.vatWithheldBs ?? 0);
  const islrWithheld = Number(purchase.islrWithheldBs ?? 0);
  const igtf = Number(purchase.igtfAmountBs ?? 0);
  const total = Number(purchase.totalAmountBs);
  const rate = Number(purchase.bcvRate);
  const taxRate = Number(purchase.taxRate);
  const base = taxableBase + exemptBase;
  const payable = total - vatWithheld - islrWithheld;
  const values = [taxableBase, exemptBase, vat, vatWithheld, islrWithheld, igtf, total, rate, taxRate];
  if (!values.every(value => Number.isFinite(value) && value >= 0) ||
      rate <= 0 || taxRate > 100 || payable <= 0 ||
      Math.abs(vat - Math.round((taxableBase * taxRate / 100 + Number.EPSILON) * 100) / 100) > 0.02 ||
      Math.abs(total - (base + vat + igtf)) > 0.02) return false;

  const inventoryByAccount = new Map();
  if (Array.isArray(purchase.inventoryLines) && purchase.inventoryLines.length > 0) {
    for (const line of purchase.inventoryLines) {
      const product = asArray(products).find(item => String(item.id) === String(line.productId) &&
        String(item.companyId) === String(purchase.companyId));
      if (!product) return false;
      const code = String(product.inventoryAccountCode || '1.1.4.01');
      const amount = Number(line.quantity) * Number(line.unitCostBs);
      if (!code || !Number.isFinite(amount) || amount <= 0) return false;
      inventoryByAccount.set(code, (inventoryByAccount.get(code) || 0) + amount);
    }
  } else {
    // Las facturas sin detalle de inventario se registran como gasto operativo
    // en el flujo actual. Se conserva compatibilidad con asientos históricos
    // que ya fueron contabilizados contra inventario.
    const expenseDebit = asArray(entry.items).some(item =>
      String(item.accountCode) === '6.1.1.04' && Number(item.debitBs || 0) > 0);
    if (expenseDebit) inventoryByAccount.set('6.1.1.04', base);
    else inventoryByAccount.set('1.1.4.01', base);
  }
  const items = asArray(entry.items);
  const cashPurchase = purchase.paymentTerm === 'CONTADO';
  const payableAccounts = [...new Set(items
    .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
    .map(item => String(item.accountCode)))];
  let payableAccountCode = '2.1.1.01';
  if (cashPurchase) {
    payableAccountCode = String(purchase.paymentAccountCode || '');
    const selected = asArray(accounts).find(account => String(account.code) === payableAccountCode);
    const name = String(selected?.name || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
    const eligible = selected?.type === 'ACTIVO' && selected?.isMovement === true &&
      (/\b(CAJA|BANCO|BANCOS|EFECTIVO|EQUIVALENTES DE EFECTIVO)\b/.test(name) || /^1\.1\.1(?:\.|$)/.test(payableAccountCode));
    if (!eligible || payableAccounts.length !== 0 || !String(purchase.paymentReference || '').trim()) return false;
  } else {
    if (payableAccounts.length !== 1) return false;
    payableAccountCode = payableAccounts[0];
  }
  const allowed = new Set([...inventoryByAccount.keys(), '1.1.3.01', '6.1.1.11', '2.1.2.03', '2.1.2.04', payableAccountCode]);
  if (!items.length || !items.every(item => {
    const amounts = [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd].map(value => Number(value ?? 0));
    return Boolean(item.accountCode) && allowed.has(item.accountCode) &&
      amounts.every(value => Number.isFinite(value) && value >= 0) &&
      !(amounts[0] > 0 && amounts[1] > 0) && !(amounts[2] > 0 && amounts[3] > 0);
  })) return false;

  const byAccount = new Map();
  for (const item of items) {
    const current = byAccount.get(item.accountCode) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
    current.debitBs += Number(item.debitBs ?? 0);
    current.creditBs += Number(item.creditBs ?? 0);
    current.debitUsd += Number(item.debitUsd ?? 0);
    current.creditUsd += Number(item.creditUsd ?? 0);
    byAccount.set(item.accountCode, current);
  }
  const expected = new Map([
    ...[...inventoryByAccount.entries()].map(([code, amount]) => [code, { debitBs: money(amount), creditBs: 0 }]),
    ['1.1.3.01', { debitBs: vat, creditBs: 0 }],
    ['6.1.1.11', { debitBs: igtf, creditBs: 0 }],
    ['2.1.2.03', { debitBs: 0, creditBs: vatWithheld }],
    ['2.1.2.04', { debitBs: 0, creditBs: islrWithheld }],
    [payableAccountCode, { debitBs: 0, creditBs: payable }]
  ]);
  for (const [accountCode, amount] of expected) {
    const actual = byAccount.get(accountCode) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
    if (Math.abs(actual.debitBs - amount.debitBs) > 0.02 ||
        Math.abs(actual.creditBs - amount.creditBs) > 0.02 ||
        Math.abs(actual.debitUsd - amount.debitBs / rate) > 0.0001 ||
        Math.abs(actual.creditUsd - amount.creditBs / rate) > 0.0001) return false;
  }
  const debitBs = items.reduce((sum, item) => sum + Number(item.debitBs ?? 0), 0);
  const creditBs = items.reduce((sum, item) => sum + Number(item.creditBs ?? 0), 0);
  const debitUsd = items.reduce((sum, item) => sum + Number(item.debitUsd ?? 0), 0);
  const creditUsd = items.reduce((sum, item) => sum + Number(item.creditUsd ?? 0), 0);
  return Math.abs(debitBs - creditBs) <= 0.02 && Math.abs(debitUsd - creditUsd) <= 0.0001 &&
    Math.abs(Number(purchase.totalAmountUsd) - total / rate) <= 0.0001 &&
    Math.abs(Number(purchase.taxableBaseUsd) - taxableBase / rate) <= 0.0001 &&
    Math.abs(Number(purchase.vatAmountUsd) - vat / rate) <= 0.0001 &&
    Math.abs(Number(purchase.vatWithheldUsd ?? 0) - vatWithheld / rate) <= 0.0001 &&
    Math.abs(Number(purchase.islrWithheldUsd ?? 0) - islrWithheld / rate) <= 0.0001 &&
    Math.abs(Number(purchase.igtfAmountUsd ?? 0) - igtf / rate) <= 0.0001 &&
    Number.isFinite(Number(entry.bcvRate)) && Math.abs(Number(entry.bcvRate) - rate) <= 0.000001;
}

const ROOT_ACCOUNT_TYPES = {
  '1': 'ACTIVO', '2': 'PASIVO', '3': 'PATRIMONIO',
  '4': 'INGRESOS', '5': 'COSTOS', '6': 'GASTOS'
};

function validateNewAccountCatalogEntries(previousAccounts, nextAccounts) {
  const priorCodes = new Set(asArray(previousAccounts).map(account => String(account.code)));
  const accounts = asArray(nextAccounts);
  const byCode = new Map();
  for (const account of accounts) {
    const code = String(account.code || '');
    if (!code) continue;
    if (byCode.has(code)) throw new Error('SQLite rechazó el catálogo: hay códigos de cuenta duplicados.');
    byCode.set(code, account);
  }

  for (const account of accounts) {
    const code = String(account.code || '').trim();
    if (priorCodes.has(code)) continue; // No reescribir la estructura histórica en esta migración.
    if (accounts.some(candidate => String(candidate.code || '').startsWith(code + '.'))) {
      throw new Error('SQLite rechazó insertar un nivel intermedio que cambiaría la jerarquía de cuentas históricas.');
    }
    const segments = code.split('.');
    if (segments.length < 1 || segments.length > 5 || segments.some(segment => !/^[0-9]+$/.test(segment)) ||
        Number(account.level) !== segments.length || !String(account.name || '').trim() ||
        typeof account.isMovement !== 'boolean') {
      throw new Error('SQLite rechazó una cuenta nueva con código, nivel o clasificación estructural inválida.');
    }
    const expectedType = ROOT_ACCOUNT_TYPES[segments[0]];
    if (!expectedType || account.type !== expectedType) {
      throw new Error('SQLite rechazó una cuenta nueva cuya clasificación no coincide con el código.');
    }
    if (segments.length === 1) {
      if (account.parentCode) throw new Error('SQLite rechazó una cuenta raíz con cuenta padre.');
      continue;
    }
    const parents = accounts
      .filter(candidate => code.startsWith(String(candidate.code || '') + '.') &&
        Number(candidate.level) < segments.length)
      .sort((a, b) => String(b.code).length - String(a.code).length);
    const parent = parents[0];
    if (!parent || account.parentCode !== parent.code || parent.isMovement ||
        Number(account.level) - Number(parent.level) > 2 || parent.type !== account.type ||
        !code.startsWith(parent.code + '.')) {
      throw new Error('SQLite rechazó la cuenta nueva: debe tener una cuenta padre agrupadora, compatible y correctamente enlazada.');
    }
  }
}

function validateNoNewTransactionsInClosedPeriods(previousState, nextState) {
  const priorCompanies = new Map(asArray(previousState.companies).map(company => [String(company.id), company]));
  const closedByCompany = new Map(asArray(nextState.companies)
    .filter(company => company.closedThroughDate)
    .map(company => [String(company.id), String(company.closedThroughDate)]));
  const collections = [
    ['journalEntries', 'date', 'asiento contable'],
    ['purchases', 'invoiceDate', 'factura de compra'],
    ['sales', 'invoiceDate', 'factura de venta'],
    ['movements', 'date', 'movimiento de inventario']
  ];
  for (const [collection, dateField, label] of collections) {
    const priorIds = new Set(asArray(previousState[collection]).map(item => String(item.id)));
    for (const item of asArray(nextState[collection])) {
      if (priorIds.has(String(item.id))) continue;
      const closedThrough = closedByCompany.get(String(item.companyId));
      const transactionDate = String(item[dateField] || '');
      if (closedThrough && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate) && transactionDate <= closedThrough) {
        const company = priorCompanies.get(String(item.companyId)) ||
          asArray(nextState.companies).find(candidate => String(candidate.id) === String(item.companyId));
        throw new Error('SQLite bloqueó el registro de ' + label + ' con fecha ' + transactionDate +
          ' en el período cerrado de ' + (company?.name || item.companyId) +
          ' (cerrado hasta ' + closedThrough + '). Registre la operación en un período abierto.');
      }
    }
  }
}


function validVatDeclarationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateVatDeclarationLedger(previousState, nextState) {
  const declarations = asArray(nextState.vatWithholdingDeclarations);
  const events = asArray(nextState.vatWithholdingDeclarationEvents);
  const companies = new Map(asArray(nextState.companies).map(item => [String(item.id), item]));
  const vouchers = new Map(asArray(nextState.vatVouchers).map(item => [String(item.id), item]));
  const declarationsById = new Map();
  const usedVoucherIds = new Set();
  const windowKeys = new Set();
  const globalLegacyAssignments = new Map();
  const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const bankMovementsById = new Map(asArray(nextState.bankStatementMovements).map(item => [String(item.id), item]));
  const bankAccountsById = new Map(asArray(nextState.bankAccounts).map(item => [String(item.id), item]));
  const usedFiscalMovementIds = new Set();

  for (const declaration of declarations) {
    const id = String(declaration.id || '');
    if (!id || declarationsById.has(id) || !companies.has(String(declaration.companyId))) {
      throw new Error('SQLite rechazó una declaración IVA con identificador duplicado o empresa inexistente.');
    }
    declarationsById.set(id, declaration);
    const period = String(declaration.period || '');
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(4, 6));
    if (!/^\d{6}$/.test(period) || !Number.isInteger(year) || year < 2000 ||
        !Number.isInteger(month) || month < 1 || month > 12 ||
        !['FIRST_HALF', 'SECOND_HALF'].includes(declaration.window)) {
      throw new Error('SQLite rechazó una declaración IVA con período o quincena inválidos.');
    }
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const expectedStart = period.slice(0, 4) + '-' + period.slice(4, 6) +
      (declaration.window === 'FIRST_HALF' ? '-01' : '-16');
    const expectedEnd = period.slice(0, 4) + '-' + period.slice(4, 6) + '-' +
      String(declaration.window === 'FIRST_HALF' ? 15 : lastDay).padStart(2, '0');
    if (declaration.startDate !== expectedStart || declaration.endDate !== expectedEnd ||
        !validVatDeclarationDate(String(declaration.createdAt || '').slice(0, 10))) {
      throw new Error('SQLite rechazó una declaración IVA cuya ventana no coincide con el período o tiene fecha inválida.');
    }
    const windowKey = String(declaration.companyId) + ':' + period + ':' + declaration.window;
    if (windowKeys.has(windowKey)) throw new Error('Ya existe una declaración para la misma empresa y quincena.');
    windowKeys.add(windowKey);
    const ids = asArray(declaration.voucherIds).map(String);
    const snapshots = asArray(declaration.voucherSnapshots);
    if (new Set(ids).size !== ids.length || ids.length !== snapshots.length ||
        ids.some((voucherId, index) => voucherId !== String(snapshots[index]?.voucherId))) {
      throw new Error('SQLite rechazó una declaración con comprobantes duplicados o snapshot inconsistente.');
    }
    if (Boolean(declaration.zeroOperations) !== (snapshots.length === 0)) {
      throw new Error('La declaración sin operaciones debe estar identificada explícitamente y no puede contener comprobantes.');
    }
    const assignments = asArray(declaration.legacyDateAssignments);
    const assignmentByVoucher = new Map();
    for (const assignment of assignments) {
      const voucherId = String(assignment.voucherId || '');
      const voucher = vouchers.get(voucherId);
      if (!voucher || String(voucher.companyId) !== String(declaration.companyId) ||
          voucher.fiscalDate || String(voucher.period || '') !== period ||
          !validVatDeclarationDate(assignment.confirmedFiscalDate) ||
          !String(assignment.confirmedFiscalDate).startsWith(period.slice(0, 4) + '-' + period.slice(4, 6)) ||
          String(assignment.note || '').trim().length < 10 ||
          assignmentByVoucher.has(voucherId)) {
        throw new Error('SQLite rechazó una asignación manual de fecha fiscal histórica sin soporte válido.');
      }
      const assignmentKey = String(declaration.companyId) + ':' + period + ':' + voucherId;
      const priorAssignment = globalLegacyAssignments.get(assignmentKey);
      if (priorAssignment && (priorAssignment.confirmedFiscalDate !== assignment.confirmedFiscalDate ||
          priorAssignment.note !== assignment.note)) {
        throw new Error('SQLite rechazó fechas fiscales legacy contradictorias entre declaraciones del mismo mes.');
      }
      globalLegacyAssignments.set(assignmentKey, assignment);
      assignmentByVoucher.set(voucherId, assignment);
    }
    const priorDeclarationIds = new Set(asArray(previousState.vatWithholdingDeclarations).map(item => String(item.id)));
    if (!priorDeclarationIds.has(id)) {
      const unresolvedLegacy = asArray(nextState.vatVouchers).filter(voucher =>
        String(voucher.companyId) === String(declaration.companyId) &&
        String(voucher.period || '') === period && !voucher.fiscalDate &&
        !assignmentByVoucher.has(String(voucher.id)));
      if (unresolvedLegacy.length > 0) {
        throw new Error('SQLite bloqueó la declaración: existen comprobantes históricos del mes sin fecha fiscal confirmada.');
      }
    }
    if (!priorDeclarationIds.has(id)) {
      const expectedVoucherIds = asArray(nextState.vatVouchers)
        .filter(voucher => String(voucher.companyId) === String(declaration.companyId))
        .filter(voucher => {
          const assigned = assignmentByVoucher.get(String(voucher.id));
          const fiscalDate = voucher.fiscalDate || assigned?.confirmedFiscalDate;
          return Boolean(fiscalDate) && fiscalDate >= declaration.startDate && fiscalDate <= declaration.endDate;
        })
        .map(voucher => String(voucher.id)).sort();
      const actualVoucherIds = ids.slice().sort();
      if (JSON.stringify(expectedVoucherIds) !== JSON.stringify(actualVoucherIds)) {
        throw new Error('SQLite rechazó la declaración: el snapshot no incluye exactamente todos los comprobantes de la empresa y quincena.');
      }
    }
    let base = 0, vat = 0, withheld = 0;
    for (const snapshot of snapshots) {
      const voucherId = String(snapshot.voucherId || '');
      const voucher = vouchers.get(voucherId);
      if (!voucher || String(voucher.companyId) !== String(declaration.companyId) ||
          usedVoucherIds.has(String(declaration.companyId) + ':' + voucherId) ||
          !validVatDeclarationDate(snapshot.fiscalDate) ||
          snapshot.fiscalDate < declaration.startDate || snapshot.fiscalDate > declaration.endDate ||
          !['FISCAL_EVENT', 'MANUALLY_VERIFIED_LEGACY_DATE', 'LEGACY_DOCUMENT_DATE'].includes(snapshot.dateBasis)) {
        throw new Error('SQLite rechazó un comprobante ausente, duplicado o fuera de la quincena en la declaración IVA.');
      }
      const assignment = assignmentByVoucher.get(voucherId);
      const expectedDateBasis = voucher.fiscalDate ? 'FISCAL_EVENT' : assignment ? 'MANUALLY_VERIFIED_LEGACY_DATE' : 'LEGACY_DOCUMENT_DATE';
      const expectedFiscalDate = voucher.fiscalDate || assignment?.confirmedFiscalDate || voucher.date;
      if (snapshot.dateBasis !== expectedDateBasis ||
          snapshot.fiscalDate !== String(expectedFiscalDate) ||
          (assignment && String(snapshot.dateVerificationNote || '') !== String(assignment.note)) ||
          String(snapshot.voucherNumber) !== String(voucher.voucherNumber) ||
          String(snapshot.supplierRif) !== String(voucher.supplierRif) ||
          String(snapshot.supplierName) !== String(voucher.supplierName) ||
          Math.abs(Number(snapshot.taxableBaseBs) - Number(voucher.taxableBaseBs)) > 0.01 ||
          Math.abs(Number(snapshot.vatAmountBs) - Number(voucher.vatAmountBs)) > 0.01 ||
          Math.abs(Number(snapshot.vatWithheldBs) - Number(voucher.vatWithheldBs)) > 0.01) {
        throw new Error('SQLite rechazó un snapshot fiscal que no coincide con el comprobante de origen.');
      }
      const amounts = [snapshot.taxableBaseBs, snapshot.vatAmountBs, snapshot.vatWithheldBs].map(Number);
      if (!amounts.every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('SQLite rechazó importes inválidos en el snapshot de la declaración IVA.');
      }
      usedVoucherIds.add(String(declaration.companyId) + ':' + voucherId);
      base += amounts[0]; vat += amounts[1]; withheld += amounts[2];
    }
    if (Math.abs(roundMoney(base) - Number(declaration.totalTaxableBaseBs)) > 0.01 ||
        Math.abs(roundMoney(vat) - Number(declaration.totalVatAmountBs)) > 0.01 ||
        Math.abs(roundMoney(withheld) - Number(declaration.totalWithheldBs)) > 0.01) {
      throw new Error('SQLite rechazó los totales de la declaración IVA porque no concilian con sus comprobantes.');
    }
  }

  const timeline = new Map();
  const declarationNumberKeys = new Set();
  const priorEventIds = new Set(asArray(previousState.vatWithholdingDeclarationEvents).map(item => String(item.id)));
  for (const event of events) {
    const isNewEvent = !priorEventIds.has(String(event.id));
    const declaration = declarationsById.get(String(event.declarationId));
    if (!declaration || !validVatDeclarationDate(String(event.occurredAt || '').slice(0, 10)) ||
        !validVatDeclarationDate(String(event.recordedAt || '').slice(0, 10))) {
      throw new Error('SQLite rechazó un evento de declaración IVA sin declaración vinculada o fecha válida.');
    }
    const history = timeline.get(declaration.id) || [];
    if (history.length > 0) {
      const priorEvent = history[history.length - 1];
      if (String(event.recordedAt) < String(priorEvent.recordedAt)) {
        throw new Error('SQLite rechazó un evento de declaración IVA registrado antes de un evento histórico.');
      }
    }
    const status = history.reduce((current, item) => {
      if (item.eventType === 'REVIEWED') return 'REVIEWED';
      if (item.eventType === 'FILED') return 'FILED';
      if (item.eventType === 'PAYMENT') return 'PAID';
      return current;
    }, 'PREPARED');
    if (event.eventType === 'DUE_DATE_SET') {
      if (!validVatDeclarationDate(String(event.dueDate || '')) ||
          !String(event.officialSourceTitle || '').trim() ||
          !String(event.officialReference || '').trim() ||
          !/^https:\/\/(?:www\.)?seniat\.gob\.ve\//i.test(String(event.officialSourceUrl || '')) && !/^https:\/\/iusdata\.com\//i.test(String(event.officialSourceUrl || '')) ||
          history.some(item => item.eventType === 'DUE_DATE_SET')) {
        throw new Error('SQLite rechazó un vencimiento sin fuente fiscal identificada y URL HTTPS verificable o duplicado.');
      }
    } else if (event.eventType === 'REVIEWED') {
      const hasCorrection = asArray(declaration.voucherIds).some(id => vouchers.get(String(id))?.requiresFiscalCorrection);
      const hasLegacy = asArray(declaration.voucherSnapshots).some(item => item.dateBasis === 'LEGACY_DOCUMENT_DATE');
      const declaredIds = new Set(asArray(declaration.voucherIds).map(String));
      const assignments = new Map(asArray(nextState.vatWithholdingDeclarations)
        .filter(item => String(item.companyId) === String(declaration.companyId) && String(item.period) === String(declaration.period))
        .flatMap(item => asArray(item.legacyDateAssignments))
        .map(item => [String(item.voucherId), item]));
      const unresolvedLegacy = asArray(nextState.vatVouchers).some(voucher =>
        String(voucher.companyId) === String(declaration.companyId) &&
        String(voucher.period || '') === String(declaration.period) &&
        !voucher.fiscalDate && !assignments.has(String(voucher.id)));
      const lateVouchers = asArray(nextState.vatVouchers).some(voucher => {
        if (String(voucher.companyId) !== String(declaration.companyId)) return false;
        const assignment = assignments.get(String(voucher.id));
        const fiscalDate = voucher.fiscalDate || assignment?.confirmedFiscalDate;
        return Boolean(fiscalDate) && fiscalDate >= declaration.startDate &&
          fiscalDate <= declaration.endDate && !declaredIds.has(String(voucher.id));
      });
      if (status !== 'PREPARED' || (isNewEvent && (hasCorrection || unresolvedLegacy || lateVouchers)) ||
          String(event.occurredAt) < String(declaration.createdAt).slice(0, 10) ||
          (hasLegacy && (!event.acknowledgedLegacyDates || String(event.note || '').trim().length < 10))) {
        throw new Error('SQLite bloqueó la revisión: existen correcciones pendientes, fechas históricas no verificadas o una transición inválida.');
      }
    } else if (event.eventType === 'FILED') {
      const reviewedEvent = history.find(item => item.eventType === 'REVIEWED');
      const declaredIds = new Set(asArray(declaration.voucherIds).map(String));
      const assignments = new Map(asArray(nextState.vatWithholdingDeclarations)
        .filter(item => String(item.companyId) === String(declaration.companyId) && String(item.period) === String(declaration.period))
        .flatMap(item => asArray(item.legacyDateAssignments))
        .map(item => [String(item.voucherId), item]));
      const unresolvedLegacy = asArray(nextState.vatVouchers).some(voucher =>
        String(voucher.companyId) === String(declaration.companyId) &&
        String(voucher.period || '') === String(declaration.period) &&
        !voucher.fiscalDate && !assignments.has(String(voucher.id)));
      const lateVouchers = asArray(nextState.vatVouchers).some(voucher => {
        if (String(voucher.companyId) !== String(declaration.companyId)) return false;
        const assignment = assignments.get(String(voucher.id));
        const fiscalDate = voucher.fiscalDate || assignment?.confirmedFiscalDate;
        return Boolean(fiscalDate) && fiscalDate >= declaration.startDate &&
          fiscalDate <= declaration.endDate && !declaredIds.has(String(voucher.id));
      });
      const numberKey = String(declaration.companyId) + ':' + String(event.declarationNumber || '').trim();
      const hasCorrection = asArray(declaration.voucherIds).some(id => vouchers.get(String(id))?.requiresFiscalCorrection);
      if (status !== 'REVIEWED' || (isNewEvent && (hasCorrection || unresolvedLegacy || lateVouchers)) ||
          !String(event.declarationNumber || '').trim() ||
          !String(event.receiptReference || '').trim() ||
          !reviewedEvent || String(event.occurredAt) < String(reviewedEvent.occurredAt) ||
          declarationNumberKeys.has(numberKey)) {
        throw new Error('SQLite bloqueó la presentación: requiere revisión previa, fecha válida, número único y acuse.');
      }
      declarationNumberKeys.add(numberKey);
    } else if (event.eventType === 'PAYMENT') {
      const paidEvents = history.filter(item => item.eventType === 'PAYMENT');
      const paid = paidEvents.reduce((sum, item) => sum + Number(item.amountBs || 0), 0);
      const filedEvent = history.find(item => item.eventType === 'FILED');
      const lastPayment = paidEvents[paidEvents.length - 1];
      const amount = Number(event.amountBs);
      if ((status !== 'FILED' && status !== 'PAID') || !filedEvent ||
          String(event.occurredAt) < String(filedEvent.occurredAt) ||
          (lastPayment && String(event.occurredAt) < String(lastPayment.occurredAt)) ||
          !Number.isFinite(amount) || amount <= 0 || Math.abs(amount - roundMoney(amount)) > 0.000001 ||
          roundMoney(paid + amount) > Number(declaration.totalWithheldBs) + 0.0001 ||
          !String(event.paymentReference || '').trim()) {
        throw new Error('SQLite bloqueó el enteramiento: requiere presentación previa, importe válido y referencia bancaria.');
      }
      const movementIds = event.bankStatementMovementIds;
      if (isNewEvent && (!Array.isArray(movementIds) || movementIds.length === 0)) {
        throw new Error('SQLite bloqueó el enteramiento nuevo: debe vincular al menos un débito bancario real.');
      }
      if (Array.isArray(movementIds) && movementIds.length > 0) {
        if (new Set(movementIds).size !== movementIds.length) {
          throw new Error('SQLite rechazó movimientos bancarios duplicados dentro del mismo enteramiento.');
        }
        let bankTotalCents = 0;
        for (const movementId of movementIds) {
          if (usedFiscalMovementIds.has(String(movementId))) {
            throw new Error('SQLite rechazó la reutilización de un movimiento bancario en más de un enteramiento.');
          }
          const movement = bankMovementsById.get(String(movementId));
          const account = movement ? bankAccountsById.get(String(movement.bankAccountId)) : null;
          if (!movement || movement.companyId !== declaration.companyId || movement.type !== 'DEBIT' ||
              !account || account.companyId !== declaration.companyId || account.currency !== 'BS' ||
              !Number.isFinite(Number(movement.amountBs)) || Number(movement.amountBs) <= 0 ||
              !validVatDeclarationDate(String(movement.date || '')) ||
              String(movement.date) < String(filedEvent.occurredAt).slice(0, 10) ||
              String(movement.date) > String(event.occurredAt).slice(0, 10)) {
            throw new Error('SQLite rechazó un soporte bancario inexistente, de otra empresa, no débito, en moneda incorrecta o fuera de fecha.');
          }
          bankTotalCents += Math.round(Number(movement.amountBs) * 100);
          usedFiscalMovementIds.add(String(movementId));
        }
        if (bankTotalCents !== Math.round(amount * 100)) {
          throw new Error('SQLite rechazó el enteramiento: la suma de débitos bancarios no coincide exactamente con el importe fiscal.');
        }
      }
      if (isNewEvent) {
        const journalEntryId = String(event.journalEntryId || '');
        const journal = asArray(nextState.journalEntries).find(item =>
          String(item.id) === journalEntryId && String(item.companyId) === String(declaration.companyId));
        const expectedReference = 'IVA-ENTERAMIENTO:' + declaration.id + ':' + String(event.paymentReference || '').trim();
        if (!journalEntryId || !journal || journal.type !== 'RETENCION_IVA' ||
            String(journal.date) !== String(event.occurredAt).slice(0, 10) ||
            String(journal.referenceDoc || '') !== expectedReference) {
          throw new Error('SQLite rechazó el enteramiento: falta el asiento contable IVA correspondiente o su referencia, empresa y fecha no coinciden.');
        }
        for (const movementId of movementIds) {
          const movement = bankMovementsById.get(String(movementId));
          if (!movement || movement.isReconciled !== true ||
              String(movement.reconciledWithJournalEntryId || '') !== journalEntryId ||
              !asArray(movement.reconciledJournalEntryIds).map(String).includes(journalEntryId)) {
            throw new Error('SQLite rechazó el enteramiento: cada débito bancario debe quedar conciliado con el mismo asiento de pago IVA.');
          }
        }
      }
    } else {
      throw new Error('SQLite rechazó un tipo de evento de declaración IVA no reconocido.');
    }
    history.push(event);
    timeline.set(declaration.id, history);
  }
}


function saleJournalMatchesInvoice(sale, entry, company) {
  if (!sale || !entry || entry.type !== 'VENTA' || entry.companyId !== sale.companyId ||
      entry.date !== sale.invoiceDate ||
      String(entry.referenceDoc || '').trim().toUpperCase().replace(/\s+/g, '') !==
        ('FAC-' + String(sale.invoiceNumber || '')).trim().toUpperCase().replace(/\s+/g, '') ||
      !Array.isArray(entry.items) || entry.items.length < 2) return false;

  const rate = Number(sale.bcvRate);
  const taxableBase = Number(sale.taxableBaseBs);
  const exempt = Number(sale.exemptAmountBs);
  const vat = Number(sale.vatAmountBs);
  const withheld = Number(sale.vatWithheldBs || 0);
  const igtf = Number(sale.igtfAmountBs || 0);
  const total = Number(sale.totalAmountBs);
  const taxRate = Number(sale.taxRate);
  const igtfApplicable = sale.igtfApplicable === true;
  if (igtf > 0 || igtfApplicable) {
    const eligibleIgtf = company?.isIgtfPerceptionAgent === true &&
      sale.paymentTerm === 'CONTADO' &&
      ['FOREIGN_CASH', 'CRYPTO'].includes(sale.paymentCurrency);
    const expectedIgtf = Math.round((taxableBase + exempt + vat) * 3) / 100;
    if (!eligibleIgtf || Number(sale.igtfRate || 0) !== 3 ||
        Math.abs(igtf - expectedIgtf) > 0.01) return false;
  }
  const values = [rate, taxableBase, exempt, vat, withheld, igtf, total, taxRate,
    Number(sale.totalAmountUsd), Number(sale.taxableBaseUsd), Number(sale.vatAmountUsd),
    Number(sale.vatWithheldUsd || 0), Number(sale.igtfAmountUsd || 0)];
  if (values.some(value => !Number.isFinite(value) || value < 0) || rate <= 0 ||
      taxRate > 100 || total <= 0 || withheld > vat + 0.01 ||
      Math.abs(vat - Math.round((taxableBase * taxRate / 100 + Number.EPSILON) * 100) / 100) > 0.01 ||
      Math.abs(total - (taxableBase + exempt + vat + igtf)) > 0.01 ||
      Math.abs(Number(sale.totalAmountUsd) - total / rate) > 0.0001 ||
      Math.abs(Number(sale.taxableBaseUsd) - taxableBase / rate) > 0.0001 ||
      Math.abs(Number(sale.vatAmountUsd) - vat / rate) > 0.0001 ||
      Math.abs(Number(sale.vatWithheldUsd || 0) - withheld / rate) > 0.0001 ||
      Math.abs(Number(sale.igtfAmountUsd || 0) - igtf / rate) > 0.0001 ||
      Math.abs(Number(entry.bcvRate) - rate) > 0.000001) return false;

  const expected = new Map([
    ['1.1.2.01', { debitBs: total - withheld, creditBs: 0, debitUsd: (total - withheld) / rate, creditUsd: 0 }],
    ['1.1.3.03', { debitBs: withheld, creditBs: 0, debitUsd: withheld / rate, creditUsd: 0 }],
    ['2.1.2.06', { debitBs: 0, creditBs: igtf, debitUsd: 0, creditUsd: igtf / rate }],
    ['4.1.1.01', { debitBs: 0, creditBs: taxableBase + exempt, debitUsd: 0, creditUsd: (taxableBase + exempt) / rate }],
    ['2.1.2.01', { debitBs: 0, creditBs: vat, debitUsd: 0, creditUsd: vat / rate }]
  ]);
  const actual = new Map();
  for (const item of entry.items) {
    const code = String(item.accountCode || '');
    if (!expected.has(code)) return false;
    const amounts = [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd].map(Number);
    if (amounts.some(value => !Number.isFinite(value) || value < 0) ||
        (amounts[0] > 0 && amounts[1] > 0) || (amounts[2] > 0 && amounts[3] > 0)) return false;
    const total = actual.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
    total.debitBs += amounts[0]; total.creditBs += amounts[1];
    total.debitUsd += amounts[2]; total.creditUsd += amounts[3];
    actual.set(code, total);
  }
  const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const micros = value => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  for (const [code, wanted] of expected) {
    const got = actual.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
    if (Math.abs(money(got.debitBs) - money(wanted.debitBs)) > 0.01 ||
        Math.abs(money(got.creditBs) - money(wanted.creditBs)) > 0.01 ||
        Math.abs(micros(got.debitUsd) - micros(wanted.debitUsd)) > 0.0001 ||
        Math.abs(micros(got.creditUsd) - micros(wanted.creditUsd)) > 0.0001) return false;
  }
  return true;
}

function validateSaleCorrectionNotes(previousState, nextState) {
  const priorSales = asArray(previousState?.sales);
  const nextSales = asArray(nextState?.sales);
  const priorIds = new Set(priorSales.map(item => String(item.id)));
  const normalize = value => String(value || '').trim().toUpperCase().replace(/\\s+/g, '');
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
  const close = (a, b, tolerance = 0.02) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= tolerance;

  for (const note of nextSales.filter(item => !priorIds.has(String(item.id)) && ['02', '03'].includes(item.documentType))) {
    const source = nextSales.find(item => item.id === note.originalSaleId && item.companyId === note.companyId && item.documentType === '01');
    const journal = asArray(nextState.journalEntries).find(item => item.id === note.journalEntryId && item.companyId === note.companyId);
    const isCredit = note.documentType === '03';
    const number = String(isCredit ? note.creditNoteNumber || note.invoiceNumber : note.debitNoteNumber || note.invoiceNumber).trim();
    const company = asArray(nextState.companies).find(item => item.id === note.companyId);
    const linkedInventory = asArray(nextState.movements).some(item => item.companyId === note.companyId &&
      (item.journalEntryId === source?.journalEntryId ||
       normalize(item.documentRef) === normalize('FAC-' + (source?.invoiceNumber || ''))));
    const base = Number(note.taxableBaseBs || 0);
    const exempt = Number(note.exemptAmountBs || 0);
    const vat = Number(note.vatAmountBs || 0);
    const total = Number(note.totalAmountBs || 0);
    const rate = Number(note.bcvRate || 0);
    const taxRate = Number(note.taxRate || 0);
    const expectedVat = round2(base * taxRate / 100);
    const expectedTotal = round2(base + exempt + vat);
    const expectedRef = (isCredit ? 'NC-CLI-' : 'ND-CLI-') + number;
    const duplicateNumber = nextSales.some(item => item.id !== note.id && item.companyId === note.companyId &&
      normalize(item.invoiceNumber) === normalize(note.invoiceNumber));
    const entries = asArray(journal?.items);
    const amountsByAccount = new Map();
    for (const line of entries) {
      const old = amountsByAccount.get(String(line.accountCode)) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
      old.debitBs += Number(line.debitBs || 0); old.creditBs += Number(line.creditBs || 0);
      old.debitUsd += Number(line.debitUsd || 0); old.creditUsd += Number(line.creditUsd || 0);
      amountsByAccount.set(String(line.accountCode), old);
    }
    const revenue = amountsByAccount.get('4.1.1.01') || {};
    const receivable = amountsByAccount.get('1.1.2.01') || {};
    const vatAccount = amountsByAccount.get('2.1.2.01') || {};
    const baseUsd = round6((base + exempt) / rate);
    const vatUsd = round6(vat / rate);
    const totalUsd = round6(total / rate);
    const expectedLineCount = vat > 0 ? 3 : 2;
    const journalMatches = Boolean(journal && entries.length === expectedLineCount &&
      entries.every(line => ['4.1.1.01', '1.1.2.01', ...(vat > 0 ? ['2.1.2.01'] : [])].includes(String(line.accountCode))) &&
      journal.type === 'AJUSTE' && journal.date === note.invoiceDate &&
      close(journal.bcvRate, rate, 0.000001) && normalize(journal.referenceDoc) === normalize(expectedRef) &&
      close(revenue.debitBs || 0, isCredit ? base + exempt : 0) &&
      close(revenue.creditBs || 0, isCredit ? 0 : base + exempt) &&
      close(revenue.debitUsd || 0, isCredit ? baseUsd : 0, 0.0001) &&
      close(revenue.creditUsd || 0, isCredit ? 0 : baseUsd, 0.0001) &&
      close(receivable.debitBs || 0, isCredit ? 0 : total) &&
      close(receivable.creditBs || 0, isCredit ? total : 0) &&
      close(receivable.debitUsd || 0, isCredit ? 0 : totalUsd, 0.0001) &&
      close(receivable.creditUsd || 0, isCredit ? totalUsd : 0, 0.0001) &&
      close(vatAccount.debitBs || 0, isCredit ? vat : 0) &&
      close(vatAccount.creditBs || 0, isCredit ? 0 : vat) &&
      close(vatAccount.debitUsd || 0, isCredit ? vatUsd : 0, 0.0001) &&
      close(vatAccount.creditUsd || 0, isCredit ? 0 : vatUsd, 0.0001) &&
      close(entries.reduce((sum, line) => sum + Number(line.debitBs || 0), 0),
        entries.reduce((sum, line) => sum + Number(line.creditBs || 0), 0)) &&
      close(entries.reduce((sum, line) => sum + Number(line.debitUsd || 0), 0),
        entries.reduce((sum, line) => sum + Number(line.creditUsd || 0), 0), 0.0001));
    if (!source || source.isCancelled || source.paymentTerm !== 'CREDITO' ||
        Number(source.vatWithheldBs || 0) > 0 || String(source.retentionVoucherNumber || '').trim() ||
        Number(source.igtfAmountBs || 0) > 0 || source.igtfApplicable === true ||
        note.paymentTerm !== 'CREDITO' || normalize(note.affectedInvoiceNumber) !== normalize(source.invoiceNumber) ||
        normalize(note.customerRif) !== normalize(source.customerRif) ||
        !String(note.customerName || '').trim() || !number || !String(note.controlNumber || '').trim() ||
        String(note.correctionReason || '').trim().length < 10 ||
        String(note.correctionWorkpaper || '').trim().length < 10 ||
        !isValidIsoDate(note.invoiceDate) || note.invoiceDate < source.invoiceDate ||
        (company?.closedThroughDate && note.invoiceDate <= company.closedThroughDate) ||
        linkedInventory || duplicateNumber || !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(base) || !Number.isFinite(exempt) || base < 0 || exempt < 0 || base + exempt <= 0 ||
        !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 ||
        !close(vat, expectedVat) || !close(total, expectedTotal) ||
        !close(note.totalAmountUsd, totalUsd, 0.0001) ||
        !close(note.taxableBaseUsd, round6(base / rate), 0.0001) ||
        !close(note.vatAmountUsd, vatUsd, 0.0001) ||
        !close(note.netReceivableAdjustmentBs, total) ||
        !close(note.netReceivableAdjustmentUsd, totalUsd, 0.0001) ||
        !journalMatches) {
      throw new Error('SQLite rechazó la NC/ND de venta: el documento, factura original, saldo fiscal, soporte o asiento correctivo no concilian.');
    }
  }

  for (const source of nextSales.filter(item => item.documentType === '01')) {
    const credits = nextSales.filter(item => item.originalSaleId === source.id && item.documentType === '03' && !item.isCancelled);
    const creditBase = round2(credits.reduce((sum, item) => sum + Number(item.taxableBaseBs || 0), 0));
    const creditExempt = round2(credits.reduce((sum, item) => sum + Number(item.exemptAmountBs || 0), 0));
    if (creditBase > Number(source.taxableBaseBs || 0) + 0.01 ||
        creditExempt > Number(source.exemptAmountBs || 0) + 0.01) {
      throw new Error('SQLite bloqueó notas de crédito de venta que exceden la base original disponible.');
    }
    const originalUsd = Number(source.totalAmountUsd || 0);
    const paidUsd = asArray(nextState.creditSettlements).filter(item =>
      item.companyId === source.companyId && item.documentId === source.id &&
      item.kind === 'SALE_COLLECTION' && !item.isReversed).reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const debitedUsd = nextSales.filter(item => item.originalSaleId === source.id && item.documentType === '02' && !item.isCancelled)
      .reduce((sum, item) => sum + Number(item.netReceivableAdjustmentUsd || 0), 0);
    const creditedUsd = credits.reduce((sum, item) => sum + Number(item.netReceivableAdjustmentUsd || 0), 0);
    if (creditedUsd > Math.max(0, originalUsd - paidUsd + debitedUsd) + 0.01) {
      throw new Error('SQLite bloqueó una NC de venta que supera el saldo por cobrar no liquidado.');
    }
  }
}

function validateAccountingSnapshot(previousState, nextState) {
  if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
    throw new Error('Estado contable inválido.');
  }
  const priorState = previousState && typeof previousState === 'object' ? previousState : {};
  validateNoNewTransactionsInClosedPeriods(priorState, nextState);
  if (asArray(priorState.accounts).length > 0) {
    validateNewAccountCatalogEntries(priorState.accounts, nextState.accounts);
  }
  assertAppendOnlyCollection(priorState, nextState, 'purchases',
    ['journalEntryId', 'isCancelled', 'cancelledByJournalEntryId', 'cancellationReason', 'cancellationNote'], ['journalEntryId', 'isCancelled']);
  for (const previousPurchase of asArray(priorState.purchases).filter(item => item.documentType === '02' && !item.isCancelled)) {
    const currentPurchase = asArray(nextState.purchases).find(item => item.id === previousPurchase.id);
    if (!currentPurchase || !currentPurchase.isCancelled) continue;
    const source = previousPurchase.journalEntryId
      ? asArray(priorState.journalEntries).find(entry => String(entry.id) === String(previousPurchase.journalEntryId))
      : undefined;
    const reversal = currentPurchase.cancelledByJournalEntryId
      ? asArray(nextState.journalEntries).find(entry => String(entry.id) === String(currentPurchase.cancelledByJournalEntryId))
      : undefined;
    const company = asArray(nextState.companies).find(item => item.id === previousPurchase.companyId);
    const debitNoteNumber = String(previousPurchase.debitNoteNumber || previousPurchase.invoiceNumber || '').trim();
    const normalizeNdReference = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    const activePayments = asArray(nextState.creditSettlements).filter(item =>
      item.companyId === previousPurchase.companyId && item.documentId === previousPurchase.id &&
      item.kind === 'PURCHASE_PAYMENT' && !item.isReversed);
    const activeAdvanceApplications = asArray(nextState.supplierAdvanceSettlements).filter(item =>
      item.companyId === previousPurchase.companyId && item.targetPurchaseId === previousPurchase.id &&
      item.kind === 'APPLIED_TO_PURCHASE' && !item.isReversed);
    const linkedMovements = asArray(nextState.movements).filter(item =>
      item.companyId === previousPurchase.companyId &&
      (item.journalEntryId === previousPurchase.journalEntryId ||
        String(item.documentRef || '') === 'ND-PROV-' + debitNoteNumber));
    const nextSource = source ? asArray(nextState.journalEntries).find(entry => String(entry.id) === String(source.id)) : undefined;
    const sourceItems = asArray(source?.items);
    const reversalItems = asArray(reversal?.items);
    const exactReversal = sourceItems.length > 0 && sourceItems.length === reversalItems.length &&
      sourceItems.every(item => reversalItems.some(reverse =>
        reverse.accountCode === item.accountCode &&
        Math.abs(Number(reverse.debitBs || 0) - Number(item.creditBs || 0)) <= 0.000001 &&
        Math.abs(Number(reverse.creditBs || 0) - Number(item.debitBs || 0)) <= 0.000001 &&
        Math.abs(Number(reverse.debitUsd || 0) - Number(item.creditUsd || 0)) <= 0.000001 &&
        Math.abs(Number(reverse.creditUsd || 0) - Number(item.debitUsd || 0)) <= 0.000001));
    const priorPeriodAdjustmentValid = Boolean(reversal?.priorPeriodAdjustment === true &&
      company?.closedThroughDate && source?.date <= company.closedThroughDate &&
      reversal?.date > company.closedThroughDate);
    if (!source || source.companyId !== previousPurchase.companyId || source.type !== 'AJUSTE' ||
        normalizeNdReference(source.referenceDoc) !== normalizeNdReference('ND-PROV-' + debitNoteNumber) ||
        !reversal || reversal.companyId !== previousPurchase.companyId || reversal.type !== 'AJUSTE' ||
        reversal.reversalOfEntryId !== source.id || nextSource?.reversedByEntryId !== reversal.id ||
        !isValidIsoDate(reversal.date) || reversal.date < source.date ||
        (!priorPeriodAdjustmentValid && (reversal.priorPeriodAdjustment === true || !exactReversal)) ||
        String(currentPurchase.cancelledByJournalEntryId || '') !== String(reversal.id) ||
        String(currentPurchase.cancellationReason || '').trim().length < 10 ||
        String(currentPurchase.cancellationNote || '').trim().length < 10 ||
        activePayments.length > 0 || activeAdvanceApplications.length > 0 || linkedMovements.length > 0) {
      throw new Error('SQLite rechazó la anulación de ND tipo 02: requiere contra-asiento enlazado, reversión exacta, motivo y papel de trabajo; no admite pagos, anticipos ni inventario vigentes.');
    }
  }
  assertAppendOnlyCollection(priorState, nextState, 'sales',
    ['journalEntryId', 'isCancelled', 'cancelledByJournalEntryId', 'cancellationReason', 'cancellationNote'], ['isCancelled']);
  validateSaleCorrectionNotes(priorState, nextState);
  assertAppendOnlyCollection(priorState, nextState, 'movements');
  assertAppendOnlyCollection(priorState, nextState, 'creditSettlements',
    ['isReversed', 'reversedByJournalEntryId'], ['isReversed']);
  assertAppendOnlyCollection(priorState, nextState, 'supplierAdvanceSettlements',
    ['isReversed', 'reversedByJournalEntryId'], ['isReversed']);
  assertAppendOnlyCollection(priorState, nextState, 'supplierDirectAdvances',
    ['isReversed', 'reversedByJournalEntryId'], ['reversedByJournalEntryId']);
  assertAppendOnlyCollection(priorState, nextState, 'bankStatementMovements',
    ['isReconciled', 'reconciledWithJournalEntryId', 'reconciledJournalEntryIds', 'matchedBy', 'reconciledAt']);
  assertAppendOnlyCollection(priorState, nextState, 'vatWithholdingDeclarations');
  assertAppendOnlyCollection(priorState, nextState, 'vatWithholdingDeclarationEvents');
  validateVatDeclarationLedger(priorState, nextState);
  assertAppendOnlyCollection(priorState, nextState, 'vatVouchers',
    ['requiresFiscalCorrection', 'correctionEntryId', 'correctionEntryIds', 'correctionNote',
      'deliveryDate', 'deliveryMethod', 'electronicDeliveryAgreed'],
    ['requiresFiscalCorrection', 'deliveryDate', 'deliveryMethod', 'electronicDeliveryAgreed']);
  for (const voucher of asArray(nextState.vatVouchers)) {
    const hasDelivery = Boolean(voucher.deliveryDate || voucher.deliveryMethod || voucher.electronicDeliveryAgreed);
    if (hasDelivery && (!isValidIsoDate(voucher.deliveryDate) ||
        !isValidIsoDate(voucher.date) || voucher.deliveryDate < voucher.date ||
        !['PHYSICAL', 'ELECTRONIC'].includes(voucher.deliveryMethod) ||
        (voucher.deliveryMethod === 'ELECTRONIC' && voucher.electronicDeliveryAgreed !== true) ||
        (voucher.deliveryMethod === 'PHYSICAL' && voucher.electronicDeliveryAgreed === true))) {
      throw new Error('SQLite rechazó la entrega del comprobante IVA: fecha, medio o acuerdo electrónico inválido.');
    }
  }
  assertAppendOnlyCollection(priorState, nextState, 'islrVouchers',
    ['requiresFiscalCorrection', 'correctionEntryId', 'correctionEntryIds', 'correctionNote'], ['requiresFiscalCorrection']);
  // Los eventos fiscales ISLR son un libro auxiliar inmutable; las correcciones se registran como reversión.
  assertAppendOnlyCollection(priorState, nextState, 'islrFiscalEvents');
  validateIslrFiscalEventLedger(priorState, nextState);
  const nextBankRows = new Map(asArray(nextState.bankStatementMovements).map(item => [String(item.id), item]));
  for (const oldRow of asArray(priorState.bankStatementMovements)) {
    const nextRow = nextBankRows.get(String(oldRow.id));
    if (!nextRow) continue; // La validación append-only anterior ya rechazó su eliminación.
    const oldLinks = Array.isArray(oldRow.reconciledJournalEntryIds) ? oldRow.reconciledJournalEntryIds : [];
    const nextLinks = Array.isArray(nextRow.reconciledJournalEntryIds) ? nextRow.reconciledJournalEntryIds : [];
    if (new Set(nextLinks).size !== nextLinks.length || oldLinks.some(id => !nextLinks.includes(id))) {
      throw new Error('SQLite bloqueó la eliminación o alteración del historial de conciliación bancaria del movimiento ' + oldRow.id + '.');
    }
  }

  const oldCompanies = new Map(asArray(priorState.companies).map(company => [String(company.id), company]));
  const nextCompanies = new Map(asArray(nextState.companies).map(company => [String(company.id), company]));
  for (const oldCompany of oldCompanies.values()) {
    if (!oldCompany.closedThroughDate) continue;
    const nextCompany = nextCompanies.get(String(oldCompany.id));
    if (!nextCompany || !nextCompany.closedThroughDate ||
        String(nextCompany.closedThroughDate) < String(oldCompany.closedThroughDate)) {
      throw new Error('SQLite bloqueó la reapertura o eliminación del cierre contable de la empresa ' + oldCompany.name + '. Se requiere un procedimiento formal de reapertura.');
    }
  }

  const priorEntries = asArray(priorState.journalEntries);
  const nextEntries = asArray(nextState.journalEntries);
  const priorById = new Map(priorEntries.map(entry => [String(entry.id), entry]));
  const nextById = new Map(nextEntries.map(entry => [String(entry.id), entry]));
  if (nextById.size !== nextEntries.length) {
    throw new Error('Hay identificadores de asientos duplicados; SQLite rechazó el guardado.');
  }
  const immutableEntry = entry => {
    const { reversedByEntryId, isAdjusted, ...immutable } = entry;
    return immutable;
  };
  for (const prior of priorEntries) {
    const next = nextById.get(String(prior.id));
    if (!next) {
      throw new Error('SQLite bloqueó la eliminación del asiento histórico #' + prior.entryNumber + '. El Libro Diario es inmutable.');
    }
    if (JSON.stringify(immutableEntry(prior)) !== JSON.stringify(immutableEntry(next))) {
      throw new Error('SQLite bloqueó la modificación del contenido histórico del asiento #' + prior.entryNumber + '. Registre un contra-asiento.');
    }
    if (prior.reversedByEntryId && prior.reversedByEntryId !== next.reversedByEntryId) {
      throw new Error('No se puede cambiar ni retirar el enlace de reversión del asiento #' + prior.entryNumber + '.');
    }
    if (next.reversedByEntryId && !prior.reversedByEntryId) {
      const reversal = nextById.get(String(next.reversedByEntryId));
      if (!reversal || reversal.reversalOfEntryId !== prior.id) {
        throw new Error('El enlace de reversión del asiento #' + prior.entryNumber + ' no tiene un contra-asiento válido.');
      }
    }
    if (prior.isAdjusted && !next.isAdjusted) {
      throw new Error('No se puede retirar la marca de ajuste del asiento #' + prior.entryNumber + '.');
    }
    if (!prior.isAdjusted && next.isAdjusted && !next.reversedByEntryId) {
      throw new Error('Un asiento no puede marcarse como ajustado sin un contra-asiento enlazado.');
    }
  }

  const priorNumberKeys = new Set(priorEntries.map(entry => String(entry.companyId) + ':' + String(entry.entryNumber)));
  const maxPriorNumberByCompany = new Map();
  for (const prior of priorEntries) {
    const key = String(prior.companyId);
    maxPriorNumberByCompany.set(key, Math.max(maxPriorNumberByCompany.get(key) || 0, Number(prior.entryNumber) || 0));
  }
  const seenNewNumbers = new Set();
  for (const entry of nextEntries) {
    const numberKey = String(entry.companyId) + ':' + String(entry.entryNumber);
    if (priorById.has(String(entry.id))) continue;
    if (!Number.isInteger(Number(entry.entryNumber)) || Number(entry.entryNumber) <= (maxPriorNumberByCompany.get(String(entry.companyId)) || 0)) {
      throw new Error('SQLite bloqueó un correlativo de asiento no creciente en la empresa ' + entry.companyId + '.');
    }
    if (priorNumberKeys.has(numberKey) || seenNewNumbers.has(numberKey)) {
      throw new Error('SQLite bloqueó un número de asiento duplicado en la empresa ' + entry.companyId + '.');
    }
    seenNewNumbers.add(numberKey);
    if (!Array.isArray(entry.items) || entry.items.length < 2) {
      throw new Error('Un nuevo asiento no contiene líneas contables suficientes.');
    }
    const totals = entry.items.reduce((sum, item) => {
      const values = [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd].map(Number);
      if (values.some(value => !Number.isFinite(value) || value < 0) ||
          (Number(item.debitBs) > 0 && Number(item.creditBs) > 0) ||
          (Number(item.debitUsd) > 0 && Number(item.creditUsd) > 0)) {
        throw new Error('SQLite rechazó un asiento con importes o lados contables inválidos.');
      }
      sum.debitBs += Number(item.debitBs); sum.creditBs += Number(item.creditBs);
      sum.debitUsd += Number(item.debitUsd); sum.creditUsd += Number(item.creditUsd);
      return sum;
    }, { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    if (Math.abs(totals.debitBs - totals.creditBs) >= 0.01 ||
        Math.abs(totals.debitUsd - totals.creditUsd) >= 0.01 ||
        totals.debitBs <= 0 || totals.debitUsd <= 0) {
      throw new Error('SQLite rechazó el asiento #' + entry.entryNumber + ': no cuadra simultáneamente en Bs. y USD.');
    }
    if (entry.reversalOfEntryId) {
      const source = nextById.get(String(entry.reversalOfEntryId));
      const otherReversal = nextEntries.find(candidate => candidate.id !== entry.id &&
        candidate.companyId === entry.companyId && candidate.reversalOfEntryId === entry.reversalOfEntryId);
      if (otherReversal) {
        throw new Error('SQLite bloqueó una segunda reversión del mismo asiento original.');
      }
      if (!source || source.companyId !== entry.companyId || source.reversalOfEntryId ||
          source.reversedByEntryId !== entry.id || !source.isAdjusted ||
          String(entry.reversalReason || '').trim().length < 10 ||
          String(entry.workpaperNote || '').trim().length < 10 ||
          String(entry.date || '') < String(source.date || '')) {
        throw new Error('SQLite rechazó un contra-asiento sin origen, enlace recíproco, justificación, papel de trabajo o fecha válida.');
      }
      if (entry.type !== 'AJUSTE' ||
          String(entry.referenceDoc || '') !== 'REV-' + source.entryNumber ||
          Math.abs(Number(entry.bcvRate) - Number(source.bcvRate)) > 0.000001 ||
          !Array.isArray(source.items) || source.items.length !== entry.items.length) {
        throw new Error('SQLite rechazó el contra-asiento: tipo, referencia, tasa BCV o cantidad de líneas no coincide con el asiento original.');
      }
      const accountByCode = new Map(asArray(nextState.accounts).map(account => [String(account.code), account]));
      let retainedTargetCode = '';
      for (let index = 0; index < source.items.length; index++) {
        const originalLine = source.items[index];
        const reversalLine = entry.items[index];
        const originalAccount = accountByCode.get(String(originalLine.accountCode));
        const remapToEquity = Boolean(entry.priorPeriodAdjustment && originalAccount &&
          ['INGRESOS', 'COSTOS', 'GASTOS'].includes(originalAccount.type));
        if (remapToEquity) {
          const targetAccount = accountByCode.get(String(reversalLine.accountCode));
          if (!targetAccount || targetAccount.type !== 'PATRIMONIO' || !targetAccount.isMovement ||
              (retainedTargetCode && retainedTargetCode !== targetAccount.code)) {
            throw new Error('SQLite rechazó el AIA: los resultados del período deben reclasificarse a una única cuenta de patrimonio de movimiento.');
          }
          retainedTargetCode = targetAccount.code;
        } else if (reversalLine.accountCode !== originalLine.accountCode) {
          throw new Error('SQLite rechazó el contra-asiento: no conserva la cuenta de la línea original.');
        }
        const pairs = [
          [reversalLine.debitBs, originalLine.creditBs, 0.01],
          [reversalLine.creditBs, originalLine.debitBs, 0.01],
          [reversalLine.debitUsd, originalLine.creditUsd, 0.0001],
          [reversalLine.creditUsd, originalLine.debitUsd, 0.0001]
        ];
        if (pairs.some(([actual, expected, tolerance]) =>
          !Number.isFinite(Number(actual)) || !Number.isFinite(Number(expected)) ||
          Math.abs(Number(actual) - Number(expected)) > tolerance)) {
          throw new Error('SQLite rechazó el contra-asiento: la línea ' + (index + 1) +
            ' no invierte exactamente Debe/Haber en Bs. y USD.');
        }
      }
    }
  }

  const normalizeDocument = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const normalizeRif = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const priorPurchaseIdsForIntegrity = new Set(asArray(priorState.purchases).map(item => String(item.id)));
  for (const purchase of asArray(nextState.purchases)) {
    if (priorPurchaseIdsForIntegrity.has(String(purchase.id)) || purchase.documentType !== '01') continue;
    const duplicate = asArray(nextState.purchases).some(other =>
      String(other.id) !== String(purchase.id) &&
      other.companyId === purchase.companyId &&
      other.documentType === '01' &&
      normalizeDocument(other.invoiceNumber) === normalizeDocument(purchase.invoiceNumber) &&
      normalizeRif(other.supplierRif) === normalizeRif(purchase.supplierRif)
    );
    if (duplicate) {
      throw new Error('SQLite rechazó una factura de compra duplicada para el mismo proveedor, empresa y número de documento.');
    }
  }

  const newSupplierDebitNotes = asArray(nextState.purchases).filter(purchase =>
    !priorPurchaseIdsForIntegrity.has(String(purchase.id)) && purchase.documentType === '02');
  for (const note of newSupplierDebitNotes) {
    const original = asArray(nextState.purchases).find(item =>
      item.id === note.originalPurchaseId && item.companyId === note.companyId && item.documentType === '01');
    const company = asArray(nextState.companies).find(item => item.id === note.companyId);
    const sourceEntry = original?.journalEntryId ? nextById.get(String(original.journalEntryId)) : undefined;
    const journal = note.journalEntryId ? nextById.get(String(note.journalEntryId)) : undefined;
    const duplicate = asArray(nextState.purchases).some(item =>
      item.id !== note.id && item.companyId === note.companyId && item.documentType === '02' &&
      normalizeRif(item.supplierRif) === normalizeRif(note.supplierRif) &&
      normalizeDocument(item.debitNoteNumber || item.invoiceNumber) === normalizeDocument(note.debitNoteNumber || note.invoiceNumber));
    const debitNoteNumber = String(note.debitNoteNumber || note.invoiceNumber || '').trim();
    const notes = String(note.notes || '');
    const review = note.supplierDebitNoteReview;
    const allowedDebitNoteCauses = ['PRICE_DIFFERENCE', 'ADDITIONAL_EXPENSE', 'FINANCING_CHARGE',
      'ADDITIONAL_GOODS_RECEIVED', 'INVENTORY_COST_ADJUSTMENT', 'OTHER'];
    const baseBs = Number(note.taxableBaseBs || 0);
    const exemptBs = Number(note.exemptAmountBs || 0);
    const vatBs = Number(note.vatAmountBs || 0);
    const totalBs = Number(note.totalAmountBs || 0);
    const rate = Number(note.bcvRate || 0);
    const totalUsd = Number(note.totalAmountUsd || 0);
    const baseUsd = Number(note.taxableBaseUsd || 0);
    const vatUsd = Number(note.vatAmountUsd || 0);
    const taxRate = Number(note.taxRate || 0);
    const debitLines = asArray(journal?.items).filter(line => Number(line.debitBs || 0) > 0);
    const payableLines = asArray(journal?.items).filter(line =>
      String(line.accountCode || '').startsWith('2.1.1.') && Number(line.creditBs || 0) > 0);
    const debitTotalBs = asArray(journal?.items).reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const creditTotalBs = asArray(journal?.items).reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const debitTotalUsd = asArray(journal?.items).reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
    const creditTotalUsd = asArray(journal?.items).reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
    const accountByCode = new Map(asArray(nextState.accounts).map(account => [String(account.code), account]));
    const debitAccountsValid = debitLines.every(line => {
      const account = accountByCode.get(String(line.accountCode));
      return Boolean(account && account.isMovement && ['ACTIVO', 'COSTOS', 'GASTOS'].includes(account.type));
    });
    const reviewValid = Boolean(review &&
      allowedDebitNoteCauses.includes(review.economicCause) &&
      !['ADDITIONAL_GOODS_RECEIVED', 'INVENTORY_COST_ADJUSTMENT'].includes(review.economicCause) &&
      String(review.reason || '').trim().length >= 10 &&
      (review.economicCause !== 'OTHER' || String(review.classificationNote || '').trim().length >= 10) &&
      String(review.debitAccountCode || '').trim() &&
      String(review.payableAccountCode || '').trim() &&
      payableLines[0]?.accountCode === review.payableAccountCode &&
      debitLines.some(line => line.accountCode === review.debitAccountCode) &&
      (vatBs <= 0 || (review.vatBreakdownReviewed === true && Boolean(review.vatAccountCode) &&
        asArray(journal?.items).some(line => line.accountCode === review.vatAccountCode && Number(line.debitBs || 0) > 0))) &&
      review.withholdingNotApplicableConfirmed === true &&
      review.igtfNotApplicableConfirmed === true &&
      String(review.fiscalReviewNote || '').trim().length >= 10);
    const noteMovements = asArray(nextState.movements).filter(movement =>
      movement.companyId === note.companyId &&
      String(movement.documentRef || '') === 'ND-PROV-' + debitNoteNumber);
    if (!company || !original || original.isCancelled || !isValidIsoDate(original.invoiceDate) || !sourceEntry || sourceEntry.companyId !== note.companyId ||
        sourceEntry.type !== 'COMPRA' ||
        normalizeDocument(sourceEntry.referenceDoc) !== normalizeDocument('FAC-' + original.invoiceNumber) ||
        sourceEntry.date !== String(original.accountCreditDate || original.invoiceDate) ||
        Math.abs(Number(sourceEntry.bcvRate) - Number(original.bcvRate)) > 0.000001 ||
        !journal || journal.companyId !== note.companyId || journal.type !== 'AJUSTE' ||
        journal.date !== String(note.accountCreditDate || note.invoiceDate) ||
        Math.abs(Number(journal.bcvRate) - rate) > 0.000001 ||
        normalizeDocument(journal.referenceDoc) !== normalizeDocument('ND-PROV-' + debitNoteNumber) ||
        !debitNoteNumber || note.isCancelled === true ||
        normalizeDocument(note.invoiceNumber) !== normalizeDocument(debitNoteNumber) ||
        !String(note.controlNumber || '').trim() ||
        normalizeDocument(note.affectedInvoiceNumber) !== normalizeDocument(original.invoiceNumber) ||
        normalizeRif(note.supplierRif) !== normalizeRif(original.supplierRif) ||
        !isValidIsoDate(note.invoiceDate) || !isValidIsoDate(note.accountCreditDate || note.invoiceDate) ||
        note.invoiceDate < original.invoiceDate || note.accountCreditDate < note.invoiceDate ||
        (company?.closedThroughDate && note.accountCreditDate <= company.closedThroughDate) ||
        duplicate || note.paymentTerm !== 'CREDITO' ||
        !Number.isFinite(rate) || rate <= 0 ||
        ![baseBs, exemptBs, vatBs, totalBs, totalUsd, baseUsd, vatUsd, taxRate,
          Number(note.vatWithheldBs || 0), Number(note.islrWithheldBs || 0), Number(note.igtfAmountBs || 0),
          Number(note.vatWithheldUsd || 0), Number(note.islrWithheldUsd || 0), Number(note.igtfAmountUsd || 0)].every(Number.isFinite) ||
        baseBs < 0 || exemptBs < 0 || vatBs < 0 || totalBs <= 0 || totalUsd <= 0 ||
        Math.abs(totalBs - (baseBs + exemptBs + vatBs)) > 0.02 ||
        Math.abs(totalUsd - totalBs / rate) > 0.0001 ||
        Math.abs(baseUsd - baseBs / rate) > 0.0001 ||
        Math.abs(vatUsd - vatBs / rate) > 0.0001 ||
        Math.abs(taxRate - (baseBs > 0 ? vatBs / baseBs * 100 : 0)) > 0.05 ||
        Number(note.retentionRate || 0) > 0.0001 ||
        Math.abs(Number(note.vatWithheldBs || 0)) > 0.01 ||
        Math.abs(Number(note.islrWithheldBs || 0)) > 0.01 ||
        Math.abs(Number(note.igtfAmountBs || 0)) > 0.01 ||
        Number(note.vatWithheldUsd || 0) > 0.0001 ||
        Number(note.islrWithheldUsd || 0) > 0.0001 ||
        Number(note.igtfAmountUsd || 0) > 0.0001 || note.igtfApplicable === true ||
        note.inventoryLines?.length || note.creditNoteLines?.length ||
        noteMovements.length > 0 || debitLines.length === 0 || payableLines.length !== 1 ||
        !debitAccountsValid || !reviewValid ||
        Math.abs(debitTotalBs - creditTotalBs) > 0.02 ||
        Math.abs(debitTotalUsd - creditTotalUsd) > 0.0001 ||
        Math.abs(Number(payableLines[0]?.creditBs || 0) - totalBs) > 0.02 ||
        Math.abs(Number(payableLines[0]?.creditUsd || 0) - totalUsd) > 0.0001 ||
        notes.trim().length < 10 || !notes.includes('Revisión fiscal manual:')) {
      throw new Error('SQLite rechazó la ND tipo 02: factura original, proveedor, fechas, importes, cuenta CxP, asiento, revisión fiscal o ausencia de efectos no autorizados no concilian.');
    }
  }

  for (const collectionName of ['purchases', 'sales']) {
    const expectedEntryType = collectionName === 'sales' ? 'VENTA' : 'COMPRA';
    const oldDocuments = asArray(priorState[collectionName]);
    const newDocuments = asArray(nextState[collectionName]);
    const oldById = new Map(oldDocuments.map(document => [String(document.id), document]));
    for (const document of newDocuments) {
      const oldDocument = oldById.get(String(document.id));
      if (document.documentType && document.documentType !== '01') continue;
      if (!document.journalEntryId) {
        if (collectionName === 'sales' && !oldDocument) {
          throw new Error('SQLite rechazó la venta nueva: falta su asiento contable enlazado.');
        }
        continue;
      }
      // Existing invoice-to-entry links are grandfathered for read/upgrade compatibility.
      // A new document or any changed link/company/type must still pass strict validation.
      const unchangedHistoricalLink = oldDocument &&
        String(oldDocument.journalEntryId || '') === String(document.journalEntryId || '') &&
        String(oldDocument.companyId || '') === String(document.companyId || '') &&
        String(oldDocument.documentType || '01') === String(document.documentType || '01');
      if (unchangedHistoricalLink) continue;
      const linkedEntry = nextById.get(String(document.journalEntryId));
      if (!linkedEntry || linkedEntry.companyId !== document.companyId ||
          linkedEntry.type !== expectedEntryType) {
        throw new Error('SQLite rechazó un vínculo de factura con un asiento de otra empresa, tipo o documento.');
      }
      if (collectionName === 'sales' && !oldDocument && !saleJournalMatchesInvoice(document, linkedEntry,
            asArray(nextState.companies).find(company => String(company.id) === String(document.companyId)))) {
        throw new Error('SQLite rechazó la venta: el asiento no concilia fecha, tasa BCV, CxC, retención recibida, IGTF, ingresos e IVA en Bs. y USD con la factura.');
      }
    }
    for (const document of newDocuments) {
      const oldDocument = oldById.get(String(document.id));
      if (!document.isCancelled || (oldDocument && oldDocument.isCancelled)) continue;
      if (!oldDocument) throw new Error('SQLite bloqueó la creación directa de un documento ya marcado como reversado.');
      const originalEntry = oldDocument.journalEntryId
        ? priorById.get(String(oldDocument.journalEntryId))
        : priorEntries.find(entry => entry.companyId === document.companyId &&
            entry.type === expectedEntryType && entry.referenceDoc === 'FAC-' + document.invoiceNumber);
      const reversal = document.cancelledByJournalEntryId
        ? nextById.get(String(document.cancelledByJournalEntryId))
        : undefined;
      if (!originalEntry || !reversal || reversal.companyId !== document.companyId ||
          reversal.reversalOfEntryId !== originalEntry.id ||
          (document.journalEntryId && document.journalEntryId !== originalEntry.id) ||
          String(document.cancellationReason || '').trim().length < 10 ||
          String(document.cancellationNote || '').trim().length < 10) {
        throw new Error('SQLite rechazó la cancelación del documento fiscal: falta el contra-asiento enlazado, el motivo o el papel de trabajo.');
      }
    }
  }

  // Una factura nueva que declara líneas de inventario debe ingresar exactamente
  // esas cantidades y costos al Kardex dentro del mismo snapshot SQLite.
  // El guardado completo ocurre dentro de una única transacción SQLite; no basta
  // con que el formulario haya intentado agregar los movimientos.
  // No permitir que una importación de respaldo o una escritura directa del
  // snapshot salte las guardias del formulario/contexto para notas de crédito.
  const priorMovementIdsForIntegrity = new Set(asArray(priorState.movements).map(item => String(item.id)));
  for (const purchase of asArray(nextState.purchases)) {
    if (priorPurchaseIdsForIntegrity.has(String(purchase.id)) ||
        !Array.isArray(purchase.inventoryLines) || purchase.inventoryLines.length === 0) continue;
    const lines = purchase.inventoryLines;
    const productIds = new Set();
    let lineTotal = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitCost = Number(line.unitCostBs);
      if (!line.productId || productIds.has(String(line.productId)) ||
          !Number.isFinite(quantity) || quantity <= 0 ||
          !Number.isFinite(unitCost) || unitCost <= 0) {
        throw new Error('SQLite rechazó líneas de inventario de compra duplicadas o con cantidad/costo inválido.');
      }
      productIds.add(String(line.productId));
      lineTotal += quantity * unitCost;
    }
    lineTotal = money(lineTotal);
    const invoiceInventoryTotal = money(Number(purchase.taxableBaseBs || 0) + Number(purchase.exemptAmountBs || 0));
    if (!Number.isFinite(invoiceInventoryTotal) || Math.abs(lineTotal - invoiceInventoryTotal) > 0.02) {
      throw new Error('SQLite rechazó la compra: las líneas de inventario no concilian con base imponible más exento.');
    }
    const expectedReference = normalizeDocument('FAC-' + purchase.invoiceNumber);
    const linkedMovements = asArray(nextState.movements).filter(movement =>
      movement.companyId === purchase.companyId &&
      movement.type === 'ENTRADA' && movement.concept === 'COMPRA' &&
      normalizeDocument(movement.documentRef) === expectedReference
    );
    if (linkedMovements.length !== lines.length) {
      throw new Error('SQLite rechazó la compra: el número de entradas de Kardex no coincide con las líneas de inventario declaradas.');
    }
    for (const line of lines) {
      const matches = linkedMovements.filter(movement => String(movement.productId) === String(line.productId));
      if (matches.length !== 1) {
        throw new Error('SQLite rechazó la compra: falta una entrada de Kardex única para el artículo ' + line.productId + '.');
      }
      const movement = matches[0];
      const expectedCost = money(Number(line.quantity) * Number(line.unitCostBs));
      const lineUnitCostBs = Number(line.unitCostBs);
      const movementQuantity = Number(movement.quantity);
      const movementUnitCostBs = Number(movement.unitCostBs);
      const movementUnitCostUsd = Number(movement.unitCostUsd);
      const movementCostBs = Number(movement.totalCostBs);
      const movementCostUsd = Number(movement.totalCostUsd);
      const movementRate = Number(movement.bcvRate);
      const invoiceRate = Number(purchase.bcvRate);
      const supplierRif = normalizeRif(purchase.supplierRif);
      const movementRif = normalizeRif(movement.counterpartyRif);
      if (priorMovementIdsForIntegrity.has(String(movement.id)) ||
          movement.date !== purchase.invoiceDate ||
          !Number.isFinite(movementQuantity) ||
          Math.abs(movementQuantity - Number(line.quantity)) > 0.000001 ||
          !Number.isFinite(lineUnitCostBs) || !Number.isFinite(movementUnitCostBs) ||
          Math.abs(movementUnitCostBs - lineUnitCostBs) > 0.02 ||
          !Number.isFinite(invoiceRate) || invoiceRate <= 0 ||
          !Number.isFinite(movementRate) || Math.abs(movementRate - invoiceRate) > 0.000001 ||
          !Number.isFinite(movementUnitCostUsd) ||
          Math.abs(movementUnitCostUsd - lineUnitCostBs / invoiceRate) > 0.0001 ||
          !Number.isFinite(movementCostBs) ||
          Math.abs(money(movementCostBs) - expectedCost) > 0.02 ||
          !Number.isFinite(movementCostUsd) ||
          Math.abs(movementCostUsd - movementCostBs / invoiceRate) > 0.0001 ||
          !supplierRif || !movementRif || movementRif !== supplierRif) {
        throw new Error('SQLite rechazó la compra: una entrada de Kardex no coincide en fecha, proveedor, tasa BCV, cantidad o costo con su línea de factura.');
      }
    }
    const purchaseEntry = purchase.journalEntryId
      ? nextById.get(String(purchase.journalEntryId))
      : undefined;
    const purchaseProducts = asArray(nextState.products);
    const inventoryExpectedByAccount = new Map();
    for (const line of lines) {
      const product = purchaseProducts.find(item => String(item.id) === String(line.productId) &&
        String(item.companyId) === String(purchase.companyId));
      if (!product) throw new Error('SQLite rechazó la compra: no existe el artículo asociado a la línea ' + line.productId + '.');
      const code = String(product.inventoryAccountCode || '1.1.4.01');
      inventoryExpectedByAccount.set(code, money((inventoryExpectedByAccount.get(code) || 0) +
        Number(line.quantity) * Number(line.unitCostBs)));
    }
    const inventoryDebitBs = purchaseEntry?.items?.reduce((sum, item) =>
      sum + (inventoryExpectedByAccount.has(String(item.accountCode)) ? Number(item.debitBs || 0) : 0), 0);
    const inventoryDebitUsd = purchaseEntry?.items?.reduce((sum, item) =>
      sum + (inventoryExpectedByAccount.has(String(item.accountCode)) ? Number(item.debitUsd || 0) : 0), 0);
    if (!purchaseEntry || purchaseEntry.companyId !== purchase.companyId ||
        purchaseEntry.type !== 'COMPRA' ||
        !Number.isFinite(Number(inventoryDebitBs)) || Math.abs(money(inventoryDebitBs) - lineTotal) > 0.02 ||
        !Number.isFinite(Number(inventoryDebitUsd)) ||
        Math.abs(money(inventoryDebitUsd) - lineTotal / Number(purchase.bcvRate)) > 0.0001 ||
        !purchaseJournalMatchesInvoice(purchase, purchaseEntry, purchaseProducts, asArray(nextState.accounts))) {
      throw new Error('SQLite rechazó la compra: el asiento no reconoce en Bs. y USD el costo, IVA, IGTF, retenciones y CxP de la factura.');
    }
  }

  // Toda factura nueva de proveedor debe conciliar con su asiento, incluso
  // cuando corresponde a servicios/gastos y no genera líneas de inventario.
  // Sin esta segunda barrera, una factura de gasto podía guardar IVA, retenciones
  // o CxP distintos del asiento mientras superaba la validación del Kardex (que no aplica).
  for (const purchase of asArray(nextState.purchases)) {
    if (priorPurchaseIdsForIntegrity.has(String(purchase.id)) || purchase.documentType !== '01') continue;
    const purchaseEntry = purchase.journalEntryId
      ? nextById.get(String(purchase.journalEntryId))
      : undefined;
    if (!purchaseEntry ||
        !purchaseJournalMatchesInvoice(purchase, purchaseEntry, asArray(nextState.products), asArray(nextState.accounts))) {
      throw new Error('SQLite rechazó la factura de compra: el asiento no concilia en Bs. y USD la base, IVA, IGTF, retenciones y obligación/pago.');
    }
  }

  const priorMovementIdSet = new Set(asArray(priorState.movements).map(item => String(item.id)));
  const priorPurchaseIdSet = new Set(asArray(priorState.purchases).map(item => String(item.id)));
  const newSupplierReturns = asArray(nextState.movements).filter(movement =>
    !priorMovementIdSet.has(String(movement.id)) &&
    movement.type === 'SALIDA' && movement.concept === 'DEVOLUCION_COMPRA');
  const newCreditNotes = asArray(nextState.purchases).filter(purchase =>
    !priorPurchaseIdSet.has(String(purchase.id)) && purchase.documentType === '03');
  for (const purchase of asArray(nextState.purchases)) {
    if (!priorPurchaseIdSet.has(String(purchase.id)) && !['01', '02', '03'].includes(purchase.documentType)) {
      throw new Error('SQLite bloqueó una nota de débito/crédito sin flujo contable autorizado.');
    }
  }
  const expectedReturnCount = newCreditNotes.reduce((sum, note) =>
    sum + (Array.isArray(note.creditNoteLines) ? note.creditNoteLines.length : 0), 0);
  if (newSupplierReturns.length !== expectedReturnCount) {
    throw new Error('SQLite bloqueó la operación: cada línea de nota de crédito debe tener exactamente su salida de Kardex asociada y viceversa.');
  }
  for (const note of newCreditNotes) {
    const original = asArray(nextState.purchases).find(item =>
      item.id === note.originalPurchaseId && item.companyId === note.companyId && item.documentType === '01');
    const lines = Array.isArray(note.creditNoteLines) ? note.creditNoteLines : [];
    const company = asArray(nextState.companies).find(item => item.id === note.companyId);
    const duplicateNoteNumber = asArray(nextState.purchases).some(item =>
      item.id !== note.id && item.companyId === note.companyId && item.documentType === '03' &&
      normalizeDocument(item.creditNoteNumber || item.invoiceNumber) === normalizeDocument(note.creditNoteNumber));
    if (!original || original.isCancelled || !isValidIsoDate(original.invoiceDate) || !isValidIsoDate(note.invoiceDate) ||
        normalizeRif(note.supplierRif) !== normalizeRif(original.supplierRif) ||
        note.affectedInvoiceNumber !== original.invoiceNumber || note.invoiceDate < original.invoiceDate ||
        (company?.closedThroughDate && note.invoiceDate <= company.closedThroughDate) ||
        duplicateNoteNumber ||
        !note.creditNoteNumber || !note.controlNumber || String(note.notes || '').trim().length < 10 ||
        lines.length === 0 || !note.journalEntryId ||
        !Number.isFinite(Number(note.bcvRate)) || Number(note.bcvRate) <= 0 ||
        !Number.isFinite(Number(note.totalAmountBs)) || Number(note.totalAmountBs) <= 0 ||
        !Number.isFinite(Number(note.totalAmountUsd)) || Number(note.totalAmountUsd) <= 0 ||
        !Number.isFinite(Number(note.taxableBaseBs || 0)) || Number(note.taxableBaseBs || 0) < 0 ||
        !Number.isFinite(Number(note.exemptAmountBs || 0)) || Number(note.exemptAmountBs || 0) < 0 ||
        !Number.isFinite(Number(note.vatAmountBs || 0)) || Number(note.vatAmountBs || 0) < 0 ||
        !Number.isFinite(Number(note.vatWithheldBs || 0)) || Number(note.vatWithheldBs || 0) < 0 ||
        !Number.isFinite(Number(note.islrWithheldBs || 0)) || Number(note.islrWithheldBs || 0) < 0 ||
        !Number.isFinite(Number(note.igtfAmountBs || 0)) || Number(note.igtfAmountBs || 0) < 0 ||
        !Number.isFinite(Number(note.netPayableReductionBs)) || Number(note.netPayableReductionBs) < 0 ||
        !Number.isFinite(Number(note.netPayableReductionUsd)) || Number(note.netPayableReductionUsd) < 0 ||
        !Number.isFinite(Number(note.supplierAdvanceBs || 0)) || Number(note.supplierAdvanceBs || 0) < 0 ||
        !Number.isFinite(Number(note.supplierAdvanceUsd || 0)) || Number(note.supplierAdvanceUsd || 0) < 0) {
      throw new Error('SQLite rechazó la nota de crédito: falta factura original, proveedor, soporte, líneas de Kardex o reducción de CxP válida.');
    }
    const sourceEntryForPayable = asArray(nextState.journalEntries).find(item =>
      item.companyId === original.companyId && item.id === original.journalEntryId);
    const sourcePayableAccounts = [...new Set(asArray(sourceEntryForPayable?.items)
      .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
      .map(item => String(item.accountCode)))];
    const cashOriginalPurchase = original.paymentTerm === 'CONTADO';
    if ((!cashOriginalPurchase && sourcePayableAccounts.length !== 1) ||
        (cashOriginalPurchase && sourcePayableAccounts.length !== 0)) {
      throw new Error('SQLite rechazó la nota de crédito: la cuenta de contrapartida no concilia con la modalidad de pago de la factura original.');
    }
    // Para contado no existe auxiliar CxP; el crédito recuperable se registra
    // íntegramente como anticipo a favor del proveedor (1.1.2.03).
    const sourcePayableAccountCode = sourcePayableAccounts[0] || '';
    const sourceLines = Array.isArray(original.inventoryLines) ? original.inventoryLines : [];
    const sourceProducts = asArray(nextState.products);
    for (const sourceLine of sourceLines) {
      const sourceProduct = sourceProducts.find(item =>
        String(item.id) === String(sourceLine.productId) && String(item.companyId) === String(original.companyId));
      if (!sourceProduct) {
        throw new Error('SQLite rechazó la factura de compra: no existe el artículo asociado en el catálogo de la empresa.');
      }
    }
    const sourceMovements = asArray(nextState.movements).filter(item =>
      item.companyId === original.companyId && item.type === 'ENTRADA' &&
      item.concept === 'COMPRA' && !item.correctionForMovementId &&
      normalizeDocument(item.documentRef) === normalizeDocument('FAC-' + original.invoiceNumber));
    const sourceLineTotal = money(sourceLines.reduce((sum, item) =>
      sum + Number(item.quantity || 0) * Number(item.unitCostBs || 0), 0));
    const sourceEntry = original.journalEntryId ? nextById.get(String(original.journalEntryId)) : undefined;
    const sourceInventoryAccounts = new Set();
    for (const sourceLine of sourceLines) {
      const sourceProduct = sourceProducts.find(item =>
        String(item.id) === String(sourceLine.productId) && String(item.companyId) === String(original.companyId));
      sourceInventoryAccounts.add(String(sourceProduct.inventoryAccountCode || '1.1.4.01'));
    }
    const sourceInventoryDebit = sourceEntry?.items?.reduce((sum, item) =>
      sum + (sourceInventoryAccounts.has(String(item.accountCode)) ? Number(item.debitBs || 0) : 0), 0) || 0;
    const sourceInventoryDebitUsd = sourceEntry?.items?.reduce((sum, item) =>
      sum + (sourceInventoryAccounts.has(String(item.accountCode)) ? Number(item.debitUsd || 0) : 0), 0) || 0;
    const sourceRate = Number(original.bcvRate);
    const sourceReconciles = sourceLines.length > 0 && Number.isFinite(sourceRate) && sourceRate > 0 &&
      Math.abs(sourceLineTotal - Number(original.taxableBaseBs || 0) - Number(original.exemptAmountBs || 0)) <= 0.02 &&
      sourceMovements.length === sourceLines.length &&
      sourceLines.every(sourceLine => {
        const matches = sourceMovements.filter(item => String(item.productId) === String(sourceLine.productId));
        if (matches.length !== 1) return false;
        const sourceMovement = matches[0];
        const expectedBs = money(Number(sourceLine.quantity) * Number(sourceLine.unitCostBs));
        const movementRif = normalizeRif(sourceMovement.counterpartyRif);
        const supplierRif = normalizeRif(original.supplierRif);
        return sourceMovement.date === original.invoiceDate && Boolean(movementRif) && Boolean(supplierRif) &&
          movementRif === supplierRif &&
          Number.isFinite(Number(sourceMovement.quantity)) &&
          Math.abs(Number(sourceMovement.quantity) - Number(sourceLine.quantity)) <= 0.000001 &&
          Number.isFinite(Number(sourceMovement.unitCostBs)) &&
          Math.abs(Number(sourceMovement.unitCostBs) - Number(sourceLine.unitCostBs)) <= 0.02 &&
          Number.isFinite(Number(sourceMovement.unitCostUsd)) &&
          Math.abs(Number(sourceMovement.unitCostUsd) - Number(sourceLine.unitCostBs) / sourceRate) <= 0.0001 &&
          Math.abs(money(Number(sourceMovement.totalCostBs)) - expectedBs) <= 0.02 &&
          Math.abs(Number(sourceMovement.bcvRate) - sourceRate) <= 0.000001 &&
          Math.abs(Number(sourceMovement.totalCostUsd) - expectedBs / sourceRate) <= 0.0001;
      }) &&
      sourceEntry?.type === 'COMPRA' && sourceEntry.companyId === original.companyId &&
      Math.abs(sourceInventoryDebit - sourceLineTotal) <= 0.02 &&
      Math.abs(sourceInventoryDebitUsd - sourceLineTotal / sourceRate) <= 0.0001 &&
      purchaseJournalMatchesInvoice(original, sourceEntry, asArray(nextState.products), asArray(nextState.accounts));
    const journal = nextById.get(String(note.journalEntryId));
    if (!sourceReconciles || !journal || journal.companyId !== note.companyId ||
        journal.type !== 'AJUSTE' || journal.date !== note.invoiceDate ||
        normalizeDocument(journal.referenceDoc) !== normalizeDocument('NC-PROV-' + note.creditNoteNumber)) {
      throw new Error('SQLite rechazó la nota de crédito: la factura original o el asiento fiscal no están conciliados.');
    }
    const linkedCreditNoteCorrection = voucher => {
      if (!voucher?.requiresFiscalCorrection) return false;
      const correctionIds = Array.isArray(voucher.correctionEntryIds) ? voucher.correctionEntryIds : (voucher.correctionEntryId ? [voucher.correctionEntryId] : []);
      if (!correctionIds.includes(journal.id)) return false;
      const correction = nextById.get(String(journal.id));
      return Boolean(correction && asArray(nextState.purchases).some(candidate =>
        candidate.companyId === original.companyId && candidate.documentType === '03' &&
        candidate.originalPurchaseId === original.id && candidate.journalEntryId === correction.id &&
        normalizeDocument(correction.referenceDoc) === normalizeDocument('NC-PROV-' + candidate.creditNoteNumber)));
    };
    const originalVatVoucher = asArray(nextState.vatVouchers).find(voucher =>
      voucher.companyId === original.companyId && voucher.purchaseRecordId === original.id);
    const originalIslrVoucher = asArray(nextState.islrVouchers).find(voucher =>
      voucher.companyId === original.companyId && voucher.invoiceNumber === original.invoiceNumber &&
      voucher.supplierRif === original.supplierRif);
    if ((Number(note.vatWithheldBs || 0) > 0 && originalVatVoucher && !linkedCreditNoteCorrection(originalVatVoucher)) ||
        (Number(note.islrWithheldBs || 0) > 0 && originalIslrVoucher && !linkedCreditNoteCorrection(originalIslrVoucher))) {
      throw new Error('SQLite rechazó la nota de crédito: falta enlazar los comprobantes de retención IVA/ISLR afectados para revisión fiscal.');
    }
    const journalMovementIds = new Set();
    const sourceMovementIds = new Set();
    let totalInventoryCost = 0;
    for (const line of lines) {
      const originalMovement = asArray(nextState.movements).find(item =>
        item.id === line.originalMovementId && item.companyId === note.companyId &&
        item.type === 'ENTRADA' && item.concept === 'COMPRA' &&
        normalizeDocument(item.documentRef) === normalizeDocument('FAC-' + original.invoiceNumber));
      const returnMovement = asArray(nextState.movements).find(item =>
        item.id === line.movementId && item.companyId === note.companyId);
      const originalLine = sourceLines.find(item => item.productId === line.productId);
      const product = asArray(nextState.products).find(item => item.id === line.productId && item.companyId === note.companyId);
      if (!originalMovement || !returnMovement || !newSupplierReturns.some(item => item.id === returnMovement.id) ||
          journalMovementIds.has(String(returnMovement.id)) || sourceMovementIds.has(String(line.originalMovementId)) ||
          originalMovement.productId !== line.productId || returnMovement.productId !== line.productId ||
          !originalLine ||
          !Number.isFinite(Number(originalMovement.quantity)) ||
          !Number.isFinite(Number(originalMovement.unitCostBs)) ||
          !Number.isFinite(Number(originalMovement.totalCostBs)) ||
          !Number.isFinite(Number(originalMovement.bcvRate)) ||
          Math.abs(Number(originalMovement.quantity) - Number(originalLine.quantity)) > 0.000001 ||
          Math.abs(Number(originalMovement.unitCostBs) - Number(originalLine.unitCostBs)) > 0.02 ||
          Math.abs(Number(originalMovement.totalCostBs) - Number(originalLine.quantity) * Number(originalLine.unitCostBs)) > 0.02 ||
          originalMovement.date !== original.invoiceDate ||
          Math.abs(Number(originalMovement.bcvRate) - Number(original.bcvRate)) > 0.000001 ||
          normalizeRif(originalMovement.counterpartyRif) !== normalizeRif(original.supplierRif) ||
          returnMovement.type !== 'SALIDA' || returnMovement.concept !== 'DEVOLUCION_COMPRA' ||
          returnMovement.date !== note.invoiceDate ||
          returnMovement.correctionForMovementId !== originalMovement.id ||
          normalizeDocument(returnMovement.documentRef) !== normalizeDocument('NC-PROV-' + note.creditNoteNumber) ||
          returnMovement.journalEntryId !== journal.id ||
          Math.abs(Number(returnMovement.quantity) - Number(line.quantity)) > 0.000001 ||
          Math.abs(Number(returnMovement.unitCostBs) - Number(line.unitCostBs)) > 0.02 ||
          Math.abs(Number(returnMovement.totalCostBs) - Number(line.inventoryCostBs)) > 0.02 ||
          Math.abs(Number(returnMovement.totalCostUsd) - Number(line.inventoryCostBs) / Number(note.bcvRate)) > 0.0001 ||
          normalizeRif(returnMovement.counterpartyRif) !== normalizeRif(original.supplierRif) ||
          !originalLine || !product ||
          !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 ||
          !Number.isFinite(Number(line.unitCostBs)) || Number(line.unitCostBs) <= 0 ||
          !Number.isFinite(Number(line.inventoryCostBs)) || Number(line.inventoryCostBs) <= 0 ||
          !Number.isFinite(Number(returnMovement.quantity)) ||
          !Number.isFinite(Number(returnMovement.unitCostBs)) ||
          !Number.isFinite(Number(returnMovement.totalCostBs)) ||
          !Number.isFinite(Number(returnMovement.totalCostUsd)) ||
          !Number.isFinite(Number(returnMovement.unitCostUsd)) ||
          !Number.isFinite(Number(returnMovement.balanceQty)) ||
          !Number.isFinite(Number(returnMovement.bcvRate)) ||
          Math.abs(Number(returnMovement.bcvRate) - Number(note.bcvRate)) > 0.000001 ||
          Math.abs(Number(returnMovement.unitCostUsd) - Number(line.unitCostBs) / Number(note.bcvRate)) > 0.0001 ||
          Math.abs(Number(line.unitCostBs) - Number(originalLine.unitCostBs)) > 0.02 ||
          Math.abs(Number(line.inventoryCostBs) - Number(line.quantity) * Number(line.unitCostBs)) > 0.02) {
        throw new Error('SQLite rechazó una línea de nota de crédito: la salida física no concilia con la entrada original y el asiento enlazado.');
      }
      journalMovementIds.add(String(returnMovement.id));
      sourceMovementIds.add(String(line.originalMovementId));
      totalInventoryCost += Number(line.inventoryCostBs);
      const allReturned = asArray(nextState.purchases).filter(item => item.companyId === original.companyId && item.originalPurchaseId === original.id)
        .flatMap(item => Array.isArray(item.creditNoteLines) ? item.creditNoteLines : [])
        .filter(item => item.productId === line.productId)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      if (allReturned > Number(originalLine.quantity) + 0.000001) {
        throw new Error('SQLite rechazó la nota de crédito: las devoluciones acumuladas superan la cantidad facturada.');
      }
      const priorProduct = asArray(priorState.products).find(item => item.id === line.productId && item.companyId === note.companyId);
      const nextProduct = asArray(nextState.products).find(item => item.id === line.productId && item.companyId === note.companyId);
      const allNewReturnsForProduct = newSupplierReturns.filter(item => item.companyId === note.companyId && item.productId === line.productId)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      if (!priorProduct || !nextProduct ||
          !Number.isFinite(Number(priorProduct.currentStock)) ||
          !Number.isFinite(Number(nextProduct.currentStock)) ||
          !Number.isFinite(Number(returnMovement.balanceQty)) ||
          Math.abs(Number(priorProduct.currentStock) - allNewReturnsForProduct - Number(nextProduct.currentStock)) > 0.000001 ||
          Math.abs(Number(returnMovement.balanceQty) - Number(nextProduct.currentStock)) > 0.000001) {
        throw new Error('SQLite rechazó la nota de crédito: la existencia final del artículo no coincide con las salidas físicas registradas.');
      }
    }
    const debitsBs = journal.items.reduce((sum, item) => sum + Number(item.debitBs || 0), 0);
    const creditsBs = journal.items.reduce((sum, item) => sum + Number(item.creditBs || 0), 0);
    const debitsUsd = journal.items.reduce((sum, item) => sum + Number(item.debitUsd || 0), 0);
    const creditsUsd = journal.items.reduce((sum, item) => sum + Number(item.creditUsd || 0), 0);
    const accountSum = (code, side, currency) => journal.items
      .filter(item => item.accountCode === code)
      .reduce((sum, item) => sum + Number(item[side + currency] || 0), 0);
    const inventoryByAccount = new Map();
    for (const line of lines) {
      const product = asArray(nextState.products).find(item => item.id === line.productId && item.companyId === note.companyId);
      const code = product?.inventoryAccountCode || '1.1.4.01';
      inventoryByAccount.set(code, (inventoryByAccount.get(code) || 0) + Number(line.inventoryCostBs));
    }
    const inventoryAccountsMatch = [...inventoryByAccount.entries()].every(([code, amount]) =>
      Math.abs(accountSum(code, 'credit', 'Bs') - amount) <= 0.02 &&
      Math.abs(accountSum(code, 'credit', 'Usd') - amount / Number(note.bcvRate)) <= 0.0001);
    const allowedCreditNoteAccounts = new Set([
      ...inventoryByAccount.keys(), sourcePayableAccountCode, '1.1.2.03',
      '1.1.3.01', '2.1.2.03', '2.1.2.04', '6.1.1.11'
    ]);
    const journalLinesValid = journal.items.length > 0 && journal.items.every(item => {
      const values = [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd]
        .map(value => Number(value ?? 0));
      return allowedCreditNoteAccounts.has(String(item.accountCode || '')) &&
        values.every(value => Number.isFinite(value) && value >= 0) &&
        !(values[0] > 0 && values[1] > 0) &&
        !(values[2] > 0 && values[3] > 0);
    });
    if (!journalLinesValid ||
        Math.abs(debitsBs - creditsBs) > 0.02 || Math.abs(debitsUsd - creditsUsd) > 0.0001 ||
        Math.abs(totalInventoryCost - Number(note.taxableBaseBs || 0) - Number(note.exemptAmountBs || 0)) > 0.02 ||
        Math.abs(accountSum(sourcePayableAccountCode, 'debit', 'Bs') - Number(note.netPayableReductionBs)) > 0.02 ||
        Math.abs(accountSum(sourcePayableAccountCode, 'debit', 'Usd') - Number(note.netPayableReductionUsd)) > 0.0001 ||
        accountSum(sourcePayableAccountCode, 'credit', 'Bs') > 0.02 || accountSum(sourcePayableAccountCode, 'credit', 'Usd') > 0.0001 ||
        Math.abs(accountSum('1.1.2.03', 'debit', 'Bs') - Number(note.supplierAdvanceBs || 0)) > 0.02 ||
        Math.abs(accountSum('1.1.2.03', 'debit', 'Usd') - Number(note.supplierAdvanceUsd || 0)) > 0.0001 ||
        accountSum('1.1.2.03', 'credit', 'Bs') > 0.02 || accountSum('1.1.2.03', 'credit', 'Usd') > 0.0001 ||
        !inventoryAccountsMatch ||
        [...inventoryByAccount.keys()].some(code => accountSum(code, 'debit', 'Bs') > 0.02 || accountSum(code, 'debit', 'Usd') > 0.0001) ||
        Math.abs(accountSum('1.1.3.01', 'credit', 'Bs') - Number(note.vatAmountBs || 0)) > 0.02 ||
        Math.abs(accountSum('1.1.3.01', 'credit', 'Usd') - Number(note.vatAmountUsd || 0)) > 0.0001 ||
        accountSum('1.1.3.01', 'debit', 'Bs') > 0.02 || accountSum('1.1.3.01', 'debit', 'Usd') > 0.0001 ||
        Math.abs(accountSum('2.1.2.03', 'debit', 'Bs') - Number(note.vatWithheldBs || 0)) > 0.02 ||
        Math.abs(accountSum('2.1.2.03', 'debit', 'Usd') - Number(note.vatWithheldUsd || 0)) > 0.0001 ||
        accountSum('2.1.2.03', 'credit', 'Bs') > 0.02 || accountSum('2.1.2.03', 'credit', 'Usd') > 0.0001 ||
        Math.abs(accountSum('2.1.2.04', 'debit', 'Bs') - Number(note.islrWithheldBs || 0)) > 0.02 ||
        Math.abs(accountSum('2.1.2.04', 'debit', 'Usd') - Number(note.islrWithheldUsd || 0)) > 0.0001 ||
        accountSum('2.1.2.04', 'credit', 'Bs') > 0.02 || accountSum('2.1.2.04', 'credit', 'Usd') > 0.0001 ||
        Math.abs(accountSum('6.1.1.11', 'credit', 'Bs') - Number(note.igtfAmountBs || 0)) > 0.02 ||
        Math.abs(accountSum('6.1.1.11', 'credit', 'Usd') - Number(note.igtfAmountUsd || 0)) > 0.0001 ||
        accountSum('6.1.1.11', 'debit', 'Bs') > 0.02 || accountSum('6.1.1.11', 'debit', 'Usd') > 0.0001 ||
        !Number.isFinite(Number(note.totalAmountUsd)) ||
        !Number.isFinite(Number(note.taxableBaseUsd || 0)) ||
        !Number.isFinite(Number(note.exemptAmountUsd || 0)) ||
        !Number.isFinite(Number(note.vatAmountUsd || 0)) ||
        !Number.isFinite(Number(note.vatWithheldUsd || 0)) ||
        !Number.isFinite(Number(note.islrWithheldUsd || 0)) ||
        !Number.isFinite(Number(note.igtfAmountUsd || 0)) ||
        !Number.isFinite(Number(note.supplierAdvanceUsd || 0)) ||
        !Number.isFinite(Number(note.netPayableReductionUsd)) ||
        Math.abs(Number(note.totalAmountBs) - Number(note.taxableBaseBs) - Number(note.exemptAmountBs) - Number(note.vatAmountBs) - Number(note.igtfAmountBs || 0)) > 0.02 ||
        Math.abs(Number(note.totalAmountUsd) - Number(note.totalAmountBs) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.taxableBaseUsd || 0) - Number(note.taxableBaseBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.exemptAmountUsd || 0) - Number(note.exemptAmountBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.vatAmountUsd || 0) - Number(note.vatAmountBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.vatWithheldUsd || 0) - Number(note.vatWithheldBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.islrWithheldUsd || 0) - Number(note.islrWithheldBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.igtfAmountUsd || 0) - Number(note.igtfAmountBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.supplierAdvanceUsd || 0) - Number(note.supplierAdvanceBs || 0) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.netPayableReductionUsd) - Number(note.netPayableReductionBs) / Number(note.bcvRate)) > 0.0001 ||
        Math.abs(Number(note.netPayableReductionBs) + Number(note.supplierAdvanceBs || 0) -
           (Number(note.totalAmountBs) - Number(note.vatWithheldBs || 0) - Number(note.islrWithheldBs || 0))) > 0.02 ||
         Math.abs(Number(note.netPayableReductionUsd) + Number(note.supplierAdvanceUsd || 0) -
           (Number(note.totalAmountUsd) - Number(note.vatWithheldUsd || 0) - Number(note.islrWithheldUsd || 0))) > 0.0001) {
      throw new Error('SQLite rechazó la nota de crédito: el asiento no está balanceado o no revierte CxP, inventario, IVA, retenciones e IGTF.');
    }
    const paid = asArray(nextState.creditSettlements).filter(item =>
      item.companyId === original.companyId && item.documentId === original.id &&
      item.kind === 'PURCHASE_PAYMENT' && !item.isReversed)
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const credited = asArray(nextState.purchases).filter(item => item.companyId === original.companyId && item.originalPurchaseId === original.id)
      .reduce((sum, item) => sum + Number(item.netPayableReductionUsd || 0), 0);
    const advanceApplied = asArray(nextState.supplierAdvanceSettlements).filter(item =>
      item.companyId === original.companyId && item.kind === 'APPLIED_TO_PURCHASE' &&
      item.targetPurchaseId === original.id && !item.isReversed)
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const originalNetUsd = Number(original.totalAmountUsd) -
      Number(original.vatWithheldUsd || 0) - Number(original.islrWithheldUsd || 0);
    if (paid + credited + advanceApplied > originalNetUsd + 0.005) {
      throw new Error('SQLite rechazó la nota de crédito: pagos, notas y anticipos aplicados superan el principal neto de CxP original.');
    }
  }
  for (const movement of newSupplierReturns) {
    const linked = newCreditNotes.some(note =>
      (note.creditNoteLines || []).some(line => line.movementId === movement.id));
    if (!linked) throw new Error('SQLite bloqueó una salida por devolución a proveedor sin nota de crédito fiscal enlazada.');
  }

  const oldSettlements = new Map(asArray(priorState.creditSettlements).map(item => [String(item.id), item]));
  for (const settlement of asArray(nextState.creditSettlements)) {
    const oldSettlement = oldSettlements.get(String(settlement.id));
    if (!oldSettlement || oldSettlement.isReversed || !settlement.isReversed) continue;
    const reversal = settlement.reversedByJournalEntryId
      ? nextById.get(String(settlement.reversedByJournalEntryId))
      : undefined;
    if (!reversal || reversal.companyId !== settlement.companyId ||
        reversal.reversalOfEntryId !== oldSettlement.journalEntryId) {
      throw new Error('SQLite rechazó la reversión de una liquidación sin contra-asiento vinculado.');
    }
  }

  const priorCreditSettlementIds = new Set(asArray(priorState.creditSettlements).map(item => String(item.id)));
  for (const settlement of asArray(nextState.creditSettlements)) {
    if (priorCreditSettlementIds.has(String(settlement.id)) || settlement.kind !== 'PURCHASE_PAYMENT') continue;
    const target = asArray(nextState.purchases).find(item =>
      item.id === settlement.documentId && item.companyId === settlement.companyId && item.documentType === '02');
    if (!target) continue;
    const sourceJournal = target.journalEntryId ? priorById.get(String(target.journalEntryId)) : undefined;
    const payableCodes = sourceJournal && sourceJournal.companyId === target.companyId &&
      sourceJournal.type === 'AJUSTE' && Array.isArray(sourceJournal.items)
      ? [...new Set(sourceJournal.items.filter(line =>
          String(line.accountCode || '').startsWith('2.1.1.') && Number(line.creditBs || 0) > 0
        ).map(line => String(line.accountCode)))]
      : [];
    const payableCode = payableCodes.length === 1 ? payableCodes[0] : '';
    const payableAccount = asArray(nextState.accounts).find(account => account.code === payableCode);
    const journal = settlement.journalEntryId ? nextById.get(String(settlement.journalEntryId)) : undefined;
    const amountUsd = Number(settlement.amountUsd);
    const amountBs = Number(settlement.amountBs);
    const settlementRate = Number(settlement.bcvRate);
    const invoiceRate = Number(target.bcvRate);
    const expectedPayableBs = Math.round(amountUsd * invoiceRate * 100) / 100;
    const expectedCashBs = Math.round(amountUsd * settlementRate * 100) / 100;
    const fxDifferenceBs = Math.round((amountBs - expectedPayableBs) * 100) / 100;
    const bank = settlement.bankAccountId
      ? asArray(nextState.bankAccounts).find(item => item.id === settlement.bankAccountId && item.companyId === target.companyId)
      : undefined;
    const cashCode = bank?.accountCode || (settlement.method === 'CASH_USD' ? '1.1.1.02' : '1.1.1.01');
    const cashAccount = asArray(nextState.accounts).find(account => account.code === cashCode);
    const bankTransfer = settlement.method === 'BANK_TRANSFER_BS' || settlement.method === 'BANK_TRANSFER_USD';
    const expectedBankCurrency = settlement.method === 'BANK_TRANSFER_USD' ? 'USD' : 'BS';
    const bankValid = bankTransfer ? Boolean(bank && bank.currency === expectedBankCurrency) : !settlement.bankAccountId;
    const payableDebit = asArray(journal?.items).filter(line => line.accountCode === payableCode)
      .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const payableCredit = asArray(journal?.items).filter(line => line.accountCode === payableCode)
      .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const payableDebitUsd = asArray(journal?.items).filter(line => line.accountCode === payableCode)
      .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
    const cashCredit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const cashDebit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const cashCreditUsd = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
    const fxCode = fxDifferenceBs > 0.009 ? '6.1.1.08' : fxDifferenceBs < -0.009 ? '4.2.1.01' : '';
    const fxAmount = Math.abs(fxDifferenceBs);
    const fxLineAmount = fxCode
      ? asArray(journal?.items).filter(line => line.accountCode === fxCode)
          .reduce((sum, line) => sum + (fxCode === '6.1.1.08'
            ? Number(line.debitBs || 0) - Number(line.creditBs || 0)
            : Number(line.creditBs || 0) - Number(line.debitBs || 0)), 0)
      : 0;
    const allowedCodes = new Set([payableCode, cashCode, ...(fxCode ? [fxCode] : [])]);
    const totals = asArray(journal?.items).reduce((acc, line) => ({
      debitBs: acc.debitBs + Number(line.debitBs || 0),
      creditBs: acc.creditBs + Number(line.creditBs || 0),
      debitUsd: acc.debitUsd + Number(line.debitUsd || 0),
      creditUsd: acc.creditUsd + Number(line.creditUsd || 0)
    }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    if (!target || target.isCancelled || target.paymentTerm !== 'CREDITO' ||
        !isValidIsoDate(settlement.settlementDate) ||
        settlement.settlementDate < String(target.accountCreditDate || target.invoiceDate) ||
        !Number.isFinite(amountUsd) || amountUsd <= 0 ||
        !Number.isFinite(amountBs) || amountBs <= 0 ||
        !Number.isFinite(settlementRate) || settlementRate <= 0 ||
        !Number.isFinite(invoiceRate) || invoiceRate <= 0 ||
        Math.abs(amountBs - expectedCashBs) >= 0.01 ||
        !sourceJournal || payableCodes.length !== 1 ||
        !payableAccount || payableAccount.type !== 'PASIVO' || payableAccount.isMovement !== true ||
        !cashAccount || cashAccount.type !== 'ACTIVO' || cashAccount.isMovement !== true || !bankValid ||
        !journal || journal.companyId !== target.companyId || journal.type !== 'AJUSTE' ||
        journal.date !== settlement.settlementDate || journal.referenceDoc !== target.invoiceNumber ||
        Math.abs(payableDebit - expectedPayableBs) > 0.02 ||
        Math.abs(payableCredit) > 0.01 ||
        Math.abs(payableDebitUsd - amountUsd) > 0.0001 ||
        Math.abs(cashCredit - amountBs) > 0.02 ||
        Math.abs(cashDebit) > 0.01 ||
        Math.abs(cashCreditUsd - amountUsd) > 0.0001 ||
        Math.abs(fxLineAmount - fxAmount) > 0.02 ||
        asArray(journal.items).some(line => !allowedCodes.has(line.accountCode)) ||
        Math.abs(totals.debitBs - totals.creditBs) > 0.02 ||
        Math.abs(totals.debitUsd - totals.creditUsd) > 0.0001) {
      throw new Error('SQLite rechazó el pago de una ND: documento, cuenta CxP propia, tesorería, diferencial cambiario o asiento no concilian.');
    }
  }

  const purchaseById = new Map(asArray(nextState.purchases).map(item => [String(item.id), item]));
  const hasValidFiscalCorrection = (purchase, correction) => {
    if (!purchase || !correction) return false;
    const source = purchase.journalEntryId ? priorById.get(String(purchase.journalEntryId)) : undefined;
    const fullReversal = Boolean(purchase.isCancelled && source && correction.reversalOfEntryId === source.id);
    const supplierCreditNote = asArray(nextState.purchases).find(note =>
      note.companyId === purchase.companyId && note.documentType === '03' &&
      note.originalPurchaseId === purchase.id && note.journalEntryId === correction.id &&
      normalizeDocument(correction.referenceDoc) === normalizeDocument('NC-PROV-' + note.creditNoteNumber) &&
      correction.type === 'AJUSTE' && Array.isArray(note.creditNoteLines) && note.creditNoteLines.length > 0);
    return fullReversal || Boolean(supplierCreditNote);
  };
  for (const voucher of asArray(nextState.vatVouchers)) {
    if (!voucher.requiresFiscalCorrection) continue;
    const purchase = purchaseById.get(String(voucher.purchaseRecordId));
    const correctionIds = Array.isArray(voucher.correctionEntryIds) ? voucher.correctionEntryIds : (voucher.correctionEntryId ? [voucher.correctionEntryId] : []);
    const correctionsValid = correctionIds.length > 0 && correctionIds.every(id => hasValidFiscalCorrection(purchase, nextById.get(String(id))));
    if (!purchase || purchase.companyId !== voucher.companyId || !correctionsValid) {
      throw new Error('SQLite rechazó una marca de corrección de retención IVA sin factura, nota de crédito o contra-asiento conciliados.');
    }
  }
  for (const voucher of asArray(nextState.islrVouchers)) {
    if (!voucher.requiresFiscalCorrection) continue;
    const purchase = asArray(nextState.purchases).find(item =>
      item.companyId === voucher.companyId && item.invoiceNumber === voucher.invoiceNumber &&
      item.supplierRif === voucher.supplierRif && item.documentType === '01');
    const correctionIds = Array.isArray(voucher.correctionEntryIds) ? voucher.correctionEntryIds : (voucher.correctionEntryId ? [voucher.correctionEntryId] : []);
    const correctionsValid = correctionIds.length > 0 && correctionIds.every(id => hasValidFiscalCorrection(purchase, nextById.get(String(id))));
    if (!correctionsValid) {
      throw new Error('SQLite rechazó una marca de corrección de retención ISLR sin factura, nota de crédito o contra-asiento conciliados.');
    }
  }

  // Supplier advance settlements are operational financial records, not free-form metadata.
  const advanceSettlements = asArray(nextState.supplierAdvanceSettlements);
  const advanceIds = new Set();
  const advanceTotals = new Map();
  const advanceAllocationsByNote = new Map();
  const advanceAllocationsByDirect = new Map();
  const nextBankAccounts = asArray(nextState.bankAccounts);
  for (const settlement of advanceSettlements) {
    const id = String(settlement.id || '');
    if (!id || advanceIds.has(id)) throw new Error('SQLite rechazó identificadores vacíos o duplicados en liquidaciones de anticipos.');
    advanceIds.add(id);
    const companyId = String(settlement.companyId || '');
    const rif = String(settlement.supplierRif || '').trim().toUpperCase();
    const amountUsd = Number(settlement.amountUsd);
    const bookBs = Number(settlement.advanceBookValueBs ?? settlement.amountBs);
    const rate = Number(settlement.bcvRate);
    if (!companyId || !rif || !['REFUND_RECEIVED', 'APPLIED_TO_PURCHASE'].includes(settlement.kind) ||
        !Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(bookBs) || bookBs <= 0 ||
        !Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(settlement.date || ''))) {
      throw new Error('SQLite rechazó una liquidación de anticipo con proveedor, fecha, moneda o tasa inválidos.');
    }
    const sources = Array.isArray(settlement.sourceCreditNoteIds) ? settlement.sourceCreditNoteIds : [];
    const directSources = Array.isArray(settlement.sourceDirectAdvanceIds) ? settlement.sourceDirectAdvanceIds : [];
    if ((!sources.length && !directSources.length) ||
        new Set(sources).size !== sources.length || new Set(directSources).size !== directSources.length) {
      throw new Error('SQLite rechazó una liquidación sin orígenes de anticipo únicos.');
    }
    const allocations = Array.isArray(settlement.sourceCreditNoteAllocations) ? settlement.sourceCreditNoteAllocations : [];
    const directAllocations = Array.isArray(settlement.sourceDirectAdvanceAllocations) ? settlement.sourceDirectAdvanceAllocations : [];
    if (allocations.length !== sources.length ||
        allocations.some(item => !item || typeof item.creditNoteId !== 'string' ||
          !Number.isFinite(Number(item.amountUsd)) || Number(item.amountUsd) <= 0 ||
          !Number.isFinite(Number(item.bookValueBs)) || Number(item.bookValueBs) < 0) ||
        new Set(allocations.map(item => item.creditNoteId)).size !== allocations.length ||
        allocations.some(item => !sources.includes(item.creditNoteId)) ||
        directAllocations.length !== directSources.length ||
        directAllocations.some(item => !item || typeof item.directAdvanceId !== 'string' ||
          !Number.isFinite(Number(item.amountUsd)) || Number(item.amountUsd) <= 0 ||
          !Number.isFinite(Number(item.bookValueBs)) || Number(item.bookValueBs) < 0) ||
        new Set(directAllocations.map(item => item.directAdvanceId)).size !== directAllocations.length ||
        directAllocations.some(item => !directSources.includes(item.directAdvanceId))) {
      throw new Error('SQLite rechazó una liquidación sin distribución individual válida por cada origen.');
    }
    const allocatedUsd = [...allocations, ...directAllocations].reduce((sum, item) => sum + Number(item.amountUsd), 0);
    const allocatedBs = [...allocations, ...directAllocations].reduce((sum, item) => sum + Number(item.bookValueBs), 0);
    if (Math.abs(allocatedUsd - amountUsd) > 0.00001 || Math.abs(allocatedBs - bookBs) > 0.02) {
      throw new Error('SQLite rechazó una distribución individual que no coincide con el importe liquidado.');
    }
    const sourceNotes = allocations.map(allocation => purchaseById.get(String(allocation.creditNoteId)));
    if (sourceNotes.some(note => !note || note.companyId !== companyId || note.documentType !== '03' ||
        note.isCancelled || String(note.supplierRif || '').trim().toUpperCase() !== rif ||
        Number(note.supplierAdvanceUsd || 0) <= 0)) {
      throw new Error('SQLite rechazó una liquidación vinculada a notas de crédito inexistentes, reversadas o de otro proveedor.');
    }
    const directAdvanceById = new Map(asArray(nextState.supplierDirectAdvances).map(item => [String(item.id), item]));
    const sourceDirectAdvances = directAllocations.map(allocation => directAdvanceById.get(String(allocation.directAdvanceId)));
    if (sourceDirectAdvances.some(source => !source || source.companyId !== companyId || (source.isReversed && !settlement.isReversed) ||
        String(source.supplierRif || '').trim().toUpperCase() !== rif ||
        Number(source.amountUsd || 0) <= 0)) {
      throw new Error('SQLite rechazó una liquidación vinculada a un anticipo directo inexistente, reversado o de otra empresa/proveedor.');
    }
    if (!settlement.isReversed) {
      for (const allocation of allocations) {
        const key = companyId + '|' + allocation.creditNoteId;
        const used = advanceAllocationsByNote.get(key) || { usd: 0, bs: 0 };
        used.usd += Number(allocation.amountUsd);
        used.bs += Number(allocation.bookValueBs);
        advanceAllocationsByNote.set(key, used);
      }
      for (const allocation of directAllocations) {
        const key = companyId + '|' + allocation.directAdvanceId;
        const used = advanceAllocationsByDirect.get(key) || { usd: 0, bs: 0 };
        used.usd += Number(allocation.amountUsd);
        used.bs += Number(allocation.bookValueBs);
        advanceAllocationsByDirect.set(key, used);
      }
    }
    const journal = nextById.get(String(settlement.journalEntryId || ''));
    if (!journal || journal.companyId !== companyId || journal.type !== 'ANTICIPO_PROVEEDOR' ||
        journal.date !== settlement.date || !Array.isArray(journal.items) || journal.items.length < 2) {
      throw new Error('SQLite rechazó una liquidación sin asiento ANTICIPO_PROVEEDOR válido y enlazado.');
    }
    const totals = journal.items.reduce((acc, item) => ({
      debitBs: acc.debitBs + Number(item.debitBs || 0), creditBs: acc.creditBs + Number(item.creditBs || 0),
      debitUsd: acc.debitUsd + Number(item.debitUsd || 0), creditUsd: acc.creditUsd + Number(item.creditUsd || 0)
    }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    const advanceCredit = journal.items.reduce((sum, item) =>
      sum + (item.accountCode === '1.1.2.03' ? Number(item.creditBs || 0) : 0), 0);
    const advanceCreditUsd = journal.items.reduce((sum, item) =>
      sum + (item.accountCode === '1.1.2.03' ? Number(item.creditUsd || 0) : 0), 0);
    if (Math.abs(totals.debitBs - totals.creditBs) >= 0.01 ||
        Math.abs(totals.debitUsd - totals.creditUsd) >= 0.01 ||
        Math.abs(totals.debitUsd - amountUsd) >= 0.0001 ||
        Math.abs(totals.creditUsd - amountUsd) >= 0.0001 ||
        Math.abs(advanceCredit - bookBs) >= 0.01 ||
        Math.abs(advanceCreditUsd - amountUsd) >= 0.0001) {
      throw new Error('SQLite rechazó un asiento de anticipo descuadrado o que no descarga el valor histórico correcto.');
    }
    if (settlement.kind === 'REFUND_RECEIVED') {
      const bank = nextBankAccounts.find(item => item.companyId === companyId && item.accountCode === settlement.treasuryAccountCode && (!item.currency || item.currency === 'BS'));
      const treasuryAccount = asArray(nextState.accounts).find(item => item.code === settlement.treasuryAccountCode);
      const validCashAccount = treasuryAccount && treasuryAccount.type === 'ACTIVO' &&
        treasuryAccount.isMovement === true && treasuryAccount.code === '1.1.1.01';
      const cashReceivedBs = Number(settlement.cashReceivedBs ?? 0);
      const treasuryDebit = journal.items.reduce((sum, item) =>
        sum + (item.accountCode === settlement.treasuryAccountCode ? Number(item.debitBs || 0) : 0), 0);
      const expectedFx = Math.round((cashReceivedBs - bookBs) * 100) / 100;
      const gainBs = journal.items.filter(item => item.accountCode === '4.2.1.01')
        .reduce((sum, item) => sum + Number(item.creditBs || 0) - Number(item.debitBs || 0), 0);
      const lossBs = journal.items.filter(item => item.accountCode === '6.1.1.08')
        .reduce((sum, item) => sum + Number(item.debitBs || 0) - Number(item.creditBs || 0), 0);
      const allowedCodes = new Set([settlement.treasuryAccountCode, '1.1.2.03',
        ...(expectedFx > 0.009 ? ['4.2.1.01'] : expectedFx < -0.009 ? ['6.1.1.08'] : [])]);
      if ((!bank && !validCashAccount) || cashReceivedBs <= 0 ||
          Math.abs(treasuryDebit - cashReceivedBs) >= 0.01 ||
          journal.items.some(item => !allowedCodes.has(item.accountCode)) ||
          Math.abs(gainBs - Math.max(0, expectedFx)) >= 0.01 ||
          Math.abs(lossBs - Math.max(0, -expectedFx)) >= 0.01) {
        throw new Error('SQLite rechazó un reembolso de anticipo cuya cuenta de tesorería, efectivo recibido o diferencial cambiario no concilian exactamente.');
      }
    } else {
      const target = purchaseById.get(String(settlement.targetPurchaseId || ''));
      const originalPurchaseJournal = target?.journalEntryId
        ? priorById.get(String(target.journalEntryId))
        : undefined;
      const payableCandidates = originalPurchaseJournal && originalPurchaseJournal.companyId === companyId &&
        originalPurchaseJournal.type === (target?.documentType === '02' ? 'AJUSTE' : 'COMPRA') && Array.isArray(originalPurchaseJournal.items)
        ? originalPurchaseJournal.items.filter(item =>
            Number(item.creditBs || 0) > 0 &&
            String(item.accountCode || '').startsWith('2.1.1.') &&
            /(proveedor|cuentas por pagar|neto a pagar)/i.test(String(item.description || '')))
        : [];
      const payableCodes = [...new Set(payableCandidates.map(item => String(item.accountCode)))];
      const targetPayableCode = payableCodes.length === 1 ? payableCodes[0] : '';
      const payableDebitBs = targetPayableCode
        ? journal.items.filter(item => item.accountCode === targetPayableCode)
            .reduce((sum, item) => sum + Number(item.debitBs || 0), 0)
        : 0;
      const payableDebitUsd = targetPayableCode
        ? journal.items.filter(item => item.accountCode === targetPayableCode)
            .reduce((sum, item) => sum + Number(item.debitUsd || 0), 0)
        : 0;
      const payableCreditBs = targetPayableCode
        ? journal.items.filter(item => item.accountCode === targetPayableCode)
            .reduce((sum, item) => sum + Number(item.creditBs || 0), 0)
        : 0;
      const payableCreditUsd = targetPayableCode
        ? journal.items.filter(item => item.accountCode === targetPayableCode)
            .reduce((sum, item) => sum + Number(item.creditUsd || 0), 0)
        : 0;
      const invoiceRate = Number(target?.bcvRate) > 0
        ? Number(target.bcvRate)
        : (Number(target?.totalAmountUsd) > 0 ? Number(target.totalAmountBs) / Number(target.totalAmountUsd) : 0);
      const expectedPayableDebitBs = Math.round(amountUsd * invoiceRate * 100) / 100;
      const advanceDebitBs = journal.items.filter(item => item.accountCode === '1.1.2.03')
        .reduce((sum, item) => sum + Number(item.debitBs || 0), 0);
      const advanceDebitUsd = journal.items.filter(item => item.accountCode === '1.1.2.03')
        .reduce((sum, item) => sum + Number(item.debitUsd || 0), 0);
      const expectedFx = Math.round((expectedPayableDebitBs - bookBs) * 100) / 100;
      const gainBs = journal.items.filter(item => item.accountCode === '4.2.1.01')
        .reduce((sum, item) => sum + Number(item.creditBs || 0) - Number(item.debitBs || 0), 0);
      const lossBs = journal.items.filter(item => item.accountCode === '6.1.1.08')
        .reduce((sum, item) => sum + Number(item.debitBs || 0) - Number(item.creditBs || 0), 0);
      const allowedCodes = new Set([targetPayableCode, '1.1.2.03',
        ...(expectedFx > 0.009 ? ['4.2.1.01'] : expectedFx < -0.009 ? ['6.1.1.08'] : [])]);
      if (!target || target.companyId !== companyId || !['01', '02'].includes(target.documentType) || target.paymentTerm !== 'CREDITO' || target.isCancelled ||
          String(target.supplierRif || '').trim().toUpperCase() !== rif ||
          !targetPayableCode || payableDebitBs <= 0 ||
          Math.abs(payableDebitBs - expectedPayableDebitBs) > 0.02 ||
          Math.abs(payableDebitUsd - amountUsd) > 0.0001 ||
          payableCreditBs > 0.02 || payableCreditUsd > 0.0001 ||
          advanceDebitBs > 0.02 || advanceDebitUsd > 0.0001 || !Number.isFinite(invoiceRate) || invoiceRate <= 0 ||
          journal.items.some(item => !allowedCodes.has(item.accountCode)) ||
          Math.abs(gainBs - Math.max(0, expectedFx)) >= 0.01 ||
          Math.abs(lossBs - Math.max(0, -expectedFx)) >= 0.01) {
        throw new Error('SQLite rechazó la aplicación de anticipo: la factura, CxP y el diferencial cambiario no concilian exactamente.');
      }
    }
    if (settlement.isReversed) {
      const reversal = settlement.reversedByJournalEntryId
        ? nextById.get(String(settlement.reversedByJournalEntryId))
        : undefined;
      if (!reversal || reversal.companyId !== companyId || reversal.reversalOfEntryId !== journal.id) {
        throw new Error('SQLite rechazó la reversión de anticipo sin contra-asiento vinculado.');
      }
    }
    if (!settlement.isReversed) {
      const key = companyId + '|' + rif;
      const current = advanceTotals.get(key) || { usd: 0, bs: 0 };
      current.usd += amountUsd;
      current.bs += bookBs;
      advanceTotals.set(key, current);
    }
  }
  for (const [key, used] of advanceTotals) {
    const [companyId, rif] = key.split('|');
    const credits = asArray(nextState.purchases).filter(item =>
      item.companyId === companyId && item.documentType === '03' && !item.isCancelled &&
      String(item.supplierRif || '').trim().toUpperCase() === rif);
    const direct = asArray(nextState.supplierDirectAdvances).filter(item =>
      item.companyId === companyId && !item.isReversed &&
      String(item.supplierRif || '').trim().toUpperCase() === rif);
    const availableUsd = credits.reduce((sum, item) => sum + Number(item.supplierAdvanceUsd || 0), 0) +
      direct.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const availableBs = credits.reduce((sum, item) => sum + Number(item.supplierAdvanceBs || 0), 0) +
      direct.reduce((sum, item) => sum + Number(item.bookValueBs || 0), 0);
    if (used.usd > availableUsd + 0.00001 || used.bs > availableBs + 0.02) {
      throw new Error('SQLite rechazó liquidaciones de anticipos que exceden los saldos de notas de crédito y desembolsos directos.');
    }
  }
  for (const [key, used] of advanceAllocationsByNote) {
    const [companyId, noteId] = key.split('|');
    const note = purchaseById.get(noteId);
    if (!note || used.usd > Number(note.supplierAdvanceUsd || 0) + 0.00001 ||
        used.bs > Number(note.supplierAdvanceBs || 0) + 0.02) {
      throw new Error('SQLite rechazó liquidaciones que exceden el saldo individual de una nota de crédito.');
    }
  }
  const directAdvanceByIdForCaps = new Map(asArray(nextState.supplierDirectAdvances).map(item => [String(item.id), item]));
  for (const [key, used] of advanceAllocationsByDirect) {
    const [companyId, directId] = key.split('|');
    const source = directAdvanceByIdForCaps.get(directId);
    if (!source || source.companyId !== companyId ||
        used.usd > Number(source.amountUsd || 0) + 0.00001 ||
        used.bs > Number(source.bookValueBs || 0) + 0.02) {
      throw new Error('SQLite rechazó liquidaciones que exceden el saldo individual de un desembolso directo.');
    }
  }
  // Cash payments, credit notes and supplier advances must share one AP ceiling.
  for (const purchase of asArray(nextState.purchases).filter(item =>
    ['01', '02'].includes(item.documentType) && item.paymentTerm === 'CREDITO' && !item.isCancelled)) {
    const paidUsd = asArray(nextState.creditSettlements).filter(item =>
      item.companyId === purchase.companyId && item.documentId === purchase.id &&
      item.kind === 'PURCHASE_PAYMENT' && !item.isReversed)
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const creditedUsd = asArray(nextState.purchases).filter(item =>
      item.companyId === purchase.companyId && item.originalPurchaseId === purchase.id &&
      item.documentType === '03' && !item.isCancelled)
      .reduce((sum, item) => sum + Number(item.netPayableReductionUsd || 0), 0);
    const appliedUsd = advanceSettlements.filter(item =>
      item.companyId === purchase.companyId && item.kind === 'APPLIED_TO_PURCHASE' &&
      item.targetPurchaseId === purchase.id && !item.isReversed)
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const netUsd = Number(purchase.totalAmountUsd) -
      Number(purchase.vatWithheldUsd || 0) - Number(purchase.islrWithheldUsd || 0);
    const appliedTotalUsd = paidUsd + creditedUsd + appliedUsd;
    if (exceedsUsdPayable(appliedTotalUsd, netUsd)) {
      const documentLabel = purchase.documentType === '02' ? 'ND' : 'factura';
      const documentNumber = String(purchase.debitNoteNumber || purchase.invoiceNumber || purchase.id || 'sin número');
      throw new Error(
        'SQLite rechazó aplicaciones de CxP en ' + documentLabel + ' ' + documentNumber +
        ' (empresa ' + String(purchase.companyId || 'sin identificar') + '): pagos ' + paidUsd.toFixed(6) +
        ' USD + notas de crédito ' + creditedUsd.toFixed(6) +
        ' USD + anticipos ' + appliedUsd.toFixed(6) +
        ' USD = ' + appliedTotalUsd.toFixed(6) +
        ' USD; principal neto ' + netUsd.toFixed(6) + ' USD.'
      );
    }
  }

  // Direct supplier advances are append-only financial source records.
  const directAdvances = asArray(nextState.supplierDirectAdvances);
  const priorDirectAdvances = asArray(previousState.supplierDirectAdvances);
  const priorDirectById = new Map(priorDirectAdvances.map(item => [String(item.id), item]));
  const directIds = new Set();
  const accountsByCode = new Map(asArray(nextState.accounts).map(item => [String(item.code), item]));
  for (const advance of directAdvances) {
    const id = String(advance.id || '');
    const companyId = String(advance.companyId || '');
    const rif = String(advance.supplierRif || '').trim().toUpperCase();
    const amountUsd = Number(advance.amountUsd);
    const bookValueBs = Number(advance.bookValueBs);
    const rate = Number(advance.bcvRate);
    const paidAmount = Number(advance.paidAmount);
    const account = accountsByCode.get(String(advance.treasuryAccountCode || ''));
    if (!id || directIds.has(id) || !companyId || !rif ||
        !isValidIsoDate(advance.date) ||
        !Number.isFinite(amountUsd) || amountUsd <= 0 ||
        !Number.isFinite(bookValueBs) || bookValueBs <= 0 ||
        !Number.isFinite(rate) || rate <= 0 ||
        Math.abs(bookValueBs - money(amountUsd * rate)) > 0.02 ||
        !['BS', 'USD'].includes(advance.paymentCurrency) ||
        !Number.isFinite(paidAmount) || paidAmount <= 0 ||
        Math.abs(paidAmount - (advance.paymentCurrency === 'USD' ? amountUsd : bookValueBs)) > 0.02 ||
        !String(advance.reference || '').trim() || !String(advance.support || '').trim() ||
        !account || account.type !== 'ACTIVO' || !account.isMovement ||
        !String(account.code).startsWith('1.1.1.') ||
        !String(advance.journalEntryId || '').trim()) {
      throw new Error('SQLite rechazó un anticipo directo con proveedor, fecha, importes, moneda, referencia o cuenta de tesorería inválidos.');
    }
    directIds.add(id);
    const journal = nextById.get(String(advance.journalEntryId));
    const advanceAccount = accountsByCode.get('1.1.2.03');
    const debitAdvanceBs = (journal?.items || []).filter(item => item.accountCode === '1.1.2.03')
      .reduce((sum, item) => sum + Number(item.debitBs || 0) - Number(item.creditBs || 0), 0);
    const debitAdvanceUsd = (journal?.items || []).filter(item => item.accountCode === '1.1.2.03')
      .reduce((sum, item) => sum + Number(item.debitUsd || 0) - Number(item.creditUsd || 0), 0);
    const treasuryCreditBs = (journal?.items || []).filter(item => item.accountCode === advance.treasuryAccountCode)
      .reduce((sum, item) => sum + Number(item.creditBs || 0) - Number(item.debitBs || 0), 0);
    const treasuryCreditUsd = (journal?.items || []).filter(item => item.accountCode === advance.treasuryAccountCode)
      .reduce((sum, item) => sum + Number(item.creditUsd || 0) - Number(item.debitUsd || 0), 0);
    if (!advanceAccount || advanceAccount.type !== 'ACTIVO' || !advanceAccount.isMovement ||
        !journal || journal.companyId !== companyId || journal.type !== 'ANTICIPO_PROVEEDOR' ||
        journal.date !== advance.date || journal.referenceDoc !== advance.reference ||
        !Array.isArray(journal.items) || journal.items.length !== 2 ||
        Math.abs(debitAdvanceBs - bookValueBs) > 0.02 ||
        Math.abs(debitAdvanceUsd - amountUsd) > 0.0001 ||
        Math.abs(treasuryCreditBs - bookValueBs) > 0.02 ||
        Math.abs(treasuryCreditUsd - amountUsd) > 0.0001) {
      throw new Error('SQLite rechazó un anticipo directo cuyo asiento no debita Anticipos a proveedores y acredita Caja/Banco por los importes exactos.');
    }
    const old = priorDirectById.get(id);
    if (old) {
      const immutable = item => {
        const copy = { ...item };
        delete copy.isReversed;
        delete copy.reversedByJournalEntryId;
        return copy;
      };
      if (JSON.stringify(immutable(old)) !== JSON.stringify(immutable(advance)) ||
          (old.isReversed && (!advance.isReversed || advance.reversedByJournalEntryId !== old.reversedByJournalEntryId))) {
        throw new Error('SQLite bloqueó la modificación de un anticipo directo histórico; debe corregirse mediante contra-asiento.');
      }
    }
    if (!advance.isReversed && advance.reversedByJournalEntryId) {
      throw new Error('SQLite rechazó un enlace de reversión de anticipo directo sin marca de reversión.');
    }
    if (advance.isReversed) {
      const reversal = advance.reversedByJournalEntryId
        ? nextById.get(String(advance.reversedByJournalEntryId))
        : undefined;
      if (!reversal || reversal.companyId !== companyId || reversal.reversalOfEntryId !== journal.id) {
        throw new Error('SQLite rechazó la reversión del anticipo directo sin contra-asiento vinculado.');
      }
    }
  }
  for (const old of priorDirectAdvances) {
    if (!directIds.has(String(old.id))) {
      throw new Error('SQLite bloqueó la eliminación de un anticipo directo histórico; debe conservarse su trazabilidad.');
    }
  }

  return { priorEntries, nextEntries, priorById, nextById };
}

module.exports = { validateAccountingSnapshot, validateNewAccountCatalogEntries, exceedsUsdPayable };
