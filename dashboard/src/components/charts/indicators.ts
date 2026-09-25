/**
 * Indicator series computed from chart bars (warmup + window), aligned with the
 * input: `null` until the indicator has enough history. Formulas follow the
 * common TradingView definitions (Wilder RSI, EMA-based MACD, population-σ
 * Bollinger, slow stochastic).
 */

export type IndicatorSeries = Array<number | null>;

/** Simple moving average; `null` entries break the window. */
export function sma(values: ReadonlyArray<number | null>, period: number): IndicatorSeries {
  const out: IndicatorSeries = new Array(values.length).fill(null);
  let sum = 0;
  let run = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null) {
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

/** Exponential moving average seeded with the SMA of the first `period` values. */
export function ema(values: ReadonlyArray<number | null>, period: number): IndicatorSeries {
  const out: IndicatorSeries = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let previous: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === null) continue;
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

export interface BollingerBands {
  upper: IndicatorSeries;
  middle: IndicatorSeries;
  lower: IndicatorSeries;
}

export function bollinger(closes: readonly number[], period = 20, multiplier = 2): BollingerBands {
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

function rsiValue(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Wilder's RSI. */
export function rsi(closes: readonly number[], period = 14): IndicatorSeries {
  const out: IndicatorSeries = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiValue(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(delta, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
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
  const histogram: IndicatorSeries = line.map((value, i) => {
    const s = signal[i];
    return value !== null && s !== null ? value - s : null;
  });
  return { macd: line, signal, histogram };
}

export interface StochasticSeries {
  k: IndicatorSeries;
  d: IndicatorSeries;
}

/** Slow stochastic (%K smoothed by `kSmooth`, %D = SMA of %K). */
export function stochastic(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  kPeriod = 14,
  kSmooth = 3,
  dPeriod = 3,
): StochasticSeries {
  const raw: IndicatorSeries = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i += 1) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j += 1) {
      highest = Math.max(highest, highs[j]);
      lowest = Math.min(lowest, lows[j]);
    }
    raw[i] = highest === lowest ? 50 : ((closes[i] - lowest) / (highest - lowest)) * 100;
  }
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dPeriod) };
}
