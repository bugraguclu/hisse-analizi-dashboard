import type { ChartSeries } from "./types";

export interface DividendPoint {
  /** Ex-date, epoch ms. */
  time: number;
  /** Gross amount per share of today's capital (bonus issues re-based). */
  perShare: number;
}

export interface TotalReturn {
  /** Price if every gross dividend had been reinvested on its ex-date; null before the window. */
  values: Array<number | null>;
  /** Dividends inside the window. */
  count: number;
  /** % change of the total-return line over the window. */
  percent: number | null;
}

/**
 * Dividend-reinvested ("total return", as on TradingView or Koyfin) line: it starts on the
 * close before the window and steps up by (1 + D / previous close) on each ex-date inside
 * the window, so the gap to the price line is what the dividends added.
 */
export function totalReturn(series: ChartSeries, dividends: readonly DividendPoint[]): TotalReturn | null {
  const { bars, windowStart } = series;
  if (bars.length === 0 || windowStart >= bars.length) return null;
  const inWindow = dividends.filter((d) => d.time > (bars[windowStart - 1]?.time ?? bars[windowStart].time - 1) && d.time <= bars[bars.length - 1].time + 86_400_000);
  if (inWindow.length === 0) return { values: bars.map(() => null), count: 0, percent: null };
  const values: Array<number | null> = bars.map(() => null);
  let factor = 1;
  let next = 0;
  const sorted = [...inWindow].sort((a, b) => a.time - b.time);
  const start = Math.max(0, windowStart - 1);
  values[start] = bars[start].close;
  for (let i = start + 1; i < bars.length; i += 1) {
    while (next < sorted.length && sorted[next].time <= bars[i].time) {
      const previous = bars[i - 1].close;
      if (previous > 0) factor *= 1 + sorted[next].perShare / previous;
      next += 1;
    }
    values[i] = bars[i].close * factor;
  }
  const base = series.referenceClose ?? bars[start].close;
  const last = values[values.length - 1];
  return { values, count: sorted.length, percent: last !== null && base > 0 ? ((last - base) / base) * 100 : null };
}
