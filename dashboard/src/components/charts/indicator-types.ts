/**
 * Contract between the indicator catalog (indicator-catalog.ts: definitions
 * and maths) and the chart (FinancialChart renders any `IndicatorOutput`
 * generically). Keep this file free of React and of lightweight-charts.
 */

import type { Locale } from "@/lib/i18n";
import type { IndicatorSeries } from "./indicators";
import type { IndicatorKind, IntervalKind } from "./types";

/** UI text in every locale (tr is the source language). */
export type Localized = Record<Locale, string>;

export interface IndicatorParamSpec {
  /** Key in `IndicatorConfig.params`, e.g. "length". */
  key: string;
  label: Localized;
  default: number;
  min: number;
  max: number;
  /** 1 for integer parameters (lengths), 0.01/0.1 for multipliers. */
  step: number;
}

/** Bars (warmup + window) in the columns the maths needs; all arrays have the same length. */
export interface IndicatorInput {
  /** Bar instants, epoch ms, ascending. */
  times: readonly number[];
  /** Istanbul trading day of each bar ("2026-09-25"): VWAP resets on a new key. */
  sessions: readonly string[];
  open: readonly (number | null)[];
  /** Falls back to the close when the feed has no high. */
  high: readonly number[];
  /** Falls back to the close when the feed has no low. */
  low: readonly number[];
  close: readonly number[];
  volume: readonly (number | null)[];
  interval: IntervalKind;
}

export type IndicatorTone = "up" | "down" | "muted";

export interface IndicatorLine {
  /** Unique within one output, e.g. "upper", "k", "signal". */
  key: string;
  /** Legend label of this line; null when the instance label says it all (SMA 20). */
  label: Localized | null;
  /** Aligned with the input bars; null = no value (warmup, gap). */
  values: IndicatorSeries;
  /** Added to the instance's colour slot (MACD signal = +1). Ignored when `tone`/`tones` is set. */
  colorOffset?: number;
  /** Fixed semantic colour (DMI: +DI up, −DI down). */
  tone?: IndicatorTone;
  /** Per-point colour (Supertrend up/down regimes); null entries have no value. */
  tones?: ReadonlyArray<IndicatorTone | null>;
  style?: "solid" | "dashed" | "dotted";
  /** "dots": point markers without a connecting line (Parabolic SAR). */
  shape?: "line" | "dots";
  /** Line width in px; defaults to 1 (overlays) — the main price line is 2. */
  width?: 1 | 2;
}

export interface IndicatorHistogram {
  key: string;
  label: Localized | null;
  values: IndicatorSeries;
  /**
   * "sign": up colour for ≥ 0, down colour below;
   * "sign-strength": same, faded while |value| shrinks bar over bar (MACD histogram).
   */
  colorMode: "sign" | "sign-strength";
}

export interface IndicatorOutput {
  lines: IndicatorLine[];
  histogram?: IndicatorHistogram;
  /** Translucent fill between two of `lines` (Bollinger), by line key. */
  band?: { upper: string; lower: string };
}

/** How values are printed in the legend and on the price axis. */
export type IndicatorFormat =
  /** Like prices (formatChartPrice): overlays, ATR. */
  | "price"
  /** Two decimals: oscillators (RSI 45,57). */
  | "fixed2"
  /** Decimals by magnitude of the data (MACD, ROC). */
  | "auto"
  /** Compact thousands/millions (OBV). */
  | "compact";

export interface IndicatorDef {
  kind: IndicatorKind;
  /** "overlay": drawn on the price pane in price units; "pane": its own pane below. */
  placement: "overlay" | "pane";
  /** Menu group. */
  group: "trend" | "momentum" | "volatility" | "volume";
  /** Short name used in labels, e.g. "SMA", "RSI", "Bollinger". */
  abbr: string;
  /** Menu title, e.g. { tr: "Basit hareketli ortalama", ... }. */
  name: Localized;
  /** One-line help shown in the menu and as a tooltip. */
  description: Localized;
  /** Extra search words (folded, lower-case), e.g. ["ortalama", "moving average"]. */
  keywords?: readonly string[];
  params: readonly IndicatorParamSpec[];
  /** Instance label, e.g. "SMA 20", "MACD 12 26 9", "VWAP". */
  label(params: Readonly<Record<string, number>>): string;
  requires?: {
    /** Needs traded volume (OBV, MFI, VWAP). */
    volume?: boolean;
    /** Only meaningful on intraday bars (VWAP). */
    intraday?: boolean;
  };
  /** Fixed pane scale (RSI 0–100); omitted = autoscale. */
  range?: { min: number; max: number };
  /** Dashed reference levels of a pane (RSI 30/70). */
  levels?: ReadonlyArray<{ value: number; tone: IndicatorTone }>;
  format: IndicatorFormat;
  compute(input: IndicatorInput, params: Readonly<Record<string, number>>): IndicatorOutput;
}
