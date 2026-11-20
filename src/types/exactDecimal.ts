/**
 * Exact base-10 arithmetic for historical accounting calculations.
 *
 * Values are represented as an integer coefficient plus a decimal scale.
 * BigInt prevents IEEE-754 rounding during intermediate calculations.
 * No currency-specific rounding is applied implicitly: callers must request
 * a presentation/payment scale explicitly with roundDecimal().
 */

export interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

const MAX_SCALE = 1000;
const POWERS_OF_TEN: bigint[] = [1n];

function powerOfTen(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_SCALE) {
    throw new Error('La escala decimal solicitada está fuera del rango permitido.');
  }
  while (POWERS_OF_TEN.length <= exponent) {
    POWERS_OF_TEN.push(POWERS_OF_TEN[POWERS_OF_TEN.length - 1] * 10n);
  }
  return POWERS_OF_TEN[exponent];
}

function normalize(value: ExactDecimal): ExactDecimal {
  let { coefficient, scale } = value;
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new Error('La escala decimal no es válida.');
  }
  if (coefficient === 0n) return { coefficient: 0n, scale: 0 };
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

/** Parses a canonical decimal string or finite JS number without binary math. */
export function parseDecimal(input: string | number | bigint): ExactDecimal {
  if (typeof input === 'bigint') return { coefficient: input, scale: 0 };
  if (typeof input === 'number' && !Number.isFinite(input)) {
    throw new Error('El importe decimal debe ser finito.');
  }
  const raw = String(input).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error('El importe no tiene un formato decimal válido.');
  const sign = match[1] === '-' ? -1n : 1n;
  const fraction = match[3] || '';
  const exponent = match[4] ? Number(match[4]) : 0;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_SCALE) {
    throw new Error('El exponente decimal está fuera del rango permitido.');
  }
  let coefficient = BigInt((match[2] + fraction).replace(/^0+(?=\d)/, '') || '0') * sign;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= powerOfTen(-scale);
    scale = 0;
  }
  return normalize({ coefficient, scale });
}

function align(left: ExactDecimal, right: ExactDecimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * powerOfTen(scale - left.scale),
    right.coefficient * powerOfTen(scale - right.scale),
    scale
  ];
}

export function addDecimal(left: string | number | bigint, right: string | number | bigint): ExactDecimal {
  const [a, b, scale] = align(parseDecimal(left), parseDecimal(right));
  return normalize({ coefficient: a + b, scale });
}

export function subtractDecimal(left: string | number | bigint, right: string | number | bigint): ExactDecimal {
  const [a, b, scale] = align(parseDecimal(left), parseDecimal(right));
  return normalize({ coefficient: a - b, scale });
}

export function multiplyDecimal(left: string | number | bigint, right: string | number | bigint): ExactDecimal {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return normalize({ coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale });
}

/** Divides with an explicit result scale; ties are rounded away from zero. */
export function divideDecimal(
  dividend: string | number | bigint,
  divisor: string | number | bigint,
  decimalPlaces = 18
): ExactDecimal {
  const a = parseDecimal(dividend);
  const b = parseDecimal(divisor);
  if (b.coefficient === 0n) throw new Error('No se puede dividir entre cero.');
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > MAX_SCALE) {
    throw new Error('La precisión de la división no es válida.');
  }
  const numerator = a.coefficient * powerOfTen(b.scale + decimalPlaces);
  const denominator = b.coefficient * powerOfTen(a.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const rounded = absRemainder * 2n >= absDenominator
    ? quotient + (numerator * denominator < 0n ? -1n : 1n)
    : quotient;
  return normalize({ coefficient: rounded, scale: decimalPlaces });
}

/** Explicit decimal rounding, half away from zero; never used implicitly. */
export function roundDecimal(value: string | number | bigint, decimalPlaces: number): ExactDecimal {
  const parsed = parseDecimal(value);
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > MAX_SCALE) {
    throw new Error('La precisión de redondeo no es válida.');
  }
  if (parsed.scale <= decimalPlaces) return parsed;
  const divisor = powerOfTen(parsed.scale - decimalPlaces);
  const quotient = parsed.coefficient / divisor;
  const remainder = parsed.coefficient % divisor;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const rounded = absRemainder * 2n >= divisor
    ? quotient + (parsed.coefficient < 0n ? -1n : 1n)
    : quotient;
  return normalize({ coefficient: rounded, scale: decimalPlaces });
}

export function compareDecimal(left: string | number | bigint, right: string | number | bigint): -1 | 0 | 1 {
  const [a, b] = align(parseDecimal(left), parseDecimal(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

export function decimalToString(value: ExactDecimal): string {
  const normalized = normalize(value);
  const negative = normalized.coefficient < 0n;
  let digits = (negative ? -normalized.coefficient : normalized.coefficient).toString();
  if (normalized.scale > 0) {
    digits = digits.padStart(normalized.scale + 1, '0');
    const split = digits.length - normalized.scale;
    digits = digits.slice(0, split) + '.' + digits.slice(split);
  }
  return (negative ? '-' : '') + digits;
}

/** Explicit legacy/UI boundary; exact source values should remain decimal strings. */
export function decimalToNumber(value: ExactDecimal): number {
  const result = Number(decimalToString(value));
  if (!Number.isFinite(result)) throw new Error('El importe decimal excede el rango numérico de presentación.');
  return result;
}
