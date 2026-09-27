/**
 * Pure geometry of the drawing tools: instants ↔ fractional bar positions,
 * pixel distances for hit testing, clipping, magnet snapping and Fibonacci
 * levels. No chart or DOM access, so it can be checked in Node.
 *
 * A "bar position" is a fractional index into the chart's bars: 3 is the
 * fourth bar, 3.5 halfway to the fifth, -2 two bar steps before the first.
 * Drawings store real instants, so a line drawn on daily bars lands on the
 * same dates on weekly or intraday bars.
 */

/** Fibonacci retracement ratios; 0 sits on the second point, 1 on the first (TradingView convention). */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export interface TimedBar {
  /** Epoch ms of the bar. */
  time: number;
}

export interface OhlcBar {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
}

const DAY_MS = 86_400_000;

/**
 * Typical gap between consecutive bars (lower median, ms): weekends, holidays
 * and overnight gaps do not skew it. One day when it cannot be measured.
 */
export function medianSpacing(bars: readonly TimedBar[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const gap = bars[i].time - bars[i - 1].time;
    if (gap > 0 && Number.isFinite(gap)) gaps.push(gap);
  }
  if (gaps.length === 0) return DAY_MS;
  gaps.sort((a, b) => a - b);
  return gaps[(gaps.length - 1) >> 1];
}

/** Index of the last bar at or before `time` (ascending bars); -1 before the first. */
function lastAtOrBefore(bars: readonly TimedBar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Fractional bar position of an instant: interpolated between the surrounding
 * bars, extrapolated with `spacing` (ms per bar) before the first and after the
 * last bar. Null without bars.
 */
export function timeToIndex(bars: readonly TimedBar[], time: number, spacing: number): number | null {
  const count = bars.length;
  if (count === 0 || !Number.isFinite(time) || !(spacing > 0)) return null;
  const first = bars[0].time;
  const last = bars[count - 1].time;
  if (time <= first) return (time - first) / spacing;
  if (time >= last) return count - 1 + (time - last) / spacing;
  const i = lastAtOrBefore(bars, time);
  const from = bars[i].time;
  const to = bars[i + 1].time;
  return to > from ? i + (time - from) / (to - from) : i;
}

/** Instant (epoch ms, rounded) at a fractional bar position; the inverse of `timeToIndex`. */
export function indexToTime(bars: readonly TimedBar[], index: number, spacing: number): number | null {
  const count = bars.length;
  if (count === 0 || !Number.isFinite(index) || !(spacing > 0)) return null;
  if (index <= 0) return Math.round(bars[0].time + index * spacing);
  if (index >= count - 1) return Math.round(bars[count - 1].time + (index - (count - 1)) * spacing);
  const i = Math.floor(index);
  return Math.round(bars[i].time + (index - i) * (bars[i + 1].time - bars[i].time));
}

export interface BarTimeMap {
  toIndex(time: number): number | null;
  toTime(index: number): number | null;
  /** Ms per bar step used outside the bars. */
  spacing: number;
}

/**
 * Time ↔ bar-position mapping for one bar array. `spacingMs` (e.g. the
 * intraday interval) overrides the measured median gap.
 */
export function createBarTimeMap(bars: readonly TimedBar[], spacingMs?: number | null): BarTimeMap {
  const spacing = spacingMs && spacingMs > 0 ? spacingMs : medianSpacing(bars);
  return {
    toIndex: (time) => timeToIndex(bars, time, spacing),
    toTime: (index) => indexToTime(bars, index, spacing),
    spacing,
  };
}

/**
 * Horizontal pixel positions of the bars. `x(i)` is the centre of bar `i`
 * (integer, 0 ≤ i < count); `step` is the width of one bar slot, used outside
 * the bars. Positions are read per bar because other series (comparison) can
 * add time points between two bars of the main series.
 */
export interface BarAxis {
  count: number;
  x(index: number): number | null;
  step: number;
}

/** Pixel x of a fractional bar position. */
export function indexToX(axis: BarAxis, index: number): number | null {
  const count = axis.count;
  if (count === 0 || !Number.isFinite(index)) return null;
  if (index <= 0) {
    const first = axis.x(0);
    return first === null ? null : first + index * axis.step;
  }
  if (index >= count - 1) {
    const last = axis.x(count - 1);
    return last === null ? null : last + (index - (count - 1)) * axis.step;
  }
  const i = Math.floor(index);
  const from = axis.x(i);
  const to = axis.x(i + 1);
  if (from === null || to === null) return null;
  return from + (index - i) * (to - from);
}

/** Fractional bar position at pixel x (binary search over the bar centres). */
export function xToIndex(axis: BarAxis, x: number): number | null {
  const count = axis.count;
  if (count === 0 || !Number.isFinite(x) || !(axis.step > 0)) return null;
  const first = axis.x(0);
  const last = axis.x(count - 1);
  if (first === null || last === null) return null;
  if (x <= first) return (x - first) / axis.step;
  if (x >= last) return count - 1 + (x - last) / axis.step;
  // Invariant: x(lo) <= x < x(hi).
  let lo = 0;
  let hi = count - 1;
  let from = first;
  let to = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const at = axis.x(mid);
    if (at === null) return null;
    if (at <= x) {
      lo = mid;
      from = at;
    } else {
      hi = mid;
      to = at;
    }
  }
  return to > from ? lo + (x - from) / (to - from) : lo;
}

// ---------------------------------------------------------------------------
// Distances (pixels) for hit testing
// ---------------------------------------------------------------------------

function projectOnLine(px: number, py: number, x1: number, y1: number, x2: number, y2: number, tMin: number, tMax: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? ((px - x1) * dx + (py - y1) * dy) / lengthSquared : 0;
  const clamped = Math.min(Math.max(t, tMin), tMax);
  return Math.hypot(px - (x1 + clamped * dx), py - (y1 + clamped * dy));
}

/** Distance from (px, py) to the segment (x1, y1)–(x2, y2). */
export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  return projectOnLine(px, py, x1, y1, x2, y2, 0, 1);
}

/** Distance from (px, py) to the ray starting at (x1, y1) through (x2, y2). */
export function distanceToRay(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  return projectOnLine(px, py, x1, y1, x2, y2, 0, Infinity);
}

/** Distance to an infinite horizontal line at `y`. */
export function distanceToHorizontal(py: number, y: number): number {
  return Math.abs(py - y);
}

/** Distance to an infinite vertical line at `x`. */
export function distanceToVertical(px: number, x: number): number {
  return Math.abs(px - x);
}

/** Distance to the outline of the rectangle spanned by two corners. */
export function distanceToRectEdges(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  return Math.min(
    distanceToSegment(px, py, x1, y1, x2, y1),
    distanceToSegment(px, py, x2, y1, x2, y2),
    distanceToSegment(px, py, x2, y2, x1, y2),
    distanceToSegment(px, py, x1, y2, x1, y1),
  );
}

/** Whether (px, py) lies inside (or on) the rectangle spanned by two corners. */
export function pointInRect(px: number, py: number, x1: number, y1: number, x2: number, y2: number): boolean {
  return px >= Math.min(x1, x2) && px <= Math.max(x1, x2) && py >= Math.min(y1, y2) && py <= Math.max(y1, y2);
}

// ---------------------------------------------------------------------------
// Clipping (Liang–Barsky): canvases draw only the visible part of long lines
// ---------------------------------------------------------------------------

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Part of the line p1 + t·(p2 − p1), t ∈ [tFrom, tTo], inside `box`; null when it misses. */
function clipParametric(x1: number, y1: number, x2: number, y2: number, box: Box, tFrom: number, tTo: number): Segment | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    const inside = x1 >= box.left && x1 <= box.right && y1 >= box.top && y1 <= box.bottom;
    return inside ? { x1, y1, x2: x1, y2: y1 } : null;
  }
  let lo = tFrom;
  let hi = tTo;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - box.left, box.right - x1, y1 - box.top, box.bottom - y1];
  for (let k = 0; k < 4; k += 1) {
    if (p[k] === 0) {
      if (q[k] < 0) return null;
      continue;
    }
    const r = q[k] / p[k];
    if (p[k] < 0) {
      if (r > hi) return null;
      if (r > lo) lo = r;
    } else {
      if (r < lo) return null;
      if (r < hi) hi = r;
    }
  }
  if (!Number.isFinite(hi)) return null;
  return { x1: x1 + lo * dx, y1: y1 + lo * dy, x2: x1 + hi * dx, y2: y1 + hi * dy };
}

/** Visible part of a segment. */
export function clipSegment(x1: number, y1: number, x2: number, y2: number, box: Box): Segment | null {
  return clipParametric(x1, y1, x2, y2, box, 0, 1);
}

/** Visible part of the ray from (x1, y1) through (x2, y2). */
export function clipRay(x1: number, y1: number, x2: number, y2: number, box: Box): Segment | null {
  return clipParametric(x1, y1, x2, y2, box, 0, Infinity);
}

// ---------------------------------------------------------------------------
// Magnet, Fibonacci
// ---------------------------------------------------------------------------

/** Vertical snap distance of the magnet, in CSS px. */
export const MAGNET_RADIUS = 12;

/**
 * The open/high/low/close of `bar` closest to pixel row `y`, when it is within
 * `radius` px; null otherwise. Bars without OHLC offer their close only.
 */
export function snapPrice(
  bar: OhlcBar,
  y: number,
  priceToY: (price: number) => number | null,
  radius: number = MAGNET_RADIUS,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const price of [bar.open, bar.high, bar.low, bar.close]) {
    if (price === null || !Number.isFinite(price)) continue;
    const at = priceToY(price);
    if (at === null || !Number.isFinite(at)) continue;
    const distance = Math.abs(at - y);
    if (distance <= radius && distance < bestDistance) {
      best = price;
      bestDistance = distance;
    }
  }
  return best;
}

/** Price of a retracement level between the first (`start`) and second (`end`) point. */
export function fibPrice(start: number, end: number, level: number): number {
  return end + (start - end) * level;
}
