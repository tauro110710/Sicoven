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




function buildVatOwnSourceSnapshotsFromState(state, companyId, sourceIds) {
  const sales = asArray(state.sales);
  const purchases = asArray(state.purchases);
  const journalEntries = asArray(state.journalEntries);
  const snapshots = {};
  const journalSnapshot = entry => entry ? {
    id: entry.id, entryNumber: entry.entryNumber, date: entry.date, referenceDoc: entry.referenceDoc, type: entry.type,
    bcvRate: entry.bcvRate, description: entry.description,
    reversalOfEntryId: entry.reversalOfEntryId || null, reversedByEntryId: entry.reversedByEntryId || null,
    items: asArray(entry.items).map(line => ({
      accountCode: line.accountCode, debitBs: line.debitBs, creditBs: line.creditBs,
      debitUsd: line.debitUsd, creditUsd: line.creditUsd, description: line.description
    }))
  } : null;
  for (const id of [...new Set(sourceIds)].sort()) {
    const sale = sales.find(item => item.id === id && item.companyId === companyId);
    if (sale) {
      snapshots[id] = JSON.stringify({
        kind: 'SALE', id: sale.id, invoiceDate: sale.invoiceDate, documentType: sale.documentType,
        invoiceNumber: sale.invoiceNumber, controlNumber: sale.controlNumber, customerRif: sale.customerRif, customerName: sale.customerName,
        totalAmountBs: sale.totalAmountBs, totalAmountUsd: sale.totalAmountUsd, taxableBaseBs: sale.taxableBaseBs, taxableBaseUsd: sale.taxableBaseUsd,
        exemptAmountBs: sale.exemptAmountBs, exemptAmountUsd: sale.exemptAmountUsd || 0, taxRate: sale.taxRate,
        vatAmountBs: sale.vatAmountBs, vatAmountUsd: sale.vatAmountUsd, additionalLuxuryTaxBs: sale.additionalLuxuryTaxBs || 0,
        additionalLuxuryTaxUsd: sale.additionalLuxuryTaxUsd || 0, igtfApplicable: Boolean(sale.igtfApplicable), igtfRate: sale.igtfRate || 0,
        igtfAmountBs: sale.igtfAmountBs || 0, igtfAmountUsd: sale.igtfAmountUsd || 0,
        vatWithheldBs: sale.vatWithheldBs, vatWithheldUsd: sale.vatWithheldUsd, retentionRate: sale.retentionRate || 0,
        retentionVoucherNumber: sale.retentionVoucherNumber || null, retentionVoucherDate: sale.retentionVoucherDate || null,
        bcvRate: sale.bcvRate, journalEntryId: sale.journalEntryId || null, originalSaleId: sale.originalSaleId || null,
        affectedInvoiceNumber: sale.affectedInvoiceNumber || null, affectedInvoiceDate: sale.affectedInvoiceDate || null,
        affectedInvoiceControlNumber: sale.affectedInvoiceControlNumber || null, isCancelled: Boolean(sale.isCancelled),
        journal: journalSnapshot(journalEntries.find(entry => entry.id === sale.journalEntryId && entry.companyId === companyId))
      });
      continue;
    }
    const purchase = purchases.find(item => item.id === id && item.companyId === companyId);
    if (purchase) {
      snapshots[id] = JSON.stringify({
        kind: 'PURCHASE', id: purchase.id, invoiceDate: purchase.invoiceDate, accountCreditDate: purchase.accountCreditDate || null,
        documentType: purchase.documentType, invoiceNumber: purchase.invoiceNumber, controlNumber: purchase.controlNumber,
        supplierRif: purchase.supplierRif, supplierName: purchase.supplierName, totalAmountBs: purchase.totalAmountBs, totalAmountUsd: purchase.totalAmountUsd,
        taxableBaseBs: purchase.taxableBaseBs, taxableBaseUsd: purchase.taxableBaseUsd, exemptAmountBs: purchase.exemptAmountBs,
        exemptAmountUsd: purchase.exemptAmountUsd || 0, taxRate: purchase.taxRate, vatAmountBs: purchase.vatAmountBs, vatAmountUsd: purchase.vatAmountUsd,
        additionalLuxuryTaxBs: purchase.additionalLuxuryTaxBs || 0, additionalLuxuryTaxUsd: purchase.additionalLuxuryTaxUsd || 0,
        igtfApplicable: Boolean(purchase.igtfApplicable), igtfRate: purchase.igtfRate || 0,
        igtfAmountBs: purchase.igtfAmountBs || 0, igtfAmountUsd: purchase.igtfAmountUsd || 0,
        vatCreditTreatment: purchase.vatCreditTreatment || 'COMMON',
        vatWithheldBs: purchase.vatWithheldBs, vatWithheldUsd: purchase.vatWithheldUsd, retentionRate: purchase.retentionRate || 0,
        voucherNumber: purchase.voucherNumber || null, bcvRate: purchase.bcvRate, journalEntryId: purchase.journalEntryId || null,
        originalPurchaseId: purchase.originalPurchaseId || null, affectedInvoiceNumber: purchase.affectedInvoiceNumber || null,
        affectedInvoiceDate: purchase.affectedInvoiceDate || null, affectedInvoiceControlNumber: purchase.affectedInvoiceControlNumber || null,
        affectedInvoiceTotalAmountBs: purchase.affectedInvoiceTotalAmountBs ?? null,
        affectedInvoiceTotalAmountUsd: purchase.affectedInvoiceTotalAmountUsd ?? null,
        inventoryLines: asArray(purchase.inventoryLines).map(line => ({ ...line })),
        creditNoteLines: asArray(purchase.creditNoteLines).map(line => ({ ...line })),
        isCancelled: Boolean(purchase.isCancelled),
        journal: journalSnapshot(journalEntries.find(entry => entry.id === purchase.journalEntryId && entry.companyId === companyId))
      });
      continue;
    }
    const zEntry = journalEntries.find(entry => entry.id === id && entry.companyId === companyId && Boolean(entry.fiscalZReport));
    snapshots[id] = zEntry ? JSON.stringify({
      kind: 'Z', id: zEntry.id, date: zEntry.date, referenceDoc: zEntry.referenceDoc,
      fiscalZReport: zEntry.fiscalZReport, journal: journalSnapshot(zEntry)
    }) : JSON.stringify({ kind: 'MISSING', id });
  }
  return snapshots;
}

function validateVatOwnDeclarationLedger(previousState, nextState) {
  const priorDeclarations = asArray(previousState.vatOwnDeclarations);
  const declarations = asArray(nextState.vatOwnDeclarations);
  const events = asArray(nextState.vatOwnDeclarationEvents);
  const companies = new Map(asArray(nextState.companies).map(item => [String(item.id), item]));
  const journals = new Map(asArray(nextState.journalEntries).map(item => [String(item.id), item]));
  const declarationById = new Map();
  const periodKeys = new Set();
  const filedNumbers = new Set();
  const timestampIsValid = value => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) && validVatDeclarationDate(value.slice(0, 10));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const normalizeRevisions = value => Array.isArray(value) ? value : [];
  const priorEventIds = new Set(asArray(previousState.vatOwnDeclarationEvents).map(item => String(item.id)));
  const resolveHistoricalRate = (company, date) => {
    const history = asArray(company?.accountingBcvRateHistory).filter(item =>
      validVatDeclarationDate(item.effectiveDate) && item.effectiveDate <= date &&
      Number.isFinite(Number(item.rate)) && Number(item.rate) > 0 &&
      Number.isFinite(Date.parse(item.recordedAt))
    ).sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)) ||
      String(b.recordedAt).localeCompare(String(a.recordedAt)));
    return history.length ? Number(history[0].rate) : null;
  };

  for (const declaration of declarations) {
    const id = String(declaration.id || '');
    const companyId = String(declaration.companyId || '');
    const period = String(declaration.period || '');
    if (!id || declarationById.has(id) || !companies.has(companyId) ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(period) ||
        !['DRAFT', 'FILED'].includes(declaration.status) ||
        !timestampIsValid(declaration.createdAt)) {
      throw new Error('SQLite rechazó una declaración mensual de IVA propia con empresa, período, estado o identificador inválido.');
    }
    const periodKey = companyId + ':' + period;
    if (periodKeys.has(periodKey)) throw new Error('SQLite rechazó dos declaraciones mensuales de IVA propio para la misma empresa y período.');
    periodKeys.add(periodKey);
    declarationById.set(id, declaration);

    const sourceIds = asArray(declaration.sourceIds).map(String);
    const relatedIds = asArray(declaration.relatedSourceIds).map(String);
    if (sourceIds.some(value => !value.trim()) || new Set(sourceIds).size !== sourceIds.length ||
        relatedIds.some(value => !value.trim()) || new Set(relatedIds).size !== relatedIds.length ||
        relatedIds.some(value => sourceIds.includes(value))) {
      throw new Error('SQLite rechazó fuentes fiscales duplicadas, vacías o mezcladas en la declaración IVA propia.');
    }
    if (!Number.isFinite(Number(declaration.bcvRate)) || Number(declaration.bcvRate) <= 0) {
      throw new Error('SQLite rechazó una declaración IVA propia sin tasa BCV válida.');
    }
    const position = declaration.position;
    if (!position || typeof position !== 'object' ||
        Object.values(position).some(value => typeof value !== 'number' || !Number.isFinite(value)) ||
        Object.entries(position).some(([field, value]) => field !== 'netTaxBs' && Number(value) < 0) ||
        position.amountDueBs < 0 || position.creditCarryForwardBs < 0 ||
        position.prorationRate < 0 || position.prorationRate > 1 ||
        (position.amountDueBs > 0.02 && position.creditCarryForwardBs > 0.02)) {
      throw new Error('SQLite rechazó una posición fiscal IVA con importes no finitos, negativos o incompatibles.');
    }
    const reclassifications = asArray(declaration.purchaseVatReclassificationItems);
    let debitBs = 0, creditBs = 0, debitUsd = 0, creditUsd = 0;
    for (const line of reclassifications) {
      const values = [line.debitBs, line.creditBs, line.debitUsd, line.creditUsd].map(Number);
      if (!String(line.accountCode || '').trim() || values.some(value => !Number.isFinite(value) || value < 0) ||
          (values[0] > 0 && values[1] > 0) || (values[2] > 0 && values[3] > 0) ||
          Math.abs(values[2] - values[0] / Number(declaration.bcvRate)) > 0.0001 ||
          Math.abs(values[3] - values[1] / Number(declaration.bcvRate)) > 0.0001) {
        throw new Error('SQLite rechazó una línea inválida de reclasificación de IVA no acreditable o con conversión Bs/USD inconsistente.');
      }
      debitBs += values[0]; creditBs += values[1]; debitUsd += values[2]; creditUsd += values[3];
    }
    if (Math.abs(debitBs - creditBs) > 0.02 || Math.abs(debitUsd - creditUsd) > 0.000001) {
      throw new Error('SQLite rechazó reclasificaciones de IVA no acreditable que no cuadran en ambas monedas.');
    }
    if (declaration.sourceSnapshots) {
      const p = position;
      const near = (actual, expected, tolerance = 0.02) =>
        Number.isFinite(Number(actual)) && Math.abs(Number(actual) - Number(expected)) <= tolerance;
      const previousFiled = declarations.filter(item =>
        item.companyId === companyId && item.status === 'FILED' && item.period < period
      ).sort((a, b) => b.period.localeCompare(a.period))[0];
      const priorCreditAvailable = Number(previousFiled?.position?.creditCarryForwardBs || 0);
      const hasCommonCurrentPurchases = asArray(declaration.sourceIds).some(sourceId => {
        const raw = declaration.sourceSnapshots?.[sourceId];
        if (typeof raw !== 'string') return false;
        let snapshot;
        try { snapshot = JSON.parse(raw); } catch { return false; }
        return snapshot?.kind === 'PURCHASE' && ['01', '02'].includes(String(snapshot.documentType)) &&
          snapshot.vatCreditTreatment === 'COMMON' && Number(snapshot.vatAmountBs || 0) > 0;
      });
      const salesBase = Number(p.taxableSalesBaseBs) + Number(p.exemptSalesBaseBs);
      const expectedProrationRate = !hasCommonCurrentPurchases ? 1
        : salesBase > 0 ? Number(p.taxableSalesBaseBs) / salesBase : null;
      const balanceBeforePriorCredit = Number(p.outputVatBs) + Number(p.debitAdjustmentsBs) +
        Number(p.purchaseCreditReversalBs) - Number(p.purchaseCreditBs) -
        Number(p.receivedWithholdingsBs) - Number(p.creditAdjustmentsBs);
      const expectedPriorApplied = Math.min(priorCreditAvailable, Math.max(0, balanceBeforePriorCredit));
      const expectedNetTax = balanceBeforePriorCredit - expectedPriorApplied;
      const expectedCarryForward = Math.max(0, -expectedNetTax) + (priorCreditAvailable - expectedPriorApplied);
      if (!near(p.outputVat16Bs + p.outputVat8Bs, p.outputVatBs) ||
          !near(p.purchaseCredit16Bs + p.purchaseCredit8Bs, p.purchaseCreditBs) ||
          !near(p.purchaseCreditGross16Bs + p.purchaseCreditGross8Bs, p.purchaseCreditGrossBs) ||
          !near(p.purchaseCreditGrossBs - p.purchaseCreditBs, p.purchaseCreditNonEligibleBs) ||
          !near(p.purchaseCreditReversal16Bs + p.purchaseCreditReversal8Bs, p.purchaseCreditReversalBs) ||
          !near(p.purchaseCreditReversalNonEligible16Bs + p.purchaseCreditReversalNonEligible8Bs, p.purchaseCreditReversalNonEligibleBs) ||
          !near(p.creditAdjustments16Bs + p.creditAdjustments8Bs, p.creditAdjustmentsBs) ||
          expectedProrationRate === null || !near(p.prorationRate, expectedProrationRate, 0.000001) ||
          !near(p.priorCreditAppliedBs, expectedPriorApplied) ||
          !near(p.netTaxBs, expectedNetTax) ||
          !near(p.amountDueBs, Math.max(0, expectedNetTax)) ||
          !near(p.creditCarryForwardBs, expectedCarryForward)) {
        throw new Error('SQLite rechazó una posición IVA cuyo desglose, crédito anterior, impuesto por enterar o saldo trasladable no concilia.');
      }
    }
    if (declaration.sourceSnapshots !== undefined) {
      const snapshots = declaration.sourceSnapshots;
      const expectedIds = [...new Set([...sourceIds, ...relatedIds])].sort();
      if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots) ||
          !equal(Object.keys(snapshots).sort(), expectedIds)) {
        throw new Error('SQLite rechazó huellas documentales IVA que no corresponden exactamente a las fuentes del borrador.');
      }
      for (const [sourceId, value] of Object.entries(snapshots)) {
        if (typeof value !== 'string') throw new Error('SQLite rechazó una huella fiscal de IVA no válida.');
        let parsed;
        try { parsed = JSON.parse(value); } catch { throw new Error('SQLite rechazó una huella fiscal IVA ilegible.'); }
        if (!parsed || !['SALE', 'PURCHASE', 'Z'].includes(parsed.kind) || String(parsed.id || '') !== String(sourceId)) {
          throw new Error('SQLite rechazó una huella fiscal IVA sin tipo de documento reconocido.');
        }
      }
    }
    const revisions = normalizeRevisions(declaration.revisions);
    if (revisions.some((revision, index) => revision.revision !== index + 1 ||
        !timestampIsValid(revision.revisedAt) || !String(revision.reason || '').trim() ||
        !revision.position || !Array.isArray(revision.sourceIds))) {
      throw new Error('SQLite rechazó el historial de versiones del borrador IVA.');
    }
    if (declaration.status === 'FILED') {
      if (!String(declaration.declarationNumber || '').trim() || !timestampIsValid(declaration.filedAt)) {
        throw new Error('SQLite rechazó una declaración IVA presentada sin número oficial o fecha válida.');
      }
      const numberKey = companyId + ':' + String(declaration.declarationNumber).trim();
      if (filedNumbers.has(numberKey)) throw new Error('SQLite rechazó un número oficial de declaración IVA duplicado en la empresa.');
      filedNumbers.add(numberKey);
    } else if (declaration.declarationNumber || declaration.filedAt) {
      throw new Error('SQLite rechazó un borrador IVA que conserva número oficial o fecha de presentación.');
    }
  }

  const priorById = new Map(priorDeclarations.map(item => [String(item.id), item]));
  const filedPeriodKeys = new Set(declarations
    .filter(item => item.status === 'FILED')
    .map(item => String(item.companyId) + ':' + String(item.period)));
  const reversedJournalIds = new Set(asArray(nextState.journalEntries)
    .filter(entry => entry.reversalOfEntryId).map(entry => String(entry.reversalOfEntryId)));
  const activityPeriodsByCompany = new Map();
  const addActivityDate = (companyId, date) => {
    // This collector only discovers months with fiscal activity; it is not the
    // source-of-truth validator for each document's date. Missing or malformed
    // legacy dates are left to the owning sales/purchases/journal validators.
    if (!date || !validVatDeclarationDate(date)) return;
    const key = String(companyId);
    if (!activityPeriodsByCompany.has(key)) activityPeriodsByCompany.set(key, new Set());
    activityPeriodsByCompany.get(key).add(date.slice(0, 7));
  };
  for (const sale of asArray(nextState.sales)) {
    if (sale.isCancelled) continue;
    addActivityDate(sale.companyId, sale.invoiceDate);
    if (sale.retentionVoucherDate) addActivityDate(sale.companyId, sale.retentionVoucherDate);
  }
  for (const purchase of asArray(nextState.purchases)) {
    if (!purchase.isCancelled) addActivityDate(purchase.companyId, purchase.invoiceDate);
  }
  for (const entry of asArray(nextState.journalEntries)) {
    if (entry.fiscalZReport && !reversedJournalIds.has(String(entry.id)) && !entry.reversalOfEntryId) {
      addActivityDate(entry.companyId, entry.fiscalZReport.date || entry.date);
    }
  }
  for (const declaration of declarations) {
    const previous = priorById.get(String(declaration.id));
    const newlyPresented = declaration.status === 'FILED' && previous?.status === 'DRAFT';
    if (!declaration.sourceSnapshots || (declaration.status !== 'DRAFT' && !newlyPresented)) continue;
    const companyId = String(declaration.companyId);
    if (newlyPresented) {
      const currentSnapshots = buildVatOwnSourceSnapshotsFromState(nextState, companyId,
        [...asArray(declaration.sourceIds), ...asArray(declaration.relatedSourceIds)]);
      if (!equal(declaration.sourceSnapshots, currentSnapshots)) {
        throw new Error('SQLite bloqueó la presentación IVA: las huellas fiscales del borrador ya no coinciden con los documentos y asientos actuales.');
      }
    }
    const knownPeriods = new Set([...(activityPeriodsByCompany.get(companyId) || [])]
      .filter(period => period < declaration.period));
    for (const item of declarations) {
      if (String(item.companyId) === companyId && item.period < declaration.period) knownPeriods.add(item.period);
    }
    for (const key of filedPeriodKeys) {
      const separator = key.lastIndexOf(':');
      if (key.slice(0, separator) === companyId) {
        const filedPeriod = key.slice(separator + 1);
        if (filedPeriod < declaration.period) knownPeriods.add(filedPeriod);
      }
    }
    const missingPeriods = [];
    if (knownPeriods.size > 0) {
      let cursor = [...knownPeriods].sort()[0];
      while (cursor < declaration.period) {
        if (!filedPeriodKeys.has(companyId + ':' + cursor)) missingPeriods.push(cursor);
        const [year, month] = cursor.split('-').map(Number);
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        cursor = String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0');
      }
    }
    if (missingPeriods.length > 0) {
      throw new Error('SQLite bloqueó la declaración IVA: existen períodos anteriores con actividad fiscal sin presentar; faltan declaraciones mensuales (' + missingPeriods.join(', ') + ').');
    }
    const laterFiled = declarations.some(item =>
      item.companyId === declaration.companyId && item.status === 'FILED' && item.period > declaration.period
    );
    if (laterFiled) {
      throw new Error('SQLite bloqueó la declaración IVA porque ya existe un período posterior presentado; use el procedimiento de rectificación.');
    }
  }
  for (const old of priorDeclarations) {
    const next = declarationById.get(String(old.id));
    if (!next) throw new Error('SQLite bloqueó la eliminación de una declaración IVA histórica; debe conservarse y corregirse mediante el procedimiento fiscal correspondiente.');
    if (old.status === 'FILED') {
      if (!equal(old, next)) throw new Error('SQLite bloqueó la modificación de una declaración IVA ya presentada; el original es inmutable.');
      continue;
    }
    if (old.status !== 'DRAFT') throw new Error('SQLite detectó un estado previo no reconocido en la declaración IVA.');
    if (next.status === 'FILED') {
      if (!next.sourceSnapshots) throw new Error('SQLite exige huellas documentales fiscales antes de presentar un borrador IVA.');
      const stripFiling = item => {
        const copy = { ...item };
        delete copy.status; delete copy.declarationNumber; delete copy.filedAt;
        return copy;
      };
      if (!equal(stripFiling(old), stripFiling(next))) {
        throw new Error('SQLite bloqueó cambios al contenido fiscal del borrador durante su presentación.');
      }
      continue;
    }
    if (next.status !== 'DRAFT') throw new Error('SQLite bloqueó una transición inválida del estado de declaración IVA.');
    if (!equal(old, next)) {
      if (!next.sourceSnapshots) throw new Error('SQLite exige huellas fiscales al actualizar un borrador IVA.');
      const oldRevisions = normalizeRevisions(old.revisions);
      const nextRevisions = normalizeRevisions(next.revisions);
      const revision = nextRevisions[nextRevisions.length - 1];
      const revisionMatchesOld = revision &&
        revision.revision === oldRevisions.length + 1 &&
        revision.createdAt === old.createdAt &&
        equal(revision.position, old.position) &&
        equal(revision.sourceIds, old.sourceIds) &&
        equal(revision.relatedSourceIds || [], old.relatedSourceIds || []) &&
        Number(revision.bcvRate || 0) === Number(old.bcvRate || 0) &&
        equal(revision.dailySourceChoices || {}, old.dailySourceChoices || {}) &&
        equal(revision.purchaseVatReclassificationItems || [], old.purchaseVatReclassificationItems || []) &&
        equal(revision.sourceSnapshots || {}, old.sourceSnapshots || {}) &&
        equal(nextRevisions.slice(0, -1), oldRevisions);
      if (!revisionMatchesOld || nextRevisions.length !== oldRevisions.length + 1) {
        throw new Error('SQLite bloqueó la actualización del borrador IVA porque no conserva una versión íntegra del contenido anterior.');
      }
      const currentSnapshots = buildVatOwnSourceSnapshotsFromState(nextState, next.companyId,
        [...asArray(next.sourceIds), ...asArray(next.relatedSourceIds)]);
      if (!equal(next.sourceSnapshots, currentSnapshots)) {
        throw new Error('SQLite rechazó la actualización del borrador IVA: las huellas nuevas no coinciden con las fuentes actuales.');
      }
    }
  }
  for (const declaration of declarations) {
    if (!priorById.has(String(declaration.id)) && declaration.status !== 'DRAFT') {
      throw new Error('SQLite no permite insertar directamente una declaración IVA como presentada; primero debe existir el borrador y su evento de presentación.');
    }
    if (!priorById.has(String(declaration.id)) && !declaration.sourceSnapshots) {
      throw new Error('SQLite exige huellas documentales fiscales al crear un nuevo borrador IVA.');
    }
    if (!priorById.has(String(declaration.id))) {
      const currentSnapshots = buildVatOwnSourceSnapshotsFromState(nextState, declaration.companyId,
        [...asArray(declaration.sourceIds), ...asArray(declaration.relatedSourceIds)]);
      if (!equal(declaration.sourceSnapshots, currentSnapshots)) {
        throw new Error('SQLite rechazó el borrador IVA: sus huellas fiscales no coinciden con los documentos y asientos originales actuales.');
      }
    }
  }

  assertAppendOnlyCollection(previousState, nextState, 'vatOwnDeclarationEvents');
  const timeline = new Map();
  const idempotencyKeys = new Set();
  const paymentReferences = new Set();
  const eventIds = new Set();
  const filedEvents = new Map();
  for (const event of events) {
    const id = String(event.id || '');
    const declaration = declarationById.get(String(event.declarationId || ''));
    if (!id || eventIds.has(id) || !declaration ||
        String(event.companyId) !== String(declaration.companyId) ||
        !String(event.idempotencyKey || '').trim() ||
        !timestampIsValid(event.occurredAt) || !timestampIsValid(event.recordedAt) ||
        !['FILED', 'PAYMENT', 'REVERSAL'].includes(event.eventType)) {
      throw new Error('SQLite rechazó un evento fiscal IVA propio con referencia, fecha, empresa o tipo inválido.');
    }
    eventIds.add(id);
    const idempotencyKey = String(event.companyId) + ':' + String(event.idempotencyKey);
    if (idempotencyKeys.has(idempotencyKey)) throw new Error('SQLite rechazó una clave de idempotencia IVA duplicada en la empresa.');
    idempotencyKeys.add(idempotencyKey);
    const history = timeline.get(declaration.id) || [];
    const eventDate = event.occurredAt.slice(0, 10);
    if (eventDate < String(declaration.createdAt).slice(0, 10) ||
        Date.parse(event.recordedAt) < Date.parse(event.occurredAt)) {
      throw new Error('SQLite rechazó un evento IVA fechado antes de crear el borrador o registrado antes de su fecha efectiva.');
    }
    const localNow = new Date();
    const localToday = localNow.getFullYear() + '-' + String(localNow.getMonth() + 1).padStart(2, '0') + '-' + String(localNow.getDate()).padStart(2, '0');
    if (eventDate > localToday) throw new Error('SQLite rechazó un evento IVA con fecha futura.');
    const journal = event.journalEntryId ? journals.get(String(event.journalEntryId)) : undefined;
    if (event.journalEntryId && (!journal || journal.companyId !== declaration.companyId ||
        journal.type !== 'AJUSTE' || journal.date !== eventDate)) {
      throw new Error('SQLite rechazó un evento IVA cuyo asiento no existe o no coincide en empresa, tipo y fecha.');
    }
    if (event.eventType === 'FILED') {
      if (!priorEventIds.has(id)) {
        const currentSnapshots = buildVatOwnSourceSnapshotsFromState(nextState, declaration.companyId,
          [...asArray(declaration.sourceIds), ...asArray(declaration.relatedSourceIds)]);
        if (!equal(declaration.sourceSnapshots, currentSnapshots)) {
          throw new Error('SQLite bloqueó la presentación IVA: cambió un documento o asiento fuente desde que se preparó el borrador.');
        }
        const company = companies.get(String(declaration.companyId));
        const [periodYear, periodMonth] = declaration.period.split('-').map(Number);
        const periodEndDate = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10);
        const historicalRate = resolveHistoricalRate(company, eventDate);
        if (eventDate <= periodEndDate) {
          throw new Error('SQLite rechazó la presentación IVA antes de finalizar el período fiscal mensual (' + periodEndDate + ').');
        }
        if (!company || !Number.isFinite(Number(company.bcvRate)) ||
            Math.abs(Number(company.bcvRate) - Number(declaration.bcvRate)) > 0.000001 ||
            historicalRate === null || Math.abs(historicalRate - Number(declaration.bcvRate)) > 0.000001) {
          throw new Error('SQLite rechazó la presentación IVA porque la tasa BCV no coincide con la tasa vigente e histórica de la fecha de presentación.');
        }
      }
      const position = declaration.position;
      const filingRequiresJournal = [position.outputVatBs, position.purchaseCreditBs, position.purchaseCreditReversalBs,
        position.purchaseCreditReversalNonEligibleBs, position.receivedWithholdingsBs, position.priorCreditAppliedBs,
        position.debitAdjustmentsBs, position.creditAdjustmentsBs, position.amountDueBs, position.creditCarryForwardBs]
        .some(value => Number(value) > 0.01) || asArray(declaration.purchaseVatReclassificationItems).length > 0;
      if (history.some(item => item.eventType === 'FILED') ||
          declaration.status !== 'FILED' || (filingRequiresJournal && !journal) ||
          String(declaration.declarationNumber || '').trim() !== String(event.declarationNumber || '').trim() ||
          declaration.filedAt.slice(0, 10) !== eventDate ||
          eventDate < declaration.period + '-01' ||
          (journal && String(journal.referenceDoc || '') !== 'IVA-MENSUAL:' + declaration.period)) {
        throw new Error('SQLite rechazó la presentación IVA sin borrador presentado, número, fecha o asiento de determinación coincidente.');
      }
      if (journal) {
        const debit = asArray(journal.items).reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
        const credit = asArray(journal.items).reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
        const debitUsd = asArray(journal.items).reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
        const creditUsd = asArray(journal.items).reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
        if (Math.abs(debit - credit) > 0.02 || Math.abs(debitUsd - creditUsd) > 0.0001) {
          throw new Error('SQLite rechazó el asiento de determinación IVA desequilibrado en Bs y USD.');
        }
        if (!priorEventIds.has(id) && declaration.sourceSnapshots) {
          const p = declaration.position;
          const rate = Number(declaration.bcvRate);
          const previousFiled = declarations.filter(item =>
            item.companyId === declaration.companyId && item.status === 'FILED' && item.period < declaration.period
          ).sort((a, b) => b.period.localeCompare(a.period))[0];
          const priorAvailable = Number(previousFiled?.position?.creditCarryForwardBs || 0);
          const priorApplied = Number(p.priorCreditAppliedBs || 0);
          const unusedPrior = Math.max(0, priorAvailable - priorApplied);
          const newlyGeneratedCarry = Math.max(0, Number(p.creditCarryForwardBs || 0) - unusedPrior);
          const expectedByAccount = new Map();
          const addExpected = (code, debitBs = 0, creditBs = 0, debitUsd = debitBs / rate, creditUsd = creditBs / rate) => {
            const current = expectedByAccount.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
            current.debitBs += debitBs; current.creditBs += creditBs;
            current.debitUsd += debitUsd; current.creditUsd += creditUsd;
            expectedByAccount.set(code, current);
          };
          addExpected('2.1.2.01', Number(p.outputVat16Bs || 0), 0);
          addExpected('2.1.2.02', Number(p.outputVat8Bs || 0), 0);
          addExpected('1.1.3.01', 0, Number(p.purchaseCredit16Bs || 0));
          addExpected('1.1.3.02', 0, Number(p.purchaseCredit8Bs || 0));
          addExpected('1.1.3.01', Number(p.purchaseCreditReversal16Bs || 0), 0);
          addExpected('1.1.3.02', Number(p.purchaseCreditReversal8Bs || 0), 0);
          for (const line of asArray(declaration.purchaseVatReclassificationItems)) {
            addExpected(String(line.accountCode || ''), Number(line.debitBs || 0), Number(line.creditBs || 0),
              Number(line.debitUsd || 0), Number(line.creditUsd || 0));
          }
          addExpected('1.1.3.03', 0, Number(p.receivedWithholdingsBs || 0));
          addExpected('1.1.3.03', Number(p.debitAdjustmentsBs || 0), 0);
          addExpected('1.1.3.01', 0, priorApplied);
          addExpected('1.1.3.01', newlyGeneratedCarry, 0);
          addExpected('2.1.2.09', 0, Number(p.amountDueBs || 0));
          addExpected('2.1.2.01', 0, Number(p.creditAdjustments16Bs || 0));
          addExpected('2.1.2.02', 0, Number(p.creditAdjustments8Bs || 0));
          const actualByAccount = new Map();
          for (const line of asArray(journal.items)) {
            const code = String(line.accountCode || '');
            const current = actualByAccount.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
            current.debitBs += Number(line.debitBs || 0); current.creditBs += Number(line.creditBs || 0);
            current.debitUsd += Number(line.debitUsd || 0); current.creditUsd += Number(line.creditUsd || 0);
            actualByAccount.set(code, current);
          }
          const codes = new Set([...expectedByAccount.keys(), ...actualByAccount.keys()]);
          for (const code of codes) {
            const expected = expectedByAccount.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
            const actual = actualByAccount.get(code) || { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 };
            if (Math.abs(actual.debitBs - expected.debitBs) > 0.02 ||
                Math.abs(actual.creditBs - expected.creditBs) > 0.02 ||
                Math.abs(actual.debitUsd - expected.debitUsd) > 0.0001 ||
                Math.abs(actual.creditUsd - expected.creditUsd) > 0.0001) {
              throw new Error('SQLite rechazó el asiento IVA: las líneas por cuenta no coinciden con la posición fiscal y las reclasificaciones aprobadas.');
            }
          }
        }
      }
      filedEvents.set(declaration.id, (filedEvents.get(declaration.id) || 0) + 1);
    } else if (event.eventType === 'PAYMENT') {
      const amount = Number(event.amountBs);
      const company = companies.get(String(declaration.companyId));
      const historicalRate = resolveHistoricalRate(company, eventDate);
      const treasuryAccount = asArray(nextState.accounts).find(item =>
        String(item.code) === String(event.treasuryAccountCode) && item.type === 'ACTIVO' &&
        item.isMovement === true && String(item.code).startsWith('1.1.1.')
      );
      const reference = String(event.reference || '').trim();
      const referenceKey = String(event.companyId) + ':' + reference;
      const priorPayments = history.filter(item => item.eventType === 'PAYMENT');
      const reversedPrior = new Set(history.filter(item => item.eventType === 'REVERSAL').map(item => item.reversalOfEventId));
      const paid = priorPayments.filter(item => !reversedPrior.has(item.id)).reduce((sum, item) => sum + Number(item.amountBs || 0), 0);
      if (declaration.status !== 'FILED' || !history.some(item => item.eventType === 'FILED') ||
          !Number.isFinite(amount) || amount <= 0 ||
          amount > Number(declaration.position.amountDueBs || 0) - paid + 0.000001 ||
          !reference || paymentReferences.has(referenceKey) ||
          !String(event.treasuryAccountCode || '').startsWith('1.1.1.') ||
          !Number.isFinite(Number(event.bcvRate)) || Number(event.bcvRate) <= 0 ||
          historicalRate === null || Math.abs(historicalRate - Number(event.bcvRate)) > 0.000001 ||
          !treasuryAccount || eventDate < String(declaration.filedAt || '').slice(0, 10) ||
          !journal || Math.abs(Number(journal.bcvRate) - Number(event.bcvRate)) > 0.000001 ||
          String(journal.referenceDoc || '') !== 'IVA-PAGO:' + declaration.id + ':' + reference ||
          !asArray(journal.items).some(line => String(line.accountCode) === '2.1.2.09' &&
            Math.abs(Number(line.debitBs || 0) - amount) <= 0.02) ||
          !asArray(journal.items).some(line => String(line.accountCode) === String(event.treasuryAccountCode) &&
            Math.abs(Number(line.creditBs || 0) - amount) <= 0.02)) {
        throw new Error('SQLite rechazó un pago IVA sin saldo disponible, referencia única, tasa, cuenta de tesorería o asiento correspondiente.');
      }
      paymentReferences.add(referenceKey);
    } else if (event.eventType === 'REVERSAL') {
      const original = history.find(item => item.id === event.reversalOfEventId && item.eventType === 'PAYMENT');
      const alreadyReversed = history.some(item => item.eventType === 'REVERSAL' && item.reversalOfEventId === original?.id);
      if (!original || alreadyReversed || eventDate < original.occurredAt.slice(0, 10) ||
          !journal || !original.journalEntryId || journal.reversalOfEntryId !== original.journalEntryId ||
          String(event.note || '').trim().length < 3) {
        throw new Error('SQLite rechazó la reversión de un pago IVA sin pago original, fecha, motivo o contra-asiento vinculado.');
      }
    }
    history.push(event);
    timeline.set(declaration.id, history);
  }
  for (const declaration of declarations) {
    const filedCount = filedEvents.get(declaration.id) || 0;
    if ((declaration.status === 'FILED' && filedCount !== 1) ||
        (declaration.status === 'DRAFT' && filedCount !== 0)) {
      throw new Error('SQLite rechazó el estado de una declaración IVA que no coincide con su evento de presentación.');
    }
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

function saleInventoryLinesMatchKardex(sale, nextState, previousState) {
  const lines = asArray(sale.inventoryLines);
  if (lines.length === 0) return true;
  const normalizeDocument = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const normalizeRif = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const rate = Number(sale.bcvRate);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const expectedReference = normalizeDocument('FAC-' + sale.invoiceNumber);
  const linkedMovements = asArray(nextState.movements).filter(movement =>
    movement.companyId === sale.companyId &&
    movement.type === 'SALIDA' && movement.concept === 'VENTA' &&
    normalizeDocument(movement.documentRef) === expectedReference
  );
  if (linkedMovements.length !== lines.length) return false;
  const priorMovementIds = new Set(asArray(previousState.movements).map(item => String(item.id)));
  const products = asArray(nextState.products);
  const entries = asArray(nextState.journalEntries);
  const seenProducts = new Set();
  let taxableBase = 0, exemptBase = 0, vatTotal = 0, lineTotal = 0;
  for (const line of lines) {
    const productId = String(line.productId || '');
    const product = products.find(item => String(item.id) === productId &&
      String(item.companyId) === String(sale.companyId));
    const quantity = Number(line.quantity);
    const unitPriceBs = Number(line.unitPriceBs);
    const netAmountBs = Number(line.netAmountBs);
    const taxRate = Number(line.taxRate);
    const vatAmountBs = Number(line.vatAmountBs);
    const exemptAmountBs = Number(line.exemptAmountBs);
    const totalBs = Number(line.totalBs);
    const productRate = product?.vatTreatment === 'GENERAL_16' ? 16 :
      product?.vatTreatment === 'REDUCIDA_8' ? 8 :
      ['EXENTO', 'EXONERADO'].includes(product?.vatTreatment) ? 0 : NaN;
    if (!product || !productId || seenProducts.has(productId) ||
        String(line.productCode || '') !== String(product.code || '') ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitPriceBs) || unitPriceBs <= 0 ||
        !Number.isFinite(netAmountBs) || Math.abs(netAmountBs - round2(quantity * unitPriceBs)) > 0.02 ||
        !Number.isFinite(taxRate) || taxRate !== productRate ||
        (taxRate > 0 && taxRate !== Number(sale.taxRate)) ||
        !Number.isFinite(vatAmountBs) ||
        Math.abs(vatAmountBs - round2(netAmountBs * taxRate / 100)) > 0.02 ||
        !Number.isFinite(exemptAmountBs) ||
        Math.abs(exemptAmountBs - (taxRate === 0 ? netAmountBs : 0)) > 0.02 ||
        !Number.isFinite(totalBs) || Math.abs(totalBs - netAmountBs - vatAmountBs) > 0.02 ||
        (line.unitPriceUsd != null &&
          (!Number.isFinite(Number(line.unitPriceUsd)) ||
           Math.abs(Number(line.unitPriceUsd) - unitPriceBs / rate) > 0.02))) return false;
    seenProducts.add(productId);
    taxableBase += taxRate > 0 ? netAmountBs : 0;
    exemptBase += exemptAmountBs;
    vatTotal += vatAmountBs;
    lineTotal += totalBs;

    const matches = linkedMovements.filter(movement => String(movement.productId) === productId);
    if (matches.length !== 1) return false;
    const movement = matches[0];
    const movementQuantity = Number(movement.quantity);
    const unitCostBs = Number(movement.unitCostBs);
    const unitCostUsd = Number(movement.unitCostUsd);
    const totalCostBs = Number(movement.totalCostBs);
    const totalCostUsd = Number(movement.totalCostUsd);
    const movementRate = Number(movement.bcvRate);
    const balanceQty = Number(movement.balanceQty);
    const balanceTotalBs = Number(movement.balanceTotalBs);
    const balanceTotalUsd = Number(movement.balanceTotalUsd);
    const customerRif = normalizeRif(sale.customerRif);
    if (priorMovementIds.has(String(movement.id)) ||
        movement.date !== sale.invoiceDate ||
        !Number.isFinite(movementQuantity) || Math.abs(movementQuantity - quantity) > 0.000001 ||
        !Number.isFinite(unitCostBs) || unitCostBs <= 0 ||
        !Number.isFinite(unitCostUsd) || Math.abs(unitCostUsd - unitCostBs / rate) > 0.0001 ||
        !Number.isFinite(totalCostBs) || Math.abs(totalCostBs - round2(quantity * unitCostBs)) > 0.02 ||
        !Number.isFinite(totalCostUsd) || Math.abs(totalCostUsd - totalCostBs / rate) > 0.0001 ||
        !Number.isFinite(movementRate) || Math.abs(movementRate - rate) > 0.000001 ||
        !Number.isFinite(balanceQty) || balanceQty < 0 ||
        !Number.isFinite(balanceTotalBs) || balanceTotalBs < 0 ||
        !Number.isFinite(balanceTotalUsd) || balanceTotalUsd < 0 ||
        !customerRif || normalizeRif(movement.counterpartyRif) !== customerRif ||
        movement.costingMethod !== (product.costingMethod || 'PROMEDIO_PONDERADO') ||
        !movement.journalEntryId) return false;

    const inventoryCode = product.inventoryAccountCode || (product.itemType === 'MATERIA_PRIMA' ? '1.1.4.02' : product.itemType === 'PRODUCTO_EN_PROCESO' ? '1.1.4.04' : '1.1.4.01');
    const costCode = product.costOfSalesAccountCode || '5.1.1.01';
    const costEntry = entries.find(entry => String(entry.id) === String(movement.journalEntryId));
    if (!costEntry || costEntry.companyId !== sale.companyId || costEntry.type !== 'INVENTARIO' ||
        costEntry.date !== sale.invoiceDate ||
        normalizeDocument(costEntry.referenceDoc) !== expectedReference ||
        Math.abs(Number(costEntry.bcvRate) - rate) > 0.000001 ||
        !Array.isArray(costEntry.items) || costEntry.items.length !== 2) return false;
    const debit = costEntry.items.find(item => item.accountCode === costCode);
    const credit = costEntry.items.find(item => item.accountCode === inventoryCode);
    if (!debit || !credit ||
        Math.abs(Number(debit.debitBs) - totalCostBs) > 0.02 || Number(debit.creditBs || 0) !== 0 ||
        Math.abs(Number(debit.debitUsd) - totalCostUsd) > 0.0001 || Number(debit.creditUsd || 0) !== 0 ||
        Math.abs(Number(credit.creditBs) - totalCostBs) > 0.02 || Number(credit.debitBs || 0) !== 0 ||
        Math.abs(Number(credit.creditUsd) - totalCostUsd) > 0.0001 || Number(credit.debitUsd || 0) !== 0) return false;
  }
  return Math.abs(round2(taxableBase) - Number(sale.taxableBaseBs)) <= 0.02 &&
    Math.abs(round2(exemptBase) - Number(sale.exemptAmountBs)) <= 0.02 &&
    Math.abs(round2(vatTotal) - Number(sale.vatAmountBs)) <= 0.02 &&
    Math.abs(round2(lineTotal) - (Number(sale.totalAmountBs) - Number(sale.igtfAmountBs || 0))) <= 0.02;
}

function validateSaleCorrectionNotes(previousState, nextState) {
  const priorSales = asArray(previousState?.sales);
  const nextSales = asArray(nextState?.sales);
  const priorIds = new Set(priorSales.map(item => String(item.id)));
  const normalize = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
  const close = (a, b, tolerance = 0.02) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= tolerance;
  const saleInventoryReturnComplete = (source, companyId, sourceInvoiceEntry) => {
    const originals = asArray(nextState.movements).filter(item =>
      item.companyId === companyId && !item.correctionForMovementId &&
      (item.journalEntryId === source?.journalEntryId ||
       normalize(item.documentRef) === normalize('FAC-' + (source?.invoiceNumber || ''))));
    if (!originals.length) return true;
    for (const original of originals) {
      if (original.type !== 'SALIDA' || original.concept !== 'VENTA') return false;
      const product = asArray(nextState.products).find(item =>
        item.id === original.productId && item.companyId === companyId);
      if (!product) return false;
      const inventoryCode = product.inventoryAccountCode || '1.1.4.01';
      const costCode = product.costOfSalesAccountCode || '5.1.1.01';
      if (asArray(sourceInvoiceEntry?.items).some(line =>
        [inventoryCode, costCode].includes(String(line.accountCode)) &&
        Number(line.debitBs || 0) + Number(line.creditBs || 0) +
        Number(line.debitUsd || 0) + Number(line.creditUsd || 0) > 0.01)) return false;
      const originalCost = original.journalEntryId
        ? asArray(nextState.journalEntries).find(item => item.id === original.journalEntryId && item.companyId === companyId)
        : undefined;
      if (!originalCost || originalCost.type !== 'INVENTARIO' ||
          originalCost.date !== original.date || originalCost.referenceDoc !== original.documentRef ||
          !Array.isArray(originalCost.items) || originalCost.items.length !== 2 ||
          originalCost.items.some(line => ![inventoryCode, costCode].includes(String(line.accountCode)))) return false;
      const originalInventoryCredit = asArray(originalCost.items).filter(line => line.accountCode === inventoryCode)
        .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
      const originalInventoryCreditUsd = asArray(originalCost.items).filter(line => line.accountCode === inventoryCode)
        .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
      const originalCostDebit = asArray(originalCost.items).filter(line => line.accountCode === costCode)
        .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
      const originalCostDebitUsd = asArray(originalCost.items).filter(line => line.accountCode === costCode)
        .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
      const originalDebitBs = asArray(originalCost.items).reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
      const originalCreditBs = asArray(originalCost.items).reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
      const originalDebitUsd = asArray(originalCost.items).reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
      const originalCreditUsd = asArray(originalCost.items).reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
      if (!close(originalDebitBs, originalCreditBs) || !close(originalDebitUsd, originalCreditUsd, 0.0001) ||
          !close(originalInventoryCredit, original.totalCostBs) ||
          !close(originalCostDebit, original.totalCostBs) ||
          !close(originalInventoryCreditUsd, original.totalCostUsd, 0.0001) ||
          !close(originalCostDebitUsd, original.totalCostUsd, 0.0001)) return false;
      const returns = asArray(nextState.movements).filter(item =>
        item.companyId === companyId && item.correctionForMovementId === original.id);
      const returnedQty = returns.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      if (!close(returnedQty, original.quantity, 0.000001) || !returns.length) return false;
      for (const returned of returns) {
        const entry = returned.journalEntryId
          ? asArray(nextState.journalEntries).find(item => item.id === returned.journalEntryId && item.companyId === companyId)
          : undefined;
        if (returned.type !== 'ENTRADA' || returned.concept !== 'DEVOLUCION_CLIENTE' ||
            !entry || entry.type !== 'INVENTARIO' || entry.date !== returned.date ||
            entry.referenceDoc !== returned.documentRef || !Array.isArray(entry.items) ||
            entry.items.length !== 2 || entry.items.some(line => ![inventoryCode, costCode].includes(String(line.accountCode)))) return false;
        const inventoryDebit = asArray(entry.items).filter(line => line.accountCode === inventoryCode)
          .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
        const inventoryDebitUsd = asArray(entry.items).filter(line => line.accountCode === inventoryCode)
          .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
        const costCredit = asArray(entry.items).filter(line => line.accountCode === costCode)
          .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
        const costCreditUsd = asArray(entry.items).filter(line => line.accountCode === costCode)
          .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
        const debitBs = asArray(entry.items).reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
        const creditBs = asArray(entry.items).reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
        const debitUsd = asArray(entry.items).reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
        const creditUsd = asArray(entry.items).reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
        if (!close(debitBs, creditBs) || !close(debitUsd, creditUsd, 0.0001) ||
            !close(inventoryDebit, returned.totalCostBs) ||
            !close(costCredit, returned.totalCostBs) ||
            !close(inventoryDebitUsd, returned.totalCostUsd, 0.0001) ||
            !close(costCreditUsd, returned.totalCostUsd, 0.0001)) return false;
      }
      const returnedCost = returns.reduce((sum, item) => sum + Number(item.totalCostBs || 0), 0);
      const returnedCostUsd = returns.reduce((sum, item) => sum + Number(item.totalCostUsd || 0), 0);
      if (!close(returnedCost, original.totalCostBs) ||
          !close(returnedCostUsd, original.totalCostUsd, 0.0001)) return false;
    }
    return true;
  };

  for (const note of nextSales.filter(item => !priorIds.has(String(item.id)) && ['02', '03'].includes(item.documentType))) {
    const source = nextSales.find(item => item.id === note.originalSaleId && item.companyId === note.companyId && item.documentType === '01');
    const sourceInvoiceEntry = source?.journalEntryId
      ? asArray(nextState.journalEntries).find(item => item.id === source.journalEntryId && item.companyId === note.companyId)
      : undefined;
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
        note.paymentTerm !== 'CREDITO' || normalize(note.invoiceNumber) !== normalize(number) ||
        (isCredit ? normalize(note.creditNoteNumber) : normalize(note.debitNoteNumber)) !== normalize(number) ||
        normalize(note.affectedInvoiceNumber) !== normalize(source.invoiceNumber) ||
        note.affectedInvoiceDate !== source.invoiceDate ||
        normalize(note.affectedInvoiceControlNumber) !== normalize(source.controlNumber) ||
        !close(note.affectedInvoiceTotalAmountBs, source.totalAmountBs) ||
        !close(note.affectedInvoiceTotalAmountUsd, source.totalAmountUsd, 0.0001) ||
        !['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(note.fiscalEmissionMedium) ||
        note.sameMediumAsOriginal !== true ||
        normalize(note.customerRif) !== normalize(source.customerRif) ||
        normalize(note.customerName) !== normalize(source.customerName) ||
        !String(note.customerName || '').trim() || !number || !String(note.controlNumber || '').trim() ||
        String(note.correctionReason || '').trim().length < 10 ||
        String(note.correctionWorkpaper || '').trim().length < 10 ||
        !isValidIsoDate(note.invoiceDate) || note.invoiceDate < source.invoiceDate ||
        (company?.closedThroughDate && note.invoiceDate <= company.closedThroughDate) ||
        (isCredit && linkedInventory && (!saleInventoryReturnComplete(source, note.companyId, sourceInvoiceEntry) ||
          !close(total, Number(source.totalAmountBs || 0)))) || duplicateNumber || !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(base) || !Number.isFinite(exempt) || base < 0 || exempt < 0 || base + exempt <= 0 ||
        !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 ||
        !close(vat, expectedVat) || !close(total, expectedTotal) ||
        !close(note.totalAmountUsd, totalUsd, 0.0001) ||
        !close(note.taxableBaseUsd, round6(base / rate), 0.0001) ||
        !close(note.exemptAmountUsd, round6(exempt / rate), 0.0001) ||
        !close(note.vatAmountUsd, vatUsd, 0.0001) ||
        !close(note.taxRate, source.taxRate, 0.000001) ||
        Number(note.vatWithheldBs || 0) !== 0 || Number(note.igtfAmountBs || 0) !== 0 ||
        Number(note.igtfAmountUsd || 0) !== 0 ||
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


function validateFixedAssetLedger(previousState, nextState) {
  const previousAssets = asArray(previousState?.fixedAssets);
  const assets = asArray(nextState?.fixedAssets);
  const assetById = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id.trim() ||
        typeof asset.companyId !== 'string' || !asset.companyId.trim() ||
        assetById.has(String(asset.id))) {
      throw new Error('SQLite rechazó activos fijos con IDs o empresas ausentes/duplicados.');
    }
    assetById.set(String(asset.id), asset);
  }
  const companies = new Set(asArray(nextState.companies).map(item => String(item.id)));
  const entries = asArray(nextState.journalEntries);
  const entryById = new Map(entries.map(entry => [String(entry.id), entry]));
  const accounts = new Map(asArray(nextState.accounts).map(account => [String(account.code), account]));
  const usedSourceLines = new Set();
  const usedDepreciationEntries = new Set();
  const assetCodes = new Set();
  const normalize = value => String(value || '').toUpperCase().replace(/Ó/g, 'O');

  for (const oldAsset of previousAssets) {
    const current = assetById.get(String(oldAsset.id));
    if (!current) throw new Error('SQLite bloqueó la eliminación del activo fijo ' + oldAsset.assetCode + '.');
    const oldBase = { ...oldAsset }; delete oldBase.depreciationEvents;
    const currentBase = { ...current }; delete currentBase.depreciationEvents;
    if (JSON.stringify(oldBase) !== JSON.stringify(currentBase)) {
      throw new Error('SQLite bloqueó la modificación de los datos originales del activo fijo ' + oldAsset.assetCode + '.');
    }
    const oldEvents = new Map(asArray(oldAsset.depreciationEvents).map(event => [String(event.id), event]));
    const currentEvents = new Map(asArray(current.depreciationEvents).map(event => [String(event.id), event]));
    if (currentEvents.size !== asArray(current.depreciationEvents).length) {
      throw new Error('SQLite rechazó eventos de depreciación duplicados para ' + current.assetCode + '.');
    }
    for (const oldEvent of oldEvents.values()) {
      const nextEvent = currentEvents.get(String(oldEvent.id));
      if (!nextEvent) throw new Error('SQLite bloqueó la eliminación del evento de depreciación ' + oldEvent.id + '.');
      const oldCopy = { ...oldEvent }; delete oldCopy.reversedByJournalEntryId;
      const nextCopy = { ...nextEvent }; delete nextCopy.reversedByJournalEntryId;
      if (JSON.stringify(oldCopy) !== JSON.stringify(nextCopy) ||
          (oldEvent.reversedByJournalEntryId && nextEvent.reversedByJournalEntryId !== oldEvent.reversedByJournalEntryId)) {
        throw new Error('SQLite bloqueó la modificación del historial de depreciación ' + oldEvent.id + '.');
      }
    }
  }

  for (const asset of assets) {
    const nonDepreciable = asset.depreciationMethod === 'NON_DEPRECIABLE';
    if (!companies.has(String(asset.companyId)) || !String(asset.assetCode || '').trim() ||
        !String(asset.description || '').trim() || !String(asset.category || '').trim() ||
        !isValidIsoDate(asset.acquisitionDate) || !isValidIsoDate(asset.serviceDate) ||
        asset.serviceDate < asset.acquisitionDate ||
        !Number.isInteger(asset.usefulLifeMonths) || (nonDepreciable ? asset.usefulLifeMonths !== 0 : asset.usefulLifeMonths <= 0) ||
        asset.status !== 'ACTIVE' || !['STRAIGHT_LINE', 'NON_DEPRECIABLE'].includes(asset.depreciationMethod) ||
        !Number.isFinite(Number(asset.acquisitionCostBs)) || Number(asset.acquisitionCostBs) <= 0 ||
        !Number.isFinite(Number(asset.acquisitionCostUsd)) || Number(asset.acquisitionCostUsd) <= 0 ||
        !Number.isFinite(Number(asset.acquisitionBcvRate)) || Number(asset.acquisitionBcvRate) <= 0 ||
        !Number.isFinite(Number(asset.residualValueBs)) || Number(asset.residualValueBs) < 0 ||
        !Number.isFinite(Number(asset.residualValueUsd)) || Number(asset.residualValueUsd) < 0 ||
        Number(asset.residualValueBs) > Number(asset.acquisitionCostBs) ||
        Number(asset.residualValueUsd) > Number(asset.acquisitionCostUsd) ||
        (nonDepreciable && (Number(asset.residualValueBs) !== Number(asset.acquisitionCostBs) ||
          Number(asset.residualValueUsd) !== Number(asset.acquisitionCostUsd) || asset.depreciationEvents.length !== 0 ||
          asset.accumulatedDepreciationAccountCode || asset.depreciationExpenseAccountCode)) ||
        (!nonDepreciable && (Number(asset.residualValueBs) >= Number(asset.acquisitionCostBs) ||
          Number(asset.residualValueUsd) >= Number(asset.acquisitionCostUsd))) ||
        !Number.isInteger(asset.sourceJournalLineIndex) || asset.sourceJournalLineIndex < 0 || !Array.isArray(asset.depreciationEvents)) {
      throw new Error('SQLite rechazó un expediente de activo fijo con datos, fechas, costos, vida útil o empresa inválidos.');
    }
    const assetCodeKey = String(asset.companyId) + '|' + String(asset.assetCode).trim().toUpperCase();
    if (assetCodes.has(assetCodeKey)) throw new Error('SQLite rechazó códigos de activos fijos duplicados dentro de una empresa.');
    assetCodes.add(assetCodeKey);
    const source = entryById.get(String(asset.sourceJournalEntryId));
    const sourceLine = source && asArray(source.items)[asset.sourceJournalLineIndex];
    const assetAccount = accounts.get(String(asset.assetAccountCode));
    const accumulatedAccount = accounts.get(String(asset.accumulatedDepreciationAccountCode));
    const expenseAccount = accounts.get(String(asset.depreciationExpenseAccountCode));
    if (!source || source.companyId !== asset.companyId || source.reversalOfEntryId ||
        entries.some(entry => String(entry.reversalOfEntryId || '') === String(source.id)) ||
        !sourceLine || sourceLine.accountCode !== asset.assetAccountCode ||
        Math.abs(Number(sourceLine.debitBs) - Number(asset.acquisitionCostBs)) > 0.01 ||
        Math.abs(Number(sourceLine.debitUsd) - Number(asset.acquisitionCostUsd)) > 0.000001 ||
        Number(sourceLine.creditBs || 0) !== 0 || Number(sourceLine.creditUsd || 0) !== 0 ||
        source.date < asset.acquisitionDate || Math.abs(Number(source.bcvRate) - Number(asset.acquisitionBcvRate)) > 0.000001 ||
        !assetAccount || assetAccount.type !== 'ACTIVO' || assetAccount.isMovement !== true ||
        !String(asset.assetAccountCode).startsWith('1.2.') || normalize(assetAccount.name).includes('DEPRECIACION ACUMULADA') ||
        (!nonDepreciable && (!accumulatedAccount || accumulatedAccount.type !== 'ACTIVO' || accumulatedAccount.isMovement !== true ||
          !normalize(accumulatedAccount.name).includes('DEPRECIACION ACUMULADA') ||
          !expenseAccount || expenseAccount.type !== 'GASTOS' || expenseAccount.isMovement !== true ||
          !normalize(expenseAccount.name).includes('DEPRECIACION')))) {
      throw new Error('SQLite rechazó un activo fijo sin asiento de adquisición capitalizado, línea origen o cuentas de depreciación válidas.');
    }
    const sourceKey = String(asset.companyId) + '|' + String(asset.sourceJournalEntryId) + '|' + String(asset.sourceJournalLineIndex);
    if (usedSourceLines.has(sourceKey)) throw new Error('SQLite rechazó la doble capitalización de una misma línea de adquisición.');
    usedSourceLines.add(sourceKey);

    const firstPeriod = String(asset.serviceDate).slice(0, 7);
    const serviceDateUtc = new Date(String(asset.serviceDate) + 'T00:00:00.000Z');
    const targetMonthIndex = serviceDateUtc.getUTCMonth() + Number(asset.usefulLifeMonths);
    const firstTargetMonth = new Date(Date.UTC(serviceDateUtc.getUTCFullYear(), targetMonthIndex, 1));
    const finalDayOfTargetMonth = new Date(Date.UTC(firstTargetMonth.getUTCFullYear(), firstTargetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    const lifeEnd = new Date(Date.UTC(firstTargetMonth.getUTCFullYear(), firstTargetMonth.getUTCMonth(), Math.min(serviceDateUtc.getUTCDate(), finalDayOfTargetMonth)));
    const lastPeriod = new Date(lifeEnd.getTime() - 86400000).toISOString().slice(0, 7);
    const activePeriods = new Set();
    const eventIds = new Set();
    const activeEvents = asArray(asset.depreciationEvents).filter(event => !event.reversedByJournalEntryId);
    let activeDepreciationBs = 0;
    let activeDepreciationUsd = 0;
    for (const event of asArray(asset.depreciationEvents)) {
      if (!event || typeof event.id !== 'string' || !event.id.trim() || eventIds.has(String(event.id)) ||
          event.companyId !== asset.companyId || event.assetId !== asset.id ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(event.period || '')) || String(event.period) < firstPeriod || String(event.period) > lastPeriod ||
          !isValidIsoDate(event.date) || String(event.date).slice(0, 7) !== String(event.period) ||
          !Number.isInteger(event.days) || event.days <= 0 ||
          !Number.isFinite(Number(event.amountBs)) || Number(event.amountBs) <= 0 ||
          !Number.isFinite(Number(event.amountUsd)) || Number(event.amountUsd) <= 0 ||
          !String(event.journalEntryId || '').trim()) {
        throw new Error('SQLite rechazó un evento de depreciación con campos inválidos para ' + asset.assetCode + '.');
      }
      eventIds.add(String(event.id));
      if (!event.reversedByJournalEntryId) {
        if (activePeriods.has(String(event.period))) throw new Error('SQLite rechazó dos depreciaciones vigentes para el mismo activo y período.');
        activePeriods.add(String(event.period));
        activeDepreciationBs += Number(event.amountBs);
        activeDepreciationUsd += Number(event.amountUsd);
      }
      const journal = entryById.get(String(event.journalEntryId));
      const expectedRef = 'DEP-' + asset.assetCode + '-' + event.period;
      const lines = asArray(journal?.items);
      const debit = lines.reduce((sum, line) => sum + (line.accountCode === asset.depreciationExpenseAccountCode ? Number(line.debitBs || 0) : 0), 0);
      const debitUsd = lines.reduce((sum, line) => sum + (line.accountCode === asset.depreciationExpenseAccountCode ? Number(line.debitUsd || 0) : 0), 0);
      const credit = lines.reduce((sum, line) => sum + (line.accountCode === asset.accumulatedDepreciationAccountCode ? Number(line.creditBs || 0) : 0), 0);
      const creditUsd = lines.reduce((sum, line) => sum + (line.accountCode === asset.accumulatedDepreciationAccountCode ? Number(line.creditUsd || 0) : 0), 0);
      if (!journal || journal.companyId !== asset.companyId || journal.type !== 'AJUSTE' ||
          journal.date !== event.date || String(journal.referenceDoc || '') !== expectedRef ||
          Math.abs(Number(journal.bcvRate) - Number(asset.acquisitionBcvRate)) > 0.000001 ||
          Math.abs(debit - Number(event.amountBs)) > 0.01 ||
          Math.abs(debitUsd - Number(event.amountUsd)) > 0.000001 ||
          Math.abs(credit - Number(event.amountBs)) > 0.01 ||
          Math.abs(creditUsd - Number(event.amountUsd)) > 0.000001 ||
          usedDepreciationEntries.has(String(event.journalEntryId))) {
        throw new Error('SQLite rechazó un evento de depreciación sin asiento dual vinculado o con importes diferentes.');
      }
      usedDepreciationEntries.add(String(event.journalEntryId));
      if (event.reversedByJournalEntryId) {
        const reversal = entryById.get(String(event.reversedByJournalEntryId));
        if (!reversal || reversal.companyId !== asset.companyId || reversal.reversalOfEntryId !== event.journalEntryId) {
          throw new Error('SQLite rechazó una marca de reversión de depreciación sin contra-asiento vinculado.');
        }
      }
      const journalReversal = entries.find(item => String(item.reversalOfEntryId || '') === String(event.journalEntryId));
      if (Boolean(journalReversal) !== Boolean(event.reversedByJournalEntryId)) {
        throw new Error('SQLite rechazó un estado de reversión de depreciación que no coincide con el Libro Diario.');
      }
    }
    const depreciableBs = Number(asset.acquisitionCostBs) - Number(asset.residualValueBs);
    const depreciableUsd = Number(asset.acquisitionCostUsd) - Number(asset.residualValueUsd);
    if (activeDepreciationBs > depreciableBs + 0.01 || activeDepreciationUsd > depreciableUsd + 0.000001) {
      throw new Error('SQLite rechazó depreciación acumulada superior al importe depreciable del activo ' + asset.assetCode + '.');
    }
    const sortedActiveEvents = activeEvents.slice().sort((a, b) => String(a.period).localeCompare(String(b.period)));
    let expectedPeriod = firstPeriod;
    const usefulLifeDays = Math.round((lifeEnd.getTime() - serviceDateUtc.getTime()) / 86400000);
    let calculatedAccumulatedBs = 0;
    let calculatedAccumulatedUsd = 0;
    for (const event of sortedActiveEvents) {
      if (String(event.period) !== expectedPeriod) {
        throw new Error('SQLite rechazó períodos de depreciación fuera de secuencia para ' + asset.assetCode + '.');
      }
      const [year, month] = expectedPeriod.split('-').map(Number);
      const periodStart = new Date(Date.UTC(year, month - 1, 1));
      const periodEnd = new Date(Date.UTC(year, month, 1));
      const overlapStart = periodStart > serviceDateUtc ? periodStart : serviceDateUtc;
      const overlapEnd = periodEnd < lifeEnd ? periodEnd : lifeEnd;
      const expectedDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000));
      const finalPeriod = overlapEnd.getTime() === lifeEnd.getTime();
      const expectedBs = finalPeriod
        ? Math.round((depreciableBs - calculatedAccumulatedBs + Number.EPSILON) * 100) / 100
        : Math.round((depreciableBs * expectedDays / usefulLifeDays + Number.EPSILON) * 100) / 100;
      const expectedUsd = finalPeriod
        ? Math.round((depreciableUsd - calculatedAccumulatedUsd + Number.EPSILON) * 1000000) / 1000000
        : Math.round((depreciableUsd * expectedDays / usefulLifeDays + Number.EPSILON) * 1000000) / 1000000;
      if (event.days !== expectedDays || Math.abs(Number(event.amountBs) - expectedBs) > 0.01 ||
          Math.abs(Number(event.amountUsd) - expectedUsd) > 0.000001) {
        throw new Error('SQLite rechazó importes de depreciación que no coinciden con el método lineal prorrateado y el período ' + expectedPeriod + '.');
      }
      calculatedAccumulatedBs += Number(event.amountBs);
      calculatedAccumulatedUsd += Number(event.amountUsd);
      expectedPeriod = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
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
  validateFixedAssetLedger(priorState, nextState);
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
  validateVatOwnDeclarationLedger(priorState, nextState);
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
        note.affectedInvoiceDate !== original.invoiceDate ||
        normalizeDocument(note.affectedInvoiceControlNumber) !== normalizeDocument(original.controlNumber) ||
        Math.abs(Number(note.affectedInvoiceTotalAmountBs) - Number(original.totalAmountBs)) > 0.02 ||
        Math.abs(Number(note.affectedInvoiceTotalAmountUsd) - Number(original.totalAmountUsd)) > 0.0001 ||
        !['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(note.fiscalEmissionMedium) ||
        note.sameMediumAsOriginal !== true ||
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
      if (collectionName === 'sales' && !oldDocument &&
          Array.isArray(document.inventoryLines) && document.inventoryLines.length > 0 &&
          !saleInventoryLinesMatchKardex(document, nextState, previousState)) {
        throw new Error('SQLite rechazó la venta: sus líneas de mercancía no concilian con las salidas de Kardex y los asientos de costo de ventas vinculados.');
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
    const serviceNote = Boolean(original && (!Array.isArray(original.inventoryLines) || original.inventoryLines.length === 0) &&
      (!Array.isArray(note.inventoryLines) || note.inventoryLines.length === 0) && lines.length === 0);
    const company = asArray(nextState.companies).find(item => item.id === note.companyId);
    const duplicateNoteNumber = asArray(nextState.purchases).some(item =>
      item.id !== note.id && item.companyId === note.companyId && item.documentType === '03' &&
      normalizeDocument(item.creditNoteNumber || item.invoiceNumber) === normalizeDocument(note.creditNoteNumber));
    if (!original || original.isCancelled || !isValidIsoDate(original.invoiceDate) || !isValidIsoDate(note.invoiceDate) ||
        normalizeRif(note.supplierRif) !== normalizeRif(original.supplierRif) ||
        note.affectedInvoiceNumber !== original.invoiceNumber || note.invoiceDate < original.invoiceDate ||
        note.affectedInvoiceDate !== original.invoiceDate ||
        normalizeDocument(note.affectedInvoiceControlNumber) !== normalizeDocument(original.controlNumber) ||
        Math.abs(Number(note.affectedInvoiceTotalAmountBs) - Number(original.totalAmountBs)) > 0.02 ||
        Math.abs(Number(note.affectedInvoiceTotalAmountUsd) - Number(original.totalAmountUsd)) > 0.0001 ||
        !['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(note.fiscalEmissionMedium) ||
        note.sameMediumAsOriginal !== true ||
        (company?.closedThroughDate && note.invoiceDate <= company.closedThroughDate) ||
        duplicateNoteNumber ||
        !note.creditNoteNumber || !note.controlNumber || String(note.notes || '').trim().length < 10 ||
        (lines.length === 0 && !serviceNote) || !note.journalEntryId ||
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
    if (serviceNote) {
      const sourceEntry = original.journalEntryId ? nextById.get(String(original.journalEntryId)) : undefined;
      const sourceMovements = asArray(nextState.movements).filter(item => item.companyId === original.companyId &&
        (item.journalEntryId === original.journalEntryId ||
         normalizeDocument(item.documentRef) === normalizeDocument('FAC-' + original.invoiceNumber)));
      const rate = Number(original.bcvRate);
      const baseBs = Number(note.taxableBaseBs || 0) + Number(note.exemptAmountBs || 0);
      const baseUsd = Number(note.taxableBaseUsd || 0) + Number(note.exemptAmountUsd || 0);
      const vatBs = Number(note.vatAmountBs || 0);
      const vatUsd = Number(note.vatAmountUsd || 0);
      const totalBs = Number(note.totalAmountBs || 0);
      const totalUsd = Number(note.totalAmountUsd || 0);
      const sourceBaseBs = Number(original.taxableBaseBs || 0) + Number(original.exemptAmountBs || 0);
      const expenseLines = asArray(sourceEntry?.items).filter(line => {
        const account = asArray(nextState.accounts).find(item => item.code === line.accountCode);
        return Number(line.debitBs || 0) > 0 && account?.isMovement &&
          (account.type === 'COSTOS' || account.type === 'GASTOS');
      });
      const sourceExpenseBs = expenseLines.reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
      const sourceExpenseUsd = expenseLines.reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
      const sourceVatLines = asArray(sourceEntry?.items).filter(line =>
        String(line.accountCode || '').startsWith('1.1.3.') && Number(line.debitBs || 0) > 0);
      const sourcePayable = sourcePayableAccounts[0] || '';
      const payableAppliedBs = money(totalBs - Number(note.supplierAdvanceBs || 0));
      const payableAppliedUsd = Math.round((totalUsd - Number(note.supplierAdvanceUsd || 0)) * 1000000) / 1000000;
      const journal = nextById.get(String(note.journalEntryId));
      const expectedCredits = new Map();
      for (const line of expenseLines) {
        const code = String(line.accountCode);
        const prior = expectedCredits.get(code) || { bs: 0, usd: 0 };
        prior.bs += Number(line.debitBs || 0) / sourceExpenseBs * baseBs;
        prior.usd += Number(line.debitUsd || 0) / sourceExpenseUsd * baseUsd;
        expectedCredits.set(code, prior);
      }
      const journalRows = asArray(journal?.items);
      const rowFor = code => journalRows.filter(line => String(line.accountCode) === String(code))
        .reduce((sum, line) => ({
          debitBs: sum.debitBs + Number(line.debitBs || 0), creditBs: sum.creditBs + Number(line.creditBs || 0),
          debitUsd: sum.debitUsd + Number(line.debitUsd || 0), creditUsd: sum.creditUsd + Number(line.creditUsd || 0)
        }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
      const within = (a, b, tolerance = 0.02) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= tolerance;
      const priorServiceNotes = asArray(nextState.purchases).filter(item =>
        item.id !== note.id && item.companyId === original.companyId &&
        item.originalPurchaseId === original.id && item.documentType === '03' &&
        !(Array.isArray(item.creditNoteLines) && item.creditNoteLines.length > 0) && !item.isCancelled);
      const cumulativeServiceTaxable = priorServiceNotes.reduce((sum, item) => sum + Number(item.taxableBaseBs || 0), 0) + Number(note.taxableBaseBs || 0);
      const cumulativeServiceExempt = priorServiceNotes.reduce((sum, item) => sum + Number(item.exemptAmountBs || 0), 0) + Number(note.exemptAmountBs || 0);
      const noteTaxableBs = Number(note.taxableBaseBs || 0);
      const noteExemptBs = Number(note.exemptAmountBs || 0);
      const noteTaxRate = Number(note.taxRate || 0);
      const expectedLineCount = expenseLines.length + (vatBs > 0 ? 1 : 0) +
        (payableAppliedBs > 0.02 ? 1 : 0) + (Number(note.supplierAdvanceBs || 0) > 0.02 ? 1 : 0);
      const validExpenseCredits = [...expectedCredits.entries()].every(([code, expected]) => {
        const actual = rowFor(code);
        return within(actual.creditBs, expected.bs) && within(actual.creditUsd, expected.usd, 0.0001) &&
          within(actual.debitBs, 0) && within(actual.debitUsd, 0, 0.0001);
      });
      const payableRow = sourcePayable ? rowFor(sourcePayable) : { debitBs: 0, debitUsd: 0 };
      const advanceRow = rowFor('1.1.2.03');
      const vatRow = sourceVatLines.length === 1 ? rowFor(sourceVatLines[0].accountCode) : { creditBs: 0, creditUsd: 0 };
      if (original.inventoryLines?.length || sourceMovements.length > 0 ||
          original.vatWithheldBs > 0 || Number(original.islrWithheldBs || 0) > 0 ||
          Number(original.igtfAmountBs || 0) > 0 || original.igtfApplicable === true ||
          asArray(nextState.vatVouchers).some(item => item.companyId === original.companyId && item.purchaseRecordId === original.id) ||
          asArray(nextState.islrVouchers).some(item => item.companyId === original.companyId && item.invoiceNumber === original.invoiceNumber && item.supplierRif === original.supplierRif) ||
          !sourceEntry || sourceEntry.type !== 'COMPRA' ||
          sourceEntry.date !== String(original.accountCreditDate || original.invoiceDate) ||
          normalizeDocument(sourceEntry.referenceDoc) !== normalizeDocument('FAC-' + original.invoiceNumber) ||
          Math.abs(Number(sourceEntry.bcvRate) - rate) > 0.000001 ||
          !purchaseJournalMatchesInvoice(original, sourceEntry, asArray(nextState.products), asArray(nextState.accounts)) ||
          !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(sourceBaseBs) || sourceBaseBs <= 0 ||
          Math.abs(sourceExpenseBs - sourceBaseBs) > 0.02 ||
          Math.abs(sourceExpenseUsd - sourceBaseBs / rate) > 0.0001 ||
          (Number(original.vatAmountBs || 0) > 0 && (sourceVatLines.length !== 1 ||
            Math.abs(Number(sourceVatLines[0].debitBs) - Number(original.vatAmountBs)) > 0.02)) ||
          Math.abs(Number(note.bcvRate) - rate) > 0.000001 ||
          Math.abs(totalBs - baseBs - vatBs) > 0.02 ||
          Math.abs(totalUsd - baseUsd - vatUsd) > 0.0001 ||
          Math.abs(noteTaxableBs * noteTaxRate / 100 - vatBs) > 0.02 ||
          Math.abs(noteTaxRate - Number(original.taxRate || 0)) > 0.000001 ||
          cumulativeServiceTaxable > Number(original.taxableBaseBs || 0) + 0.01 ||
          cumulativeServiceExempt > Number(original.exemptAmountBs || 0) + 0.01 ||
          Number(note.vatWithheldBs || 0) !== 0 || Number(note.islrWithheldBs || 0) !== 0 ||
          Number(note.igtfAmountBs || 0) !== 0 ||
          Math.abs(Number(note.taxableBaseUsd || 0) - noteTaxableBs / rate) > 0.0001 ||
          Math.abs(Number(note.exemptAmountUsd || 0) - noteExemptBs / rate) > 0.0001 ||
          Math.abs(baseUsd - baseBs / rate) > 0.0001 ||
          Math.abs(vatUsd - vatBs / rate) > 0.0001 ||
          Math.abs(totalUsd - totalBs / rate) > 0.0001 ||
          Math.abs(Number(note.netPayableReductionBs) - totalBs) > 0.02 ||
          Math.abs(Number(note.netPayableReductionUsd) - totalUsd) > 0.0001 ||
          !Number.isFinite(Number(note.supplierAdvanceBs || 0)) || Number(note.supplierAdvanceBs || 0) < 0 ||
          !Number.isFinite(Number(note.supplierAdvanceUsd || 0)) || Number(note.supplierAdvanceUsd || 0) < 0 ||
          Number(note.supplierAdvanceBs || 0) > totalBs + 0.02 ||
          Number(note.supplierAdvanceUsd || 0) > totalUsd + 0.0001 ||
          Math.abs(Number(note.supplierAdvanceBs || 0) / rate - Number(note.supplierAdvanceUsd || 0)) > 0.0001 ||
          Math.abs(payableAppliedBs / rate - payableAppliedUsd) > 0.0001 ||
          (cashOriginalPurchase && (payableAppliedBs > 0.02 || payableAppliedUsd > 0.0001)) ||
          (!cashOriginalPurchase && !sourcePayable) ||
          note.affectedInvoiceDate !== original.invoiceDate ||
          normalizeDocument(note.affectedInvoiceControlNumber) !== normalizeDocument(original.controlNumber) ||
          Math.abs(Number(note.affectedInvoiceTotalAmountBs) - Number(original.totalAmountBs)) > 0.02 ||
          Math.abs(Number(note.affectedInvoiceTotalAmountUsd) - Number(original.totalAmountUsd)) > 0.0001 ||
          !['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(note.fiscalEmissionMedium) ||
          note.sameMediumAsOriginal !== true ||
          !journal || journal.companyId !== note.companyId || journal.type !== 'AJUSTE' ||
          journal.date !== note.invoiceDate ||
          normalizeDocument(journal.referenceDoc) !== normalizeDocument('NC-PROV-' + note.creditNoteNumber) ||
          journalRows.length !== expectedLineCount ||
          !validExpenseCredits ||
          Math.abs(payableRow.debitBs - payableAppliedBs) > 0.02 ||
          Math.abs(payableRow.debitUsd - payableAppliedUsd) > 0.0001 ||
          Math.abs(advanceRow.debitBs - Number(note.supplierAdvanceBs || 0)) > 0.02 ||
          Math.abs(advanceRow.debitUsd - Number(note.supplierAdvanceUsd || 0)) > 0.0001 ||
          Math.abs(vatRow.creditBs - vatBs) > 0.02 ||
          Math.abs(vatRow.creditUsd - vatUsd) > 0.0001 ||
          !within(journalRows.reduce((sum, line) => sum + Number(line.debitBs || 0), 0),
            journalRows.reduce((sum, line) => sum + Number(line.creditBs || 0), 0)) ||
          !within(journalRows.reduce((sum, line) => sum + Number(line.debitUsd || 0), 0),
            journalRows.reduce((sum, line) => sum + Number(line.creditUsd || 0), 0), 0.0001)) {
        throw new Error('SQLite rechazó la NC de servicios: la factura, gasto original, IVA, CxP/anticipo o asiento correctivo no concilian.');
      }
      continue;
    }
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
      item.id === settlement.documentId && item.companyId === settlement.companyId &&
      ['01', '02'].includes(item.documentType));
    if (!target) {
      throw new Error('SQLite rechazó un pago de proveedor sin factura de compra o ND destino en la empresa indicada.');
    }
    // A newly imported invoice and its payment may be committed in one SQLite
    // snapshot. Resolve the immutable source journal from that complete snapshot.
    const sourceJournal = target.journalEntryId ? nextById.get(String(target.journalEntryId)) : undefined;
    const expectedSourceType = target.documentType === '02' ? 'AJUSTE' : 'COMPRA';
    const payableCodes = sourceJournal && sourceJournal.companyId === target.companyId &&
      sourceJournal.type === expectedSourceType && Array.isArray(sourceJournal.items)
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
    const payableCreditUsd = asArray(journal?.items).filter(line => line.accountCode === payableCode)
      .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
    const cashCredit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const cashDebit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const cashDebitUsd = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
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
    const normalizedReference = String(settlement.reference || '').trim().replace(/\s+/g, '').toUpperCase();
    const duplicateBankReference = bankTransfer && normalizedReference && asArray(nextState.creditSettlements).some(item =>
      item.id !== settlement.id && item.companyId === target.companyId &&
      item.bankAccountId === settlement.bankAccountId && !item.isReversed &&
      String(item.reference || '').trim().replace(/\s+/g, '').toUpperCase() === normalizedReference
    );
    const duplicateWithoutReference = !normalizedReference && asArray(nextState.creditSettlements).some(item =>
      item.id !== settlement.id && item.companyId === target.companyId &&
      item.documentId === settlement.documentId && item.kind === 'PURCHASE_PAYMENT' && !item.isReversed &&
      !String(item.reference || '').trim() && item.settlementDate === settlement.settlementDate &&
      Math.round(Number(item.amountUsd || 0) * 100) === Math.round(amountUsd * 100) &&
      item.method === settlement.method && item.bankAccountId === settlement.bankAccountId &&
      Math.round(Number(item.bcvRate || 0) * 1000000) === Math.round(settlementRate * 1000000)
    );
    if (target.isCancelled || target.paymentTerm !== 'CREDITO' ||
        !isValidIsoDate(settlement.settlementDate) ||
        settlement.settlementDate < String(target.accountCreditDate || target.invoiceDate) ||
        !['CASH_BS', 'CASH_USD', 'BANK_TRANSFER_BS', 'BANK_TRANSFER_USD'].includes(settlement.method) ||
        (bankTransfer && !String(settlement.reference || '').trim()) ||
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
        Math.abs(payableCreditUsd) > 0.0001 ||
        Math.abs(cashCredit - amountBs) > 0.02 ||
        Math.abs(cashDebit) > 0.01 ||
        Math.abs(cashDebitUsd) > 0.0001 ||
        Math.abs(cashCreditUsd - amountUsd) > 0.0001 ||
        Math.abs(fxLineAmount - fxAmount) > 0.02 ||
        asArray(journal.items).some(line => !allowedCodes.has(line.accountCode)) ||
        Math.abs(totals.debitBs - totals.creditBs) > 0.02 ||
        Math.abs(totals.debitUsd - totals.creditUsd) > 0.0001 ||
        duplicateBankReference || duplicateWithoutReference) {
      throw new Error('SQLite rechazó el pago de una factura/ND de proveedor: documento, cuenta CxP propia, tesorería, referencia duplicada, diferencial cambiario o asiento no concilian.');
    }
  }


  const priorSaleSettlementIds = new Set(asArray(priorState.creditSettlements).map(item => String(item.id)));
  for (const settlement of asArray(nextState.creditSettlements)) {
    if (priorSaleSettlementIds.has(String(settlement.id)) || settlement.kind !== 'SALE_COLLECTION') continue;
    const target = asArray(nextState.sales).find(item =>
      item.id === settlement.documentId && item.companyId === settlement.companyId &&
      ['01', '02'].includes(item.documentType));
    if (!target) {
      throw new Error('SQLite rechazó un cobro sin factura/ND de venta destino en la empresa indicada.');
    }
    const sourceJournal = target.journalEntryId ? nextById.get(String(target.journalEntryId)) : undefined;
    const expectedSourceType = target.documentType === '02' ? 'AJUSTE' : 'VENTA';
    const receivableCode = '1.1.2.01';
    const sourceReceivable = asArray(sourceJournal?.items).filter(line =>
      line.accountCode === receivableCode && Number(line.debitBs || 0) > 0
    );
    const receivableAccount = asArray(nextState.accounts).find(account => account.code === receivableCode);
    const journal = settlement.journalEntryId ? nextById.get(String(settlement.journalEntryId)) : undefined;
    const amountUsd = Number(settlement.amountUsd);
    const amountBs = Number(settlement.amountBs);
    const settlementRate = Number(settlement.bcvRate);
    const invoiceRate = Number(target.bcvRate) > 0
      ? Number(target.bcvRate)
      : (Number(target.totalAmountUsd) > 0 ? Number(target.totalAmountBs) / Number(target.totalAmountUsd) : 0);
    const expectedReceivableBs = Math.round(amountUsd * invoiceRate * 100) / 100;
    const expectedCashBs = Math.round(amountUsd * settlementRate * 100) / 100;
    const fxDifferenceBs = Math.round((amountBs - expectedReceivableBs) * 100) / 100;
    const bank = settlement.bankAccountId
      ? asArray(nextState.bankAccounts).find(item => item.id === settlement.bankAccountId && item.companyId === target.companyId)
      : undefined;
    const bankTransfer = settlement.method === 'BANK_TRANSFER_BS' || settlement.method === 'BANK_TRANSFER_USD';
    const expectedBankCurrency = settlement.method === 'BANK_TRANSFER_USD' ? 'USD' : 'BS';
    const cashCode = bank?.accountCode || (settlement.method === 'CASH_USD' ? '1.1.1.02' : '1.1.1.01');
    const cashAccount = asArray(nextState.accounts).find(account => account.code === cashCode);
    const bankValid = bankTransfer ? Boolean(bank && bank.currency === expectedBankCurrency) : !settlement.bankAccountId;
    const cashDebit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const cashCredit = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const cashDebitUsd = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
    const cashCreditUsd = asArray(journal?.items).filter(line => line.accountCode === cashCode)
      .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
    const receivableDebit = asArray(journal?.items).filter(line => line.accountCode === receivableCode)
      .reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const receivableCredit = asArray(journal?.items).filter(line => line.accountCode === receivableCode)
      .reduce((sum, line) => sum + Number(line.creditBs || 0), 0);
    const receivableDebitUsd = asArray(journal?.items).filter(line => line.accountCode === receivableCode)
      .reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
    const receivableCreditUsd = asArray(journal?.items).filter(line => line.accountCode === receivableCode)
      .reduce((sum, line) => sum + Number(line.creditUsd || 0), 0);
    const fxCode = fxDifferenceBs > 0.009 ? '4.2.1.01' : fxDifferenceBs < -0.009 ? '6.1.1.08' : '';
    const fxAmount = Math.abs(fxDifferenceBs);
    const fxLineAmount = fxCode
      ? asArray(journal?.items).filter(line => line.accountCode === fxCode)
          .reduce((sum, line) => sum + (fxCode === '4.2.1.01'
            ? Number(line.creditBs || 0) - Number(line.debitBs || 0)
            : Number(line.debitBs || 0) - Number(line.creditBs || 0)), 0)
      : 0;
    const allowedCodes = new Set([receivableCode, cashCode, ...(fxCode ? [fxCode] : [])]);
    const totals = asArray(journal?.items).reduce((acc, line) => ({
      debitBs: acc.debitBs + Number(line.debitBs || 0),
      creditBs: acc.creditBs + Number(line.creditBs || 0),
      debitUsd: acc.debitUsd + Number(line.debitUsd || 0),
      creditUsd: acc.creditUsd + Number(line.creditUsd || 0)
    }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    const normalizedReference = String(settlement.reference || '').trim().replace(/\s+/g, '').toUpperCase();
    const duplicateBankReference = bankTransfer && normalizedReference && asArray(nextState.creditSettlements).some(item =>
      item.id !== settlement.id && item.companyId === target.companyId &&
      item.bankAccountId === settlement.bankAccountId && !item.isReversed &&
      String(item.reference || '').trim().replace(/\s+/g, '').toUpperCase() === normalizedReference
    );
    const duplicateWithoutReference = !normalizedReference && asArray(nextState.creditSettlements).some(item =>
      item.id !== settlement.id && item.companyId === target.companyId &&
      item.documentId === settlement.documentId && item.kind === 'SALE_COLLECTION' && !item.isReversed &&
      !String(item.reference || '').trim() && item.settlementDate === settlement.settlementDate &&
      Math.round(Number(item.amountUsd || 0) * 100) === Math.round(amountUsd * 100) &&
      item.method === settlement.method && item.bankAccountId === settlement.bankAccountId &&
      Math.round(Number(item.bcvRate || 0) * 1000000) === Math.round(settlementRate * 1000000)
    );
    if (target.isCancelled || target.paymentTerm !== 'CREDITO' ||
        !isValidIsoDate(settlement.settlementDate) ||
        settlement.settlementDate < String(target.invoiceDate) ||
        !['CASH_BS', 'CASH_USD', 'BANK_TRANSFER_BS', 'BANK_TRANSFER_USD'].includes(settlement.method) ||
        (bankTransfer && !normalizedReference) ||
        !Number.isFinite(amountUsd) || amountUsd <= 0 ||
        !Number.isFinite(amountBs) || amountBs <= 0 ||
        !Number.isFinite(settlementRate) || settlementRate <= 0 ||
        !Number.isFinite(invoiceRate) || invoiceRate <= 0 ||
        Math.abs(amountBs - expectedCashBs) >= 0.01 ||
        !sourceJournal || sourceJournal.companyId !== target.companyId ||
        sourceJournal.type !== expectedSourceType || sourceReceivable.length === 0 ||
        !receivableAccount || receivableAccount.type !== 'ACTIVO' || receivableAccount.isMovement !== true ||
        !cashAccount || cashAccount.type !== 'ACTIVO' || cashAccount.isMovement !== true || !bankValid ||
        !journal || journal.companyId !== target.companyId || journal.type !== 'AJUSTE' ||
        journal.date !== settlement.settlementDate || journal.referenceDoc !== target.invoiceNumber ||
        Math.abs(cashDebit - amountBs) > 0.02 || Math.abs(cashCredit) > 0.01 ||
        Math.abs(cashDebitUsd - amountUsd) > 0.0001 || Math.abs(cashCreditUsd) > 0.0001 ||
        Math.abs(receivableCredit - expectedReceivableBs) > 0.02 || Math.abs(receivableDebit) > 0.01 ||
        Math.abs(receivableCreditUsd - amountUsd) > 0.0001 || Math.abs(receivableDebitUsd) > 0.0001 ||
        Math.abs(fxLineAmount - fxAmount) > 0.02 ||
        asArray(journal.items).some(line => !allowedCodes.has(line.accountCode)) ||
        Math.abs(totals.debitBs - totals.creditBs) > 0.02 ||
        Math.abs(totals.debitUsd - totals.creditUsd) > 0.0001 ||
        duplicateBankReference || duplicateWithoutReference) {
      throw new Error('SQLite rechazó el cobro de una factura/ND de venta: documento, CxC, tesorería, referencia, diferencial cambiario o asiento no concilian.');
    }
  }

  // Cobros, notas de crédito y ND deben compartir un único límite de CxC.
  for (const sale of asArray(nextState.sales).filter(item =>
    ['01', '02'].includes(item.documentType) && item.paymentTerm === 'CREDITO' && !item.isCancelled)) {
    const collectedUsd = asArray(nextState.creditSettlements).filter(item =>
      item.companyId === sale.companyId && item.documentId === sale.id &&
      item.kind === 'SALE_COLLECTION' && !item.isReversed)
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const creditedUsd = asArray(nextState.sales).filter(item =>
      item.companyId === sale.companyId && item.originalSaleId === sale.id &&
      item.documentType === '03' && !item.isCancelled)
      .reduce((sum, item) => sum + Number(item.netReceivableAdjustmentUsd || 0), 0);
    const debitedUsd = asArray(nextState.sales).filter(item =>
      item.companyId === sale.companyId && item.originalSaleId === sale.id &&
      item.documentType === '02' && !item.isCancelled)
      .reduce((sum, item) => sum + Number(item.netReceivableAdjustmentUsd || 0), 0);
    const netReceivableUsd = Number(sale.totalAmountUsd) - Number(sale.vatWithheldUsd || 0);
    if (collectedUsd + creditedUsd > netReceivableUsd + debitedUsd + 0.005) {
      throw new Error('SQLite rechazó el lote: cobros y notas de crédito superan el principal neto de CxC.');
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
      // The target invoice may be part of this same atomic import batch.
      // Resolve its immutable journal from the complete next snapshot, not only
      // from the previously persisted state.
      const originalPurchaseJournal = target?.journalEntryId
        ? nextById.get(String(target.journalEntryId))
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

module.exports = { validateAccountingSnapshot, validateNewAccountCatalogEntries, validateFixedAssetLedger, exceedsUsdPayable };
