export type SeniatVatCalendarWindow = 'FIRST_HALF' | 'SECOND_HALF';

export interface SeniatVatDueDate {
  dueDate: string;
  sourceTitle: string;
  sourceReference: string;
  sourceUrl: string;
}

const FIRST_HALF_DAYS: number[][] = [
  [28, 20, 25, 23, 20, 29, 27, 31, 29, 20, 27, 16],
  [19, 23, 20, 27, 18, 26, 21, 25, 18, 28, 26, 29],
  [21, 18, 24, 21, 29, 16, 30, 24, 24, 29, 17, 21],
  [30, 18, 23, 30, 22, 18, 23, 18, 21, 23, 23, 28],
  [23, 25, 26, 20, 21, 19, 28, 19, 30, 22, 20, 22],
  [22, 27, 30, 22, 28, 17, 22, 21, 25, 30, 18, 17],
  [20, 19, 27, 24, 19, 30, 20, 28, 28, 21, 25, 18],
  [27, 24, 18, 17, 26, 22, 31, 20, 22, 27, 19, 18],
  [26, 26, 31, 29, 27, 23, 17, 26, 17, 26, 24, 30],
  [29, 27, 17, 28, 25, 25, 29, 27, 23, 19, 30, 23]
];

const SECOND_HALF_DAYS: number[][] = [
  [15, 9, 6, 1, 6, 12, 8, 14, 14, 5, 13, 3],
  [6, 10, 3, 14, 4, 11, 3, 13, 3, 14, 12, 15],
  [8, 5, 9, 8, 14, 3, 14, 12, 10, 15, 2, 4],
  [16, 12, 4, 16, 7, 10, 7, 5, 2, 7, 9, 11],
  [9, 2, 11, 7, 13, 2, 10, 6, 9, 6, 5, 7],
  [5, 13, 12, 9, 15, 8, 6, 3, 15, 8, 4, 10],
  [13, 4, 10, 13, 5, 15, 9, 4, 11, 2, 11, 8],
  [12, 11, 2, 6, 11, 4, 15, 10, 4, 13, 3, 2],
  [7, 3, 13, 10, 12, 5, 2, 7, 8, 9, 6, 9],
  [14, 6, 5, 15, 8, 9, 13, 11, 7, 1, 10, 14]
];

const SOURCE_TITLE = 'Gaceta Oficial N.º 43.273 — Providencia SNAT/2025/000091';
const SOURCE_REFERENCE = 'Calendario 2026 de sujetos pasivos especiales y agentes de retención, artículo 1';
const SOURCE_URL = 'https://iusdata.com/wp-content/uploads/2025/12/1-SENIAT-GO-43.273-2025-DIC-09.pdf';

/**
 * Resolves the 2026 due date only for an Article 1 designated special agent.
 * Article 2 metal buyers that are not also designated special taxpayers must
 * keep a manually verified due date; no calendar is inferred for them.
 */
export function getSeniatVatWithholdingDueDate(
  rif: string,
  period: string,
  window: SeniatVatCalendarWindow,
  agentBasis: string,
  isPersonalFirm = false
): SeniatVatDueDate | null {
  if (!['ARTICLE_1_SPECIAL_DESIGNATED', 'ARTICLE_1_AND_2'].includes(agentBasis)) return null;
  if (!/^2026(?:0[1-9]|1[0-2])$/.test(period)) return null;
  const normalizedRif = String(rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (!/^[VJGEP]\d{8,9}$/.test(normalizedRif)) return null;
  const digits = normalizedRif.replace(/[^0-9]/g, '');
  const lastDigit = digits.slice(-1);
  if (!/^[0-9]$/.test(lastDigit)) return null;
  if (/^[VEP]/.test(normalizedRif) && !isPersonalFirm) return null;

  const periodMonth = Number(period.slice(4, 6));
  const dueMonth = window === 'FIRST_HALF' ? periodMonth : periodMonth + 1;
  if (dueMonth > 12) return null;
  const dueYear = 2026;
  const days = window === 'FIRST_HALF' ? FIRST_HALF_DAYS : SECOND_HALF_DAYS;
  const day = days[Number(lastDigit)][dueMonth - 1];
  const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { dueDate, sourceTitle: SOURCE_TITLE, sourceReference: SOURCE_REFERENCE, sourceUrl: SOURCE_URL };
}
