/** Date-only arithmetic in UTC: browser time zones never move a selected day. */
export function dayKey(year: number, month: number, day = 1): string {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dayParts(value: string): [number, number, number] {
  return [Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))];
}

export function shiftDate(value: string, days: number): string {
  const [year, month, day] = dayParts(value);
  return new Date(Date.UTC(year, month, day + days)).toISOString().slice(0, 10);
}

export function shiftMonth(value: string, months: number): string {
  const [year, month, day] = dayParts(value);
  const target = new Date(Date.UTC(year, month + months, 1));
  const last = new Date(Date.UTC(year, month + months + 1, 0)).getUTCDate();
  return dayKey(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last));
}

export function periodAllowed(year: number, month: number | undefined, min?: string, max?: string): boolean {
  if (year < 100 || year > 9999) return false;
  const start = dayKey(year, month ?? 0);
  const end = month === undefined ? dayKey(year, 11, 31) : dayKey(year, month, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return (!min || end >= min) && (!max || start <= max);
}
