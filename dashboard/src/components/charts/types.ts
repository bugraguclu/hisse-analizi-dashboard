import type { ChartPeriod } from "@/types";

/** How the main series is drawn. */
export type ChartType = "area" | "line" | "candles";

/** Price overlays drawn on the main pane. */
export type OverlayKey = "ma20" | "ma50" | "ma200" | "bb";

/** Indicator panes stacked under the main pane. */
export type PaneKey = "rsi" | "macd" | "stoch";

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
