/**
 * Validación de dominio de los importes de una compra, ejecutada antes de
 * cualquier escritura persistente (asiento, comprobante, Kardex o registro).
 *
 * No sustituye al motor fiscal: comprueba tipos, finitud, signo, límites de
 * retención y consistencia de los equivalentes USD. El desglose IVA/suntuario
 * se valida después con `assertFiscalBreakdown`.
 */

import { isSupportedFiscalRate } from './vatFiscalEngine';

export interface PurchaseAmountInput {
  totalAmountBs: number;
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs?: number;
  igtfAmountBs?: number;
  vatWithheldBs: number;
  islrWithheldBs?: number;
  retentionRate?: number;
  islrRate?: number;
  islrSubtrahendBs?: number;
  taxRate?: number;
  bcvRate?: number;
  totalAmountUsd?: number;
  taxableBaseUsd?: number;
  exemptAmountUsd?: number;
  vatAmountUsd?: number;
  additionalLuxuryTaxUsd?: number;
  vatWithheldUsd?: number;
  islrWithheldUsd?: number;
  igtfAmountUsd?: number;
}

const TOLERANCE_BS = 0.02;
const TOLERANCE_USD = 0.02;

const isProvided = (value: unknown): value is number => value !== undefined && value !== null;

const assertNonNegativeAmount = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(label + ' debe ser un importe numérico, finito y no negativo.');
  }
  return value;
};

const assertOptionalRate = (value: unknown, label: string): void => {
  if (!isProvided(value)) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(label + ' debe ser una tasa numérica entre 0 y 100.');
  }
};

const assertSupportedFiscalRate = (value: unknown, label: string): void => {
  if (!isProvided(value)) return;
  if (!isSupportedFiscalRate(value as number)) {
    throw new Error(label + ' no está admitida: SICOVEN solo acepta 0 %, 8 %, 16 % y 31 % (16 % IVA + 15 % suntuario).');
  }
};

/**
 * Lanza un error con el primer problema encontrado. Un retorno sin excepción
 * significa que la compra puede continuar hacia las validaciones fiscales y
 * contables, todavía sin escrituras.
 */
export function validatePurchaseAmounts(input: PurchaseAmountInput): void {
  const totalAmountBs = assertNonNegativeAmount(input.totalAmountBs, 'El total de la factura');
  const taxableBaseBs = assertNonNegativeAmount(input.taxableBaseBs, 'La base imponible');
  const exemptAmountBs = assertNonNegativeAmount(input.exemptAmountBs, 'El importe exento');
  const vatAmountBs = assertNonNegativeAmount(input.vatAmountBs, 'El IVA');
  const additionalLuxuryTaxBs = assertNonNegativeAmount(input.additionalLuxuryTaxBs ?? 0, 'El impuesto adicional al consumo suntuario');
  const igtfAmountBs = assertNonNegativeAmount(input.igtfAmountBs ?? 0, 'El IGTF');
  const vatWithheldBs = assertNonNegativeAmount(input.vatWithheldBs, 'La retención de IVA');
  const islrWithheldBs = assertNonNegativeAmount(input.islrWithheldBs ?? 0, 'La retención de ISLR');

  if (totalAmountBs <= 0) {
    throw new Error('El total de la factura debe ser mayor que cero.');
  }
  assertSupportedFiscalRate(input.taxRate, 'La alícuota de IVA');
  assertOptionalRate(input.retentionRate, 'La tasa de retención de IVA');
  assertOptionalRate(input.islrRate, 'La tasa de retención de ISLR');
  if (isProvided(input.islrSubtrahendBs)) {
    assertNonNegativeAmount(input.islrSubtrahendBs, 'El sustraendo de ISLR');
  }
  if (isProvided(input.bcvRate) && (typeof input.bcvRate !== 'number' || !Number.isFinite(input.bcvRate) || input.bcvRate < 0)) {
    throw new Error('La tasa BCV debe ser un número finito y no negativo.');
  }

  const fiscalComponents = taxableBaseBs + exemptAmountBs + vatAmountBs + additionalLuxuryTaxBs + igtfAmountBs;
  if (Math.abs(fiscalComponents - totalAmountBs) > TOLERANCE_BS) {
    throw new Error('El total de la factura no coincide con la base imponible, el exento, el IVA, el suntuario y el IGTF declarados.');
  }

  if (vatWithheldBs > vatAmountBs + TOLERANCE_BS) {
    throw new Error('La retención de IVA no puede superar el IVA causado en la factura.');
  }
  if (islrWithheldBs > taxableBaseBs + TOLERANCE_BS) {
    throw new Error('La retención de ISLR no puede superar la base imponible de la factura.');
  }
  if (vatWithheldBs + islrWithheldBs > totalAmountBs + 0.005) {
    throw new Error('La suma de las retenciones de IVA e ISLR no puede superar el total de la factura.');
  }

  const usdAmounts: Array<[keyof PurchaseAmountInput, number, string]> = [
    ['totalAmountUsd', totalAmountBs, 'El total en USD'],
    ['taxableBaseUsd', taxableBaseBs, 'La base imponible en USD'],
    ['exemptAmountUsd', exemptAmountBs, 'El importe exento en USD'],
    ['vatAmountUsd', vatAmountBs, 'El IVA en USD'],
    ['additionalLuxuryTaxUsd', additionalLuxuryTaxBs, 'El suntuario en USD'],
    ['vatWithheldUsd', vatWithheldBs, 'La retención de IVA en USD'],
    ['islrWithheldUsd', islrWithheldBs, 'La retención de ISLR en USD'],
    ['igtfAmountUsd', igtfAmountBs, 'El IGTF en USD']
  ];
  const rate = input.bcvRate;
  const hasRate = isProvided(rate) && Number.isFinite(rate) && rate > 0;
  for (const [key, bsAmount, label] of usdAmounts) {
    const value = input[key];
    if (!isProvided(value)) continue;
    const usd = assertNonNegativeAmount(value, label);
    if (!hasRate) {
      if (usd > 0.005) throw new Error(label + ' no puede ser mayor que cero sin una tasa BCV válida.');
      continue;
    }
    const expected = bsAmount / rate;
    if (Math.abs(usd - expected) > TOLERANCE_USD) {
      throw new Error(label + ' no corresponde al importe en Bs. dividido entre la tasa BCV declarada.');
    }
  }
}
