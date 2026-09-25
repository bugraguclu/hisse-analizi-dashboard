"use client";

import { useCallback, useMemo, useRef } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { parseDate, toFiniteNumber } from "@/lib/format";
import { STALE_TIME } from "@/lib/queryClient";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import type { ChartHistoryOut, ChartPeriod, OhlcvBar } from "@/types";
import { toChartTime } from "./time";
import type { ChartBar, ChartSeries, ChartView, IntervalKind } from "./types";

/** Bars requested before each window: enough for SMA 200 and a settled Wilder RSI. */
export const CHART_WARMUP_BARS = 250;

export const CHART_PERIODS: readonly ChartPeriod[] = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "5y", "max"];

export function isIntradayPeriod(period: ChartPeriod): boolean {
  return period === "1d" || period === "5d";
}

function intervalOf(interval: string | undefined, period: ChartPeriod): { kind: IntervalKind; minutes: number | null } {
  const value = (interval ?? "").trim().toLowerCase();
  const intraday = /^(\d+)(m|h)$/.exec(value);
  if (intraday) return { kind: "intraday", minutes: Number(intraday[1]) * (intraday[2] === "h" ? 60 : 1) };
  if (value === "1wk" || value === "1w") return { kind: "weekly", minutes: null };
  if (value === "1mo") return { kind: "monthly", minutes: null };
  if (value === "1d") return { kind: "daily", minutes: null };
  if (period === "1d") return { kind: "intraday", minutes: 15 };
  if (period === "5d") return { kind: "intraday", minutes: 30 };
  if (period === "5y") return { kind: "weekly", minutes: null };
  if (period === "max") return { kind: "monthly", minutes: null };
  return { kind: "daily", minutes: null };
}

function positive(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function toBar(row: OhlcvBar): ChartBar | null {
  const date = parseDate(row.Date ?? row.Datetime ?? null);
  const close = positive(row.Close);
  if (!date || close === null) return null;
  const open = positive(row.Open);
  let high = positive(row.High);
  let low = positive(row.Low);
  // Keep candles well-formed even when a feed glitch reports a close outside the range.
  if (high !== null) high = Math.max(high, close, open ?? close);
  if (low !== null) low = Math.min(low, close, open ?? close);
  const volume = toFiniteNumber(row.Volume);
  return { time: date.getTime(), open, high, low, close, volume: volume !== null && volume >= 0 ? volume : null };
}

function toBars(rows: readonly OhlcvBar[] | undefined): ChartBar[] {
  const bars: ChartBar[] = [];
  for (const row of rows ?? []) {
    const bar = toBar(row);
    if (bar) bars.push(bar);
  }
  return bars;
}

/** Response of the chart endpoints → one ascending series with the window start marked. */
export function parseChartHistory(payload: ChartHistoryOut, symbol: string, period: ChartPeriod): ChartSeries {
  const window = toBars(payload.data);
  const firstWindowTime = window.reduce((min, bar) => Math.min(min, bar.time), Infinity);
  const byTime = new Map<number, ChartBar>();
  for (const bar of toBars(payload.warmup)) if (bar.time < firstWindowTime) byTime.set(bar.time, bar);
  for (const bar of window) byTime.set(bar.time, bar);
  const bars = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  const windowStart = window.length > 0 ? Math.max(0, bars.findIndex((bar) => bar.time >= firstWindowTime)) : bars.length;
  const { kind, minutes } = intervalOf(payload.interval, period);
  const reference = positive(payload.reference_close);
  return {
    symbol,
    period,
    interval: kind,
    intervalMinutes: minutes,
    bars,
    windowStart,
    referenceClose: reference ?? (windowStart > 0 ? bars[windowStart - 1].close : null),
    info: payload.info && typeof payload.info === "object" ? payload.info : null,
  };
}

interface RawChartHistory {
  symbol: string;
  period: ChartPeriod;
  payload: ChartHistoryOut;
}

type ChartKind = "ticker" | "index";

function chartHistoryOptions(kind: ChartKind, symbol: string, period: ChartPeriod) {
  return queryOptions({
    queryKey: ["chartHistory", kind, symbol, period, CHART_WARMUP_BARS],
    queryFn: async ({ signal }): Promise<RawChartHistory> => ({
      symbol,
      period,
      payload: await api.chartHistory(kind, symbol, period, CHART_WARMUP_BARS, signal),
    }),
    staleTime: isIntradayPeriod(period) ? STALE_TIME.market : STALE_TIME.analysis,
  });
}

/**
 * Chart bars (window + warmup) for a stock ("ticker") or an index. While a new
 * period loads the previous period stays on screen (placeholder data, same
 * symbol only); `data.period` tells which period is actually shown.
 */
export function useChartHistory(
  kind: ChartKind,
  symbol: string,
  period: ChartPeriod,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const liveInterval = useLiveRefetchInterval(60_000);
  const select = useCallback((raw: RawChartHistory) => parseChartHistory(raw.payload, raw.symbol, raw.period), []);
  return useQuery({
    ...chartHistoryOptions(kind, symbol, period),
    select,
    refetchInterval: period === "1d" ? liveInterval : false,
    placeholderData: (previous) => (previous?.symbol === symbol ? previous : undefined),
    enabled: enabled && symbol.length > 0,
  });
}

/** Hovering back and forth over a chart warms its periods at most this often. */
const PREFETCH_INTERVAL_MS = 30_000;

/**
 * Loads every period of a chart in the background once the viewer shows intent
 * (pointer over, or focus inside, the chart or its period picker), so a period
 * switch paints from cache instead of waiting for the backend. React Query
 * skips periods that are already cached and fresh.
 */
export function usePrefetchChartPeriods(kind: ChartKind, symbol: string): () => void {
  const queryClient = useQueryClient();
  const lastRef = useRef<{ key: string; at: number } | null>(null);
  return useCallback(() => {
    if (!symbol) return;
    const key = `${kind}:${symbol}`;
    const now = Date.now();
    if (lastRef.current?.key === key && now - lastRef.current.at < PREFETCH_INTERVAL_MS) return;
    lastRef.current = { key, at: now };
    for (const period of CHART_PERIODS) void queryClient.prefetchQuery(chartHistoryOptions(kind, symbol, period));
  }, [kind, symbol, queryClient]);
}

/** Whether instant `at` (epoch ms) falls inside `bar`'s Istanbul session: its intraday slot, day, week or month. */
function barContains(series: ChartSeries, bar: ChartBar, at: number): boolean {
  const barWall = toChartTime(bar.time);
  const atWall = toChartTime(at);
  if (atWall < barWall) return false;
  switch (series.interval) {
    case "intraday":
      return series.intervalMinutes !== null && atWall < barWall + series.intervalMinutes * 60;
    case "daily":
      return Math.floor(atWall / 86_400) === Math.floor(barWall / 86_400);
    case "weekly":
      return atWall < barWall + 7 * 86_400;
    case "monthly": {
      const barDate = new Date(barWall * 1000);
      const atDate = new Date(atWall * 1000);
      return barDate.getUTCFullYear() === atDate.getUTCFullYear() && barDate.getUTCMonth() === atDate.getUTCMonth();
    }
  }
}

/**
 * Brings the newest bar up to the live quote. The history is cached for
 * minutes while the quote refreshes every few seconds, so without this the
 * last candle, the price line and the period change lag the page header.
 * Only a bar whose session contains the quote time is touched (never an older
 * quote over a newer bar); a quote from a session the history doesn't have
 * yet waits for the next history refetch. `at` should be the upstream quote
 * time; intraday bars are only updated when `exactTime` says it is one.
 */
export function withLiveQuote(
  series: ChartSeries | undefined,
  last: number | null | undefined,
  at: number | null | undefined,
  exactTime: boolean,
): ChartSeries | undefined {
  if (!series || series.bars.length === 0 || last == null || !(last > 0) || !at) return series;
  if (series.interval === "intraday" && !exactTime) return series;
  const bar = series.bars[series.bars.length - 1];
  if (bar.close === last || !barContains(series, bar, at)) return series;
  const bars = series.bars.slice();
  bars[bars.length - 1] = {
    ...bar,
    close: last,
    high: bar.high === null ? null : Math.max(bar.high, last),
    low: bar.low === null ? null : Math.min(bar.low, last),
  };
  return { ...series, bars };
}

/** `withLiveQuote`, memoized: the merged series keeps its identity until the history or the quote changes. */
export function useLiveSeries(
  series: ChartSeries | undefined,
  last: number | null | undefined,
  at: number | null | undefined,
  exactTime: boolean,
): ChartSeries | undefined {
  return useMemo(() => withLiveQuote(series, last, at, exactTime), [series, last, at, exactTime]);
}

export interface RangeStats {
  first: ChartBar;
  last: ChartBar;
  /** Close the change is measured from (bar before the range, or the given base). */
  base: number;
  /** Time of the bar `base` comes from; null for an external base (official previous close). */
  baseTime: number | null;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  count: number;
}

/**
 * Change/high/low of bars[from..to]. The change is measured from the close
 * before the range (the period's previous close for the default window), so it
 * matches the header figures; `baseOverride` (e.g. the official previous close
 * for 1D) wins when given. `extremes: "close"` measures high/low on closes (what
 * a line/area chart draws), `"wick"` on the bars' highs and lows.
 */
export function rangeStats(
  series: ChartSeries,
  view: Pick<ChartView, "from" | "to">,
  baseOverride?: number | null,
  extremes: "close" | "wick" = "wick",
): RangeStats | null {
  const { bars } = series;
  if (bars.length === 0) return null;
  const from = Math.max(0, Math.min(view.from, bars.length - 1));
  const to = Math.max(from, Math.min(view.to, bars.length - 1));
  let high = -Infinity;
  let low = Infinity;
  for (let i = from; i <= to; i += 1) {
    const bar = bars[i];
    high = Math.max(high, extremes === "wick" ? (bar.high ?? bar.close) : bar.close, bar.close);
    low = Math.min(low, extremes === "wick" ? (bar.low ?? bar.close) : bar.close, bar.close);
  }
  const first = bars[from];
  const last = bars[to];
  let base: number;
  let baseTime: number | null;
  if (baseOverride && baseOverride > 0) {
    base = baseOverride;
    baseTime = null;
  } else if (from > 0) {
    base = bars[from - 1].close;
    baseTime = bars[from - 1].time;
  } else if (from === series.windowStart && series.referenceClose) {
    base = series.referenceClose;
    baseTime = null;
  } else {
    base = first.open ?? first.close;
    baseTime = first.time;
  }
  const change = last.close - base;
  return { first, last, base, baseTime, change, changePercent: (change / base) * 100, high, low, count: to - from + 1 };
}

/** The period window as a view (what the chart shows before any zoom/pan). */
export function windowView(series: ChartSeries): ChartView {
  return { from: Math.min(series.windowStart, Math.max(0, series.bars.length - 1)), to: Math.max(0, series.bars.length - 1), isDefault: true };
}
