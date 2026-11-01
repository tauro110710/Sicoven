export type VatFiscalIncidentEventType = 'INCIDENT_RECORDED' | 'REVIEW_RECORDED' | 'ACTION_RECORDED';
export type VatFiscalIncidentStatus = 'PENDING_REVIEW' | 'REVIEW_DOCUMENTED' | 'ACTION_DOCUMENTED';

export interface VatFiscalIncidentEvent {
  id: string;
  eventType: VatFiscalIncidentEventType;
  decisionText: string;
  externalReference: string | null;
  journalEntryId: string | null;
  declarationEventIds: string[];
  bankMovementIds: string[];
  actorUserId: number | null;
  actorUsername: string;
  createdAt: string;
}

export interface VatFiscalIncident {
  id: string;
  companyId: string;
  purchaseId: string;
  originalPurchaseId: string;
  documentType: '01' | '02' | '03';
  documentNumber: string;
  affectedInvoiceNumber: string | null;
  vatVoucherId: string | null;
  declarationId: string | null;
  declarationEventIds: string[];
  bankMovementIds: string[];
  reason: string;
  detectedAt: string;
  createdByUserId: number | null;
  createdByUsername: string;
  createdAt: string;
  events: VatFiscalIncidentEvent[];
  status: VatFiscalIncidentStatus;
  resolved: false;
}

export interface VatFiscalIncidentCreateInput {
  purchaseId: string;
  vatVoucherId?: string;
  declarationId?: string;
  declarationEventIds?: string[];
  bankMovementIds?: string[];
  reason: string;
  detectedAt: string;
}

export interface VatFiscalIncidentEventInput {
  incidentId: string;
  eventType: 'REVIEW_RECORDED' | 'ACTION_RECORDED';
  decisionText: string;
  externalReference?: string;
  declarationId?: string;
  declarationEventIds?: string[];
  bankMovementIds?: string[];
  journalEntryId?: string;
}
