/**
 * Technical indicator math and pure chart-geometry projection for mobile charts.
 * Formulas match TradingView / Pine (`dashboard/src/components/charts/indicators.ts`):
 *  - SMA, EMA (SMA-seeded), Bollinger Bands (population std dev), Wilder RSI, MACD (12, 26, 9).
 * Computes across `[...warmup, ...window]` so indicators are valid from bar 0 of
 * the selected window, then slices back to `window.length`.
 */

export type IndicatorSeries = Array<number | null>;

export const MOBILE_INDICATORS = [
  "SMA 20",
  "EMA 50",
  "RSI 14",
  "MACD 12 26 9",
  "Bollinger 20 2",
] as const;

export type MobileIndicatorId = (typeof MOBILE_INDICATORS)[number];

export function sma(values: ReadonlyArray<number | null>, period: number): IndicatorSeries {
  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (period < 1) return out;
  let sum = 0;
  let run = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) {
      sum = 0;
      run = 0;
      continue;
    }
    sum += value;
    run += 1;
    if (run > period) {
      sum -= values[i - period] as number;
      run = period;
    }
    if (run === period) out[i] = sum / period;
  }
  return out;
}

export function ema(values: ReadonlyArray<number | null>, period: number): IndicatorSeries {
  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (period < 1) return out;
  const k = 2 / (period + 1);
  let previous: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null || !Number.isFinite(value)) continue;
    if (previous === null) {
      seedSum += value;
      seedCount += 1;
      if (seedCount === period) {
        previous = seedSum / period;
        out[i] = previous;
      }
    } else {
      previous = value * k + previous * (1 - k);
      out[i] = previous;
    }
  }
  return out;
}

export interface BollingerBandsSeries {
  upper: IndicatorSeries;
  middle: IndicatorSeries;
  lower: IndicatorSeries;
}

export function bollinger(closes: readonly number[], period = 20, multiplier = 2): BollingerBandsSeries {
  const middle = sma(closes, period);
  const upper: IndicatorSeries = new Array(closes.length).fill(null);
  const lower: IndicatorSeries = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (closes[j] - mean) ** 2;
    const deviation = Math.sqrt(variance / period) * multiplier;
    upper[i] = mean + deviation;
    lower[i] = mean - deviation;
  }
  return { upper, middle, lower };
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder's RSI. */
export function rsi(closes: readonly number[], period = 14): IndicatorSeries {
  const out: IndicatorSeries = new Array(closes.length).fill(null);
  if (closes.length <= period || period < 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiFromAvg(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = rsiFromAvg(avgGain, avgLoss);
  }
  return out;
}

export interface MacdSeries {
  macd: IndicatorSeries;
  signal: IndicatorSeries;
  histogram: IndicatorSeries;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdSeries {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const line: IndicatorSeries = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });
  const signal = ema(line, signalPeriod);
  const histogram: IndicatorSeries = line.map((val, i) => {
    const s = signal[i];
    return val !== null && s !== null ? val - s : null;
  });
  return { macd: line, signal, histogram };
}

export interface ComputedChartIndicators {
  sma20: IndicatorSeries | null;
  ema50: IndicatorSeries | null;
  bollinger: BollingerBandsSeries | null;
  rsi14: IndicatorSeries | null;
  macd: MacdSeries | null;
}

/**
 * Computes requested indicators over `warmupCloses + windowCloses` so lines start
 * converged at index 0 of the visible chart, returning only the `windowCloses` slice.
 */
export function computeWindowIndicators(
  warmupCloses: readonly number[],
  windowCloses: readonly number[],
  activeIndicators: readonly string[],
): ComputedChartIndicators {
  const active = new Set(activeIndicators);
  const offset = warmupCloses.length;
  const full = [...warmupCloses, ...windowCloses];
  const slice = (series: IndicatorSeries): IndicatorSeries => series.slice(offset);

  const sma20 = active.has("SMA 20") ? slice(sma(full, 20)) : null;
  const ema50 = active.has("EMA 50") ? slice(ema(full, 50)) : null;
  const bb = active.has("Bollinger 20 2") ? bollinger(full, 20, 2) : null;
  const rsi14 = active.has("RSI 14") ? slice(rsi(full, 14)) : null;
  const macdFull = active.has("MACD 12 26 9") ? macd(full, 12, 26, 9) : null;

  return {
    sma20,
    ema50,
    bollinger: bb
      ? { upper: slice(bb.upper), middle: slice(bb.middle), lower: slice(bb.lower) }
      : null,
    rsi14,
    macd: macdFull
      ? {
          macd: slice(macdFull.macd),
          signal: slice(macdFull.signal),
          histogram: slice(macdFull.histogram),
        }
      : null,
  };
}

export function latestFinite(series: IndicatorSeries | null | undefined): number | null {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chart downsampling & pure pixel geometry (no native SVG required)
// ---------------------------------------------------------------------------

/**
 * Selects up to `maxPoints` indices from `0..length-1`, always keeping index 0,
 * `length - 1`, and the bucket min/max of `primaryValues` so spikes and drawdowns
 * remain accurate on 5y/max periods while staying 60fps on iOS.
 */
export function selectSampleIndices(
  primaryValues: ReadonlyArray<number | null>,
  maxPoints = 96,
): number[] {
  const n = primaryValues.length;
  if (n === 0) return [];
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);

  const buckets = Math.max(2, Math.floor((maxPoints - 2) / 2));
  const step = (n - 2) / buckets;
  const picked = new Set<number>([0, n - 1]);

  for (let b = 0; b < buckets; b += 1) {
    const start = 1 + Math.floor(b * step);
    const end = Math.min(n - 1, 1 + Math.floor((b + 1) * step));
    let minIdx = -1;
    let maxIdx = -1;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = start; i < end; i += 1) {
      const v = primaryValues[i];
      if (v === null || !Number.isFinite(v)) continue;
      if (v < minVal) {
        minVal = v;
        minIdx = i;
      }
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    if (minIdx !== -1) picked.add(minIdx);
    if (maxIdx !== -1) picked.add(maxIdx);
  }
  return [...picked].sort((a, b) => a - b);
}

export interface YDomain {
  min: number;
  max: number;
}

export function computeYDomain(
  seriesList: ReadonlyArray<ReadonlyArray<number | null>>,
  fixedDomain?: Partial<YDomain>,
  padRatio = 0.06,
): YDomain | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const series of seriesList) {
    for (const v of series) {
      if (v !== null && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    if (fixedDomain?.min !== undefined && fixedDomain?.max !== undefined) {
      return { min: fixedDomain.min, max: fixedDomain.max };
    }
    return null;
  }
  if (lo === hi) {
    const delta = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 1;
    lo -= delta;
    hi += delta;
  } else {
    const pad = (hi - lo) * padRatio;
    lo -= pad;
    hi += pad;
  }
  return {
    min: fixedDomain?.min !== undefined ? fixedDomain.min : lo,
    max: fixedDomain?.max !== undefined ? fixedDomain.max : hi,
  };
}

export function projectX(index: number, count: number, width: number): number {
  if (count <= 1) return width / 2;
  return (index / (count - 1)) * width;
}

export function projectY(value: number, domain: YDomain, height: number): number {
  const span = domain.max - domain.min;
  if (span <= 0) return height / 2;
  const clamped = (value - domain.min) / span;
  return height - clamped * height;
}

export interface LineSegment {
  key: string;
  left: number;
  top: number;
  width: number;
  angleRad: number;
}

/**
 * Converts a numeric series into rotated-rect line segments for React Native `View`s.
 * Null values break the line cleanly (never interpolated to 0).
 */
export function buildLineSegments(
  values: ReadonlyArray<number | null>,
  domain: YDomain,
  width: number,
  height: number,
  strokeWidth = 2,
  stepped = false,
): LineSegment[] {
  const n = values.length;
  if (n < 2 || width <= 0 || height <= 0) return [];
  const segments: LineSegment[] = [];

  const pushSeg = (key: string, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.25) return;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    segments.push({
      key,
      left: cx - len / 2,
      top: cy - strokeWidth / 2,
      width: len + 0.5,
      angleRad: Math.atan2(dy, dx),
    });
  };

  for (let i = 1; i < n; i += 1) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === null || curr === null || !Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const x1 = projectX(i - 1, n, width);
    const y1 = projectY(prev, domain, height);
    const x2 = projectX(i, n, width);
    const y2 = projectY(curr, domain, height);
    if (stepped) {
      pushSeg(`${i}-h`, x1, y1, x2, y1);
      pushSeg(`${i}-v`, x2, y1, x2, y2);
    } else {
      pushSeg(`${i}`, x1, y1, x2, y2);
    }
  }
  return segments;
}

export interface HistogramBar {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  positive: boolean;
}

export function buildHistogramBars(
  values: ReadonlyArray<number | null>,
  domain: YDomain,
  width: number,
  height: number,
): HistogramBar[] {
  const n = values.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const zeroY = Math.min(height, Math.max(0, projectY(0, domain, height)));
  const slot = width / Math.max(n, 1);
  const barW = Math.max(1.5, Math.min(12, slot * 0.68));
  const bars: HistogramBar[] = [];

  for (let i = 0; i < n; i += 1) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    const x = projectX(i, n, width) - barW / 2;
    const y = projectY(v, domain, height);
    const top = Math.min(y, zeroY);
    const h = Math.max(1, Math.abs(y - zeroY));
    bars.push({
      index: i,
      left: Math.max(0, Math.min(width - barW, x)),
      top,
      width: barW,
      height: h,
      positive: v >= 0,
    });
  }
  return bars;
}
