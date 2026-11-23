/**
 * Turkish-locale number, currency, percentage, and Istanbul date/time formatters
 * for the mobile app. Missing, null, NaN, or non-finite values always render as
 * `EMPTY_VALUE` ("—") and are never coerced to 0.
 */

export const EMPTY_VALUE = "—";
export const MINUS_SIGN = "−";

const ISTANBUL_TZ = "Europe/Istanbul";

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Building an Intl formatter is expensive on Hermes; list rows and charts format
// thousands of values, so one formatter per decimal count is reused.
const numberFormatters = new Map<number, Intl.NumberFormat>();

function numberFormatter(decimals: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("tr-TR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatters.set(decimals, formatter);
  }
  return formatter;
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const formatted = numberFormatter(decimals).format(value);
  return formatted.startsWith("-") ? `${MINUS_SIGN}${formatted.slice(1)}` : formatted;
}

export function formatInteger(value: number | null | undefined): string {
  return formatNumber(value, 0);
}

export function formatPrice(value: number | null | undefined, decimals = 2, currency = "₺"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${formatNumber(value, decimals)} ${currency}`;
}

export function formatSignedPrice(value: number | null | undefined, decimals = 2, currency = "₺"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = formatNumber(Math.abs(value), decimals);
  if (Math.abs(value) < 10 ** -(decimals + 1)) return `${abs} ${currency}`;
  const sign = value > 0 ? "+" : MINUS_SIGN;
  return `${sign}${abs} ${currency}`;
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  // Turkish writes the sign before the percent sign: "−%1,9", not "%−1,9".
  const body = formatNumber(Math.abs(value), decimals);
  return value < 0 && body !== formatNumber(0, decimals) ? `${MINUS_SIGN}%${body}` : `%${body}`;
}

export function formatSignedPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = formatNumber(Math.abs(value), decimals);
  if (Math.abs(value) < 0.005 && decimals <= 2) return `%${abs}`;
  const sign = value > 0 ? "+" : MINUS_SIGN;
  return `${sign}%${abs}`;
}

export function formatSignedPp(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = formatNumber(Math.abs(value), decimals);
  if (Math.abs(value) < 10 ** -(decimals + 1)) return `${abs} puan`;
  const sign = value > 0 ? "+" : MINUS_SIGN;
  return `${sign}${abs} puan`;
}

export function formatBp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const rounded = Math.round(value);
  if (rounded === 0) return "0 bp";
  const sign = rounded > 0 ? "+" : MINUS_SIGN;
  return `${sign}${formatInteger(Math.abs(rounded))} bp`;
}

export function formatRatio(value: number | null | undefined, decimals = 2, suffix = "x"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${formatNumber(value, decimals)}${suffix}`;
}

export function formatCompactTry(value: number | null | undefined, currency = "₺"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS_SIGN : "";
  if (abs >= 1e12) return `${sign}${formatNumber(abs / 1e12, 2)} Tr ${currency}`;
  if (abs >= 1e9) return `${sign}${formatNumber(abs / 1e9, 2)} Mr ${currency}`;
  if (abs >= 1e6) return `${sign}${formatNumber(abs / 1e6, 1)} Mn ${currency}`;
  if (abs >= 1e3) return `${sign}${formatNumber(abs / 1e3, 1)} B ${currency}`;
  return `${sign}${formatNumber(abs, 0)} ${currency}`;
}

/**
 * Compact money for macro aggregates: "$2,7 Mr", "−$6,7 Mr", "−481,1 Mr ₺".
 * `signed` adds "+" to positive values (balances and changes).
 */
export function formatCompactMoney(
  value: number | null | undefined,
  currency: "USD" | "TRY",
  signed = false,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS_SIGN : signed && value > 0 ? "+" : "";
  let body: string;
  if (abs >= 1e12) body = `${formatNumber(abs / 1e12, 2)} Tr`;
  else if (abs >= 1e9) body = `${formatNumber(abs / 1e9, 1)} Mr`;
  else if (abs >= 1e6) body = `${formatNumber(abs / 1e6, 1)} Mn`;
  else if (abs >= 1e3) body = `${formatNumber(abs / 1e3, 1)} B`;
  else body = formatNumber(abs, 0);
  return currency === "USD" ? `${sign}$${body}` : `${sign}${body} ₺`;
}

export function formatCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS_SIGN : "";
  if (abs >= 1e9) return `${sign}${formatNumber(abs / 1e9, 2)} Mr`;
  if (abs >= 1e6) return `${sign}${formatNumber(abs / 1e6, 2)} Mn`;
  if (abs >= 1e3) return `${sign}${formatNumber(abs / 1e3, 1)} B`;
  return `${sign}${formatInteger(abs)}`;
}

/** Formats a TRY financial statement figure into Million TRY (matching web FinancialStatements). */
export function formatMillions(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const millions = value / 1_000_000;
  if (Math.round(millions * 10 ** decimals) === 0) return formatNumber(0, decimals);
  return formatNumber(millions, decimals);
}

/** Chooses 0 decimals for large statement rows and 1 decimal when all non-null figures are < 10 Mn. */
export function statementRowDecimals(values: ReadonlyArray<number | null>): number {
  const millions = values.filter((v): v is number => v !== null && Number.isFinite(v)).map((v) => v / 1_000_000);
  if (millions.length === 0) return 0;
  return millions.some((m) => Math.abs(m) >= 10) || millions.every((m) => Number.isInteger(m)) ? 0 : 1;
}

export function formatMarketValue(
  value: number | null | undefined,
  unit: "TRY" | "USD" | "percent" | "index" | string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  if (unit === "percent") return formatPercent(value, 2);
  if (unit === "TRY") return `${formatNumber(value, value >= 100 ? 2 : 4)} ₺`;
  if (unit === "USD") return `$${formatNumber(value, value >= 100 ? 2 : 2)}`;
  return formatNumber(value, 2);
}

export function parseIsoOrEpoch(input: string | number | null | undefined): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  const kap = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (kap) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = kap;
    const ms = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}+03:00`);
    return Number.isFinite(ms) ? ms : null;
  }
  let iso = s.includes("T") ? s : s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += "T00:00:00";
  if (/^\d{4}-\d{2}$/.test(iso)) iso += "-01T00:00:00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "+03:00";
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function formatIstanbulDate(input: string | number | null | undefined): string {
  const ms = parseIsoOrEpoch(input);
  if (ms === null) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatIstanbulShortDate(input: string | number | null | undefined): string {
  const ms = parseIsoOrEpoch(input);
  if (ms === null) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TZ,
    day: "2-digit",
    month: "short",
  }).format(new Date(ms));
}

export function formatIstanbulDateTime(input: string | number | null | undefined): string {
  const ms = parseIsoOrEpoch(input);
  if (ms === null) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatIstanbulTime(input: string | number | null | undefined): string {
  const ms = parseIsoOrEpoch(input);
  if (ms === null) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: ISTANBUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function formatMonthYear(input: string | null | undefined): string {
  if (!input) return EMPTY_VALUE;
  const match = input.match(/^(\d{4})-(\d{2})/);
  if (!match) return formatIstanbulDate(input);
  const ms = Date.parse(`${match[1]}-${match[2]}-15T12:00:00Z`);
  if (!Number.isFinite(ms)) return input;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  }).format(new Date(ms));
}

export function formatFreshnessStamp(input: string | number | null | undefined, nowMs = Date.now()): string {
  const ms = parseIsoOrEpoch(input);
  if (ms === null) return EMPTY_VALUE;
  const ageSec = Math.floor((nowMs - ms) / 1000);
  if (ageSec >= 0 && ageSec < 60) return "Az önce";
  if (ageSec >= 60 && ageSec < 3600) return `${Math.floor(ageSec / 60)} dk önce`;
  return formatIstanbulDateTime(ms);
}
