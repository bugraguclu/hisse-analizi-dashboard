"use client";

/*
 * Interactive price/index chart built on TradingView Lightweight Charts™
 * (Copyright (c) 2025 TradingView, Inc., Apache License 2.0,
 * https://www.tradingview.com/). Cards that mount this component show the
 * attribution link in their footer (chart i18n key "attribution").
 */

import {
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";
import type {
  BarPrice,
  ChartOptions,
  DeepPartial,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  ISeriesPrimitive,
  ITextWatermarkPluginApi,
  Logical,
  MouseEventParams,
  SeriesMarker,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { Menu } from "@base-ui/react/menu";
import { ChevronsRight, Copy, Download, ExternalLink, Minus, RotateCcw, X } from "lucide-react";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { formatChangePercent, formatNumber, getIntlLocale, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartLegend, IndicatorLegendItem, type LegendCompare } from "./ChartLegend";
import { observeTheme, readChartPalette, rgba, SERIES_CSS_VAR, type ChartPalette, type Rgb } from "./colors";
import { CheckMark, MENU_ITEM_CLASS, POPUP_CLASS } from "./controls";
import { chartMinMove, formatChartChange, formatChartPrice, formatTicks } from "./format";
import { useChartI18n, type ChartKey } from "./i18n";
import { buildIndicatorInput } from "./indicator-catalog";
import { buildIndicatorView, lineRgb, toneRgb, type IndicatorView } from "./indicator-view";
import { describeMeasure, measureGeometry, MeasureOverlay, type MeasureGeometry, type MeasureState } from "./measure";
import { BandFillPrimitive, EventBadgesPrimitive, SessionBreaksPrimitive, TargetFanPrimitive, type EventBadge } from "./primitives";
import { composeSnapshot, type SnapshotHeader, type SnapshotLabel } from "./snapshot";
import { barLabelStyle, formatBarTime, formatWallTime, SESSION_END_MINUTES, tickLabel, toChartTime, wallMinutes } from "./time";
import { seriesUnit } from "./units";
import type {
  ChartBar,
  ChartEvent,
  ChartEventKind,
  ChartSeries,
  ChartType,
  ChartView,
  CompareSeries,
  IndicatorConfig,
  PriceScaleKind,
} from "./types";
import { newDrawingId, useDrawingLayer } from "./drawings";
import { DEFAULT_COLOR } from "./drawings/model";
import { DrawingPrimitive } from "./drawings/primitive";
import type { Drawing, DrawingTool } from "./drawings/types";
import { isApplePlatform, useCoarsePointer } from "./use-coarse-pointer";

type Lib = typeof import("lightweight-charts");
type AnySeries = ISeriesApi<SeriesType>;

interface Engine {
  lib: Lib;
  chart: IChartApi;
}

interface AttachedPrimitive {
  series: AnySeries;
  primitive: ISeriesPrimitive<Time>;
}

export interface FinancialChartHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  scrollToLatest(): void;
  /** Framed PNG (header, chart, attribution); null before the chart is drawn. */
  snapshot(): Promise<Blob | null>;
  focus(): void;
  /** Undo the last drawing change of this page view. */
  undoDrawing(): void;
  /** Remove every drawing (undoable). */
  clearDrawings(): void;
}

export interface FinancialChartProps {
  series: ChartSeries;
  type: ChartType;
  indicators?: readonly IndicatorConfig[];
  /** Legend actions (settings, hide, remove); omit for a read-only legend. */
  onIndicatorsChange?: (next: IndicatorConfig[]) => void;
  volume?: boolean;
  /** Symbols drawn with the main series as % return from the first visible bar. */
  compare?: readonly CompareSeries[];
  onCompareRemove?: (symbol: string) => void;
  /** Dashed reference line (previous close / period start) with its axis label. */
  baseline?: { price: number; label: string } | null;
  /** Colour of the area/line series; defaults to the window's direction. */
  tone?: "up" | "down" | "flat";
  /** Canvas height in px, or "fill" to grow inside a flex column (full screen). */
  height: number | "fill";
  /** Height of each indicator pane in px. */
  paneHeight?: number;
  /** Extend an intraday session to 18:00 with empty slots (1D while trading). */
  padToSessionEnd?: boolean;
  /** Pulse the last price (live intraday data). */
  live?: boolean;
  /** Label the high/low of the visible range. */
  extremes?: boolean;
  scale?: PriceScaleKind;
  onScaleChange?: (scale: PriceScaleKind) => void;
  /** Faint symbol text behind the series. */
  watermark?: { title: string; subtitle?: string } | null;
  grid?: boolean;
  /** Dividends, reports and disclosures as badges along the time axis. */
  events?: readonly ChartEvent[];
  tool?: DrawingTool;
  onToolChange?: (tool: DrawingTool) => void;
  /** Trend lines, levels, Fibonacci… of this symbol (drawings/store). */
  drawings?: readonly Drawing[];
  onDrawingsChange?: (next: Drawing[]) => void;
  drawingsVisible?: boolean;
  /** Drawing points snap to open/high/low/close. */
  magnet?: boolean;
  /** Whether `undoDrawing()` has anything to undo (for a toolbar button). */
  onUndoStateChange?: (canUndo: boolean) => void;
  onHoverChange?: (index: number | null) => void;
  onViewChange?: (view: ChartView) => void;
  /** "modifier": vertical wheel scrolls the page, Ctrl/⌘ + wheel zooms; "always": wheel zooms. */
  wheelZoom?: "modifier" | "always";
  ariaLabel: string;
  symbol: string;
  /** Title/subtitle of the PNG snapshot header. */
  snapshotTitle?: { title: string; subtitle: string };
  /** Context-menu snapshot actions (the workspace owns file names and toasts). */
  onSnapshot?: (action: "download" | "copy") => void;
  /** Must be stable (module-level or memoized): changing it rebuilds the chart. */
  valueFormatter?: (value: number) => string;
  handleRef?: Ref<FinancialChartHandle>;
  className?: string;
  /**
   * "overlays" (cards): the date/OHLC row is left to the card's own summary line and the
   * baseline is named on the price axis; only indicator and comparison keys stay above the plot.
   */
  legendMode?: "full" | "overlays";
  /** A plain mouse drag measures (cards); Shift + drag and the measure tool always do. */
  dragMeasure?: boolean;
  /** Analyst consensus, drawn as a fan from the last close into the future space. */
  targets?: PriceTargets | null;
  /** Horizontal levels with an axis label (the viewer's average cost). */
  levels?: readonly PriceLevel[];
  /** Extra dashed lines on the price pane (dividend-reinvested total return), one value per bar. */
  extraLines?: readonly ExtraLine[];
  /** Expected events (next financial report, announced dividend): dashed badges in the future space. */
  upcoming?: readonly ChartEvent[];
}

export interface PriceTargets {
  low: number;
  mean: number;
  high: number;
  analysts: number | null;
}

export interface PriceLevel {
  price: number;
  label: string;
  tone: "primary" | "up" | "down" | "muted";
}

export interface ExtraLine {
  key: string;
  label: string;
  values: ReadonlyArray<number | null>;
  /** Categorical palette slot (0–4). */
  slot: number;
}

interface AxisBox {
  priceWidth: number;
  timeHeight: number;
  plotWidth: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  /** Price and bar under the pointer (main pane only), for "add horizontal line". */
  price: number | null;
  time: number | null;
}

interface EventTip {
  id: string;
  x: number;
  y: number;
  pinned: boolean;
}

const CANDLE_TYPES: ReadonlySet<ChartType> = new Set(["candles", "hollow", "heikin", "bars"]);
const ZOOM_STEP = 0.7;
/** Canvas text size (price/time axes, marker labels), in px. */
const CHART_FONT_SIZE = 11;
/** Widest bar spacing, in px: short periods on wide plots show extra bars instead of fat ones. */
const MAX_BAR_SPACING = 48;
const NO_DRAWINGS: readonly Drawing[] = [];
const NO_LEVELS: readonly PriceLevel[] = [];
const NO_LINES: readonly ExtraLine[] = [];
const NO_EVENTS: readonly ChartEvent[] = [];
/** Height of the event badges' own strip at the bottom of the price pane, px. */
const EVENT_LANE_PX = 22;
/** Share of the price pane the volume bars may take. */
const VOLUME_SHARE = 0.14;
const ignoreDrawings = () => {};

const EVENT_SLOT: Record<ChartEventKind, number | null> = { earnings: 0, dividend: 1, capital: 2, disclosure: null };
const EVENT_LABEL: Record<ChartEventKind, ChartKey> = {
  dividend: "event.dividend",
  earnings: "event.earnings",
  capital: "event.capital",
  disclosure: "event.disclosure",
};
const EVENT_LETTER: Record<ChartEventKind, ChartKey> = {
  dividend: "event.letter.dividend",
  earnings: "event.letter.earnings",
  capital: "event.letter.capital",
  disclosure: "event.letter.disclosure",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function barIsUp(bars: readonly ChartBar[], index: number): boolean {
  const bar = bars[index];
  if (bar.open !== null && bar.open !== bar.close) return bar.close > bar.open;
  const previous = bars[index - 1];
  return !previous || bar.close >= previous.close;
}

/** Empty 15/30-minute slots from the last bar up to 18:00, so 1D shows the whole session. */
function sessionPadTimes(series: ChartSeries, times: readonly UTCTimestamp[]): UTCTimestamp[] {
  if (series.interval !== "intraday" || !series.intervalMinutes || times.length === 0) return [];
  const last = times[times.length - 1];
  if (wallMinutes(last) >= SESSION_END_MINUTES) return [];
  const step = series.intervalMinutes * 60;
  const end = last - (last % 86_400) + SESSION_END_MINUTES * 60;
  const pad: UTCTimestamp[] = [];
  for (let time = last + step; time <= end; time += step) pad.push(time as UTCTimestamp);
  return pad;
}

/** Empty daily (weekdays), weekly or monthly slots after the last bar: room for the target fan and upcoming events. */
function futureSlots(interval: ChartSeries["interval"], last: UTCTimestamp | undefined, count: number): UTCTimestamp[] {
  if (last === undefined || count <= 0 || interval === "intraday") return [];
  const out: UTCTimestamp[] = [];
  let t: number = last;
  for (let i = 0; i < count; i += 1) {
    if (interval === "daily") {
      do t += 86_400;
      while ([0, 6].includes(new Date(t * 1000).getUTCDay()));
    } else if (interval === "weekly") {
      t += 7 * 86_400;
    } else {
      const d = new Date(t * 1000);
      d.setUTCMonth(d.getUTCMonth() + 1);
      t = d.getTime() / 1000;
    }
    out.push(t as UTCTimestamp);
  }
  return out;
}

/** Index of the last bar at or before `time` (ascending bars, binary search); -1 if none. */
function barAtOrBefore(bars: readonly ChartBar[], time: number): number {
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
 * Bar an event badge sits on: the bar whose session contains it. A date-only
 * event (dividend: Istanbul midnight) on intraday bars belongs to that day's
 * first bar, not to the previous evening's last one.
 */
function eventBarIndex(bars: readonly ChartBar[], time: number, interval: ChartSeries["interval"]): number {
  const index = barAtOrBefore(bars, time);
  if (interval !== "intraday" || wallMinutes(toChartTime(time)) !== 0) return index;
  const next = index + 1;
  if (next >= bars.length) return -1;
  const day = (ms: number) => Math.floor(toChartTime(ms) / 86_400);
  return day(bars[next].time) === day(time) ? next : -1;
}

/** OHLC of a bar with the feed's gaps filled (open = previous close, high/low = body). */
function ohlcOf(bars: readonly ChartBar[], i: number) {
  const bar = bars[i];
  const open = bar.open ?? (i > 0 ? bars[i - 1].close : bar.close);
  return {
    open,
    high: bar.high ?? Math.max(open, bar.close),
    low: bar.low ?? Math.min(open, bar.close),
    close: bar.close,
  };
}

/** Heikin Ashi candles: averaged bodies that smooth noise out of a trend. */
function heikinAshi(bars: readonly ChartBar[]) {
  const out: Array<{ open: number; high: number; low: number; close: number }> = [];
  for (let i = 0; i < bars.length; i += 1) {
    const { open, high, low, close } = ohlcOf(bars, i);
    const haClose = (open + high + low + close) / 4;
    const haOpen = i === 0 ? (open + close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    out.push({ open: haOpen, high: Math.max(high, haOpen, haClose), low: Math.min(low, haOpen, haClose), close: haClose });
  }
  return out;
}

function chartOptions(
  lib: Lib,
  palette: ChartPalette,
  series: ChartSeries,
  format: (value: number) => string,
  padded: boolean,
  type: ChartType,
  grid: boolean,
): DeepPartial<ChartOptions> {
  const muted = rgba(palette.muted);
  const firstWindowBar = series.windowStart > 0 ? series.bars[series.windowStart] : undefined;
  const windowStartTime = firstWindowBar ? toChartTime(firstWindowBar.time) : null;
  return {
    autoSize: true,
    layout: {
      background: { type: lib.ColorType.Solid, color: "transparent" },
      textColor: muted,
      fontFamily: palette.monoFamily,
      fontSize: CHART_FONT_SIZE,
      attributionLogo: false,
      panes: { separatorColor: rgba(palette.border), separatorHoverColor: rgba(palette.muted, 0.18), enableResize: true },
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: grid, color: rgba(palette.grid), style: lib.LineStyle.Solid },
    },
    rightPriceScale: { borderVisible: false, entireTextOnly: true, minimumWidth: 64 },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: false,
      rightOffset: 0,
      fixLeftEdge: true,
      // The right edge is pinned to the last bar, which would clip the empty session slots.
      fixRightEdge: !padded,
      lockVisibleTimeRangeOnResize: true,
      maxBarSpacing: MAX_BAR_SPACING,
      timeVisible: series.interval === "intraday",
      secondsVisible: false,
      ticksVisible: false,
      // Our longest tick label is "23 Eyl" / "15:00": reserve 6 characters, not the default 8, for denser labels on phones.
      tickMarkMaxCharacterLength: 6,
      // Labels are centred on their bar and the library only pulls them inside at the data's own ends. Two
      // edges fall elsewhere, so their labels would be cut in half: the period's first bar (warmup bars sit
      // left of it) and the empty 18:00 slot a live 1D chart ends on.
      tickMarkFormatter: (time: Time, tickMarkType: number) => {
        if (typeof time !== "number") return null;
        if (time === windowStartTime || (padded && wallMinutes(time) >= SESSION_END_MINUTES)) return "";
        return tickLabel(time, tickMarkType, series.interval);
      },
    },
    crosshair: {
      // Candles snap to the nearest of open/high/low/close, lines to the close (TradingView's magnet).
      mode: CANDLE_TYPES.has(type) ? lib.CrosshairMode.MagnetOHLC : lib.CrosshairMode.Magnet,
      vertLine: { color: rgba(palette.muted, 0.6), width: 1, style: lib.LineStyle.Dashed, labelBackgroundColor: rgba(palette.foreground) },
      horzLine: { color: rgba(palette.muted, 0.6), width: 1, style: lib.LineStyle.Dashed, labelBackgroundColor: rgba(palette.foreground) },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: {
      mouseWheel: true,
      pinch: true,
      axisPressedMouseMove: { time: true, price: true },
      axisDoubleClickReset: { time: true, price: true },
    },
    kineticScroll: { mouse: false, touch: true },
    trackingMode: { exitMode: lib.TrackingModeExitMode.OnTouchEnd },
    localization: {
      locale: getIntlLocale(),
      priceFormatter: (price: BarPrice) => format(price),
      // Prices are positive: the margins under the data (volume, event strip) would otherwise get ticks below 0 on "Tümü".
      tickmarksPriceFormatter: (prices: BarPrice[]) => formatTicks(prices, (value, decimals) => (value < 0 ? "" : formatNumber(value, decimals))),
      percentageFormatter: (value: number) => formatChangePercent(value),
      tickmarksPercentageFormatter: (values: number[]) =>
        formatTicks(values, (value, decimals) => formatChangePercent(value, Math.min(decimals, 2))),
      timeFormatter: (time: Time) => (typeof time === "number" ? formatWallTime(time, barLabelStyle(series.interval)) : ""),
    },
  };
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Advance width of one character of the (monospaced) chart font. */
function monoCharWidth(family: string, size: number): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return size * 0.6;
  measureContext.font = `${size}px ${family}`;
  return measureContext.measureText("0").width || size * 0.6;
}

/**
 * Marker text is centred on its bar, so near a plot edge it would be cut. The
 * chart font is monospaced: leading (or trailing) spaces shift the visible
 * value just enough to keep it inside, still as close to the arrow as possible.
 */
function edgeSafeLabel(label: string, x: number | null, width: number, charWidth: number): string {
  if (x === null) return "";
  const margin = 2;
  const half = (label.length * charWidth) / 2;
  const overflowLeft = margin - (x - half);
  if (overflowLeft > 0) return " ".repeat(Math.ceil((2 * overflowLeft) / charWidth)) + label;
  const overflowRight = x + half - (width - margin);
  if (overflowRight > 0) return label + " ".repeat(Math.ceil((2 * overflowRight) / charWidth));
  return label;
}

/** High/low of the visible range as two quiet markers (selective direct labels). */
function extremeMarkers(
  type: ChartType,
  bars: readonly ChartBar[],
  times: readonly UTCTimestamp[],
  from: number,
  to: number,
  color: string,
  format: (value: number) => string,
  place: (index: number, label: string) => string,
): SeriesMarker<Time>[] {
  if (to - from < 3) return [];
  const wicks = CANDLE_TYPES.has(type);
  const high = (i: number) => (wicks ? (bars[i].high ?? bars[i].close) : bars[i].close);
  const low = (i: number) => (wicks ? (bars[i].low ?? bars[i].close) : bars[i].close);
  let hi = from;
  let lo = from;
  for (let i = from; i <= to; i += 1) {
    if (high(i) > high(hi)) hi = i;
    if (low(i) < low(lo)) lo = i;
  }
  if (hi === lo) return [];
  const markers: SeriesMarker<Time>[] = [
    { time: times[hi], position: "aboveBar", shape: "arrowDown", color, text: place(hi, format(high(hi))), size: 0.6 },
    { time: times[lo], position: "belowBar", shape: "arrowUp", color, text: place(lo, format(low(lo))), size: 0.6 },
  ];
  return markers.sort((a, b) => Number(a.time) - Number(b.time));
}

function lineStyleOf(lib: Lib, style: "solid" | "dashed" | "dotted" | undefined) {
  return style === "dashed" ? lib.LineStyle.Dashed : style === "dotted" ? lib.LineStyle.Dotted : lib.LineStyle.Solid;
}

function detachAll(attached: readonly AttachedPrimitive[]) {
  for (const { series, primitive } of attached) {
    try {
      series.detachPrimitive(primitive);
    } catch {
      // The owner series is already gone.
    }
  }
}

/**
 * Price/index chart in seven styles with volume, any number of configurable
 * indicators (overlays and panes), multi-symbol comparison, event badges, a
 * crosshair legend, log/percent scales, wheel/pinch zoom, drag pan,
 * drag-to-measure, keyboard navigation and PNG snapshots.
 */
export function FinancialChart({
  series,
  type,
  indicators = [],
  onIndicatorsChange,
  volume = false,
  compare = [],
  onCompareRemove,
  baseline = null,
  tone,
  height,
  paneHeight = 110,
  padToSessionEnd = false,
  live = false,
  extremes = true,
  scale = "normal",
  onScaleChange,
  watermark = null,
  grid = true,
  events = [],
  tool = "cursor",
  onToolChange,
  drawings = NO_DRAWINGS,
  onDrawingsChange,
  drawingsVisible = true,
  magnet = true,
  onUndoStateChange,
  onHoverChange,
  onViewChange,
  wheelZoom = "modifier",
  ariaLabel,
  symbol,
  snapshotTitle,
  onSnapshot,
  valueFormatter = formatChartPrice,
  handleRef,
  className,
  legendMode = "full",
  dragMeasure = false,
  targets = null,
  levels = NO_LEVELS,
  extraLines = NO_LINES,
  upcoming = NO_EVENTS,
}: FinancialChartProps) {
  const { t, locale } = useChartI18n();
  const motionAllowed = useMotionAllowed();
  const helpId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef(new Map<string, AnySeries>());
  const primitivesRef = useRef<AttachedPrimitive[]>([]);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const eventsRef = useRef<EventBadgesPrimitive | null>(null);
  const watermarkRef = useRef<ITextWatermarkPluginApi<Time> | null>(null);
  const paletteRef = useRef<ChartPalette | null>(null);
  const defaultRangeRef = useRef<{ from: number; to: number } | null>(null);
  const shownKeyRef = useRef<string | null>(null);
  const isDefaultRef = useRef(true);
  const zoomFrameRef = useRef(0);
  const announceTimerRef = useRef<number | undefined>(undefined);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [drawingPrimitive] = useState(() => new DrawingPrimitive());
  // The main series and palette of the latest rebuild, for layers that draw with them (drawings).
  const [mainSeries, setMainSeries] = useState<AnySeries | null>(null);
  const [chartPalette, setChartPalette] = useState<ChartPalette | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [view, setView] = useState<ChartView | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([]);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const [geometry, setGeometry] = useState<MeasureGeometry | null>(null);
  const [gestureHint, setGestureHint] = useState(false);
  const [axisBox, setAxisBox] = useState<AxisBox | null>(null);
  const [scrolledBack, setScrolledBack] = useState(false);
  const [manualScale, setManualScale] = useState(false);
  const [eventTip, setEventTip] = useState<EventTip | null>(null);
  /**
   * The clicked badge: its tip (a dialog with links) shows whenever the pointer is on no other badge.
   * A ref, so a crosshair event right after the click already sees the new pin.
   */
  const pinnedEventRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const coarsePointer = useCoarsePointer();
  const [announcement, setAnnouncement] = useState("");

  const bars = series.bars;
  const compareList = useMemo(() => compare.filter((item) => item.series.bars.length > 0), [compare]);
  const compareActive = compareList.length > 0;
  const percentScale = compareActive || scale === "percent";
  const baselinePrice = baseline && !compareActive ? baseline.price : null;
  // Cards name the baseline on the price axis; their legend has no row for it.
  const baselineTitle = legendMode === "overlays" ? (baseline?.label ?? "") : "";
  const levelsKey = JSON.stringify(levels);
  const times = useMemo(() => bars.map((bar) => toChartTime(bar.time)), [bars]);
  const padTimes = useMemo(() => (padToSessionEnd ? sessionPadTimes(series, times) : []), [padToSessionEnd, series, times]);
  // Room after the last bar for the target fan (30 % of the window) and the expected events, at
  // most 35 % of the window so the bars keep most of the plot; an event further out stays off the
  // chart (cards still name it). Daily, weekly and monthly charts only.
  const upcomingKey = upcoming.map((event) => `${event.id}@${event.time}`).join("|");
  const upcomingTimes = upcoming.map((event) => event.time).join(",");
  const hasTargets = targets !== null;
  const futureTimes = useMemo(() => {
    if (padTimes.length > 0 || series.interval === "intraday" || times.length === 0) return [];
    const windowBars = Math.max(1, times.length - series.windowStart);
    const room = Math.max(12, Math.round(windowBars * 0.35));
    const slots = futureSlots(series.interval, times[times.length - 1], room);
    let count = hasTargets ? Math.max(12, Math.round(windowBars * 0.3)) : 0;
    for (const time of upcomingTimes ? upcomingTimes.split(",") : []) {
      const at = toChartTime(Number(time));
      const slot = slots.findIndex((candidate) => candidate >= at);
      const needed = slot + 1 + Math.max(3, Math.round(windowBars * 0.04));
      if (slot >= 0 && needed <= room) count = Math.max(count, needed);
    }
    return slots.slice(0, count);
  }, [padTimes.length, series.interval, series.windowStart, times, hasTargets, upcomingTimes]);
  const hasVolume = useMemo(() => bars.some((bar) => bar.volume !== null && bar.volume > 0), [bars]);
  const indicatorInput = useMemo(() => buildIndicatorInput(bars, series.interval), [bars, series.interval]);
  // A string key keeps the computed views stable when parents pass fresh arrays with the same content.
  const indicatorsKey = JSON.stringify(indicators);
  const indicatorViews = useMemo<IndicatorView[]>(
    () =>
      (JSON.parse(indicatorsKey) as IndicatorConfig[]).map((config) =>
        buildIndicatorView(config, { input: indicatorInput, hasVolume, overlaysSuspended: percentScale, priceFormat: valueFormatter }),
      ),
    [indicatorsKey, indicatorInput, hasVolume, percentScale, valueFormatter],
  );
  const drawnPanes = useMemo(() => indicatorViews.filter((item) => item.def.placement === "pane" && item.status === "ok"), [indicatorViews]);
  const legendRow = useMemo(
    () => indicatorViews.filter((item) => item.def.placement === "overlay" || item.status !== "ok"),
    [indicatorViews],
  );
  const eventsKey = events.map((event) => event.id).join("|");

  const windowBase =
    series.referenceClose ?? (series.windowStart > 0 ? bars[series.windowStart - 1]?.close : bars[series.windowStart]?.close) ?? null;
  const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null;
  const mainTone = tone ?? trendTone(lastClose !== null && windowBase !== null ? lastClose - windowBase : null);
  const mainCssColor = mainTone === "up" ? "var(--up)" : mainTone === "down" ? "var(--down)" : "var(--primary)";
  const dataKey = `${series.symbol}|${series.period}|${series.interval}|${compareActive ? "cmp" : ""}|${type}`;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    const registry = seriesRef.current;
    void import("lightweight-charts").then((lib) => {
      if (disposed) return;
      chart = lib.createChart(host, {
        autoSize: true,
        layout: { attributionLogo: false, background: { type: lib.ColorType.Solid, color: "transparent" } },
      });
      setEngine({ lib, chart });
    });
    const stopTheme = observeTheme(() => setThemeVersion((version) => version + 1));
    return () => {
      disposed = true;
      stopTheme();
      cancelAnimationFrame(zoomFrameRef.current);
      window.clearTimeout(announceTimerRef.current);
      // Primitives go while the chart lives: cleanups after this one (the drawing layer dropping a
      // gesture) still call them, and a call reaching a removed chart schedules a paint of disposed
      // canvases ("Object is disposed"). The removal cancels the repaint the detaching asks for.
      detachAll(primitivesRef.current);
      markersRef.current = null;
      eventsRef.current = null;
      watermarkRef.current = null;
      primitivesRef.current = [];
      registry.clear();
      chart?.remove();
    };
  }, []);

  const shouldAnimate = useEffectEvent(() => motionAllowed);

  const publishBuild = useEffectEvent((main: AnySeries | null, palette: ChartPalette) => {
    setMainSeries(main);
    setChartPalette(palette);
  });

  const refreshMeasureGeometry = useEffectEvent(() => {
    setGeometry(engine && measure ? measureGeometry(engine.chart, seriesRef.current.get("main"), measure, bars) : null);
  });

  const refreshPaneTops = useEffectEvent(() => {
    const host = hostRef.current;
    if (!engine || !host) return;
    const hostTop = host.getBoundingClientRect().top;
    const tops = engine.chart
      .panes()
      .slice(1)
      .map((pane) => {
        const element = pane.getHTMLElement();
        return element ? element.getBoundingClientRect().top - hostTop : 0;
      });
    setPaneTops((previous) =>
      previous.length === tops.length && previous.every((top, i) => Math.abs(top - tops[i]) < 0.5) ? previous : tops,
    );
  });

  const refreshScaleState = useEffectEvent(() => {
    if (!engine) return;
    const priceScale = engine.chart.priceScale("right");
    setManualScale(priceScale.options().autoScale === false);
    const timeScale = engine.chart.timeScale();
    const next = { priceWidth: priceScale.width(), timeHeight: timeScale.height(), plotWidth: timeScale.width() };
    setAxisBox((previous) =>
      previous && previous.priceWidth === next.priceWidth && previous.timeHeight === next.timeHeight && previous.plotWidth === next.plotWidth
        ? previous
        : next,
    );
  });

  const applyViewChange = useEffectEvent(() => {
    if (!engine || bars.length === 0) return;
    const range = engine.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const last = bars.length - 1;
    const target = defaultRangeRef.current;
    // A period with too few bars for the plot width (1M on a wide screen) cannot be stretched past
    // MAX_BAR_SPACING, so the engine widens the default range to the left, into the warmup bars.
    const fitFrom = target ? Math.min(target.from, target.to - engine.chart.timeScale().width() / MAX_BAR_SPACING) : 0;
    const isDefault = target
      ? Math.abs(range.to - target.to) < 0.75 && range.from > fitFrom - 0.75 && range.from < target.from + 0.75
      : true;
    // The default view is exactly the period window: counting the warmup bars the engine shows
    // (rounding or the spacing cap) measured the period change from a close before "Dönem başı".
    const from = isDefault ? clamp(series.windowStart, 0, last) : clamp(Math.ceil(range.from - 0.001), 0, last);
    const to = clamp(Math.floor(range.to + 0.001), from, last);
    isDefaultRef.current = isDefault;
    const next: ChartView = { from, to, isDefault };
    setView((previous) =>
      previous && previous.from === from && previous.to === to && previous.isDefault === isDefault ? previous : next,
    );
    onViewChange?.(next);
    setScrolledBack(range.to < last - 1);
    if (markersRef.current && paletteRef.current) {
      const timeScale = engine.chart.timeScale();
      const width = timeScale.width();
      const charWidth = monoCharWidth(paletteRef.current.monoFamily, CHART_FONT_SIZE);
      const place = (index: number, label: string) =>
        edgeSafeLabel(label, timeScale.logicalToCoordinate(index as Logical), width, charWidth);
      markersRef.current.setMarkers(extremeMarkers(type, bars, times, from, to, rgba(paletteRef.current.muted), valueFormatter, place));
    }
    setEventTip((current) => {
      if (!current) return current;
      const position = eventsRef.current?.positionOf(current.id);
      return position ? { ...current, x: position.x, y: position.y } : null;
    });
    refreshMeasureGeometry();
    refreshPaneTops();
    refreshScaleState();
  });

  // Build every series from scratch whenever data, structure, theme or locale change.
  // Rebuilding a dozen series of ≤1.5k points takes a few ms and keeps pane order trivial.
  useEffect(() => {
    const host = hostRef.current;
    if (!engine || !host) return;
    const { lib, chart } = engine;
    const palette = readChartPalette(host);
    paletteRef.current = palette;
    const registry = seriesRef.current;
    const timeScale = chart.timeScale();
    const previousRange = timeScale.getVisibleLogicalRange();
    const keepView = shownKeyRef.current === dataKey && previousRange !== null && !isDefaultRef.current;

    markersRef.current?.detach();
    markersRef.current = null;
    detachAll(primitivesRef.current);
    primitivesRef.current = [];
    eventsRef.current = null;
    watermarkRef.current?.detach();
    watermarkRef.current = null;
    for (const api of registry.values()) chart.removeSeries(api);
    registry.clear();
    for (let i = chart.panes().length - 1; i > 0; i -= 1) chart.removePane(i);

    chart.applyOptions(chartOptions(lib, palette, series, valueFormatter, padTimes.length > 0 || futureTimes.length > 0, type, grid));
    if (bars.length === 0) {
      publishBuild(null, palette);
      return;
    }

    const up = rgba(palette.up);
    const down = rgba(palette.down);
    const mainRgb: Rgb = mainTone === "up" ? palette.up : mainTone === "down" ? palette.down : palette.primary;
    const ring = rgba(palette.card);
    const priceFormat = { type: "custom" as const, formatter: (price: BarPrice) => valueFormatter(price), minMove: chartMinMove(bars, seriesUnit(series)) };
    const pad = [...padTimes, ...futureTimes].map((time) => ({ time }));
    const attach = (owner: AnySeries, primitive: ISeriesPrimitive<Time>) => {
      owner.attachPrimitive(primitive);
      primitivesRef.current.push({ series: owner, primitive });
    };

    // Main series ------------------------------------------------------------
    let main: AnySeries;
    if (type === "candles" || type === "hollow" || type === "heikin") {
      main = chart.addSeries(lib.CandlestickSeries, {
        priceFormat,
        priceLineStyle: lib.LineStyle.Dotted,
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderUpColor: up,
        borderDownColor: down,
        borderVisible: type === "hollow",
        // Heikin Ashi closes are averages: the real last price gets its own line below.
        lastValueVisible: type !== "heikin",
        priceLineVisible: type !== "heikin",
      });
      if (type === "heikin") {
        const ha = heikinAshi(bars);
        main.setData([...ha.map((bar, i) => ({ time: times[i], ...bar })), ...pad]);
        if (lastClose !== null) {
          const lastUp = barIsUp(bars, bars.length - 1);
          main.createPriceLine({
            price: lastClose,
            color: rgba(lastUp ? palette.up : palette.down, 0.9),
            lineWidth: 1,
            lineStyle: lib.LineStyle.Dotted,
            axisLabelVisible: true,
            title: "",
          });
        }
      } else if (type === "hollow") {
        // TradingView hollow candles: colour by close vs previous close, body filled when close < open.
        const hollowFill = rgba(palette.card);
        main.setData([
          ...bars.map((bar, i) => {
            const candle = ohlcOf(bars, i);
            const previous = i > 0 ? bars[i - 1].close : candle.open;
            const color = candle.close >= previous ? up : down;
            return { time: times[i], ...candle, color: candle.close < candle.open ? color : hollowFill, borderColor: color, wickColor: color };
          }),
          ...pad,
        ]);
      } else {
        main.setData([...bars.map((_, i) => ({ time: times[i], ...ohlcOf(bars, i) })), ...pad]);
      }
    } else if (type === "bars") {
      main = chart.addSeries(lib.BarSeries, { priceFormat, priceLineStyle: lib.LineStyle.Dotted, upColor: up, downColor: down, openVisible: true, thinBars: false });
      main.setData([...bars.map((_, i) => ({ time: times[i], ...ohlcOf(bars, i) })), ...pad]);
    } else {
      const lineOptions = {
        priceFormat,
        priceLineStyle: lib.LineStyle.Dotted,
        lineWidth: 2 as const,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBorderColor: ring,
        lastPriceAnimation: live ? lib.LastPriceAnimationMode.Continuous : lib.LastPriceAnimationMode.Disabled,
      };
      const values = [...bars.map((bar, i) => ({ time: times[i], value: bar.close })), ...pad];
      if (type === "baseline") {
        const base = baselinePrice ?? windowBase ?? bars[0].close;
        const alpha = palette.dark ? 0.26 : 0.2;
        main = chart.addSeries(lib.BaselineSeries, {
          ...lineOptions,
          baseValue: { type: "price" as const, price: base },
          relativeGradient: true,
          topLineColor: up,
          topFillColor1: rgba(palette.up, alpha),
          topFillColor2: rgba(palette.up, 0.02),
          bottomLineColor: down,
          bottomFillColor1: rgba(palette.down, 0.02),
          bottomFillColor2: rgba(palette.down, alpha),
        });
      } else if (type === "area") {
        main = chart.addSeries(lib.AreaSeries, {
          ...lineOptions,
          crosshairMarkerBackgroundColor: rgba(mainRgb),
          lineColor: rgba(mainRgb),
          // Strongest under the line, fading to nothing at the bottom of the visible range (relative to
          // the data, not the pane), like every pro area chart: the volume and the grid stay readable.
          topColor: rgba(mainRgb, palette.dark ? 0.28 : 0.24),
          bottomColor: rgba(mainRgb, 0),
          relativeGradient: true,
        });
      } else {
        main = chart.addSeries(lib.LineSeries, { ...lineOptions, crosshairMarkerBackgroundColor: rgba(mainRgb), color: rgba(mainRgb) });
      }
      main.setData(values);
    }
    registry.set("main", main);
    // In comparison (%) mode the 0 % base line is the shared reference: quiet and dashed.
    main.applyOptions({
      baseLineVisible: percentScale,
      baseLineColor: rgba(palette.muted, 0.7),
      baseLineStyle: lib.LineStyle.Dashed,
      baseLineWidth: 1,
    });
    const eventsShown = events.length > 0 || upcoming.length > 0;
    // Event badges get a fixed-height strip at the bottom of the price pane, under the volume bars.
    const mainPaneHeight = Math.max(120, (host.clientHeight || (typeof height === "number" ? height : 480)) - paneHeight * drawnPanes.length);
    const lane = eventsShown ? EVENT_LANE_PX / mainPaneHeight : 0;
    chart.priceScale("right", 0).applyOptions({
      mode: percentScale ? lib.PriceScaleMode.Percentage : scale === "log" ? lib.PriceScaleMode.Logarithmic : lib.PriceScaleMode.Normal,
      scaleMargins: { top: 0.1, bottom: (volume && hasVolume ? VOLUME_SHARE + 0.02 : lane > 0 ? 0.04 : 0.08) + lane },
    });

    if (baselinePrice !== null) {
      main.createPriceLine({
        price: baselinePrice,
        color: rgba(palette.muted, 0.85),
        lineWidth: 1,
        lineStyle: lib.LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: rgba(palette.muted),
        axisLabelTextColor: rgba(palette.card),
        title: baselineTitle,
      });
    }

    // Volume: histogram along the bottom of the main pane, above the event strip ----
    if (volume && hasVolume) {
      const volumeSeries = chart.addSeries(lib.HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      // Candles keep up/down colours (they read as the bars above); line and area charts get one quiet tone.
      const candles = CANDLE_TYPES.has(type);
      const alpha = candles ? (palette.dark ? 0.26 : 0.2) : palette.dark ? 0.2 : 0.15;
      const upColor = rgba(candles ? palette.up : palette.muted, alpha);
      const downColor = rgba(candles ? palette.down : palette.muted, alpha);
      volumeSeries.setData(
        bars.map((bar, i) =>
          bar.volume === null ? { time: times[i] } : { time: times[i], value: bar.volume, color: barIsUp(bars, i) ? upColor : downColor },
        ),
      );
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 1 - VOLUME_SHARE - lane, bottom: lane }, visible: false });
      registry.set("volume", volumeSeries);
    }

    // Indicators -----------------------------------------------------------------
    const addLines = (item: IndicatorView, paneIndex: number): AnySeries[] => {
      const output = item.output;
      if (!output) return [];
      const format = { type: "custom" as const, formatter: (value: BarPrice) => item.format(value), minMove: item.minMove };
      const created: AnySeries[] = [];
      if (output.histogram) {
        const histogram = chart.addSeries(lib.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: format }, paneIndex);
        const values = output.histogram.values;
        const strength = output.histogram.colorMode === "sign-strength";
        histogram.setData(
          values.map((value, j) => {
            if (value === null) return { time: times[j] };
            const previous = values[j - 1] ?? value;
            const strong = !strength || Math.abs(value) >= Math.abs(previous);
            return { time: times[j], value, color: rgba(value >= 0 ? palette.up : palette.down, strong ? 0.7 : 0.35) };
          }),
        );
        registry.set(`${item.config.id}:${output.histogram.key}`, histogram);
        created.push(histogram);
      }
      for (const line of output.lines) {
        const dots = line.shape === "dots";
        const lineSeries = chart.addSeries(
          lib.LineSeries,
          {
            color: rgba(lineRgb(palette, item.config, line)),
            lineWidth: line.width ?? 1,
            lineStyle: lineStyleOf(lib, line.style),
            lineVisible: !dots,
            pointMarkersVisible: dots,
            pointMarkersRadius: dots ? 1.5 : undefined,
            priceLineVisible: false,
            lastValueVisible: paneIndex > 0,
            crosshairMarkerVisible: paneIndex > 0 && !dots,
            crosshairMarkerRadius: 3,
            crosshairMarkerBorderColor: ring,
            priceFormat: format,
          },
          paneIndex,
        );
        lineSeries.setData(
          line.values.map((value, j) => {
            if (value === null) return { time: times[j] };
            const pointTone = line.tones?.[j];
            return pointTone ? { time: times[j], value, color: rgba(toneRgb(palette, pointTone)) } : { time: times[j], value };
          }),
        );
        registry.set(`${item.config.id}:${line.key}`, lineSeries);
        created.push(lineSeries);
      }
      if (output.band) {
        const upper = output.lines.find((line) => line.key === output.band?.upper);
        const lower = output.lines.find((line) => line.key === output.band?.lower);
        const owner = registry.get(`${item.config.id}:${output.band.upper}`);
        if (upper && lower && owner) {
          attach(owner, new BandFillPrimitive(upper.values, lower.values, rgba(lineRgb(palette, item.config, upper), palette.dark ? 0.08 : 0.06)));
        }
      }
      return created;
    };

    for (const item of indicatorViews) {
      if (item.def.placement === "overlay" && item.status === "ok") addLines(item, 0);
    }

    // Benchmarks -----------------------------------------------------------------
    for (const item of compareList) {
      const benchmark = chart.addSeries(lib.LineSeries, {
        color: rgba(palette.series[item.color % 5]),
        lineWidth: 2,
        baseLineVisible: false,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: ring,
        priceFormat,
      });
      benchmark.setData(item.series.bars.map((bar) => ({ time: toChartTime(bar.time), value: bar.close })));
      registry.set(`compare:${item.symbol}`, benchmark);
    }

    // Indicator panes -------------------------------------------------------------
    drawnPanes.forEach((item, i) => {
      const paneIndex = i + 1;
      const created = addLines(item, paneIndex);
      const range = item.def.range;
      if (range) {
        for (const owner of created) owner.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: range.min, maxValue: range.max } }) });
      }
      const anchor = created[created.length - 1];
      if (anchor) {
        for (const level of item.def.levels ?? []) {
          anchor.createPriceLine({
            price: level.value,
            color: rgba(toneRgb(palette, level.tone), level.tone === "muted" ? 0.4 : 0.55),
            lineWidth: 1,
            lineStyle: level.tone === "muted" ? lib.LineStyle.Dotted : lib.LineStyle.Dashed,
            axisLabelVisible: false,
            title: "",
          });
        }
      }
    });

    // Indicator panes always read in their own units, also while the main pane shows %.
    for (let paneIndex = 1; paneIndex < chart.panes().length; paneIndex += 1) {
      chart.priceScale("right", paneIndex).applyOptions({ mode: lib.PriceScaleMode.Normal, scaleMargins: { top: 0.14, bottom: 0.08 } });
    }

    // The main pane keeps whatever the indicator panes leave.
    const paneList = chart.panes();
    if (paneList.length > 1) {
      const total = host.clientHeight || (typeof height === "number" ? height : 480);
      paneList[0].setStretchFactor(Math.max(total - paneHeight * (paneList.length - 1), total * 0.45));
      for (const pane of paneList.slice(1)) pane.setStretchFactor(paneHeight);
    }

    // Decorations -----------------------------------------------------------------
    if (watermark) {
      const size = clamp(Math.round((host.clientWidth || 640) / 11), 26, 68);
      watermarkRef.current = lib.createTextWatermark(chart.panes()[0], {
        horzAlign: "center",
        vertAlign: "center",
        lines: [
          { text: watermark.title, color: rgba(palette.foreground, palette.dark ? 0.075 : 0.06), fontSize: size, fontFamily: palette.fontFamily, fontStyle: "600" },
          ...(watermark.subtitle
            ? [{ text: watermark.subtitle, color: rgba(palette.foreground, palette.dark ? 0.1 : 0.08), fontSize: clamp(Math.round(size / 4), 11, 15), fontFamily: palette.fontFamily, fontStyle: "" }]
            : []),
        ],
      });
    }

    if (series.interval === "intraday") {
      const starts: number[] = [];
      for (let i = 1; i < indicatorInput.sessions.length; i += 1) {
        if (indicatorInput.sessions[i] !== indicatorInput.sessions[i - 1]) starts.push(i);
      }
      if (starts.length > 0) attach(main, new SessionBreaksPrimitive(starts, rgba(palette.muted, 0.28)));
    }

    if (eventsShown) {
      const badges: EventBadge[] = [];
      for (const event of events) {
        const index = eventBarIndex(bars, event.time, series.interval);
        if (index < 0) continue;
        const slot = EVENT_SLOT[event.kind];
        badges.push({
          id: event.id,
          kind: event.kind,
          index,
          letter: t(EVENT_LETTER[event.kind]),
          color: rgba(slot === null ? palette.muted : palette.series[slot]),
        });
      }
      for (const event of upcoming) {
        const at = toChartTime(event.time);
        const k = futureTimes.findIndex((slot) => slot >= at);
        if (k < 0) continue;
        const slot = EVENT_SLOT[event.kind];
        badges.push({
          id: event.id,
          kind: event.kind,
          index: bars.length + padTimes.length + k,
          letter: t(EVENT_LETTER[event.kind]),
          color: rgba(slot === null ? palette.muted : palette.series[slot]),
          upcoming: true,
        });
      }
      const primitive = new EventBadgesPrimitive({
        card: rgba(palette.card),
        font: palette.fontFamily,
        lane: lane > 0 ? { height: EVENT_LANE_PX, color: rgba(palette.border) } : undefined,
      });
      attach(main, primitive);
      primitive.setBadges(badges);
      eventsRef.current = primitive;
    }

    // Price-level layers (total-return line, the viewer's levels, the analyst target fan): not on % scales ----
    if (!percentScale) {
      for (const line of extraLines) {
        const extra = chart.addSeries(lib.LineSeries, {
          color: rgba(palette.series[line.slot % 5]),
          lineWidth: 2,
          lineStyle: lib.LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: line.label,
          priceFormat,
        });
        extra.setData(line.values.map((value, j) => (value === null || value === undefined ? { time: times[j] } : { time: times[j], value })));
        registry.set(`extra:${line.key}`, extra);
      }
    }
    const extraPrices: number[] = [];
    if (!percentScale) {
      for (const level of levels) {
        const color = rgba(level.tone === "up" ? palette.up : level.tone === "down" ? palette.down : level.tone === "muted" ? palette.muted : palette.primary);
        main.createPriceLine({
          price: level.price,
          color,
          lineWidth: 1,
          lineStyle: lib.LineStyle.LargeDashed,
          axisLabelVisible: true,
          axisLabelColor: color,
          axisLabelTextColor: rgba(palette.card),
          title: level.label,
        });
        extraPrices.push(level.price);
      }
    }
    if (targets && futureTimes.length > 0 && lastClose !== null && !percentScale) {
      const meanUp = targets.mean >= lastClose;
      const meanColor = rgba(meanUp ? palette.up : palette.down);
      const pct = (value: number) => formatChangePercent(((value - lastClose) / lastClose) * 100);
      attach(
        main,
        new TargetFanPrimitive({
          from: bars.length - 1,
          to: bars.length - 1 + padTimes.length + futureTimes.length,
          last: lastClose,
          low: targets.low,
          mean: targets.mean,
          high: targets.high,
          labels: {
            title: targets.analysts ? t("targets.titleN", { n: targets.analysts }) : t("targets.title"),
            mean: `${t("targets.mean")} ${valueFormatter(targets.mean)} (${pct(targets.mean)})`,
            high: `${t("targets.high")} ${valueFormatter(targets.high)}`,
            low: `${t("targets.low")} ${valueFormatter(targets.low)}`,
          },
          colors: {
            fill: rgba(meanUp ? palette.up : palette.down, palette.dark ? 0.08 : 0.07),
            line: rgba(palette.muted, 0.8),
            mean: meanColor,
            text: rgba(palette.foreground, 0.85),
            muted: rgba(palette.muted),
            card: rgba(palette.card),
          },
          font: palette.fontFamily,
        }),
      );
      main.createPriceLine({
        price: targets.mean,
        color: meanColor,
        lineVisible: false,
        axisLabelVisible: true,
        axisLabelColor: meanColor,
        axisLabelTextColor: rgba(palette.card),
        title: "",
      });
      extraPrices.push(targets.low, targets.high);
    }
    // The scale keeps the levels and the whole target range in view.
    if (extraPrices.length > 0) {
      const lo = Math.min(...extraPrices);
      const hi = Math.max(...extraPrices);
      main.applyOptions({
        autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
          const res = original();
          if (!res) return res;
          return { ...res, priceRange: { minValue: Math.min(res.priceRange.minValue, lo), maxValue: Math.max(res.priceRange.maxValue, hi) } };
        },
      });
    }

    if (extremes) markersRef.current = lib.createSeriesMarkers(main, []);
    // Last: drawings sit above the event badges.
    attach(main, drawingPrimitive);

    // Period window by default; keep the user's zoom/pan across refetches of the same data.
    const defaultRange = { from: series.windowStart - 0.5, to: bars.length - 1 + padTimes.length + futureTimes.length + 0.5 };
    defaultRangeRef.current = defaultRange;
    timeScale.setVisibleLogicalRange(keepView && previousRange ? previousRange : defaultRange);
    publishBuild(main, palette);

    // The drawing reveal plays for the first data only: a new period, type or comparison swaps in place.
    const firstShow = shownKeyRef.current === null;
    shownKeyRef.current = dataKey;
    const cancelReveal = firstShow && shouldAnimate() ? playReveal(host, chart) : undefined;
    const frame = requestAnimationFrame(() => applyViewChange());
    return () => {
      cancelAnimationFrame(frame);
      cancelReveal?.();
    };
    // `eventsKey` stands for `events`, `levelsKey` for `levels`, `upcomingKey` for `upcoming` and the
    // watermark texts for `watermark` (parents pass fresh objects); `targets` and `extraLines` are memoized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engine,
    series,
    bars,
    times,
    padTimes,
    indicatorViews,
    drawnPanes,
    indicatorInput,
    type,
    volume,
    hasVolume,
    compareList,
    percentScale,
    scale,
    baselinePrice,
    windowBase,
    lastClose,
    mainTone,
    live,
    extremes,
    grid,
    watermark?.title,
    watermark?.subtitle,
    eventsKey,
    dataKey,
    valueFormatter,
    height,
    paneHeight,
    themeVersion,
    t,
    drawingPrimitive,
    futureTimes,
    baselineTitle,
    targets,
    levelsKey,
    extraLines,
    upcomingKey,
  ]);

  // Crosshair → legend / header scrub, event badges; double click on the plot resets the view.
  const onCrosshair = useEffectEvent((param: MouseEventParams<Time>) => {
    const index = param.point && param.logical !== undefined ? clamp(Math.round(param.logical), 0, Math.max(bars.length - 1, 0)) : null;
    setHoverIndex((previous) => (previous === index ? previous : index));
    onHoverChange?.(index);
    const objectId = param.hoveredInfo?.objectId;
    const eventId = typeof objectId === "string" && objectId.startsWith("event:") ? objectId.slice(6) : null;
    // The badge under the pointer shows its tip, over a pinned one too; off the badges the pinned tip
    // comes back, so the pointer can cross a stacked badge on its way to the pinned tip's links.
    const pinnedId = pinnedEventRef.current;
    const shownId = eventId ?? pinnedId;
    eventsRef.current?.setActive(shownId);
    setEventTip((current) => {
      if (!shownId) return null;
      if (current?.id === shownId) return current;
      const position = eventsRef.current?.positionOf(shownId);
      return position ? { id: shownId, x: position.x, y: position.y, pinned: shownId === pinnedId } : null;
    });
  });
  const onClick = useEffectEvent((param: MouseEventParams<Time>) => {
    const objectId = param.hoveredInfo?.objectId;
    const eventId = typeof objectId === "string" && objectId.startsWith("event:") ? objectId.slice(6) : null;
    // A click on a badge pins its tip, anywhere else unpins.
    pinnedEventRef.current = eventId;
    eventsRef.current?.setActive(eventId);
    const position = eventId ? eventsRef.current?.positionOf(eventId) : null;
    setEventTip(eventId && position ? { id: eventId, x: position.x, y: position.y, pinned: true } : null);
  });
  const closeEventTip = () => {
    pinnedEventRef.current = null;
    setEventTip(null);
    eventsRef.current?.setActive(null);
  };
  const onDoubleClick = useEffectEvent(() => resetView());
  useEffect(() => {
    if (!engine) return;
    const move = (param: MouseEventParams<Time>) => onCrosshair(param);
    const click = (param: MouseEventParams<Time>) => onClick(param);
    const dblClick = () => onDoubleClick();
    engine.chart.subscribeCrosshairMove(move);
    engine.chart.subscribeClick(click);
    engine.chart.subscribeDblClick(dblClick);
    return () => {
      engine.chart.unsubscribeCrosshairMove(move);
      engine.chart.unsubscribeClick(click);
      engine.chart.unsubscribeDblClick(dblClick);
    };
  }, [engine]);

  // Visible range → view state, extremes, measure overlay, pane legends.
  useEffect(() => {
    if (!engine) return;
    let frame = 0;
    const onRange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => applyViewChange());
    };
    const timeScale = engine.chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(onRange);
    timeScale.subscribeSizeChange(onRange);
    return () => {
      cancelAnimationFrame(frame);
      timeScale.unsubscribeVisibleLogicalRangeChange(onRange);
      timeScale.unsubscribeSizeChange(onRange);
    };
  }, [engine]);

  // Pane legends follow pane resizes (separator drag, container resize); a price-axis drag leaves auto scale.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !engine) return;
    const observer = new ResizeObserver(() => refreshPaneTops());
    observer.observe(host);
    const onPointerUp = () =>
      requestAnimationFrame(() => {
        refreshPaneTops();
        refreshScaleState();
      });
    host.addEventListener("pointerup", onPointerUp);
    return () => {
      observer.disconnect();
      host.removeEventListener("pointerup", onPointerUp);
    };
  }, [engine]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshMeasureGeometry());
    return () => cancelAnimationFrame(frame);
  }, [measure]);

  // Vertical wheel scrolls the page; Ctrl/⌘ + wheel, trackpad pinch and horizontal swipes drive the chart.
  // A plain wheel over the chart, or the first touch, briefly shows how to zoom and pan instead.
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let lastWheelHint = -Infinity;
    let touchHintShown = false;
    let hideTimer: number | undefined;
    const flashHint = () => {
      setGestureHint(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setGestureHint(false), 2200);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.stopPropagation();
      const now = performance.now();
      if (now - lastWheelHint < 45_000) return;
      lastWheelHint = now;
      flashHint();
    };
    const onTouchStart = () => {
      if (touchHintShown) return;
      touchHintShown = true;
      flashHint();
    };
    if (wheelZoom !== "always") plot.addEventListener("wheel", onWheel, { capture: true, passive: true });
    plot.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      plot.removeEventListener("wheel", onWheel, { capture: true });
      plot.removeEventListener("touchstart", onTouchStart);
      window.clearTimeout(hideTimer);
    };
  }, [wheelZoom]);

  // Drag-to-measure: the measure tool, or Shift + drag anywhere on the main pane.
  const indexAt = useEffectEvent((clientX: number, clientY: number | null): number | null => {
    const host = hostRef.current;
    if (!engine || !host || bars.length === 0) return null;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    if (clientY !== null) {
      const y = clientY - rect.top;
      const mainHeight = engine.chart.panes()[0]?.getHeight() ?? rect.height;
      if (x < 0 || x > engine.chart.timeScale().width() || y < 0 || y > mainHeight) return null;
    }
    const logical = engine.chart.timeScale().coordinateToLogical(x);
    return logical === null ? null : clamp(Math.round(logical), 0, bars.length - 1);
  });
  const measureWanted = useEffectEvent((event: PointerEvent) => tool === "measure" || (tool === "cursor" && event.shiftKey));
  // Cards: a plain mouse drag in cursor mode measures once it has moved a few px (Google Finance).
  const dragMeasureWanted = useEffectEvent((event: PointerEvent) => dragMeasure && tool === "cursor" && event.pointerType === "mouse" && !event.shiftKey);
  const commitMeasure = useEffectEvent((next: MeasureState | null) => {
    setMeasure(next);
    const main = seriesRef.current.get("main");
    if (!next || !engine || !main || !bars[next.end]) return;
    // The chart never sees the drag (events are swallowed), so drive crosshair + legend here.
    engine.chart.setCrosshairPosition(bars[next.end].close, times[next.end], main);
    setHoverIndex(next.end);
    onHoverChange?.(next.end);
  });

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let active: { pointerId: number; start: number } | null = null;
    // A pending drag-measure lets the press through (clicks on badges still work) but hides the moves (no pan).
    const swallow = (event: Event) => {
      if (active || (pending && (event.type === "mousemove" || event.type === "touchmove"))) event.stopPropagation();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.pointerId) return;
      const end = indexAt(event.clientX, null);
      if (end !== null) commitMeasure({ start: active.start, end, dragging: true });
    };
    const finish = (event: PointerEvent) => {
      if (!active || event.pointerId !== active.pointerId) return;
      const start = active.start;
      const end = indexAt(event.clientX, null) ?? start;
      active = null;
      commitMeasure(end === start ? null : { start, end, dragging: false });
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    // A pending drag that becomes a measurement after a few px of travel,
    // unless another handler (drawing handles) claimed the press.
    let pending: { pointerId: number; start: number; x: number; y: number; down: PointerEvent } | null = null;
    const onPendingMove = (event: PointerEvent) => {
      if (!pending || event.pointerId !== pending.pointerId) return;
      if (pending.down.defaultPrevented) {
        dropPending();
        return;
      }
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 5) return;
      active = { pointerId: pending.pointerId, start: pending.start };
      dropPending();
      const end = indexAt(event.clientX, null) ?? active.start;
      commitMeasure({ start: active.start, end, dragging: true });
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    };
    const dropPending = () => {
      pending = null;
      window.removeEventListener("pointermove", onPendingMove);
      window.removeEventListener("pointerup", dropPending);
      window.removeEventListener("pointercancel", dropPending);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!measureWanted(event)) {
        if (!dragMeasureWanted(event)) return;
        const start = indexAt(event.clientX, event.clientY);
        if (start === null) return;
        pending = { pointerId: event.pointerId, start, x: event.clientX, y: event.clientY, down: event };
        window.addEventListener("pointermove", onPendingMove);
        window.addEventListener("pointerup", dropPending);
        window.addEventListener("pointercancel", dropPending);
        return;
      }
      const start = indexAt(event.clientX, event.clientY);
      if (start === null) return;
      active = { pointerId: event.pointerId, start };
      event.stopPropagation();
      event.preventDefault();
      commitMeasure({ start, end: start, dragging: true });
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    };
    const swallowed = ["mousedown", "mousemove", "touchstart", "touchmove"] as const;
    plot.addEventListener("pointerdown", onPointerDown, { capture: true });
    for (const name of swallowed) plot.addEventListener(name, swallow, { capture: true, passive: true });
    return () => {
      plot.removeEventListener("pointerdown", onPointerDown, { capture: true });
      for (const name of swallowed) plot.removeEventListener(name, swallow, { capture: true });
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dropPending();
    };
  }, []);

  // Drawings: one series primitive on the main series, gestures in the capture phase after the measure
  // handler above (which claims Shift + drag and the measure tool by calling preventDefault).
  const drawingLayer = useDrawingLayer({
    chart: engine?.chart ?? null,
    primitive: drawingPrimitive,
    mainSeries,
    plotRef,
    bars,
    times,
    interval: series.interval,
    intervalMinutes: series.intervalMinutes,
    palette: chartPalette,
    locale,
    drawings,
    onDrawingsChange: onDrawingsChange ?? ignoreDrawings,
    tool,
    onToolChange: onToolChange ?? ignoreDrawings,
    visible: drawingsVisible,
    magnet,
    format: valueFormatter,
    onHoverIndex: (index) => {
      setHoverIndex(index);
      onHoverChange?.(index);
    },
  });

  useEffect(() => {
    onUndoStateChange?.(drawingLayer.canUndo);
  }, [drawingLayer.canUndo, onUndoStateChange]);

  // Right click: TradingView-style chart menu. On touch a long press is the chart's crosshair, so it stays that.
  const openContextMenu = useEffectEvent((clientX: number, clientY: number) => {
    const host = hostRef.current;
    const main = seriesRef.current.get("main");
    if (!engine || !host || !main) return;
    const rect = host.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const inMain = x >= 0 && x <= engine.chart.timeScale().width() && y >= 0 && y <= (engine.chart.panes()[0]?.getHeight() ?? 0);
    const price = inMain ? main.coordinateToPrice(y) : null;
    const logical = inMain ? engine.chart.timeScale().coordinateToLogical(x) : null;
    const index = logical === null ? null : clamp(Math.round(logical), 0, bars.length - 1);
    setContextMenu({ x: clientX, y: clientY, price: price === null || !Number.isFinite(price) ? null : price, time: index === null ? null : bars[index].time });
  });
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    let lastPointer = "mouse";
    const onPointerDown = (event: PointerEvent) => {
      lastPointer = event.pointerType;
    };
    const onContextMenu = (event: MouseEvent) => {
      if (lastPointer === "touch") return;
      event.preventDefault();
      openContextMenu(event.clientX, event.clientY);
    };
    plot.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    plot.addEventListener("contextmenu", onContextMenu);
    return () => {
      plot.removeEventListener("pointerdown", onPointerDown, { capture: true });
      plot.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  // Leaving measure mode drops a finished measurement.
  const dropMeasure = useEffectEvent(() => setMeasure((current) => (current && !current.dragging ? null : current)));
  useEffect(() => {
    if (tool !== "measure") dropMeasure();
  }, [tool]);

  // ---------------------------------------------------------------------------
  // Commands (toolbar, keyboard, double click)
  // ---------------------------------------------------------------------------

  function animateTo(target: { from: number; to: number }) {
    if (!engine) return;
    const timeScale = engine.chart.timeScale();
    const start = timeScale.getVisibleLogicalRange();
    cancelAnimationFrame(zoomFrameRef.current);
    if (!start || !motionAllowed) {
      timeScale.setVisibleLogicalRange(target);
      return;
    }
    const startedAt = performance.now();
    const duration = 260;
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      timeScale.setVisibleLogicalRange({
        from: start.from + (target.from - start.from) * eased,
        to: start.to + (target.to - start.to) * eased,
      });
      if (progress < 1) zoomFrameRef.current = requestAnimationFrame(step);
    };
    zoomFrameRef.current = requestAnimationFrame(step);
  }

  function zoom(factor: number) {
    if (!engine) return;
    const range = engine.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const total = bars.length + padTimes.length + futureTimes.length;
    const width = range.to - range.from;
    const nextWidth = clamp(width * factor, Math.min(8, total), total + 1);
    const anchor = hoverIndex ?? range.to;
    const ratio = width > 0 ? (anchor - range.from) / width : 1;
    let from = anchor - ratio * nextWidth;
    let to = from + nextWidth;
    const minFrom = -0.5;
    const maxTo = total - 0.5;
    if (from < minFrom) {
      to += minFrom - from;
      from = minFrom;
    }
    if (to > maxTo) {
      from = Math.max(minFrom, from - (to - maxTo));
      to = maxTo;
    }
    animateTo({ from, to });
  }

  function resetView() {
    engine?.chart.priceScale("right").setAutoScale(true);
    setManualScale(false);
    if (defaultRangeRef.current) animateTo(defaultRangeRef.current);
  }

  function scrollToLatest() {
    if (!engine) return;
    const range = engine.chart.timeScale().getVisibleLogicalRange();
    if (!range) return;
    const to = bars.length - 1 + padTimes.length + futureTimes.length + 0.5;
    animateTo({ from: to - (range.to - range.from), to });
  }

  function snapshotLabels(palette: ChartPalette, item: IndicatorView, index: number): SnapshotLabel[] {
    const output = item.output;
    if (!output) return [];
    const values = output.lines
      .map((line) => line.values[index])
      .filter((value): value is number => value !== null && value !== undefined)
      .map((value) => item.format(value));
    const histogram = output.histogram?.values[index];
    if (histogram !== null && histogram !== undefined) values.push(item.format(histogram));
    const first = output.lines[0];
    return [{ color: rgba(first ? lineRgb(palette, item.config, first) : palette.muted), label: item.label, value: values.join(" ") || "—" }];
  }

  function snapshot(): Promise<Blob | null> {
    const palette = paletteRef.current;
    if (!engine || !palette || lastClose === null) return Promise.resolve(null);
    const change = windowBase !== null ? lastClose - windowBase : null;
    const last = bars.length - 1;
    const header: SnapshotHeader = {
      title: snapshotTitle?.title ?? symbol,
      subtitle: snapshotTitle?.subtitle ?? formatBarTime(bars[bars.length - 1].time, barLabelStyle(series.interval)),
      value: valueFormatter(lastClose),
      change: change !== null && windowBase ? `${formatChangePercent((change / windowBase) * 100)} (${formatChartChange(change, lastClose, seriesUnit(series))})` : "",
      tone: trendTone(change),
      footer: t("snapshot.footer"),
      overlays: legendRow.filter((item) => item.status === "ok").flatMap((item) => snapshotLabels(palette, item, last)),
      panes: drawnPanes.flatMap((item, i) => (paneTops[i] === undefined ? [] : [{ top: paneTops[i], items: snapshotLabels(palette, item, last) }])),
    };
    return composeSnapshot(engine.chart, palette, header);
  }

  useImperativeHandle(handleRef, () => ({
    zoomIn: () => zoom(ZOOM_STEP),
    zoomOut: () => zoom(1 / ZOOM_STEP),
    reset: resetView,
    scrollToLatest,
    snapshot,
    focus: () => plotRef.current?.focus(),
    undoDrawing: drawingLayer.undo,
    clearDrawings: drawingLayer.clearAll,
  }));

  function focusBar(index: number) {
    if (!engine) return;
    const main = seriesRef.current.get("main");
    const bar = bars[index];
    if (!main || !bar) return;
    setHoverIndex(index);
    onHoverChange?.(index);
    const range = engine.chart.timeScale().getVisibleLogicalRange();
    if (range && (index < range.from + 0.5 || index > range.to - 0.5)) {
      const width = range.to - range.from;
      const from = index < range.from + 0.5 ? index - 0.5 : index + 0.5 - width;
      engine.chart.timeScale().setVisibleLogicalRange({ from, to: from + width });
    }
    engine.chart.setCrosshairPosition(bar.close, times[index], main);
    const previous = bars[index - 1];
    const change = previous ? formatChangePercent(((bar.close - previous.close) / previous.close) * 100) : "";
    window.clearTimeout(announceTimerRef.current);
    announceTimerRef.current = window.setTimeout(() => {
      setAnnouncement(
        t("chart.announce", { date: formatBarTime(bar.time, barLabelStyle(series.interval)), close: valueFormatter(bar.close), change }),
      );
    }, 250);
  }

  function toggleScale(next: PriceScaleKind) {
    if (compareActive || !onScaleChange) return;
    onScaleChange(scale === next ? "normal" : next);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!engine || bars.length === 0) return;
    if (drawingLayer.onKeyDown(event)) {
      event.preventDefault();
      return;
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      // Alt shortcuts by physical key: Alt+L types "¬" on a Mac.
      if (event.code === "KeyR") resetView();
      else if (event.code === "KeyL") toggleScale("log");
      else if (event.code === "KeyP") toggleScale("percent");
      else return;
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    const last = bars.length - 1;
    const current = hoverIndex ?? view?.to ?? last;
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case "ArrowLeft":
        focusBar(clamp(current - step, 0, last));
        break;
      case "ArrowRight":
        focusBar(clamp(current + step, 0, last));
        break;
      case "Home":
        focusBar(view?.from ?? 0);
        break;
      case "End":
        focusBar(view?.to ?? last);
        break;
      case "+":
      case "=":
        zoom(ZOOM_STEP);
        break;
      case "-":
      case "_":
        zoom(1 / ZOOM_STEP);
        break;
      case "0":
        resetView();
        break;
      case "Escape": {
        const cleared = hoverIndex !== null || measure !== null || tool !== "cursor" || eventTip !== null;
        engine.chart.clearCrosshairPosition();
        setHoverIndex(null);
        onHoverChange?.(null);
        setMeasure(null);
        closeEventTip();
        if (tool !== "cursor") onToolChange?.("cursor");
        // Nothing to clear: let the Escape reach the full-screen dialog.
        if (!cleared) return;
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  }

  function onBlur() {
    if (!engine) return;
    engine.chart.clearCrosshairPosition();
    setHoverIndex(null);
    onHoverChange?.(null);
  }

  const changeIndicator = (next: IndicatorConfig) =>
    onIndicatorsChange?.(indicators.map((config) => (config.id === next.id ? next : config)));
  const removeIndicator = (id: string) => onIndicatorsChange?.(indicators.filter((config) => config.id !== id));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const lastIndex = bars.length - 1;
  const legendIndex = hoverIndex !== null ? clamp(hoverIndex, 0, Math.max(lastIndex, 0)) : lastIndex;
  const visibleFrom = view?.from ?? series.windowStart;

  let legendCompare: LegendCompare | null = null;
  const baseBar = bars[visibleFrom];
  const legendBar = bars[legendIndex];
  if (compareActive && baseBar && legendBar) {
    legendCompare = {
      mainPercent: ((legendBar.close - baseBar.close) / baseBar.close) * 100,
      items: compareList.map((item) => {
        const compareBars = item.series.bars;
        const baseAt = barAtOrBefore(compareBars, baseBar.time);
        const at = barAtOrBefore(compareBars, legendBar.time);
        return {
          symbol: item.symbol,
          label: item.label,
          color: SERIES_CSS_VAR[item.color % 5],
          percent: baseAt >= 0 && at >= 0 ? ((compareBars[at].close - compareBars[baseAt].close) / compareBars[baseAt].close) * 100 : null,
        };
      }),
      onRemove: onCompareRemove,
    };
  }

  const paneLegends = drawnPanes.map((item, i) => {
    const top = paneTops[i];
    if (top === undefined) return null;
    return (
      <div
        key={item.config.id}
        className="pointer-events-none absolute left-2 z-[4] flex max-w-[calc(100%-5rem)] items-baseline rounded-sm bg-card/85 px-1 font-mono text-[10px] leading-4 tabular-nums [&_button]:pointer-events-auto"
        style={{ top: top + 4 }}
      >
        <IndicatorLegendItem
          view={item}
          index={legendIndex}
          onChange={onIndicatorsChange ? changeIndicator : undefined}
          onRemove={onIndicatorsChange ? () => removeIndicator(item.config.id) : undefined}
        />
      </div>
    );
  });

  const measureInfo = measure ? describeMeasure(measure, bars, series, locale) : null;
  const showMeasureHint = tool === "measure" && !measure;
  const drawingTool = tool !== "cursor";

  const tipEvents = eventTip
    ? (eventsRef.current?.groupOf(eventTip.id) ?? [eventTip.id])
        .map((id) => events.find((event) => event.id === id) ?? upcoming.find((event) => event.id === id))
        .filter((event): event is ChartEvent => event !== undefined)
    : [];

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", height === "fill" && "min-h-0 flex-1", className)}>
      <ChartLegend
        series={series}
        index={legendIndex}
        symbol={symbol}
        mainColor={mainCssColor}
        format={valueFormatter}
        showOhlc={bars.some((bar) => bar.open !== null)}
        showVolume={volume}
        overlays={legendRow}
        onIndicatorChange={onIndicatorsChange ? changeIndicator : undefined}
        onIndicatorRemove={onIndicatorsChange ? removeIndicator : undefined}
        baseline={baseline && !compareActive ? baseline : null}
        compare={legendCompare}
        hovering={hoverIndex !== null}
        hideMain={legendMode === "overlays"}
      />
      <div
        ref={plotRef}
        role="group"
        aria-roledescription={t("chart.roleDescription")}
        aria-label={ariaLabel}
        aria-describedby={helpId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={cn(
          "relative isolate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          drawingTool ? "cursor-crosshair touch-none" : "touch-pan-y",
          height === "fill" && "min-h-0 flex-1",
        )}
        style={height === "fill" ? undefined : { height }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        {paneLegends}
        {geometry && measureInfo ? <MeasureOverlay geometry={geometry} info={measureInfo} /> : null}
        {drawingLayer.overlay}
        {eventTip && tipEvents.length > 0 ? (
          <EventTooltip
            tip={eventTip}
            events={tipEvents}
            plotWidth={axisBox?.plotWidth ?? 0}
            interval={series.interval}
            onClose={closeEventTip}
          />
        ) : null}
        {axisBox && scrolledBack && bars.length > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            title={t("action.latest")}
            aria-label={t("action.latest")}
            className="absolute z-[4] inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ right: axisBox.priceWidth + 8, bottom: axisBox.timeHeight + 8 + (events.length > 0 ? 24 : 0) }}
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {axisBox && onScaleChange ? (
          <div
            className="absolute bottom-0 right-0 z-[4] flex items-center justify-center gap-0.5"
            style={{ width: axisBox.priceWidth, height: axisBox.timeHeight }}
          >
            {manualScale ? (
              <ScaleButton label={t("scale.autoShort")} title={t("scale.autoTitle")} pressed={false} onClick={resetView} />
            ) : null}
            <ScaleButton
              label={t("scale.logShort")}
              title={compareActive ? t("scale.compareLocked") : t("scale.logTitle")}
              pressed={scale === "log" && !compareActive}
              disabled={compareActive}
              onClick={() => toggleScale("log")}
            />
            <ScaleButton
              label={t("scale.percentShort")}
              title={compareActive ? t("scale.compareLocked") : t("scale.percentTitle")}
              pressed={percentScale}
              disabled={compareActive}
              onClick={() => toggleScale("percent")}
            />
          </div>
        ) : null}
        {gestureHint || showMeasureHint ? (
          // Over the time axis, not the plot: the top of the plot is where the period high and its label sit.
          <div className="pointer-events-none absolute inset-x-0 bottom-0.5 z-[5] flex justify-center px-2">
            <span className="animate-fade rounded-md border border-border bg-popover px-2.5 py-1 text-center text-[11px] font-medium leading-4 text-popover-foreground">
              {showMeasureHint
                ? t(coarsePointer ? "hint.measureTouch" : "hint.measure")
                : coarsePointer
                  ? t("hint.touch")
                  : t("hint.wheel", { key: isApplePlatform() ? "⌘" : "Ctrl" })}
            </span>
          </div>
        ) : null}
      </div>
      <p id={helpId} className="sr-only">
        {t("hint.keyboard")}
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <Menu.Root open={contextMenu !== null} onOpenChange={(open) => (open ? undefined : setContextMenu(null))}>
        <Menu.Portal>
          <Menu.Positioner
            anchor={contextMenu ? { getBoundingClientRect: () => DOMRect.fromRect({ x: contextMenu.x, y: contextMenu.y, width: 0, height: 0 }) } : null}
            side="bottom"
            align="start"
            sideOffset={2}
            collisionPadding={12}
            className="z-[90]"
          >
            <Menu.Popup aria-label={t("ctx.label")} className={cn(POPUP_CLASS, "min-w-56 p-1")}>
              <Menu.Item className={MENU_ITEM_CLASS} onClick={resetView}>
                <RotateCcw aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1">{t("ctx.reset")}</span>
                <kbd className="font-mono text-[10px] text-muted-foreground">Alt+R</kbd>
              </Menu.Item>
              {scrolledBack ? (
                <Menu.Item className={MENU_ITEM_CLASS} onClick={scrollToLatest}>
                  <ChevronsRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{t("ctx.latest")}</span>
                </Menu.Item>
              ) : null}
              {onDrawingsChange && drawingsVisible && contextMenu?.price != null && contextMenu.time != null && !percentScale ? (
                <Menu.Item
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    if (contextMenu?.price == null || contextMenu.time == null) return;
                    onDrawingsChange([
                      ...drawings,
                      { id: newDrawingId(), kind: "hline", points: [{ time: contextMenu.time, price: contextMenu.price }], color: DEFAULT_COLOR.hline },
                    ]);
                  }}
                >
                  <Minus aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1">{t("ctx.addLevel", { price: valueFormatter(contextMenu.price) })}</span>
                </Menu.Item>
              ) : null}
              {onScaleChange ? (
                <>
                  <Menu.Separator className="my-1 h-px bg-border" />
                  <Menu.CheckboxItem className={MENU_ITEM_CLASS} checked={scale === "log" && !compareActive} disabled={compareActive} onCheckedChange={() => toggleScale("log")}>
                    <CheckMark checked={scale === "log" && !compareActive} />
                    <span className="flex-1">{t("scale.log")}</span>
                    <kbd className="font-mono text-[10px] text-muted-foreground">Alt+L</kbd>
                  </Menu.CheckboxItem>
                  <Menu.CheckboxItem className={MENU_ITEM_CLASS} checked={percentScale} disabled={compareActive} onCheckedChange={() => toggleScale("percent")}>
                    <CheckMark checked={percentScale} />
                    <span className="flex-1">{t("scale.percent")}</span>
                    <kbd className="font-mono text-[10px] text-muted-foreground">Alt+P</kbd>
                  </Menu.CheckboxItem>
                </>
              ) : null}
              {onSnapshot ? (
                <>
                  <Menu.Separator className="my-1 h-px bg-border" />
                  <Menu.Item className={MENU_ITEM_CLASS} onClick={() => onSnapshot("copy")}>
                    <Copy aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{t("snapshot.copy")}</span>
                  </Menu.Item>
                  <Menu.Item className={MENU_ITEM_CLASS} onClick={() => onSnapshot("download")}>
                    <Download aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1">{t("snapshot.download")}</span>
                    <kbd className="font-mono text-[10px] text-muted-foreground">Alt+S</kbd>
                  </Menu.Item>
                </>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function ScaleButton({
  label,
  title,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-mono text-[10px] leading-none outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-default",
        pressed ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
      )}
    >
      {label}
    </button>
  );
}

function EventTooltip({
  tip,
  events,
  plotWidth,
  interval,
  onClose,
}: {
  tip: EventTip;
  events: readonly ChartEvent[];
  plotWidth: number;
  interval: ChartSeries["interval"];
  onClose: () => void;
}) {
  const { t } = useChartI18n();
  const style = interval === "intraday" ? "dayMonthTime" : "date";
  const width = 272;
  const left = clamp(tip.x - width / 2, 4, Math.max(4, plotWidth - width - 4));
  return (
    <div
      role={tip.pinned ? "dialog" : "tooltip"}
      aria-label={tip.pinned ? t("event.count", { n: events.length }) : undefined}
      className={cn(
        "absolute z-[6] rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]",
        tip.pinned ? "pointer-events-auto" : "pointer-events-none",
      )}
      style={{ left, top: tip.y - 14, width, transform: "translateY(-100%)" }}
    >
      {tip.pinned ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t("event.close")}
          className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
      <ul className="max-h-60 space-y-2 overflow-y-auto pr-4 scrollbar-thin">
        {events.slice(0, 6).map((event) => {
          const slot = EVENT_SLOT[event.kind];
          const color = slot === null ? "var(--muted-foreground)" : SERIES_CSS_VAR[slot];
          return (
            <li key={event.id} className="text-xs leading-4">
              <div className="flex items-baseline gap-1.5">
                <span className="font-medium" style={{ color }}>
                  {t(EVENT_LABEL[event.kind])}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatBarTime(event.time, style)}</span>
              </div>
              <p className="mt-0.5 font-medium text-foreground">{event.title}</p>
              {event.detail ? <p className="mt-0.5 text-muted-foreground">{event.detail}</p> : null}
              {event.url && tip.pinned ? (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("event.open")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Left-to-right "drawing" reveal: a card-coloured curtain slides off the plot area. */
function playReveal(host: HTMLElement, chart: IChartApi): () => void {
  const container = host.parentElement;
  if (!container || typeof host.animate !== "function") return () => {};
  const width = chart.timeScale().width();
  const height = host.clientHeight - chart.timeScale().height();
  if (width <= 0 || height <= 0) return () => {};
  const curtain = document.createElement("div");
  Object.assign(curtain.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${width}px`,
    height: `${height}px`,
    background: "var(--card)",
    transformOrigin: "right center",
    pointerEvents: "none",
    zIndex: "1",
  });
  container.appendChild(curtain);
  const animation = curtain.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
    duration: 700,
    easing: "cubic-bezier(0.65, 0, 0.35, 1)",
    fill: "forwards",
  });
  const cleanup = () => curtain.remove();
  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
  return () => animation.cancel();
}
