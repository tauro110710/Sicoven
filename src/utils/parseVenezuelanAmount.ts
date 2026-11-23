/** Parses Venezuelan decimal inputs, accepting either decimal comma or decimal point. */
export const parseVenezuelanAmount = (value: string): number => {
  const raw = String(value ?? '').trim();
  if (!raw) return Number.NaN;
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
};
