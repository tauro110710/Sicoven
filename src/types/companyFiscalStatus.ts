import type { Company, IvaRetentionAgentBasis, TaxpayerType } from './accounting';

export type CompanyVatTaxStatus = 'ORDINARY' | 'FORMAL' | 'EXEMPT' | 'EXONERATED' | 'NON_SUBJECT' | 'UNKNOWN';
export type CompanyIgtfAgentStatus = 'AGENT' | 'NOT_AGENT';
export type CompanyPersonalFirmStatus = 'FIRM' | 'NOT_FIRM';
export type CompanyFiscalStatusDimension =
  | 'SENIAT_SPECIAL_TAXPAYER'
  | 'IVA_TAX_STATUS'
  | 'IVA_RETENTION_AGENT'
  | 'IVA_PERSONAL_FIRM'
  | 'IGTF_PERCEPTION_AGENT';

export type CompanyFiscalStatusValue =
  | TaxpayerType
  | CompanyVatTaxStatus
  | IvaRetentionAgentBasis
  | CompanyIgtfAgentStatus
  | CompanyPersonalFirmStatus;

/**
 * Evento histórico append-only. effectiveDate gobierna la condición aplicable;
 * authorityDate y authorityReference identifican el acto/documento que la respalda.
 */
export interface CompanyFiscalStatusEvent {
  id: string;
  dimension: CompanyFiscalStatusDimension;
  status: CompanyFiscalStatusValue;
  effectiveDate: string;
  authorityReference?: string;
  authorityDate?: string;
  supportingDocumentRef?: string;
  notes?: string;
  recordedAt: string;
}

export interface CompanyFiscalProfileAtDate {
  taxpayerType: TaxpayerType;
  ivaTaxStatus: CompanyVatTaxStatus;
  ivaRetentionAgentBasis: IvaRetentionAgentBasis;
  isPersonalFirm: boolean;
  isIgtfPerceptionAgent: boolean;
}

const ALLOWED: Record<CompanyFiscalStatusDimension, readonly string[]> = {
  SENIAT_SPECIAL_TAXPAYER: ['ESPECIAL', 'ORDINARIO'],
  IVA_TAX_STATUS: ['ORDINARY', 'FORMAL', 'EXEMPT', 'EXONERATED', 'NON_SUBJECT', 'UNKNOWN'],
  IVA_RETENTION_AGENT: ['ARTICLE_1_SPECIAL_DESIGNATED', 'ARTICLE_2_METALS', 'ARTICLE_1_AND_2', 'NOT_AGENT', 'UNCONFIRMED'],
  IVA_PERSONAL_FIRM: ['FIRM', 'NOT_FIRM'],
  IGTF_PERCEPTION_AGENT: ['AGENT', 'NOT_AGENT']
};

export function isValidFiscalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateCompanyFiscalStatusEvent(event: CompanyFiscalStatusEvent): string[] {
  const errors: string[] = [];
  if (!event || typeof event !== 'object') return ['El evento fiscal no tiene un formato válido.'];
  if (!event.id?.trim()) errors.push('El evento requiere un identificador.');
  if (typeof event.dimension !== 'string' || !(event.dimension in ALLOWED)) errors.push('Seleccione una dimensión fiscal válida.');
  else if (!ALLOWED[event.dimension].includes(String(event.status))) errors.push('El estado no corresponde a la dimensión fiscal seleccionada.');
  if (!isValidFiscalIsoDate(event.effectiveDate)) errors.push('La fecha de vigencia debe ser una fecha válida.');
  if (!event.recordedAt || !Number.isFinite(Date.parse(event.recordedAt))) errors.push('El evento requiere fecha de registro válida.');
  if (event.authorityReference && event.authorityReference.length > 240) errors.push('La referencia de autoridad supera 240 caracteres.');
  if (event.supportingDocumentRef && event.supportingDocumentRef.length > 500) errors.push('La referencia del soporte supera 500 caracteres.');
  if (event.notes && event.notes.length > 2000) errors.push('Las observaciones superan 2.000 caracteres.');
  if (event.dimension === 'SENIAT_SPECIAL_TAXPAYER' && event.status === 'ESPECIAL') {
    if (!event.authorityReference?.trim()) errors.push('La calificación como Sujeto Pasivo Especial requiere referencia de la notificación expresa del SENIAT.');
    if (!isValidFiscalIsoDate(event.authorityDate)) errors.push('La calificación como Sujeto Pasivo Especial requiere la fecha de la notificación expresa.');
  }
  if (event.authorityDate && !isValidFiscalIsoDate(event.authorityDate)) errors.push('La fecha del documento de autoridad no es válida.');
  return errors;
}

/** Valida que los eventos existentes no se editen ni eliminen al agregar uno nuevo. */
export function validateCompanyFiscalStatusHistory(
  previous: CompanyFiscalStatusEvent[] = [],
  next: CompanyFiscalStatusEvent[] = []
): void {
  if (!Array.isArray(previous) || !Array.isArray(next)) throw new Error('El historial fiscal de la empresa no tiene un formato válido.');
  const oldById = new Map(previous.map(item => [String(item.id), item]));
  const nextById = new Map(next.map(item => [String(item.id), item]));
  if (oldById.size !== previous.length || nextById.size !== next.length) throw new Error('El historial fiscal contiene identificadores duplicados.');
  for (const old of previous) {
    const current = nextById.get(String(old.id));
    if (!current || JSON.stringify(old) !== JSON.stringify(current)) {
      throw new Error('El historial fiscal es inmutable: los eventos existentes no se editan ni eliminan; registre un nuevo evento con su vigencia y soporte.');
    }
  }
  const keys = new Set<string>();
  for (const event of next) {
    const errors = validateCompanyFiscalStatusEvent(event);
    if (errors.length) throw new Error(errors.join(' '));
    const key = event.dimension + '|' + event.effectiveDate;
    if (keys.has(key)) throw new Error('Ya existe un evento para esa dimensión y fecha de vigencia. Use una fecha distinta o revise el evento existente.');
    keys.add(key);
  }
  // Los eventos se incorporan cronológicamente por dimensión. Para corregir
  // información previa debe existir un flujo de rectificación separado: una
  // alta tardía no puede reescribir la condición que sustentó documentos emitidos.
  for (const dimension of Object.keys(ALLOWED) as CompanyFiscalStatusDimension[]) {
    const priorEvents = previous
      .filter(item => item.dimension === dimension && isValidFiscalIsoDate(item.effectiveDate))
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    let lastDate = priorEvents.at(-1)?.effectiveDate || '';
    let lastStatus = priorEvents.at(-1)?.status;
    const additions = next
      .filter(item => !oldById.has(String(item.id)) && item.dimension === dimension)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    for (const event of additions) {
      if (lastDate && event.effectiveDate <= lastDate) {
        throw new Error('Los cambios de esta condición deben registrarse en orden cronológico. No se permite agregar un evento retroactivo que altere la condición usada por operaciones anteriores.');
      }
      if (dimension === 'SENIAT_SPECIAL_TAXPAYER' && lastStatus === 'ESPECIAL' && event.status === 'ORDINARIO' &&
          (!event.authorityReference?.trim() || !isValidFiscalIsoDate(event.authorityDate))) {
        throw new Error('La pérdida de la calificación como Sujeto Pasivo Especial requiere referencia y fecha del acto o notificación individual que la respalda.');
      }
      lastDate = event.effectiveDate;
      lastStatus = event.status;
    }
  }
}

export function resolveCompanyFiscalStatusAtDate(
  company: Pick<Company, 'taxpayerType' | 'ivaTaxStatus' | 'ivaRetentionAgentBasis' | 'isPersonalFirm' | 'isIgtfPerceptionAgent' | 'fiscalStatusHistory'>,
  dimension: CompanyFiscalStatusDimension,
  effectiveDate: string
): CompanyFiscalStatusValue {
  const events = Array.isArray(company.fiscalStatusHistory) ? company.fiscalStatusHistory : [];
  const applicable = events
    .filter(event => event.dimension === dimension && isValidFiscalIsoDate(event.effectiveDate) && event.effectiveDate <= effectiveDate)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.recordedAt.localeCompare(a.recordedAt))[0];
  if (applicable) return applicable.status;
  switch (dimension) {
    case 'SENIAT_SPECIAL_TAXPAYER': return company.taxpayerType;
    case 'IVA_TAX_STATUS': return company.ivaTaxStatus || 'UNKNOWN';
    case 'IVA_RETENTION_AGENT': return company.ivaRetentionAgentBasis || 'UNCONFIRMED';
    case 'IVA_PERSONAL_FIRM': return company.isPersonalFirm === true ? 'FIRM' : 'NOT_FIRM';
    case 'IGTF_PERCEPTION_AGENT': return company.isIgtfPerceptionAgent === true ? 'AGENT' : 'NOT_AGENT';
  }
}

export function resolveCompanyFiscalProfileAtDate(
  company: Pick<Company, 'taxpayerType' | 'ivaTaxStatus' | 'ivaRetentionAgentBasis' | 'isPersonalFirm' | 'isIgtfPerceptionAgent' | 'fiscalStatusHistory'>,
  effectiveDate: string
): CompanyFiscalProfileAtDate {
  return {
    taxpayerType: resolveCompanyFiscalStatusAtDate(company, 'SENIAT_SPECIAL_TAXPAYER', effectiveDate) as TaxpayerType,
    ivaTaxStatus: resolveCompanyFiscalStatusAtDate(company, 'IVA_TAX_STATUS', effectiveDate) as CompanyVatTaxStatus,
    ivaRetentionAgentBasis: resolveCompanyFiscalStatusAtDate(company, 'IVA_RETENTION_AGENT', effectiveDate) as IvaRetentionAgentBasis,
    isPersonalFirm: resolveCompanyFiscalStatusAtDate(company, 'IVA_PERSONAL_FIRM', effectiveDate) === 'FIRM',
    isIgtfPerceptionAgent: resolveCompanyFiscalStatusAtDate(company, 'IGTF_PERCEPTION_AGENT', effectiveDate) === 'AGENT'
  };
}
