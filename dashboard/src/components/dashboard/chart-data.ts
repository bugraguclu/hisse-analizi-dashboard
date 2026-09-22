import { MARKET_TIME_ZONE, parseDate, toFiniteNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { istanbulClock } from "@/lib/market-hours";
import type { ChartPeriod, OhlcvBar } from "@/types";

/** Periods offered by the index chart, in display order (values sent to the backend as-is). */
export const CHART_PERIODS: readonly ChartPeriod[] = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "5y", "max"];

export const INTRADAY_PERIODS: ReadonlySet<ChartPeriod> = new Set(["1d", "5d"]);

export interface ChartPoint {
  /** Position on the (gap-free) x axis. */
  i: number;
  /** Epoch ms of the bar. */
  t: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  /** Istanbul calendar day, "YYYY-MM-DD". */
  day: string;
}

const MONTHS_BACK: Partial<Record<ChartPeriod, number>> = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "5y": 60 };

function monthsBefore(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
}

/**
 * Normalise borsapy bars into chart points and trim them to the requested
 * window. borsapy returns more history than the label promises (1d = rolling
 * 24 h across two sessions, 1mo = 30 daily bars ≈ 6 weeks, ytd ≈ 1 year), so
 * the window is enforced here: 1d = last session, 5d = last 5 sessions,
 * ytd = current calendar year, Nmo/Ny = calendar months back from the last bar.
 * Bars without a timestamp or close are dropped (never plotted as 0).
 */
export function buildSeries(bars: readonly OhlcvBar[] | undefined, period: ChartPeriod): ChartPoint[] {
  const byTime = new Map<number, Omit<ChartPoint, "i">>();
  for (const bar of bars ?? []) {
    const date = parseDate(bar.Date ?? bar.Datetime ?? null);
    const close = toFiniteNumber(bar.Close);
    if (!date || close === null) continue;
    const t = date.getTime();
    byTime.set(t, {
      t,
      close,
      open: toFiniteNumber(bar.Open),
      high: toFiniteNumber(bar.High),
      low: toFiniteNumber(bar.Low),
      day: istanbulClock(t).dateKey,
    });
  }
  let points = Array.from(byTime.values()).sort((a, b) => a.t - b.t);
  if (points.length === 0) return [];
  const last = points[points.length - 1];

  if (period === "1d") {
    points = points.filter((p) => p.day === last.day);
  } else if (period === "5d") {
    const days = Array.from(new Set(points.map((p) => p.day))).slice(-5);
    points = points.filter((p) => days.includes(p.day));
  } else if (period === "ytd") {
    const year = last.day.slice(0, 4);
    points = points.filter((p) => p.day.startsWith(year));
  } else {
    const months = MONTHS_BACK[period];
    if (months) {
      const cutoff = monthsBefore(last.t, months);
      points = points.filter((p) => p.t >= cutoff);
    }
  }
  return points.map((p, i) => ({ ...p, i }));
}

export interface SeriesStats {
  first: ChartPoint;
  last: ChartPoint;
  open: number;
  high: number;
  low: number;
  change: number;
  changePercent: number | null;
}

export function seriesStats(points: readonly ChartPoint[]): SeriesStats | null {
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  let high = -Infinity;
  let low = Infinity;
  for (const p of points) {
    high = Math.max(high, p.high ?? p.close, p.close);
    low = Math.min(low, p.low ?? p.close, p.close);
  }
  const change = last.close - first.close;
  return {
    first,
    last,
    open: first.open ?? first.close,
    high,
    low,
    change,
    changePercent: first.close !== 0 ? (change / first.close) * 100 : null,
  };
}

type TickUnit = "hour" | "day" | "week" | "month" | "year";

const TICK_UNIT: Record<ChartPeriod, TickUnit> = {
  "1d": "hour",
  "5d": "day",
  "1mo": "week",
  "3mo": "month",
  "6mo": "month",
  ytd: "month",
  "1y": "month",
  "5y": "year",
  max: "year",
};

const TICK_FORMAT: Record<TickUnit, Intl.DateTimeFormatOptions> = {
  hour: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { day: "numeric", month: "short" },
  week: { day: "numeric", month: "short" },
  month: { month: "short" },
  year: { year: "numeric" },
};

const INTL_LOCALES: Record<Locale, string> = { tr: "tr-TR", en: "en-US", fr: "fr-FR" };

function formatIn(ms: number, options: Intl.DateTimeFormatOptions, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], { ...options, timeZone: MARKET_TIME_ZONE }).format(ms);
}

/**
 * Date-aware x-axis ticks: one per hour (1d), session (5d), week (1mo),
 * month (3mo–1y) or year (5y/max), thinned to at most `maxTicks`.
 * Month ticks that cross a year boundary also show the year.
 */
export function buildTicks(
  points: readonly ChartPoint[],
  period: ChartPeriod,
  locale: Locale,
  maxTicks = 7,
): { ticks: number[]; labels: Map<number, string> } {
  const unit = TICK_UNIT[period];
  const candidates: ChartPoint[] = [];
  let previousKey = "";
  for (const p of points) {
    const clock = istanbulClock(p.t);
    const key =
      unit === "hour"
        ? `${p.day}T${Math.floor(clock.minutes / 60)}`
        : unit === "day"
          ? p.day
          : unit === "week"
            ? `${p.day.slice(0, 4)}-w${Math.floor((Date.parse(p.day) / 86_400_000 + 3) / 7)}`
            : unit === "month"
              ? p.day.slice(0, 7)
              : p.day.slice(0, 4);
    if (key !== previousKey) candidates.push(p);
    previousKey = key;
  }
  const step = Math.max(1, Math.ceil(candidates.length / maxTicks));
  const chosen = candidates.filter((_, index) => index % step === 0);
  const spansYears = points.length > 0 && points[0].day.slice(0, 4) !== points[points.length - 1].day.slice(0, 4);
  const labels = new Map<number, string>();
  for (const p of chosen) {
    const options = unit === "month" && spansYears ? { month: "short", year: "2-digit" } as const : TICK_FORMAT[unit];
    labels.set(p.i, formatIn(p.t, options, locale));
  }
  return { ticks: chosen.map((p) => p.i), labels };
}

/** Tooltip/axis label for a single point. */
export function pointLabel(point: ChartPoint, period: ChartPeriod, locale: Locale): string {
  return INTRADAY_PERIODS.has(period)
    ? formatIn(point.t, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, locale)
    : formatIn(point.t, { day: "numeric", month: "short", year: "numeric" }, locale);
}

/** Y domain that includes the baseline and leaves a little headroom. */
export function yDomain(points: readonly ChartPoint[], baseline: number | null): [number, number] | ["auto", "auto"] {
  if (points.length === 0) return ["auto", "auto"];
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.close);
    max = Math.max(max, p.close);
  }
  if (baseline !== null) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.01 || 1;
  return [min - pad, max + pad];
}
