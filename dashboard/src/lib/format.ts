import type { Locale } from "./i18n";

/**
 * Locale-aware display formatters. Every number/date shown in the UI goes
 * through these helpers so separators, percent placement, compact suffixes
 * (tr: bin/Mn/Mr/Tn, en: K/M/B/T) and month names follow the selected language.
 */

const INTL_LOCALES: Record<Locale, string> = { tr: "tr-TR", en: "en-US", fr: "fr-FR" };

let activeLocale: Locale = "tr";

/** Called by LocaleProvider during render so formatters follow the UI language. */
export function setFormatLocale(locale: Locale) {
  activeLocale = locale;
}

export function getIntlLocale(): string {
  return INTL_LOCALES[activeLocale];
}

/** Placeholder rendered for missing values. Compare against this, never a literal. */
export const EMPTY_VALUE = "—";

function isMissing(val: unknown): val is null | undefined {
  return val === null || val === undefined || (typeof val === "number" && Number.isNaN(val));
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${activeLocale}|${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getIntlLocale(), options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${activeLocale}|${JSON.stringify(options)}`;
  let formatter = dateFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(getIntlLocale(), options);
    dateFormatCache.set(key, formatter);
  }
  return formatter;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** 13233.58 → "13.233,58" (tr) / "13,233.58" (en). */
export function formatNumber(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return numberFormat({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(val));
}

/** Price with 2 decimals: 302.5 → "302,50". */
export function formatPrice(val?: number | null): string {
  return formatNumber(val, 2);
}

/** Abbreviated magnitude: 436.4e9 → "436,4 Mr" (tr) / "436.4B" (en); 5900 → "5,9 bin" / "5.9K". */
export function formatCompact(val?: number | null, maxFractionDigits = 1): string {
  if (isMissing(val)) return EMPTY_VALUE;
  const num = Number(val);
  // CLDR abbreviates Turkish thousands as "B" (bin), which readers take for "billion"
  // next to "Mn"/"Mr" — a 10^6 misread on volume columns. Spell it out instead.
  if (activeLocale === "tr") {
    const scale = 10 ** maxFractionDigits;
    // Round the magnitude half away from zero like Intl does, so negatives mirror
    // positives and 999,95 (which Intl rounds up to "1 B") is caught as well.
    const magnitude = Math.abs(num);
    if (Math.round(magnitude * scale) / scale >= 1e3) {
      const thousands = Math.round((magnitude / 1e3) * scale) / scale;
      // 999.950 rounds to 1.000 bin — let the compact formatter render it as "1 Mn".
      if (thousands < 1e3) {
        return `${numberFormat({ maximumFractionDigits: maxFractionDigits }).format(Math.sign(num) * thousands)} bin`;
      }
    }
  }
  return numberFormat({ notation: "compact", maximumFractionDigits: maxFractionDigits }).format(num);
}

/** Unsigned percentage for ratios/levels: 16.28 → "%16,28" (tr) / "16.28%" (en). Input is already in percent units. */
export function formatPercent(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return numberFormat({ style: "percent", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
    Number(val) / 100,
  );
}

/** Signed percentage change: 1.51 → "+%1,51", -0.78 → "-%0,78" (tr) / "+1.51%" (en). Input in percent units. */
export function formatChangePercent(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return numberFormat({
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val) / 100);
}

/** Signed absolute change: -104.11 → "-104,11", 3 → "+3,00". */
export function formatSigned(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return numberFormat({
    signDisplay: "exceptZero",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val));
}

/** Turkish lira amount: 455 → "₺455,00". */
export function formatCurrency(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return numberFormat({
    style: "currency",
    currency: "TRY",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val));
}

/** Multiple/ratio: 5.72 → "5,72x". */
export function formatMultiple(val?: number | null, decimals = 2): string {
  if (isMissing(val)) return EMPTY_VALUE;
  return `${formatNumber(val, decimals)}x`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Parses the date shapes the backend emits without timezone surprises:
 * KAP "DD.MM.YYYY HH:mm(:ss)", plain "YYYY-MM-DD" (kept as a local calendar
 * day instead of UTC midnight), "MM-YYYY"/"YYYY-MM" periods and ISO datetimes.
 */
export function parseDate(val?: string | number | Date | null): Date | null {
  if (val === null || val === undefined || val === "") return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = val.trim();
  // KAP timestamps: passing them to Date directly swaps day/month.
  const kap = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (kap) {
    return new Date(+kap[3], +kap[2] - 1, +kap[1], +(kap[4] ?? 0), +(kap[5] ?? 0), +(kap[6] ?? 0));
  }
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
  const my = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (my) return new Date(+my[2], +my[1] - 1, 1);
  const ym = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (ym) return new Date(+ym[1], +ym[2] - 1, 1);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date + time: "5 Ağu 2026 18:35". Falls back to the raw input when unparseable. */
export function formatDate(dateStr?: string | number | Date | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === "") return EMPTY_VALUE;
  const date = parseDate(dateStr);
  if (!date) return String(dateStr);
  return dateFormat({ dateStyle: "medium", timeStyle: "short" }).format(date);
}

/** Calendar day only: "2025-09-02" → "2 Eyl 2025". */
export function formatDay(dateStr?: string | number | Date | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === "") return EMPTY_VALUE;
  const date = parseDate(dateStr);
  if (!date) return String(dateStr);
  return dateFormat({ day: "numeric", month: "short", year: "numeric" }).format(date);
}

/** Month period: "08-2026" / "2026-08" → "Ağu 2026". */
export function formatMonthYear(dateStr?: string | number | Date | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === "") return EMPTY_VALUE;
  const date = parseDate(dateStr);
  if (!date) return String(dateStr);
  return dateFormat({ month: "short", year: "numeric" }).format(date);
}

/** Clock time: "14:30". */
export function formatTime(dateStr?: string | number | Date | null): string {
  if (dateStr === null || dateStr === undefined || dateStr === "") return EMPTY_VALUE;
  const date = parseDate(dateStr);
  if (!date) return String(dateStr);
  return dateFormat({ hour: "2-digit", minute: "2-digit" }).format(date);
}

// ---------------------------------------------------------------------------
// Market time (Borsa İstanbul wall clock), relative time, safe coercion
// ---------------------------------------------------------------------------

/** Borsa İstanbul's time zone — session times/chart ticks are shown in it. */
export const MARKET_TIME_ZONE = "Europe/Istanbul";

export type MarketDateStyle =
  | "time" // 14:30
  | "dayMonth" // 22 Eyl
  | "dayMonthTime" // 22 Eyl 14:30
  | "date" // 22 Eyl 2026
  | "dateTime" // 22 Eyl 2026 14:30
  | "monthYear" // Eyl 2026
  | "year" // 2026
  | "weekdayLong"; // 22 Eylül Salı

const MARKET_DATE_STYLES: Record<MarketDateStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  dayMonth: { day: "numeric", month: "short" },
  dayMonthTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  date: { day: "numeric", month: "short", year: "numeric" },
  dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  monthYear: { month: "short", year: "numeric" },
  year: { year: "numeric" },
  weekdayLong: { weekday: "long", day: "numeric", month: "long" },
};

/**
 * Zone-less strings the backend sends as Istanbul wall-clock values: KAP
 * "DD.MM.YYYY( HH:mm(:ss))", calendar days / naive ISO datetimes and month periods.
 */
const WALL_CLOCK_PATTERNS: readonly RegExp[] = [
  /^\d{2}\.\d{2}\.\d{4}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/,
  /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/,
  /^\d{1,2}[-/.]\d{4}$/,
  /^\d{4}[-/.]\d{1,2}$/,
];

/** Date/time in Istanbul time (independent of the viewer's time zone). */
export function formatMarketDate(value?: string | number | Date | null, style: MarketDateStyle = "dateTime"): string {
  const date = parseDate(value);
  if (!date) return EMPTY_VALUE;
  // parseDate builds zone-less wall-clock strings in the viewer's own zone, so they
  // are formatted in that zone: converting them to Istanbul would shift them by the
  // viewer's UTC offset (e.g. "2026-01-23" → "22 Oca" anywhere east of UTC+3).
  const wallClock = typeof value === "string" && WALL_CLOCK_PATTERNS.some((pattern) => pattern.test(value.trim()));
  const options = wallClock ? MARKET_DATE_STYLES[style] : { ...MARKET_DATE_STYLES[style], timeZone: MARKET_TIME_ZONE };
  return dateFormat(options).format(date);
}

const relativeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

/** "3 saat önce" / "3 hours ago" / "il y a 3 heures" (moment.js-style thresholds). */
export function formatRelativeTime(value?: string | number | Date | null, now: number = Date.now()): string {
  const date = parseDate(value);
  if (!date) return EMPTY_VALUE;
  const intlLocale = getIntlLocale();
  let formatter = relativeFormatCache.get(intlLocale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
    relativeFormatCache.set(intlLocale, formatter);
  }
  const seconds = (date.getTime() - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return formatter.format(0, "second");
  if (abs < 45 * 60) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 22 * 3600) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 26 * 86400) return formatter.format(Math.round(seconds / 86400), "day");
  if (abs < 320 * 86400) return formatter.format(Math.round(seconds / (30.44 * 86400)), "month");
  return formatter.format(Math.round(seconds / (365.25 * 86400)), "year");
}

/** Coerce an API value (number or numeric string such as Decimal "330.2500") to a finite number, else null. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Price-direction convention — single switch point, mirrors --up/--down in
// globals.css. Use `text-up`/`text-down`/`bg-up/10`… utilities in markup and
// TREND_COLOR for Recharts/SVG props (SVG attributes accept CSS variables).
// ---------------------------------------------------------------------------

export type TrendTone = "up" | "down" | "flat";

/** Direction of a signed change; missing/NaN/zero values are "flat". */
export function trendTone(value?: number | null): TrendTone {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

export const TREND_COLOR: Record<TrendTone, string> = {
  up: "var(--up)",
  down: "var(--down)",
  flat: "var(--muted-foreground)",
};

export const TREND_TEXT_CLASS: Record<TrendTone, string> = {
  up: "text-up",
  down: "text-down",
  flat: "text-muted-foreground",
};

/** Tinted pill (background + text) for a signed change. */
export const TREND_PILL_CLASS: Record<TrendTone, string> = {
  up: "bg-up/10 text-up",
  down: "bg-down/10 text-down",
  flat: "bg-muted text-muted-foreground",
};
