/**
 * Núcleo de cálculo de nómina SICOVEN.
 *
 * No contiene porcentajes legales predeterminados. Cada parámetro debe ser
 * suministrado por una regla identificada, fechada y respaldada por fuente.
 * Esto evita que una tasa histórica se aplique como si siguiera vigente.
 */
export type PayrollFrequency = 'WEEKLY' | 'BIWEEKLY';
export type PayrollBaseKey = 'normalSalary' | 'integralSalary' | 'grossSalary';

export interface PayrollEmployee {
  id: string;
  companyId: string;
  fiscalId: string;
  fullName: string;
  hireDate: string;
  position: string;
  costCenter?: string;
  frequency: PayrollFrequency;
  baseSalary: number;
}

export interface PayrollEarning {
  code: string;
  description: string;
  amount: number;
  isSalary: boolean;
}

export interface PayrollDeduction {
  code: string;
  description: string;
  amount: number;
}

export interface PayrollBases {
  normalSalary: number;
  integralSalary: number;
  grossSalary: number;
}

export interface PayrollLegalRule {
  code: string;
  description: string;
  base: PayrollBaseKey;
  workerRate: number;
  employerRate: number;
  /** Tope de base imponible, no tope de contribución. */
  baseCap?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  sourceReference: string;
  verifiedAt: string;
}

export interface PayrollContributionLine {
  code: string;
  description: string;
  base: number;
  workerAmount: number;
  employerAmount: number;
  sourceReference: string;
}

export interface PayrollCalculation {
  periodEnd: string;
  grossEarnings: number;
  salaryEarnings: number;
  bases: PayrollBases;
  contributions: PayrollContributionLine[];
  workerLegalDeductions: number;
  employerContributions: number;
  otherDeductions: number;
  netPay: number;
  totalEmployerCost: number;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(label + ' debe ser un importe numérico igual o mayor que cero.');
  }
}

/**
 * Calcula solo conceptos parametrizados y trazables.
 * No decide por sí mismo qué conceptos integran salario normal o integral:
 * esas bases deben llegar calculadas desde reglas legales verificadas.
 */
export function calculatePayroll(input: {
  periodEnd: string;
  earnings: PayrollEarning[];
  deductions?: PayrollDeduction[];
  bases: PayrollBases;
  rules: PayrollLegalRule[];
}): PayrollCalculation {
  if (!validDate(input.periodEnd)) throw new Error('La fecha final del período no es válida.');
  if (!Array.isArray(input.earnings) || input.earnings.length === 0) {
    throw new Error('La nómina requiere al menos una asignación.');
  }

  for (const key of ['normalSalary', 'integralSalary', 'grossSalary'] as const) {
    assertAmount(input.bases[key], 'La base ' + key);
  }

  const earnings = input.earnings.map(line => {
    if (!line.code.trim() || !line.description.trim()) throw new Error('Cada asignación requiere código y descripción.');
    assertAmount(line.amount, 'La asignación ' + line.description);
    return { ...line, amount: roundMoney(line.amount) };
  });
  const deductions = (input.deductions || []).map(line => {
    if (!line.code.trim() || !line.description.trim()) throw new Error('Cada deducción requiere código y descripción.');
    assertAmount(line.amount, 'La deducción ' + line.description);
    return { ...line, amount: roundMoney(line.amount) };
  });

  const grossEarnings = roundMoney(earnings.reduce((sum, line) => sum + line.amount, 0));
  const salaryEarnings = roundMoney(earnings.filter(line => line.isSalary).reduce((sum, line) => sum + line.amount, 0));
  const seenRules = new Set<string>();

  const contributions = input.rules.map(rule => {
    if (!rule.code.trim() || seenRules.has(rule.code)) throw new Error('Hay reglas legales vacías o duplicadas: ' + rule.code + '.');
    seenRules.add(rule.code);
    if (!rule.sourceReference.trim() || !validDate(rule.verifiedAt) || !validDate(rule.effectiveFrom) ||
        (rule.effectiveTo && !validDate(rule.effectiveTo))) {
      throw new Error('La regla ' + rule.code + ' carece de fuente o fechas verificables.');
    }
    if (input.periodEnd < rule.effectiveFrom || (rule.effectiveTo && input.periodEnd > rule.effectiveTo)) {
      throw new Error('La regla ' + rule.code + ' no está vigente para la fecha del período.');
    }
    for (const [label, rate] of [['tasa del trabajador', rule.workerRate], ['tasa patronal', rule.employerRate]] as const) {
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('La ' + label + ' de ' + rule.code + ' no es válida.');
    }
    if (rule.baseCap !== undefined) assertAmount(rule.baseCap, 'El tope de base de ' + rule.code);
    const rawBase = input.bases[rule.base];
    const base = roundMoney(rule.baseCap === undefined ? rawBase : Math.min(rawBase, rule.baseCap));
    return {
      code: rule.code,
      description: rule.description,
      base,
      workerAmount: roundMoney(base * rule.workerRate),
      employerAmount: roundMoney(base * rule.employerRate),
      sourceReference: rule.sourceReference
    };
  });

  const workerLegalDeductions = roundMoney(contributions.reduce((sum, line) => sum + line.workerAmount, 0));
  const employerContributions = roundMoney(contributions.reduce((sum, line) => sum + line.employerAmount, 0));
  const otherDeductions = roundMoney(deductions.reduce((sum, line) => sum + line.amount, 0));
  const netPay = roundMoney(grossEarnings - workerLegalDeductions - otherDeductions);
  if (netPay < 0) throw new Error('Las deducciones superan las asignaciones; revise la nómina antes de continuar.');

  return {
    periodEnd: input.periodEnd,
    grossEarnings,
    salaryEarnings,
    bases: { ...input.bases },
    contributions,
    workerLegalDeductions,
    employerContributions,
    otherDeductions,
    netPay,
    totalEmployerCost: roundMoney(grossEarnings + employerContributions)
  };
}
