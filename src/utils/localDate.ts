/**
 * Fecha de calendario local en formato YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` usa UTC: en Venezuela (UTC-4), desde
 * las 20:00 locales devuelve el día siguiente. Las fechas de documentos,
 * comprobantes y asientos deben usar el día local del usuario.
 */
export function toLocalIsoDate(
  date: Date = new Date(),
  timezoneOffsetMinutes: number = date.getTimezoneOffset()
): string {
  return new Date(date.getTime() - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function todayLocalIso(): string {
  return toLocalIsoDate();
}
