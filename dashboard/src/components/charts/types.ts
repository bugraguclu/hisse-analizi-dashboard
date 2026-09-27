import type { ChartPeriod } from "@/types";

/** How the main series is drawn. */
export type ChartType = "area" | "line" | "candles" | "hollow" | "bars" | "heikin" | "baseline";

/** Legacy (prefs v1) price overlays; migrated to `IndicatorConfig` in prefs v2. */
export type OverlayKey = "ma20" | "ma50" | "ma200" | "bb";

/** Legacy (prefs v1) indicator panes; migrated to `IndicatorConfig` in prefs v2. */
export type PaneKey = "rsi" | "macd" | "stoch";

/** Every indicator the kit can compute (see indicator-catalog.ts). */
export type IndicatorKind =
  | "sma"
  | "ema"
  | "bb"
  | "vwap"
  | "psar"
  | "supertrend"
  | "rsi"
  | "macd"
  | "stoch"
  | "stochrsi"
  | "cci"
  | "willr"
  | "atr"
  | "adx"
  | "obv"
  | "mfi"
  | "roc";

/** One indicator on a chart; a kind can appear several times (SMA 20 + SMA 50). */
export interface IndicatorConfig {
  /** Stable instance id, unique within a chart (e.g. "sma-k3f9"). */
  id: string;
  kind: IndicatorKind;
  /** Parameter values keyed like the catalog's `params` (sanitized). */
  params: Record<string, number>;
  /** Categorical palette slot (0–4) of the first line; further lines take the next slots. */
  color: number;
  /** Kept in the legend but not drawn. */
  hidden?: boolean;
}

/** Price axis of the main pane. */
export type PriceScaleKind = "normal" | "log" | "percent";

/** Bar size of a series; decides axis/legend date formats. */
export type IntervalKind = "intraday" | "daily" | "weekly" | "monthly";

export interface ChartBar {
  /** Epoch ms of the bar (real instant, not wall clock). */
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface ChartSeries {
  /** Symbol the bars belong to (placeholder data can lag behind the selection). */
  symbol: string;
  /** Period the bars were fetched for. */
  period: ChartPeriod;
  interval: IntervalKind;
  /** Minutes between intraday bars (15 for 1d, 30 for 5d); null for daily and longer. */
  intervalMinutes: number | null;
  /** Warmup bars followed by the period window, ascending, unique times. */
  bars: ChartBar[];
  /** Index of the first bar of the requested window; bars before it are warmup. */
  windowStart: number;
  /** Close before the window (base of the period change); null when unknown. */
  referenceClose: number | null;
  /** Live quote block of the response (index endpoint: prev_close, change, ...). */
  info: Record<string, unknown> | null;
}

/** Visible bar range of a chart, in `bars` indices (inclusive). */
export interface ChartView {
  from: number;
  to: number;
  /** True while the view is the untouched default window of the period. */
  isDefault: boolean;
}

/** A symbol drawn next to the main series as % return (comparison mode). */
export interface CompareSeries {
  symbol: string;
  label: string;
  series: ChartSeries;
  /** Categorical palette slot (0–4). */
  color: number;
}

/** Corporate / disclosure event pinned to the time axis. */
export type ChartEventKind = "dividend" | "earnings" | "capital" | "disclosure";

export interface ChartEvent {
  id: string;
  kind: ChartEventKind;
  /** Epoch ms of the event (ex-date, publication time...). */
  time: number;
  title: string;
  /** Second line of the tooltip (amount, summary). */
  detail: string | null;
  url: string | null;
}
