/**
 * Contract between the drawing tools (this folder) and FinancialChart.
 *
 * FinancialChart owns the lightweight-charts instance and rebuilds every
 * series when data/structure change; the drawing layer attaches ONE series
 * primitive to the current main series (re-attaching when `mainSeries`
 * changes) and handles its own pointer gestures on the plot element.
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from "react";
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from "lightweight-charts";
import type { Locale } from "@/lib/i18n";
import type { ChartPalette } from "../colors";
import type { ChartBar, IntervalKind } from "../types";

/** Shapes a viewer can draw. */
export type DrawingKind = "trend" | "ray" | "hline" | "vline" | "rect" | "fib";

/** Active pointer tool. "measure" is FinancialChart's own drag-to-measure, not a stored drawing. */
export type DrawingTool = "cursor" | "measure" | DrawingKind;

export interface DrawingPoint {
  /** Real instant (epoch ms): maps onto the bars of any period, fractional between bars. */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** trend / ray / rect / fib: [start, end]; hline / vline: [anchor]. */
  points: DrawingPoint[];
  /** Categorical palette slot 0–4, or -1 for the foreground ink. */
  color: number;
  dashed?: boolean;
}

export interface DrawingLayerOptions {
  chart: IChartApi | null;
  /** Main price series; the primitive is re-attached whenever this object changes. */
  mainSeries: ISeriesApi<SeriesType> | null;
  /** The chart's focusable plot wrapper: pointer listeners go here (capture phase). */
  plotRef: RefObject<HTMLDivElement | null>;
  bars: readonly ChartBar[];
  /** Chart x value of each bar (Istanbul wall clock as UTC seconds). */
  times: readonly UTCTimestamp[];
  interval: IntervalKind;
  /** Minutes between intraday bars; null for daily and longer. */
  intervalMinutes: number | null;
  /** Resolved design tokens (canvas cannot read CSS variables); null until the chart is built. */
  palette: ChartPalette | null;
  locale: Locale;
  drawings: readonly Drawing[];
  onDrawingsChange: (next: Drawing[]) => void;
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  /** All drawings hidden (and not hit-testable). */
  visible: boolean;
  /** Snap points to the nearest open/high/low/close when close enough. */
  magnet: boolean;
  /** Price formatter of the main series (axis labels, Fibonacci level prices). */
  format: (value: number) => string;
  /** The layer drives the crosshair while it swallows pointer moves (drag); keeps legends in sync. */
  onHoverIndex?: (index: number | null) => void;
}

export interface DrawingLayer {
  selectedId: string | null;
  /** HTML rendered inside the plot element (edit bar of the selected drawing, placement hint). */
  overlay: ReactNode;
  /**
   * Keys while the plot has focus: Delete/Backspace (remove selected), Escape
   * (cancel placement → deselect → back to the cursor), ⌘/Ctrl+Z (undo).
   * Returns true when the key was handled (the chart then ignores it).
   */
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
  /** A placement or drag is in progress. */
  busy: boolean;
}
