import { EMPTY_VALUE, formatMarketDate, formatNumber, formatPercent, getIntlLocale } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { istanbulClock } from "@/lib/market-hours";
import { makroText } from "./i18n-dict";
import type { IndicatorFrequency, MarketUnit } from "./types";

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${getIntlLocale()}|${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getIntlLocale(), options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

/** Signed change in percentage points: 0.24 → "+0,24 puan" / "+0.24 pp". Zero → "0,00 puan". */
export function formatPp(value: number | null | undefined, locale: Locale, decimals = 2): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  const number = numberFormat({ signDisplay: "exceptZero", minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return `${number} ${makroText("common.pp", locale)}`;
}

/** Basis points from a change in percentage points: -1 → "-100 bp", 0.09 → "+9 bp". */
export function formatBp(changePp: number | null | undefined, locale: Locale): string {
  if (!isNumber(changePp)) return EMPTY_VALUE;
  const bp = Math.round(changePp * 100);
  return `${numberFormat({ signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(bp)} ${makroText("common.bp", locale)}`;
}

/** Basis points given directly (policy-rate decisions): -100 → "-100 bp". */
export function formatBpValue(bp: number | null | undefined, locale: Locale): string {
  if (!isNumber(bp)) return EMPTY_VALUE;
  return `${numberFormat({ signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(bp)} ${makroText("common.bp", locale)}`;
}

/** Compact money: 68.4e9 USD → "$68,4 Mr" (tr) / "$68.4B" (en) / "68,4 Md $" (fr). */
export function formatMoneyCompact(value: number | null | undefined, currency: "USD" | "TRY", signed = false): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  return numberFormat({
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(value) >= 1e12 ? 2 : 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);
}

/** Reference period of a release: "Ağu 2026", "2. çeyrek 2026", "2025", "11 Eyl 2026". */
export function formatPeriod(period: string | null | undefined, frequency: IndicatorFrequency, locale: Locale): string {
  if (!period) return EMPTY_VALUE;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) return formatMarketDate(period, "date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  switch (frequency) {
    case "month":
      return formatMarketDate(`${match[1]}-${match[2]}`, "monthYear");
    case "quarter":
      return makroText("period.quarter", locale, { q: Math.ceil(month / 3), year });
    case "year":
      return String(year);
    default:
      return formatMarketDate(period, "date");
  }
}

const FOUR_DECIMALS = new Set(["usdtry", "eurtry", "gbptry", "basket", "eurusd"]);

/** Decimals for a market instrument (FX pairs quote four). */
export function marketDecimals(key: string, unit: MarketUnit): number {
  if (unit === "percent") return 2;
  return FOUR_DECIMALS.has(key) ? 4 : 2;
}

/** Last price / yield of a market instrument in its natural precision. */
export function formatMarketValue(value: number | null | undefined, key: string, unit: MarketUnit): string {
  if (!isNumber(value)) return EMPTY_VALUE;
  if (unit === "percent") return formatPercent(value, 2);
  return formatNumber(value, marketDecimals(key, unit));
}

/** Whole calendar days (Istanbul) from `now` until the ISO day `target`. */
export function daysUntil(target: string, now: number): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(target);
  if (!match) return null;
  const today = istanbulClock(now).dateKey;
  const [ty, tm, td] = today.split("-").map(Number);
  return Math.round((Date.UTC(+match[1], +match[2] - 1, +match[3]) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

/** "YYYY-MM" month key of an ISO day / timestamp string. */
export function monthKey(value: string | undefined | null): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}-${match[2]}` : null;
}

/** Last calendar day of a "YYYY-MM" month, "YYYY-MM-DD". */
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${key}-${String(last).padStart(2, "0")}`;
}
