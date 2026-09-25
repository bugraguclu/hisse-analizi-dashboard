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
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import type {
  BarPrice,
  ChartOptions,
  DeepPartial,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  Logical,
  MouseEventParams,
  SeriesMarker,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { formatChangePercent, formatNumber, formatSigned, getIntlLocale, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChartLegend, type LegendCompare, type LegendOverlayValue } from "./ChartLegend";
import { observeTheme, readChartPalette, rgba, SERIES_CSS_VAR, type ChartPalette, type Rgb } from "./colors";
import { formatChartPrice, formatSpan, formatTicks, priceDecimals } from "./format";
import { useChartI18n, type ChartKey } from "./i18n";
import {
  bollinger,
  macd as macdSeries,
  rsi as rsiSeries,
  sma,
  stochastic as stochasticSeries,
  type BollingerBands,
  type IndicatorSeries,
  type MacdSeries,
  type StochasticSeries,
} from "./indicators";
import { barLabelStyle, formatBarTime, formatWallTime, SESSION_END_MINUTES, tickLabel, toChartTime, wallMinutes } from "./time";
import type { ChartBar, ChartSeries, ChartType, ChartView, OverlayKey, PaneKey } from "./types";

type Lib = typeof import("lightweight-charts");
type AnySeries = ISeriesApi<SeriesType>;

interface Engine {
  lib: Lib;
  chart: IChartApi;
}

export interface FinancialChartHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
  download(filename: string): void;
  focus(): void;
}

export interface FinancialChartProps {
  series: ChartSeries;
  type: ChartType;
  overlays?: readonly OverlayKey[];
  panes?: readonly PaneKey[];
  volume?: boolean;
  /** Benchmark drawn with the main series as % return from the first visible bar. */
  compare?: { label: string; series: ChartSeries } | null;
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
  measureMode?: boolean;
  onMeasureModeChange?: (on: boolean) => void;
  onHoverChange?: (index: number | null) => void;
  onViewChange?: (view: ChartView) => void;
  /** "modifier": vertical wheel scrolls the page, Ctrl/⌘ + wheel zooms; "always": wheel zooms. */
  wheelZoom?: "modifier" | "always";
  ariaLabel: string;
  symbol: string;
  /** Must be stable (module-level or memoized): changing it rebuilds the chart. */
  valueFormatter?: (value: number) => string;
  handleRef?: Ref<FinancialChartHandle>;
  className?: string;
}

interface MeasureState {
  start: number;
  end: number;
  dragging: boolean;
}

interface MeasureGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  plotWidth: number;
  plotHeight: number;
}

interface IndicatorData {
  ma20?: IndicatorSeries;
  ma50?: IndicatorSeries;
  ma200?: IndicatorSeries;
  bb?: BollingerBands;
  rsi?: IndicatorSeries;
  macd?: MacdSeries;
  stoch?: StochasticSeries;
}

const OVERLAY_ORDER: readonly OverlayKey[] = ["ma20", "ma50", "ma200", "bb"];
const PANE_ORDER: readonly PaneKey[] = ["rsi", "macd", "stoch"];
/** Fixed categorical slot per overlay (never cycled): chart-1 ink blue, 2 ochre, 3 plum, 4 teal. */
const OVERLAY_SLOT: Record<OverlayKey, number> = { ma20: 0, ma50: 1, ma200: 2, bb: 3 };
const OVERLAY_LABEL: Record<OverlayKey, ChartKey> = { ma20: "ind.ma20", ma50: "ind.ma50", ma200: "ind.ma200", bb: "ind.bb" };
/** The benchmark uses slot 1; overlays are off while comparing, so it never collides. */
const COMPARE_SLOT = 0;
const ZOOM_STEP = 0.7;
/** Canvas text size (price/time axes, marker labels), in px. */
const CHART_FONT_SIZE = 11;
/** Widest bar spacing, in px: short periods on wide plots show extra bars instead of fat ones. */
const MAX_BAR_SPACING = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeIndicators(bars: readonly ChartBar[], overlays: readonly OverlayKey[], panes: readonly PaneKey[]): IndicatorData {
  const closes = bars.map((bar) => bar.close);
  const data: IndicatorData = {};
  if (overlays.includes("ma20")) data.ma20 = sma(closes, 20);
  if (overlays.includes("ma50")) data.ma50 = sma(closes, 50);
  if (overlays.includes("ma200")) data.ma200 = sma(closes, 200);
  if (overlays.includes("bb")) data.bb = bollinger(closes, 20, 2);
  if (panes.includes("rsi")) data.rsi = rsiSeries(closes, 14);
  if (panes.includes("macd")) data.macd = macdSeries(closes, 12, 26, 9);
  if (panes.includes("stoch")) {
    const highs = bars.map((bar) => bar.high ?? bar.close);
    const lows = bars.map((bar) => bar.low ?? bar.close);
    data.stoch = stochasticSeries(highs, lows, closes, 14, 3, 3);
  }
  return data;
}

function barIsUp(bars: readonly ChartBar[], index: number): boolean {
  const bar = bars[index];
  if (bar.open !== null && bar.open !== bar.close) return bar.close > bar.open;
  const previous = bars[index - 1];
  return !previous || bar.close >= previous.close;
}

function lineData(times: readonly UTCTimestamp[], values: IndicatorSeries) {
  return values.map((value, i) => (value === null ? { time: times[i] } : { time: times[i], value }));
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

function formatIndicator(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined) return "—";
  return formatNumber(value, decimals ?? priceDecimals(value));
}

function chartOptions(
  lib: Lib,
  palette: ChartPalette,
  series: ChartSeries,
  format: (value: number) => string,
  padded: boolean,
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
      horzLines: { color: rgba(palette.grid), style: lib.LineStyle.Solid },
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
      mode: lib.CrosshairMode.Magnet,
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
      tickmarksPriceFormatter: (prices: BarPrice[]) => formatTicks(prices, (value, decimals) => formatNumber(value, decimals)),
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
  const high = (i: number) => (type === "candles" ? (bars[i].high ?? bars[i].close) : bars[i].close);
  const low = (i: number) => (type === "candles" ? (bars[i].low ?? bars[i].close) : bars[i].close);
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

/**
 * Candlestick / line / area chart with volume, SMA and Bollinger overlays,
 * RSI / MACD / stochastic panes, benchmark comparison, a crosshair legend,
 * wheel/pinch zoom, drag pan, drag-to-measure and keyboard navigation.
 */
export function FinancialChart({
  series,
  type,
  overlays = [],
  panes = [],
  volume = false,
  compare = null,
  baseline = null,
  tone,
  height,
  paneHeight = 110,
  padToSessionEnd = false,
  live = false,
  extremes = true,
  measureMode = false,
  onMeasureModeChange,
  onHoverChange,
  onViewChange,
  wheelZoom = "modifier",
  ariaLabel,
  symbol,
  valueFormatter = formatChartPrice,
  handleRef,
  className,
}: FinancialChartProps) {
  const { t, locale } = useChartI18n();
  const motionAllowed = useMotionAllowed();
  const helpId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef(new Map<string, AnySeries>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const paletteRef = useRef<ChartPalette | null>(null);
  const defaultRangeRef = useRef<{ from: number; to: number } | null>(null);
  const shownKeyRef = useRef<string | null>(null);
  const isDefaultRef = useRef(true);
  const zoomFrameRef = useRef(0);
  const announceTimerRef = useRef<number | undefined>(undefined);

  const [engine, setEngine] = useState<Engine | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [view, setView] = useState<ChartView | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([]);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const [geometry, setGeometry] = useState<MeasureGeometry | null>(null);
  const [gestureHint, setGestureHint] = useState(false);
  const coarsePointer = useCoarsePointer();
  const [announcement, setAnnouncement] = useState("");

  const bars = series.bars;
  const compareSeries = compare && compare.series.bars.length > 0 ? compare.series : null;
  const compareLabel = compare?.label ?? "";
  const compareActive = compareSeries !== null;
  const baselinePrice = baseline && !compareActive ? baseline.price : null;
  // String keys keep derived arrays stable when parents pass fresh array literals.
  const overlaysKey = compareActive ? "" : OVERLAY_ORDER.filter((key) => overlays.includes(key)).join(",");
  const panesKey = PANE_ORDER.filter((key) => panes.includes(key)).join(",");
  const activeOverlays = useMemo(() => (overlaysKey ? (overlaysKey.split(",") as OverlayKey[]) : []), [overlaysKey]);
  const activePanes = useMemo(() => (panesKey ? (panesKey.split(",") as PaneKey[]) : []), [panesKey]);
  const times = useMemo(() => bars.map((bar) => toChartTime(bar.time)), [bars]);
  const indicators = useMemo(() => computeIndicators(bars, activeOverlays, activePanes), [bars, activeOverlays, activePanes]);
  const macdDecimals = useMemo(() => {
    let peak = 0;
    for (const value of indicators.macd?.macd ?? []) if (value !== null) peak = Math.max(peak, Math.abs(value));
    return peak > 0 ? priceDecimals(peak) : 2;
  }, [indicators]);
  const padTimes = useMemo(() => (padToSessionEnd ? sessionPadTimes(series, times) : []), [padToSessionEnd, series, times]);

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
      markersRef.current = null;
      registry.clear();
      chart?.remove();
    };
  }, []);

  const shouldAnimate = useEffectEvent(() => motionAllowed);

  const refreshMeasureGeometry = useEffectEvent(() => {
    setGeometry(engine && measure ? measureGeometry(engine, seriesRef.current.get("main"), measure, bars) : null);
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
    if (markersRef.current && paletteRef.current) {
      const timeScale = engine.chart.timeScale();
      const width = timeScale.width();
      const charWidth = monoCharWidth(paletteRef.current.monoFamily, CHART_FONT_SIZE);
      const place = (index: number, label: string) =>
        edgeSafeLabel(label, timeScale.logicalToCoordinate(index as Logical), width, charWidth);
      markersRef.current.setMarkers(extremeMarkers(type, bars, times, from, to, rgba(paletteRef.current.muted), valueFormatter, place));
    }
    refreshMeasureGeometry();
    refreshPaneTops();
  });

  // Build every series from scratch whenever data, structure, theme or locale change.
  // Rebuilding ~10 series of ≤1k points takes a few ms and keeps pane order trivial.
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
    for (const api of registry.values()) chart.removeSeries(api);
    registry.clear();
    for (let i = chart.panes().length - 1; i > 0; i -= 1) chart.removePane(i);

    chart.applyOptions(chartOptions(lib, palette, series, valueFormatter, padTimes.length > 0));
    if (bars.length === 0) return;

    const mainRgb: Rgb = mainTone === "up" ? palette.up : mainTone === "down" ? palette.down : palette.primary;
    const ring = rgba(palette.card);
    const priceFormat = { type: "custom" as const, formatter: (price: BarPrice) => valueFormatter(price), minMove: 0.01 };
    const indicatorFormat = { type: "custom" as const, formatter: (value: BarPrice) => formatIndicator(value), minMove: 0.0001 };

    // Main series ------------------------------------------------------------
    let main: AnySeries;
    if (type === "candles") {
      main = chart.addSeries(lib.CandlestickSeries, {
        priceFormat,
        priceLineStyle: lib.LineStyle.Dotted,
        upColor: rgba(palette.up),
        downColor: rgba(palette.down),
        wickUpColor: rgba(palette.up),
        wickDownColor: rgba(palette.down),
        borderVisible: false,
      });
      main.setData([
        ...bars.map((bar, i) => {
          const open = bar.open ?? (i > 0 ? bars[i - 1].close : bar.close);
          return {
            time: times[i],
            open,
            high: bar.high ?? Math.max(open, bar.close),
            low: bar.low ?? Math.min(open, bar.close),
            close: bar.close,
          };
        }),
        ...padTimes.map((time) => ({ time })),
      ]);
    } else {
      const lineOptions = {
        priceFormat,
        priceLineStyle: lib.LineStyle.Dotted,
        lineWidth: 2 as const,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderWidth: 2,
        crosshairMarkerBorderColor: ring,
        crosshairMarkerBackgroundColor: rgba(mainRgb),
        lastPriceAnimation: live ? lib.LastPriceAnimationMode.Continuous : lib.LastPriceAnimationMode.Disabled,
      };
      const wash = rgba(mainRgb, palette.dark ? 0.14 : 0.1);
      main =
        type === "area"
          ? chart.addSeries(lib.AreaSeries, { ...lineOptions, lineColor: rgba(mainRgb), topColor: wash, bottomColor: wash })
          : chart.addSeries(lib.LineSeries, { ...lineOptions, color: rgba(mainRgb) });
      main.setData([...bars.map((bar, i) => ({ time: times[i], value: bar.close })), ...padTimes.map((time) => ({ time }))]);
    }
    registry.set("main", main);
    // In comparison (%) mode the 0 % base line is the shared reference: quiet and dashed.
    main.applyOptions({
      baseLineVisible: compareActive,
      baseLineColor: rgba(palette.muted, 0.7),
      baseLineStyle: lib.LineStyle.Dashed,
      baseLineWidth: 1,
    });
    chart.priceScale("right", 0).applyOptions({
      mode: compareActive ? lib.PriceScaleMode.Percentage : lib.PriceScaleMode.Normal,
      scaleMargins: { top: 0.12, bottom: volume ? 0.24 : 0.08 },
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
        title: "",
      });
    }

    // Volume: histogram along the bottom fifth of the main pane --------------
    if (volume && bars.some((bar) => bar.volume !== null && bar.volume > 0)) {
      const volumeSeries = chart.addSeries(lib.HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      const alpha = palette.dark ? 0.42 : 0.3;
      const upColor = rgba(palette.up, alpha);
      const downColor = rgba(palette.down, alpha);
      volumeSeries.setData(
        bars.map((bar, i) =>
          bar.volume === null ? { time: times[i] } : { time: times[i], value: bar.volume, color: barIsUp(bars, i) ? upColor : downColor },
        ),
      );
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
      registry.set("volume", volumeSeries);
    }

    // Overlays ------------------------------------------------------------------
    const overlayLine = (key: string, values: IndicatorSeries, color: Rgb, dashed = false) => {
      const line = chart.addSeries(lib.LineSeries, {
        color: rgba(color),
        lineWidth: 1,
        lineStyle: dashed ? lib.LineStyle.Dashed : lib.LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        priceFormat,
      });
      line.setData(lineData(times, values));
      registry.set(key, line);
    };
    for (const key of activeOverlays) {
      const color = palette.series[OVERLAY_SLOT[key]];
      if (key === "bb") {
        if (!indicators.bb) continue;
        overlayLine("bb.upper", indicators.bb.upper, color);
        overlayLine("bb.middle", indicators.bb.middle, color, true);
        overlayLine("bb.lower", indicators.bb.lower, color);
      } else {
        const values = indicators[key];
        if (values) overlayLine(key, values, color);
      }
    }

    // Benchmark -----------------------------------------------------------------
    if (compareSeries) {
      const benchmark = chart.addSeries(lib.LineSeries, {
        color: rgba(palette.series[COMPARE_SLOT]),
        lineWidth: 2,
        baseLineVisible: false,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: ring,
        priceFormat,
      });
      benchmark.setData(compareSeries.bars.map((bar) => ({ time: toChartTime(bar.time), value: bar.close })));
      registry.set("compare", benchmark);
    }

    // Indicator panes -------------------------------------------------------------
    const level = (target: AnySeries, price: number, color: string, style: number = lib.LineStyle.Dashed) =>
      target.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false, title: "" });
    const fixedRange = () => ({ priceRange: { minValue: 0, maxValue: 100 } });
    activePanes.forEach((key, i) => {
      const paneIndex = i + 1;
      const paneLine = (values: IndicatorSeries, color: Rgb) => {
        const line = chart.addSeries(
          lib.LineSeries,
          {
            color: rgba(color),
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerRadius: 3,
            crosshairMarkerBorderColor: ring,
            priceFormat: indicatorFormat,
          },
          paneIndex,
        );
        line.setData(lineData(times, values));
        return line;
      };
      if (key === "rsi" && indicators.rsi) {
        const line = paneLine(indicators.rsi, palette.series[0]);
        line.applyOptions({ autoscaleInfoProvider: fixedRange });
        level(line, 70, rgba(palette.down, 0.55));
        level(line, 30, rgba(palette.up, 0.55));
        level(line, 50, rgba(palette.muted, 0.35), lib.LineStyle.Dotted);
        registry.set("rsi", line);
      } else if (key === "macd" && indicators.macd) {
        const macdFormat = {
          type: "custom" as const,
          formatter: (value: BarPrice) => formatIndicator(value, macdDecimals),
          minMove: 10 ** -macdDecimals,
        };
        const histogram = chart.addSeries(
          lib.HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false, priceFormat: macdFormat },
          paneIndex,
        );
        const values = indicators.macd.histogram;
        histogram.setData(
          values.map((value, j) => {
            if (value === null) return { time: times[j] };
            const previous = values[j - 1] ?? value;
            const strengthening = Math.abs(value) >= Math.abs(previous);
            return { time: times[j], value, color: rgba(value >= 0 ? palette.up : palette.down, strengthening ? 0.7 : 0.35) };
          }),
        );
        registry.set("macd.hist", histogram);
        const macdLine = paneLine(indicators.macd.macd, palette.series[0]);
        macdLine.applyOptions({ priceFormat: macdFormat });
        registry.set("macd.line", macdLine);
        const signal = paneLine(indicators.macd.signal, palette.series[1]);
        signal.applyOptions({ priceFormat: macdFormat });
        level(signal, 0, rgba(palette.muted, 0.4), lib.LineStyle.Dotted);
        registry.set("macd.signal", signal);
      } else if (key === "stoch" && indicators.stoch) {
        const k = paneLine(indicators.stoch.k, palette.series[0]);
        k.applyOptions({ autoscaleInfoProvider: fixedRange });
        level(k, 80, rgba(palette.down, 0.55));
        level(k, 20, rgba(palette.up, 0.55));
        registry.set("stoch.k", k);
        const d = paneLine(indicators.stoch.d, palette.series[1]);
        d.applyOptions({ autoscaleInfoProvider: fixedRange });
        registry.set("stoch.d", d);
      }
    });

    // Indicator panes always read in their own units, also while the main pane shows %.
    for (let paneIndex = 1; paneIndex < chart.panes().length; paneIndex += 1) {
      chart.priceScale("right", paneIndex).applyOptions({ mode: lib.PriceScaleMode.Normal, scaleMargins: { top: 0.12, bottom: 0.08 } });
    }

    // The main pane keeps whatever the indicator panes leave.
    const paneList = chart.panes();
    if (paneList.length > 1) {
      const total = host.clientHeight || (typeof height === "number" ? height : 480);
      paneList[0].setStretchFactor(Math.max(total - paneHeight * (paneList.length - 1), total * 0.45));
      for (const pane of paneList.slice(1)) pane.setStretchFactor(paneHeight);
    }

    if (extremes) markersRef.current = lib.createSeriesMarkers(main, []);

    // Period window by default; keep the user's zoom/pan across refetches of the same data.
    const defaultRange = { from: series.windowStart - 0.5, to: bars.length - 1 + padTimes.length + 0.5 };
    defaultRangeRef.current = defaultRange;
    timeScale.setVisibleLogicalRange(keepView && previousRange ? previousRange : defaultRange);

    // The drawing reveal plays for the first data only: a new period, type or comparison swaps in place.
    const firstShow = shownKeyRef.current === null;
    shownKeyRef.current = dataKey;
    const cancelReveal = firstShow && shouldAnimate() ? playReveal(host, chart) : undefined;
    const frame = requestAnimationFrame(() => applyViewChange());
    return () => {
      cancelAnimationFrame(frame);
      cancelReveal?.();
    };
  }, [
    engine,
    series,
    bars,
    times,
    padTimes,
    indicators,
    activeOverlays,
    activePanes,
    type,
    volume,
    compareSeries,
    compareActive,
    baselinePrice,
    mainTone,
    live,
    extremes,
    dataKey,
    valueFormatter,
    height,
    paneHeight,
    macdDecimals,
    themeVersion,
    locale,
  ]);

  // Crosshair → legend / header scrub; double click on the plot resets the view.
  const onCrosshair = useEffectEvent((param: MouseEventParams<Time>) => {
    const index = param.point && param.logical !== undefined ? clamp(Math.round(param.logical), 0, Math.max(bars.length - 1, 0)) : null;
    setHoverIndex((previous) => (previous === index ? previous : index));
    onHoverChange?.(index);
  });
  const onDoubleClick = useEffectEvent(() => resetView());
  useEffect(() => {
    if (!engine) return;
    const move = (param: MouseEventParams<Time>) => onCrosshair(param);
    const dblClick = () => onDoubleClick();
    engine.chart.subscribeCrosshairMove(move);
    engine.chart.subscribeDblClick(dblClick);
    return () => {
      engine.chart.unsubscribeCrosshairMove(move);
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

  // Pane legends follow pane resizes (separator drag, container resize).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !engine) return;
    const observer = new ResizeObserver(() => refreshPaneTops());
    observer.observe(host);
    const onPointerUp = () => requestAnimationFrame(() => refreshPaneTops());
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

  // Drag-to-measure: measure mode, or Shift + drag anywhere on the main pane.
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
  const measureWanted = useEffectEvent((event: PointerEvent) => measureMode || event.shiftKey);
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
    const swallow = (event: Event) => {
      if (active) event.stopPropagation();
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
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !measureWanted(event)) return;
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
    };
  }, []);

  // Leaving measure mode drops a finished measurement.
  const dropMeasure = useEffectEvent(() => setMeasure((current) => (current && !current.dragging ? null : current)));
  useEffect(() => {
    if (!measureMode) dropMeasure();
  }, [measureMode]);

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
    const total = bars.length + padTimes.length;
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
    if (defaultRangeRef.current) animateTo(defaultRangeRef.current);
  }

  function download(filename: string) {
    const host = hostRef.current;
    if (!engine || !host) return;
    const shot = engine.chart.takeScreenshot(true, false);
    const canvas = document.createElement("canvas");
    canvas.width = shot.width;
    canvas.height = shot.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = rgba(readChartPalette(host).card);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(shot, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  }

  useImperativeHandle(handleRef, () => ({
    zoomIn: () => zoom(ZOOM_STEP),
    zoomOut: () => zoom(1 / ZOOM_STEP),
    reset: resetView,
    download,
    focus: () => plotRef.current?.focus(),
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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!engine || bars.length === 0) return;
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
        const cleared = hoverIndex !== null || measure !== null || measureMode;
        engine.chart.clearCrosshairPosition();
        setHoverIndex(null);
        onHoverChange?.(null);
        setMeasure(null);
        if (measureMode) onMeasureModeChange?.(false);
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const lastIndex = bars.length - 1;
  const legendIndex = hoverIndex !== null ? clamp(hoverIndex, 0, Math.max(lastIndex, 0)) : lastIndex;
  const visibleFrom = view?.from ?? series.windowStart;

  const overlayValues: LegendOverlayValue[] = [];
  for (const key of activeOverlays) {
    const color = SERIES_CSS_VAR[OVERLAY_SLOT[key]];
    if (key === "bb") {
      const bands = indicators.bb;
      overlayValues.push({ key: "bbUpper", label: `${t("ind.bb")} ${t("legend.bbUpper")}`, color, value: bands?.upper[legendIndex] ?? null });
      overlayValues.push({ key: "bb", label: t("legend.bbMiddle"), color, dashed: true, value: bands?.middle[legendIndex] ?? null });
      overlayValues.push({ key: "bbLower", label: t("legend.bbLower"), color, value: bands?.lower[legendIndex] ?? null });
    } else {
      overlayValues.push({ key, label: t(OVERLAY_LABEL[key]), color, value: indicators[key]?.[legendIndex] ?? null });
    }
  }

  let legendCompare: LegendCompare | null = null;
  const baseBar = bars[visibleFrom];
  const legendBar = bars[legendIndex];
  if (compareSeries && baseBar && legendBar) {
    const compareBars = compareSeries.bars;
    const baseAt = barAtOrBefore(compareBars, baseBar.time);
    const at = barAtOrBefore(compareBars, legendBar.time);
    legendCompare = {
      label: compareLabel,
      color: SERIES_CSS_VAR[COMPARE_SLOT],
      mainPercent: ((legendBar.close - baseBar.close) / baseBar.close) * 100,
      comparePercent:
        baseAt >= 0 && at >= 0 ? ((compareBars[at].close - compareBars[baseAt].close) / compareBars[baseAt].close) * 100 : null,
    };
  }

  const paneLegends = activePanes.map((key, i) => {
    const top = paneTops[i];
    if (top === undefined) return null;
    let content: ReactNode;
    if (key === "rsi") {
      content = (
        <>
          <span className="text-muted-foreground">RSI 14</span>
          <PaneValue color={SERIES_CSS_VAR[0]} value={formatIndicator(indicators.rsi?.[legendIndex], 2)} />
        </>
      );
    } else if (key === "macd") {
      const histogram = indicators.macd?.histogram[legendIndex] ?? null;
      content = (
        <>
          <span className="text-muted-foreground">MACD 12 26 9</span>
          <PaneValue color={SERIES_CSS_VAR[0]} value={formatIndicator(indicators.macd?.macd[legendIndex], macdDecimals)} />
          <PaneValue color={SERIES_CSS_VAR[1]} value={formatIndicator(indicators.macd?.signal[legendIndex], macdDecimals)} />
          <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(histogram)])}>{formatIndicator(histogram, macdDecimals)}</span>
        </>
      );
    } else {
      content = (
        <>
          <span className="text-muted-foreground">{t("ind.stoch")} 14 3 3</span>
          <PaneValue color={SERIES_CSS_VAR[0]} value={`%K ${formatIndicator(indicators.stoch?.k[legendIndex], 2)}`} />
          <PaneValue color={SERIES_CSS_VAR[1]} value={`%D ${formatIndicator(indicators.stoch?.d[legendIndex], 2)}`} />
        </>
      );
    }
    return (
      <div
        key={key}
        aria-hidden
        className="pointer-events-none absolute left-2 z-[1] flex items-baseline gap-2 rounded-sm bg-card/85 px-1 font-mono text-[10px] leading-4 tabular-nums"
        style={{ top: top + 4 }}
      >
        {content}
      </div>
    );
  });

  const measureInfo = measure ? describeMeasure(measure, bars, series, locale) : null;
  const showMeasureHint = measureMode && !measure;

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
        overlays={overlayValues}
        baseline={baseline && !compareActive ? baseline : null}
        compare={legendCompare}
        hovering={hoverIndex !== null}
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
          measureMode ? "cursor-crosshair touch-none" : "touch-pan-y",
          height === "fill" && "min-h-0 flex-1",
        )}
        style={height === "fill" ? undefined : { height }}
      >
        <div ref={hostRef} className="absolute inset-0" />
        {paneLegends}
        {geometry && measureInfo ? <MeasureOverlay geometry={geometry} info={measureInfo} /> : null}
        {gestureHint || showMeasureHint ? (
          // Over the time axis, not the plot: the top of the plot is where the period high and its label sit.
          <div className="pointer-events-none absolute inset-x-0 bottom-0.5 z-[3] flex justify-center px-2">
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
    </div>
  );
}

function PaneValue({ color, value }: { color: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 font-medium text-foreground">
      <span aria-hidden className="inline-block h-0 w-2.5 border-t-2 align-middle" style={{ borderColor: color }} />
      {value}
    </span>
  );
}

function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribeCoarsePointer(onChange: () => void): () => void {
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Primary input is touch: gesture hints talk about pinching instead of Ctrl + wheel and Esc. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER_QUERY).matches,
    () => false,
  );
}

function measureGeometry(engine: Engine, main: AnySeries | undefined, measure: MeasureState, bars: readonly ChartBar[]): MeasureGeometry | null {
  const start = bars[measure.start];
  const end = bars[measure.end];
  if (!main || !start || !end) return null;
  const timeScale = engine.chart.timeScale();
  const x1 = timeScale.logicalToCoordinate(measure.start as Logical);
  const x2 = timeScale.logicalToCoordinate(measure.end as Logical);
  const y1 = main.priceToCoordinate(start.close);
  const y2 = main.priceToCoordinate(end.close);
  if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
  return { x1, y1, x2, y2, plotWidth: timeScale.width(), plotHeight: engine.chart.panes()[0]?.getHeight() ?? 0 };
}

interface MeasureInfo {
  change: number;
  percent: number;
  bars: number;
  span: string;
  from: string;
  to: string;
}

function describeMeasure(measure: MeasureState, bars: readonly ChartBar[], series: ChartSeries, locale: Locale): MeasureInfo | null {
  const a = Math.min(measure.start, measure.end);
  const b = Math.max(measure.start, measure.end);
  const first = bars[a];
  const last = bars[b];
  if (!first || !last) return null;
  // Direction follows the drag: dragging right-to-left measures backwards in time.
  const [origin, target] = measure.end >= measure.start ? [first, last] : [last, first];
  const change = target.close - origin.close;
  const style = series.interval === "intraday" ? "dayMonthTime" : series.interval === "monthly" ? "monthYear" : "date";
  return {
    change,
    percent: (change / origin.close) * 100,
    bars: b - a,
    span: formatSpan(first.time, last.time, series.interval, locale),
    from: formatBarTime(origin.time, style),
    to: formatBarTime(target.time, style),
  };
}

function MeasureOverlay({ geometry, info }: { geometry: MeasureGeometry; info: MeasureInfo }) {
  const { t } = useChartI18n();
  const { x1, y1, x2, y2, plotWidth, plotHeight } = geometry;
  const tone = trendTone(info.change);
  const color = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--muted-foreground)";
  const left = Math.min(x1, x2);
  const width = Math.abs(x2 - x1);
  const topY = Math.min(y1, y2);
  const placeBelow = topY < 72;
  const towardsLeft = x2 > plotWidth / 2;
  return (
    <>
      <svg aria-hidden className="pointer-events-none absolute inset-0 z-[2] overflow-visible" width="100%" height="100%">
        <rect x={left} y={0} width={Math.max(width, 1)} height={plotHeight} fill={color} fillOpacity={0.08} />
        <line x1={x1} x2={x1} y1={0} y2={plotHeight} stroke={color} strokeOpacity={0.4} strokeWidth={1} />
        <line x1={x2} x2={x2} y1={0} y2={plotHeight} stroke={color} strokeOpacity={0.4} strokeWidth={1} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
        <circle cx={x1} cy={y1} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
        <circle cx={x2} cy={y2} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
      </svg>
      <div
        className="pointer-events-none absolute z-[3] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1.5 font-mono text-[11px] leading-4 tabular-nums text-popover-foreground"
        style={{
          left: clamp(x2, 4, Math.max(4, plotWidth - 4)),
          top: placeBelow ? Math.max(y1, y2) + 12 : topY - 12,
          transform: `translate(${towardsLeft ? "calc(-100% - 8px)" : "8px"}, ${placeBelow ? "0" : "-100%"})`,
        }}
      >
        <div className={cn("text-xs font-semibold", TREND_TEXT_CLASS[tone])}>
          {formatSigned(info.change)} ({formatChangePercent(info.percent)})
        </div>
        <div className="text-muted-foreground">
          {t("measure.bars", { n: info.bars })} · {info.span}
        </div>
        <div className="font-sans text-muted-foreground">
          {info.from} → {info.to}
        </div>
      </div>
    </>
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
