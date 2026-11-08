'use strict';

const COMPANY_SCOPED_ARRAY_FIELDS = Object.freeze([
  'journalEntries',
  'purchases',
  'sales',
  'products',
  'customers',
  'suppliers',
  'movements',
  'fixedAssets',
  'vatVouchers',
  'vatWithholdingDeclarations',
  'islrVouchers',
  'bankAccounts',
  'bankStatementMovements',
  'creditSettlements',
  'supplierAdvanceSettlements',
  'supplierDirectAdvances',
  'islrFiscalEvents',
  'financialDisclosures'
]);
const RELATIONAL_ARRAY_FIELDS = Object.freeze(['vatWithholdingDeclarationEvents']);
const ALL_TENANT_ARRAY_FIELDS = Object.freeze([...COMPANY_SCOPED_ARRAY_FIELDS, ...RELATIONAL_ARRAY_FIELDS]);

function requireArray(state, field) {
  if (!Array.isArray(state[field])) {
    throw new Error('El estado contable no contiene una colección válida: ' + field + '.');
  }
  return state[field];
}

function partitionAccountingSnapshot(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('El snapshot contable debe ser un objeto.');
  }
  if (!Array.isArray(state.companies)) throw new Error('El snapshot no contiene el registro de empresas.');
  const companies = state.companies;
  const companyById = new Map();
  for (const company of companies) {
    const id = String(company?.id || '').trim();
    if (!id || companyById.has(id)) throw new Error('El snapshot contiene empresas con identificadores vacíos o duplicados.');
    companyById.set(id, company);
  }
  const currentCompanyId = String(state.currentCompanyId || '');
  if (currentCompanyId && !companyById.has(currentCompanyId)) {
    throw new Error('La empresa activa no existe en el snapshot contable.');
  }

  const rowsByCompany = new Map([...companyById.keys()].map(id => [id, Object.fromEntries(ALL_TENANT_ARRAY_FIELDS.map(field => [field, []]))]));
  const declarationCompanyById = new Map();
  for (const declaration of requireArray(state, 'vatWithholdingDeclarations')) {
    const id = String(declaration?.id || '');
    const companyId = String(declaration?.companyId || '');
    if (!id || !companyById.has(companyId) || declarationCompanyById.has(id)) {
      throw new Error('Una declaración de retenciones IVA no tiene una empresa válida o posee un identificador duplicado.');
    }
    declarationCompanyById.set(id, companyId);
  }

  for (const field of COMPANY_SCOPED_ARRAY_FIELDS) {
    for (const item of requireArray(state, field)) {
      const companyId = String(item?.companyId || '');
      if (!companyId || !companyById.has(companyId)) {
        throw new Error('El registro de ' + field + ' no tiene una empresa propietaria válida. Se bloqueó la separación para evitar mezclar datos.');
      }
      rowsByCompany.get(companyId)[field].push(item);
    }
  }

  for (const event of requireArray(state, 'vatWithholdingDeclarationEvents')) {
    const declarationId = String(event?.declarationId || '');
    const companyId = declarationCompanyById.get(declarationId);
    if (!companyId || (event.companyId && String(event.companyId) !== companyId)) {
      throw new Error('Un evento de declaración IVA no se puede vincular de forma inequívoca a su empresa.');
    }
    rowsByCompany.get(companyId).vatWithholdingDeclarationEvents.push(event);
  }

  return companies.map(company => {
    const companyId = String(company.id);
    return {
      ...state,
      companies: [company],
      currentCompanyId: companyId,
      ...rowsByCompany.get(companyId)
    };
  });
}

function createEmptyAccountingSnapshot() {
  return {
    companies: [],
    currentCompanyId: '',
    accounts: [],
    journalEntries: [],
    purchases: [],
    sales: [],
    products: [],
    customers: [],
    suppliers: [],
    movements: [],
    fixedAssets: [],
    vatVouchers: [],
    vatWithholdingDeclarations: [],
    vatWithholdingDeclarationEvents: [],
    islrVouchers: [],
    bankAccounts: [],
    bankStatementMovements: [],
    creditSettlements: [],
    supplierAdvanceSettlements: [],
    supplierDirectAdvances: [],
    islrFiscalEvents: [],
    financialDisclosures: [],
    displayCurrency: 'DUAL'
  };
}

function mergeAccountingSnapshots(snapshots, preferredCompanyId = '') {
  if (!Array.isArray(snapshots)) throw new TypeError('La lista de snapshots por empresa debe ser un arreglo.');
  if (snapshots.length === 0) return createEmptyAccountingSnapshot();

  const companies = [];
  const seenCompanies = new Set();
  const merged = { ...snapshots[0] };
  for (const field of ALL_TENANT_ARRAY_FIELDS) merged[field] = [];
  let accountsJson = JSON.stringify(snapshots[0].accounts || []);
  let displayCurrency = snapshots[0].displayCurrency || 'DUAL';

  for (const snapshot of snapshots) {
    if (!snapshot || !Array.isArray(snapshot.companies) || snapshot.companies.length !== 1) {
      throw new Error('Cada base SQLite debe contener exactamente una empresa.');
    }
    const company = snapshot.companies[0];
    const companyId = String(company?.id || '');
    if (!companyId || seenCompanies.has(companyId) || String(snapshot.currentCompanyId || '') !== companyId) {
      throw new Error('Las bases SQLite contienen empresas duplicadas o una identidad interna inconsistente.');
    }
    seenCompanies.add(companyId);
    companies.push(company);
    if (JSON.stringify(snapshot.accounts || []) !== accountsJson) {
      throw new Error('Los planes de cuentas locales no coinciden entre empresas. Se bloqueó la carga para evitar un catálogo contable ambiguo.');
    }
    if ((snapshot.displayCurrency || 'DUAL') !== displayCurrency) {
      throw new Error('La preferencia de moneda de visualización no coincide entre las bases locales.');
    }
    for (const field of ALL_TENANT_ARRAY_FIELDS) {
      merged[field].push(...requireArray(snapshot, field));
    }
  }

  const activeCompanyId = String(preferredCompanyId || '');
  merged.companies = companies;
  merged.currentCompanyId = seenCompanies.has(activeCompanyId) ? activeCompanyId : companies[0].id;
  merged.accounts = snapshots[0].accounts || [];
  merged.displayCurrency = displayCurrency;
  return merged;
}

module.exports = {
  COMPANY_SCOPED_ARRAY_FIELDS,
  RELATIONAL_ARRAY_FIELDS,
  ALL_TENANT_ARRAY_FIELDS,
  partitionAccountingSnapshot,
  mergeAccountingSnapshots,
  createEmptyAccountingSnapshot
};
