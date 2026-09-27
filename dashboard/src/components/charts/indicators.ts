/**
 * Indicator series computed from chart bars (warmup + window), aligned with the
 * input: `null` until the indicator has enough history. Formulas follow
 * TradingView's built-in (Pine `ta.*`) definitions (Wilder RSI/RMA, EMA-based
 * MACD, population-σ Bollinger, slow stochastic, `ta.sar`, `ta.supertrend`,
 * DMI...), so values match the TradingView chart once the warmup has converged.
 * Pure maths: no React, no chart library, no locale.
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

function emptySeries(length: number): IndicatorSeries {
  return new Array<number | null>(length).fill(null);
}

/** Highest high and lowest low of bars `from..to` (inclusive). */
function windowRange(highs: readonly number[], lows: readonly number[], from: number, to: number): [number, number] {
  let highest = -Infinity;
  let lowest = Infinity;
  for (let j = from; j <= to; j += 1) {
    highest = Math.max(highest, highs[j]);
    lowest = Math.min(lowest, lows[j]);
  }
  return [highest, lowest];
}

/** Volume indicators stay empty on feeds without volume (some indices) rather than drawing a flat zero. */
function hasVolume(volumes: ReadonlyArray<number | null>): boolean {
  return volumes.some((volume) => volume !== null && volume > 0);
}

function typicalPrices(highs: readonly number[], lows: readonly number[], closes: readonly number[]): number[] {
  return closes.map((close, i) => (highs[i] + lows[i] + close) / 3);
}

/**
 * Wilder's moving average (Pine `ta.rma`): seeded with the SMA of the first
 * `period` values, then `alpha = 1 / period`. Nulls (a derived series' warmup)
 * are skipped like in `ema`.
 */
export function rma(values: ReadonlyArray<number | null>, period: number): IndicatorSeries {
  const out = emptySeries(values.length);
  const alpha = 1 / period;
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
      previous = alpha * value + (1 - alpha) * previous;
      out[i] = previous;
    }
  }
  return out;
}

/** True range per bar; the first bar has no previous close and uses high − low (Pine `ta.tr(true)`). */
export function trueRange(highs: readonly number[], lows: readonly number[], closes: readonly number[]): number[] {
  return closes.map((_, i) => {
    const range = highs[i] - lows[i];
    if (i === 0) return range;
    const previous = closes[i - 1];
    return Math.max(range, Math.abs(highs[i] - previous), Math.abs(lows[i] - previous));
  });
}

/** Average true range: RMA of the true range (Pine `ta.atr`), in price units. */
export function atr(highs: readonly number[], lows: readonly number[], closes: readonly number[], period = 14): IndicatorSeries {
  return rma(trueRange(highs, lows, closes), period);
}

/**
 * Session-anchored VWAP of hlc3: Σ(price × volume) / Σ(volume) restarting whenever
 * `sessions[i]` changes (TradingView's default "Session" anchor). Null until the
 * session has traded volume.
 */
export function vwap(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  volumes: ReadonlyArray<number | null>,
  sessions: readonly string[],
): IndicatorSeries {
  const out = emptySeries(closes.length);
  let session: string | undefined;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < closes.length; i += 1) {
    if (sessions[i] !== session) {
      session = sessions[i];
      weighted = 0;
      total = 0;
    }
    const volume = volumes[i];
    if (volume !== null && volume > 0) {
      weighted += ((highs[i] + lows[i] + closes[i]) / 3) * volume;
      total += volume;
    }
    if (total > 0) out[i] = weighted / total;
  }
  return out;
}

export interface ParabolicSarSeries {
  sar: IndicatorSeries;
  /** True while the SAR is below price (uptrend); null where `sar` is null. */
  uptrend: Array<boolean | null>;
}

/**
 * Parabolic SAR, a port of Pine's `ta.sar` reference so the dots flip on the same
 * bars as on TradingView: the first trend comes from the second close vs the
 * first, and the SAR never enters the previous two bars' range.
 */
export function parabolicSar(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  start = 0.02,
  increment = 0.02,
  maximum = 0.2,
): ParabolicSarSeries {
  const n = closes.length;
  const sar = emptySeries(n);
  const uptrend = new Array<boolean | null>(n).fill(null);
  let result = 0;
  let extreme = 0;
  let acceleration = start;
  let below = false;
  for (let i = 1; i < n; i += 1) {
    let trendStart = i === 1;
    if (trendStart) {
      below = closes[1] > closes[0];
      extreme = below ? highs[1] : lows[1];
      result = below ? lows[0] : highs[0];
      acceleration = start;
    }
    result += acceleration * (extreme - result);
    if (below ? result > lows[i] : result < highs[i]) {
      // Reversal: the new SAR starts at the extreme point of the finished trend.
      trendStart = true;
      below = !below;
      result = below ? Math.min(lows[i], extreme) : Math.max(highs[i], extreme);
      extreme = below ? highs[i] : lows[i];
      acceleration = start;
    }
    if (!trendStart && (below ? highs[i] > extreme : lows[i] < extreme)) {
      extreme = below ? highs[i] : lows[i];
      acceleration = Math.min(acceleration + increment, maximum);
    }
    if (below) result = Math.min(result, lows[i - 1], i > 1 ? lows[i - 2] : Infinity);
    else result = Math.max(result, highs[i - 1], i > 1 ? highs[i - 2] : -Infinity);
    sar[i] = result;
    uptrend[i] = below;
  }
  return { sar, uptrend };
}

export interface SupertrendSeries {
  /** The line while the trend is up (drawn below price); null in a downtrend. */
  up: IndicatorSeries;
  /** The line while the trend is down (drawn above price); null in an uptrend. */
  down: IndicatorSeries;
}

/**
 * Supertrend as Pine's `ta.supertrend(factor, atrPeriod)`: hl2 ± factor × ATR bands
 * that only ratchet towards price and flip when the close crosses the active band.
 * Split by regime so a chart never draws the vertical jump of a flip.
 */
export function supertrend(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 10,
  factor = 3,
): SupertrendSeries {
  const n = closes.length;
  const up = emptySeries(n);
  const down = emptySeries(n);
  const range = atr(highs, lows, closes, period);
  let upperBefore: number | null = null;
  let lowerBefore: number | null = null;
  let trendBefore: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const average = range[i];
    const middle = (highs[i] + lows[i]) / 2;
    const basicUpper = average === null ? null : middle + factor * average;
    const basicLower = average === null ? null : middle - factor * average;
    // Pine's nz(): a missing previous band counts as 0.
    const prevUpper: number = upperBefore ?? 0;
    const prevLower: number = lowerBefore ?? 0;
    const prevClose = i > 0 ? closes[i - 1] : null;
    const lower: number | null =
      (basicLower !== null && basicLower > prevLower) || (prevClose !== null && prevClose < prevLower) ? basicLower : prevLower;
    const upper: number | null =
      (basicUpper !== null && basicUpper < prevUpper) || (prevClose !== null && prevClose > prevUpper) ? basicUpper : prevUpper;
    let bullish: boolean;
    if (i === 0 || range[i - 1] === null) bullish = false;
    else if (trendBefore === prevUpper) bullish = upper !== null && closes[i] > upper;
    else bullish = !(lower !== null && closes[i] < lower);
    const trend = bullish ? lower : upper;
    // TradingView hides the first bar and the ATR warmup.
    if (i > 0 && average !== null && trend !== null) (bullish ? up : down)[i] = trend;
    upperBefore = upper;
    lowerBefore = lower;
    trendBefore = trend;
  }
  return { up, down };
}

/**
 * Stochastic RSI as TradingView's: the stochastic formula over RSI values
 * (highest/lowest RSI of `stochLength` bars), %K = SMA(`smoothK`), %D = SMA(%K, `dPeriod`).
 * A flat RSI window reads 50, like `stochastic`.
 */
export function stochRsi(
  closes: readonly number[],
  rsiLength = 14,
  stochLength = 14,
  smoothK = 3,
  dPeriod = 3,
): StochasticSeries {
  const strength = rsi(closes, rsiLength);
  const raw = emptySeries(closes.length);
  for (let i = stochLength - 1; i < strength.length; i += 1) {
    const current = strength[i];
    if (current === null) continue;
    let highest = -Infinity;
    let lowest = Infinity;
    let complete = true;
    for (let j = i - stochLength + 1; j <= i; j += 1) {
      const value = strength[j];
      if (value === null) {
        complete = false;
        break;
      }
      highest = Math.max(highest, value);
      lowest = Math.min(lowest, value);
    }
    // In a flat market RSI only drifts by rounding noise (~1e-14); stretched to 0–100 that noise would flicker.
    if (complete) raw[i] = highest - lowest < 1e-9 ? 50 : ((current - lowest) / (highest - lowest)) * 100;
  }
  const k = sma(raw, smoothK);
  return { k, d: sma(k, dPeriod) };
}

/** Commodity channel index on hlc3: (price − SMA) / (0.015 × mean absolute deviation); 0 on a flat window. */
export function cci(highs: readonly number[], lows: readonly number[], closes: readonly number[], period = 20): IndicatorSeries {
  const typical = typicalPrices(highs, lows, closes);
  const mean = sma(typical, period);
  const out = emptySeries(closes.length);
  for (let i = period - 1; i < typical.length; i += 1) {
    const average = mean[i];
    if (average === null) continue;
    let deviation = 0;
    for (let j = i - period + 1; j <= i; j += 1) deviation += Math.abs(typical[j] - average);
    deviation /= period;
    // A flat window (limit-locked bars) leaves only rounding residue in both terms, whose ratio would read ±66,67.
    out[i] = deviation <= Math.abs(average) * 1e-12 ? 0 : (typical[i] - average) / (0.015 * deviation);
  }
  return out;
}

/** Williams %R (−100…0): −100 × (highest high − close) / (highest − lowest); −50 on a flat window. */
export function williamsR(highs: readonly number[], lows: readonly number[], closes: readonly number[], period = 14): IndicatorSeries {
  const out = emptySeries(closes.length);
  for (let i = period - 1; i < closes.length; i += 1) {
    const [highest, lowest] = windowRange(highs, lows, i - period + 1, i);
    out[i] = highest === lowest ? -50 : (-100 * (highest - closes[i])) / (highest - lowest);
  }
  return out;
}

export interface DmiSeries {
  /** +DI: share of the smoothed true range that moved up. */
  plus: IndicatorSeries;
  /** −DI: share of the smoothed true range that moved down. */
  minus: IndicatorSeries;
  /** Trend strength regardless of direction. */
  adx: IndicatorSeries;
}

/**
 * Directional movement index as TradingView's "DMI": Wilder-smoothed ±DM over the
 * smoothed true range (both from the second bar, like Pine's `ta.change`/`ta.tr`),
 * ADX = 100 × RMA(|+DI − −DI| / (+DI + −DI)). A zero range keeps the previous DI
 * (Pine `fixnan`).
 */
export function dmi(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  diLength = 14,
  adxSmoothing = 14,
): DmiSeries {
  const n = closes.length;
  const ranges = trueRange(highs, lows, closes);
  const plusMove = emptySeries(n);
  const minusMove = emptySeries(n);
  const range = emptySeries(n);
  for (let i = 1; i < n; i += 1) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusMove[i] = up > down && up > 0 ? up : 0;
    minusMove[i] = down > up && down > 0 ? down : 0;
    range[i] = ranges[i];
  }
  const smoothedRange = rma(range, diLength);
  const smoothedPlus = rma(plusMove, diLength);
  const smoothedMinus = rma(minusMove, diLength);
  const plus = emptySeries(n);
  const minus = emptySeries(n);
  const spread = emptySeries(n);
  let lastPlus: number | null = null;
  let lastMinus: number | null = null;
  for (let i = 0; i < n; i += 1) {
    const total = smoothedRange[i];
    const up = smoothedPlus[i];
    const down = smoothedMinus[i];
    if (total === null || up === null || down === null) continue;
    if (total !== 0) {
      lastPlus = (100 * up) / total;
      lastMinus = (100 * down) / total;
    }
    if (lastPlus === null || lastMinus === null) continue;
    plus[i] = lastPlus;
    minus[i] = lastMinus;
    const sum = lastPlus + lastMinus;
    spread[i] = Math.abs(lastPlus - lastMinus) / (sum === 0 ? 1 : sum);
  }
  const adx = rma(spread, adxSmoothing).map((value) => (value === null ? null : 100 * value));
  return { plus, minus, adx };
}

/**
 * On-balance volume: running total adding the volume of bars that closed up and
 * subtracting it on down closes (unchanged close or missing volume adds 0). Starts
 * at 0 on the first bar, so only its shape (not its level) compares with TradingView.
 */
export function obv(closes: readonly number[], volumes: ReadonlyArray<number | null>): IndicatorSeries {
  const out = emptySeries(closes.length);
  if (!hasVolume(volumes)) return out;
  let total = 0;
  for (let i = 0; i < closes.length; i += 1) {
    if (i > 0) {
      const volume = volumes[i] ?? 0;
      if (closes[i] > closes[i - 1]) total += volume;
      else if (closes[i] < closes[i - 1]) total -= volume;
    }
    out[i] = total;
  }
  return out;
}

/**
 * Money flow index (Pine `ta.mfi(hlc3, length)`): hlc3 × volume split into positive
 * and negative flow by hlc3 vs the previous bar, 100 − 100 / (1 + positive / negative)
 * over `period` bars. No negative flow reads 100; no flow at all reads 50.
 */
export function mfi(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  volumes: ReadonlyArray<number | null>,
  period = 14,
): IndicatorSeries {
  const out = emptySeries(closes.length);
  if (!hasVolume(volumes)) return out;
  const typical = typicalPrices(highs, lows, closes);
  for (let i = period; i < typical.length; i += 1) {
    let positive = 0;
    let negative = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const flow = typical[j] * (volumes[j] ?? 0);
      if (typical[j] > typical[j - 1]) positive += flow;
      else if (typical[j] < typical[j - 1]) negative += flow;
    }
    if (negative === 0) out[i] = positive === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + positive / negative);
  }
  return out;
}

/** Rate of change: 100 × (close − close `period` bars ago) / that close. */
export function roc(closes: readonly number[], period = 9): IndicatorSeries {
  const out = emptySeries(closes.length);
  for (let i = period; i < closes.length; i += 1) {
    const base = closes[i - period];
    if (base !== 0) out[i] = (100 * (closes[i] - base)) / base;
  }
  return out;
}
