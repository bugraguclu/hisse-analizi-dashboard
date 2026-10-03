import type { ChartPeriod } from "@/types";
import type { ChartBar, ChartCurrency, ChartSeries, ChartUnit, DerivedUnit } from "./types";

/**
 * Units a chart can show prices in, and the arithmetic that re-expresses lira bars in
 * the derived ones: euros and grams of gold divide each bar by that day's EUR/TRY or
 * gram-gold close (that week's for bars older than a year), "real" lira multiplies it
 * by CPI(latest month) / CPI(the bar's month), i.e. expresses it in today's lira.
 *
 * No React and no value imports, so `node --test` runs units.test.ts on it directly.
 */

export const CHART_UNITS: readonly ChartUnit[] = ["TRY", "USD", "EUR", "GOLD", "REAL"];

export function isChartUnit(value: unknown): value is ChartUnit {
  return typeof value === "string" && (CHART_UNITS as readonly string[]).includes(value);
}

export function isDerivedUnit(unit: ChartUnit): unit is DerivedUnit {
  return unit === "EUR" || unit === "GOLD" || unit === "REAL";
}

/** Currency the chart endpoints are asked for: derived units start from lira. */
export function requestCurrency(unit: ChartUnit): ChartCurrency {
  return unit === "USD" ? "USD" : "TRY";
}

/** The unit a series' prices are in. */
export function seriesUnit(series: Pick<ChartSeries, "currency" | "unit">): ChartUnit {
  return series.unit ?? series.currency;
}

/** Lira and real lira keep the quotes' two decimals; dollars, euros and grams of gold need significant digits. */
export function isLiraScale(unit: ChartUnit): boolean {
  return unit === "TRY" || unit === "REAL";
}

/** Derived units need daily or weekly bars inside the five years of macro history: not 1D, 5D or Tümü. */
const DERIVED_PERIODS: ReadonlySet<ChartPeriod> = new Set<ChartPeriod>(["1mo", "3mo", "6mo", "ytd", "1y", "5y"]);

export function unitAvailable(unit: ChartUnit, period: ChartPeriod): boolean {
  return !isDerivedUnit(unit) || DERIVED_PERIODS.has(period);
}

/** The unit shown for `period`: the chosen one where it exists, lira otherwise (the choice is kept for other periods). */
export function effectiveUnit(unit: ChartUnit, period: ChartPeriod): ChartUnit {
  return unitAvailable(unit, period) ? unit : "TRY";
}

/** Macro market key of a rate unit's TL price. */
export const RATE_KEY: Readonly<Record<Exclude<DerivedUnit, "REAL">, string>> = { EUR: "eurtry", GOLD: "gram_gold" };

/**
 * Macro histories that cover a period with its indicator warmup (250 bars): the daily
 * last year, plus the weekly five years for older daily bars; 5Y's bars are weekly.
 */
export function rateHistoryPeriods(period: ChartPeriod): ReadonlyArray<"1y" | "5y"> {
  return period === "5y" ? ["5y"] : ["1y", "5y"];
}

// --- days ----------------------------------------------------------------------

const DAY_MS = 86_400_000;
const ISTANBUL_OFFSET_MS = 3 * 3_600_000;

/**
 * Istanbul calendar day of an instant, as days since 1970-01-01. Istanbul has been UTC+3
 * all year since 2016; older daily bars are stamped hours after midnight, so they still
 * land on their own day.
 */
export function istanbulDayIndex(ms: number): number {
  return Math.floor((ms + ISTANBUL_OFFSET_MS) / DAY_MS);
}

/** "YYYY-MM-DD…" → its calendar day; null when the text is not a date. */
function dayOfDate(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS : null;
}

function monthOfDay(day: number): string {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// --- rates (EUR/TRY, gram gold) --------------------------------------------------

export interface RatePoint {
  /** Calendar day (`istanbulDayIndex`) the close belongs to; weekly points carry their week's first day. */
  day: number;
  /** TL price of one unit (one euro, one gram of gold). */
  value: number;
}

/** A macro market history response (`{ points: [{ date, close }] }`) → ascending points. */
export function parseRatePoints(payload: unknown): RatePoint[] {
  const points = (payload as { points?: unknown } | null)?.points;
  if (!Array.isArray(points)) return [];
  const byDay = new Map<number, number>();
  for (const point of points as Array<{ date?: unknown; close?: unknown }>) {
    const day = dayOfDate(point?.date);
    const close = point?.close;
    if (day !== null && typeof close === "number" && Number.isFinite(close) && close > 0) byDay.set(day, close);
  }
  return Array.from(byDay, ([day, value]) => ({ day, value })).sort((a, b) => a.day - b.day);
}

/** Daily points where there are any; weekly points only before the first daily one. */
export function mergeRatePoints(daily: readonly RatePoint[], weekly: readonly RatePoint[]): RatePoint[] {
  if (daily.length === 0) return [...weekly];
  const first = daily[0].day;
  return [...weekly.filter((point) => point.day < first), ...daily];
}

/** The close at or before `day` (a weekly point covers its week); null before the first point. */
export function rateAt(points: readonly RatePoint[], day: number): number | null {
  if (points.length === 0 || day < points[0].day) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].day <= day) lo = mid;
    else hi = mid - 1;
  }
  return points[lo].value;
}

// --- consumer prices (TÜFE) -----------------------------------------------------

export interface CpiIndex {
  /** "YYYY-MM" → price level chained from the monthly changes (first month = 100 × its change). */
  levels: ReadonlyMap<string, number>;
  first: string;
  latest: string;
}

/** `/macro/inflation`'s `tufe_history` (newest first, `{ Date, MonthlyInflation }`) → a chained CPI level per month. */
export function parseCpiIndex(payload: unknown): CpiIndex | null {
  const rows = (payload as { tufe_history?: unknown } | null)?.tufe_history;
  if (!Array.isArray(rows)) return null;
  const months = new Map<string, number>();
  for (const row of rows as Array<{ Date?: unknown; MonthlyInflation?: unknown }>) {
    const day = dayOfDate(row?.Date);
    const change = row?.MonthlyInflation;
    if (day !== null && typeof change === "number" && Number.isFinite(change)) months.set(monthOfDay(day), change);
  }
  if (months.size === 0) return null;
  const ordered = Array.from(months).sort(([a], [b]) => (a < b ? -1 : 1));
  const levels = new Map<string, number>();
  let level = 100;
  for (const [month, change] of ordered) {
    level *= 1 + change / 100;
    levels.set(month, level);
  }
  return { levels, first: ordered[0][0], latest: ordered[ordered.length - 1][0] };
}

/**
 * Multiplier that brings a lira price of `day` to the latest CPI month's lira. Months after
 * the latest published one are already "today's" lira (1); null before the CPI history.
 */
export function cpiFactor(cpi: CpiIndex, day: number): number | null {
  const month = monthOfDay(day);
  if (month > cpi.latest) return 1;
  const level = cpi.levels.get(month);
  const latest = cpi.levels.get(cpi.latest);
  return level && latest ? latest / level : null;
}

// --- conversion -------------------------------------------------------------------

/** Multiplier for a lira price at instant `ms`; null when the data does not reach back that far. */
export type UnitFactor = (ms: number) => number | null;

export function rateFactor(points: readonly RatePoint[]): UnitFactor {
  return (ms) => {
    const rate = rateAt(points, istanbulDayIndex(ms));
    return rate ? 1 / rate : null;
  };
}

export function realFactor(cpi: CpiIndex): UnitFactor {
  return (ms) => cpiFactor(cpi, istanbulDayIndex(ms));
}

function scaleBar(bar: ChartBar, factor: number): ChartBar {
  return {
    ...bar,
    open: bar.open === null ? null : bar.open * factor,
    high: bar.high === null ? null : bar.high * factor,
    low: bar.low === null ? null : bar.low * factor,
    close: bar.close * factor,
  };
}

/**
 * A lira series re-expressed in `unit`: every price times its bar's factor (volume as is).
 * Bars the data doesn't reach (warmup older than the rate history) are dropped rather than
 * converted at a wrong rate, so indicators simply start later.
 */
export function convertSeries(series: ChartSeries, unit: DerivedUnit, factorAt: UnitFactor): ChartSeries {
  const windowStartTime = series.bars[series.windowStart]?.time ?? Infinity;
  const bars: ChartBar[] = [];
  for (const bar of series.bars) {
    const factor = factorAt(bar.time);
    if (factor !== null) bars.push(scaleBar(bar, factor));
  }
  const windowStart = bars.findIndex((bar) => bar.time >= windowStartTime);
  // The close before the window: the bar before it, else the raw reference at the window's first rate.
  const before = series.windowStart > 0 ? series.bars[series.windowStart - 1] : undefined;
  const referenceFactor = before ? factorAt(before.time) : series.bars[series.windowStart] ? factorAt(series.bars[series.windowStart].time) : null;
  return {
    ...series,
    bars,
    windowStart: windowStart === -1 ? bars.length : windowStart,
    referenceClose: series.referenceClose !== null && referenceFactor !== null ? series.referenceClose * referenceFactor : null,
    unit,
  };
}
