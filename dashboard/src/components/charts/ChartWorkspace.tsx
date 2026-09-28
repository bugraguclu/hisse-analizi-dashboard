"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { useMarketStatus } from "@/hooks/use-market-status";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import type { ChartPeriod } from "@/types";
import { ChartDataTable } from "./ChartDataTable";
import { ChartToolbar, type ToolbarFeatures } from "./ChartToolbar";
import type { CompareChoice, CompareItem } from "./ComparePicker";
import { ToolButton } from "./controls";
import { useCompareSeries } from "./data";
import { DRAWING_SHORTCUTS, DrawingToolbar, useDrawings } from "./drawings";
import type { DrawingTool } from "./drawings/types";
import { useChartEvents } from "./events";
import { INDICATORS } from "./indicator-catalog";
import { FinancialChart, type FinancialChartHandle } from "./FinancialChart";
import { formatChartPrice, formatUsdChartPrice } from "./format";
import { useChartI18n } from "./i18n";
import type { ChartPrefs } from "./prefs";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { copyPng, downloadBlob } from "./snapshot";
import { formatWallTime, toChartTime } from "./time";
import type { ChartSeries, ChartView, CompareSeries } from "./types";
import { useMediaQuery } from "./use-coarse-pointer";

export type { ToolbarFeatures } from "./ChartToolbar";

const ALL_FEATURES: ToolbarFeatures = { indicators: true, compare: true, drawings: true, events: true };

export interface WorkspaceStatus {
  /** First load (nothing to show yet). */
  pending: boolean;
  /** Failed with nothing cached. */
  error: boolean;
  /** Showing the previous period while the selected one loads. */
  placeholder: boolean;
  onRetry: () => void;
}

export interface SummaryState {
  series: ChartSeries;
  view: ChartView | null;
  hoverIndex: number | null;
}

export interface ChartWorkspaceProps {
  /** Card title, repeated in the full-screen header. */
  title: string;
  symbol: string;
  /** Company / index name: full-screen header, watermark and snapshot. */
  name?: string;
  /** Stocks get event badges (dividends, KAP); indices don't. */
  kind: "ticker" | "index";
  ariaLabel: string;
  series: ChartSeries | undefined;
  status: WorkspaceStatus;
  period: ChartPeriod;
  periodOptions: ReadonlyArray<SegmentedOption<ChartPeriod>>;
  periodLabel: string;
  onPeriodChange: (period: ChartPeriod) => void;
  prefs: ChartPrefs;
  onPrefsChange: (next: ChartPrefs) => void;
  /** Module-level defaults ("restore default setup"). */
  defaults: ChartPrefs;
  /** Tools offered inside the card; full screen offers `fullscreenFeatures` (default: all). */
  features: ToolbarFeatures;
  fullscreenFeatures?: ToolbarFeatures;
  baseline?: { price: number; label: string } | null;
  live?: boolean;
  padToSessionEnd?: boolean;
  /** Main pane height in px; every indicator pane adds `paneHeight`. */
  height: number;
  paneHeight?: number;
  /** Line above the toolbar (period change, range...) — follows the crosshair. */
  summary?: (state: SummaryState) => ReactNode;
  /** Live price block of the full-screen header. */
  headline?: ReactNode;
  onHoverChange?: (index: number | null) => void;
  emptyMessage: string;
  errorMessage: string;
  /** File name (without extension) for the PNG export. */
  downloadName: string;
  /** Must be stable (module-level or memoized). */
  valueFormatter?: (value: number) => string;
  /** Pointer or focus entered the chart (e.g. to prefetch the other periods). */
  onIntent?: () => void;
  className?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Card body of an interactive chart — summary line, tool row, the chart (with
 * a placeholder while a new period loads), drawing tools and the data table —
 * and its full-screen twin: a terminal layout with the live price, the period
 * picker, a drawing rail and a status bar, entered through the browser's
 * Fullscreen API when it allows (an in-page overlay otherwise, e.g. iPhone).
 */
export function ChartWorkspace({
  title,
  symbol,
  name,
  kind,
  ariaLabel,
  series,
  status,
  period,
  periodOptions,
  periodLabel,
  onPeriodChange,
  prefs,
  onPrefsChange,
  defaults,
  features,
  fullscreenFeatures = ALL_FEATURES,
  baseline = null,
  live = false,
  padToSessionEnd = false,
  height,
  paneHeight = 110,
  summary,
  headline,
  onHoverChange,
  emptyMessage,
  errorMessage,
  downloadName,
  valueFormatter = formatChartPrice,
  onIntent,
  className,
}: ChartWorkspaceProps) {
  const { t, locale } = useChartI18n();
  const chartRef = useRef<FinancialChartHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const nativeFullscreenRef = useRef(false);
  const [tool, setTool] = useState<DrawingTool>("cursor");
  const [drawOpen, setDrawOpen] = useState(false);
  const [tableOn, setTableOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [view, setView] = useState<ChartView | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [compareItems, setCompareItems] = useState<CompareItem[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  // What is on screen decides the unit: a lira series stays labelled lira while its dollar twin loads.
  const currency = series?.currency ?? prefs.currency;
  const usd = currency === "USD";
  const formatter = usd ? formatUsdChartPrice : valueFormatter;
  // Prices of a drawing only mean something in one currency: dollar charts keep their own set.
  const [drawings, setDrawings] = useDrawings(usd ? `${symbol}@USD` : symbol);
  const narrow = useMediaQuery("(max-width: 639px)");
  // Landscape phones: every row above the plot costs chart height.
  const short = useMediaQuery("(max-height: 520px)");

  const activeFeatures = fullscreen ? fullscreenFeatures : features;
  const compareQ = useCompareSeries(activeFeatures.compare ? compareItems : [], period, prefs.currency);
  const compareSeries = useMemo<CompareSeries[]>(
    () =>
      compareItems.flatMap((item, i) => {
        const data = compareQ.series[i];
        return data ? [{ symbol: item.symbol, label: item.label, series: data, color: item.color }] : [];
      }),
    [compareItems, compareQ.series],
  );
  const eventsQ = useChartEvents(symbol, locale, kind === "ticker" && activeFeatures.events && prefs.events);
  const chartEvents = kind === "ticker" && activeFeatures.events && prefs.events ? (eventsQ.data ?? []) : [];

  const handleHover = (index: number | null) => {
    setHoverIndex(index);
    onHoverChange?.(index);
  };

  const openFullscreen = () => {
    setFullscreen(true);
    setView(null);
    handleHover(null);
    // Real full screen hides the browser chrome; the whole document goes full screen so the
    // menus (portalled to <body>) stay visible. iPhone Safari refuses: the overlay alone remains.
    const root = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && typeof root.requestFullscreen === "function") {
      root
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          nativeFullscreenRef.current = true;
        })
        .catch(() => {});
    }
  };

  const closeFullscreen = () => {
    setFullscreen(false);
    setView(null);
    handleHover(null);
    if (nativeFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    nativeFullscreenRef.current = false;
  };

  // Leaving the browser's full screen (Esc, system gesture) also leaves the chart's.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        setFullscreen(false);
        setView(null);
        setHoverIndex(null);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    const native = nativeFullscreenRef;
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      // Navigating away mid full screen must not leave the next page in it.
      if (native.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      native.current = false;
    };
  }, []);

  const onFullscreenEscape = useEffectEvent(() => closeFullscreen());

  // Full screen: lock page scroll, close on Escape, give focus to the chart and back afterwards.
  useEffect(() => {
    if (!fullscreen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // An open menu or popover takes the Escape first.
      if (document.querySelector("[data-popup-open]")) return;
      onFullscreenEscape();
    };
    document.addEventListener("keydown", onKeyDown);
    const frame = requestAnimationFrame(() => chartRef.current?.focus());
    const card = rootRef.current;
    return () => {
      root.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      cancelAnimationFrame(frame);
      // The card's toolbar is re-mounted on close: hand focus back to its full-screen button.
      requestAnimationFrame(() => card?.querySelector<HTMLElement>('[data-chart-action="fullscreen"]')?.focus());
    };
  }, [fullscreen]);

  // Leaving the card's drawing strip drops a half-chosen tool.
  const setDrawStrip = (open: boolean) => {
    setDrawOpen(open);
    if (!open) setTool("cursor");
  };

  const snapshotAction = (action: "download" | "copy") => {
    const handle = chartRef.current;
    if (!handle) return;
    if (action === "copy") {
      void copyPng(handle.snapshot()).then((ok) => (ok ? toast.success(t("snapshot.copied")) : toast.error(t("snapshot.copyFailed"))));
    } else {
      void handle.snapshot().then((blob) => {
        if (blob) downloadBlob(blob, `${downloadName}${usd ? "-USD" : ""}.png`);
      });
    }
  };

  const addCompare = (choice: CompareChoice) =>
    setCompareItems((items) => {
      if (items.some((item) => item.symbol === choice.symbol)) return items;
      const used = new Set(items.map((item) => item.color));
      const color = [0, 1, 2, 3, 4].find((slot) => !used.has(slot)) ?? 0;
      return [...items, { symbol: choice.symbol, kind: choice.kind, label: choice.label, color }];
    });
  const removeCompare = (symbol: string) => setCompareItems((items) => items.filter((item) => item.symbol !== symbol));

  // Workspace shortcuts; the chart handles its own keys first (arrows, zoom, Escape…).
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    // React events also bubble out of portalled menus: only keys from the chart itself count.
    const target = event.target as Node;
    if (!rootRef.current?.contains(target) && !dialogRef.current?.contains(target)) return;
    if (event.metaKey || event.ctrlKey) return;
    if (event.altKey) {
      if (event.code === "KeyS") {
        snapshotAction("download");
      } else if (event.code === "KeyU") {
        onPrefsChange({ ...prefs, currency: prefs.currency === "USD" ? "TRY" : "USD" });
      } else {
        const next = DRAWING_SHORTCUTS[event.code];
        if (!next) return;
        if (next !== "measure" && !activeFeatures.drawings) return;
        setTool((current) => (current === next ? "cursor" : next));
        if (!fullscreen || narrow) setDrawOpen(true);
      }
      event.preventDefault();
      return;
    }
    if (event.key === "f" || event.key === "F") {
      if (fullscreen) closeFullscreen();
      else openFullscreen();
    } else if (event.key === "/") {
      if (!activeFeatures.indicators) return;
      setIndicatorsOpen(true);
    } else if (event.key === "?") {
      setShortcutsOpen(true);
    } else {
      return;
    }
    event.preventDefault();
  };

  const now = useNow();
  const market = useMarketStatus();
  const clock = now !== null ? formatWallTime(toChartTime(now), "time") : null;
  const intraday = series?.interval === "intraday";
  const hasVolume = series ? series.bars.some((bar) => bar.volume !== null && bar.volume > 0) : false;
  // Panes the chart will actually stack (FinancialChart skips hidden and unavailable ones).
  const paneCount = activeFeatures.indicators
    ? prefs.indicators.filter((config) => {
        const def = INDICATORS[config.kind];
        return def.placement === "pane" && !config.hidden && !(def.requires?.intraday && !intraday) && !(def.requires?.volume && !hasVolume);
      }).length
    : 0;
  const totalHeight = height + paneCount * paneHeight;
  const periodText = periodOptions.find((option) => option.value === (series?.period ?? period))?.title ?? "";

  const renderChart = (mode: "card" | "fullscreen") => {
    // Only a wait the viewer caused is announced; background refreshes swap the data in silently.
    const busy = status.placeholder || (compareItems.length > 0 && compareQ.pending);
    if (status.pending && !series) return <ChartSkeleton height={mode === "fullscreen" ? 480 : height + 44} label={t("chart.loading")} />;
    if (status.error && !series) return <ErrorState compact message={errorMessage} onRetry={status.onRetry} />;
    if (!series || series.bars.length === 0) return <EmptyState compact message={emptyMessage} />;
    return (
      <div className={cn("relative flex min-h-0 flex-col", mode === "fullscreen" && "flex-1")}>
        <div
          className={cn("flex min-h-0 flex-col transition-opacity duration-200", mode === "fullscreen" && "flex-1", status.placeholder && "opacity-50")}
          aria-busy={status.placeholder || undefined}
        >
          <FinancialChart
            handleRef={chartRef}
            series={series}
            type={prefs.type}
            indicators={activeFeatures.indicators ? prefs.indicators : []}
            onIndicatorsChange={activeFeatures.indicators ? (indicators) => onPrefsChange({ ...prefs, indicators }) : undefined}
            volume={prefs.volume}
            compare={compareSeries}
            onCompareRemove={removeCompare}
            baseline={baseline}
            live={live}
            padToSessionEnd={padToSessionEnd}
            height={mode === "fullscreen" ? "fill" : totalHeight}
            paneHeight={paneHeight}
            extremes={prefs.extremes}
            scale={prefs.scale}
            onScaleChange={(scale) => onPrefsChange({ ...prefs, scale })}
            watermark={prefs.watermark ? { title: symbol, subtitle: [name, periodText, usd ? "USD" : null].filter(Boolean).join(" · ") } : null}
            grid={prefs.grid}
            events={chartEvents}
            tool={tool}
            onToolChange={setTool}
            drawings={activeFeatures.drawings ? drawings : undefined}
            onDrawingsChange={activeFeatures.drawings ? setDrawings : undefined}
            drawingsVisible={!prefs.drawingsHidden}
            magnet={prefs.magnet}
            onUndoStateChange={setCanUndo}
            onHoverChange={handleHover}
            onViewChange={setView}
            wheelZoom={mode === "fullscreen" ? "always" : "modifier"}
            ariaLabel={ariaLabel}
            symbol={symbol}
            snapshotTitle={{
              title: name ? `${symbol} · ${name}` : symbol,
              subtitle: [periodText, usd ? t("currency.label") : null, clock ? t("chart.istanbulTime", { time: clock }) : null]
                .filter(Boolean)
                .join(" · "),
            }}
            valueFormatter={formatter}
            onSnapshot={snapshotAction}
          />
        </div>
        {busy ? (
          <span
            role="status"
            className="pointer-events-none absolute right-0 top-0 inline-flex items-center gap-1 rounded-sm bg-card/90 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
            {t("chart.updating")}
          </span>
        ) : null}
      </div>
    );
  };

  const renderBody = (mode: "card" | "fullscreen") => {
    const rail = mode === "fullscreen" && activeFeatures.drawings && !narrow;
    const strip = activeFeatures.drawings && drawOpen && !rail;
    return (
      <>
        {series && series.bars.length > 0 && summary && !(mode === "fullscreen" && short) ? summary({ series, view, hoverIndex }) : null}
        <ChartToolbar
          mode={mode}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          defaults={defaults}
          features={activeFeatures}
          intraday={intraday}
          hasVolume={hasVolume}
          indicatorsOpen={indicatorsOpen}
          onIndicatorsOpenChange={setIndicatorsOpen}
          compare={
            activeFeatures.compare
              ? { items: compareItems, onAdd: addCompare, onRemove: removeCompare, onClear: () => setCompareItems([]), exclude: symbol }
              : null
          }
          drawOpen={strip}
          onDrawOpenChange={setDrawStrip}
          drawingCount={drawings.length}
          showDrawToggle={activeFeatures.drawings && !rail}
          measureOn={tool === "measure"}
          onMeasureChange={(on) => setTool(on ? "measure" : "cursor")}
          tableOn={tableOn}
          onTableChange={setTableOn}
          onFullscreen={openFullscreen}
          zoomed={view !== null && !view.isDefault}
          onZoomIn={() => chartRef.current?.zoomIn()}
          onZoomOut={() => chartRef.current?.zoomOut()}
          onReset={() => chartRef.current?.reset()}
          onSnapshot={snapshotAction}
          onShortcuts={() => setShortcutsOpen(true)}
          compact={narrow}
        />
        {strip ? (
          <DrawingToolbar
            tool={tool}
            onToolChange={setTool}
            orientation="horizontal"
            count={drawings.length}
            hidden={prefs.drawingsHidden}
            onHiddenChange={(hidden) => onPrefsChange({ ...prefs, drawingsHidden: hidden })}
            magnet={prefs.magnet}
            onMagnetChange={(magnet) => onPrefsChange({ ...prefs, magnet })}
            onClearAll={() => chartRef.current?.clearDrawings()}
            onUndo={() => chartRef.current?.undoDrawing()}
            canUndo={canUndo}
            className="-mt-1"
          />
        ) : null}
        {mode === "fullscreen" ? (
          <div className="flex min-h-0 flex-1 gap-3">
            {rail ? (
              <DrawingToolbar
                tool={tool}
                onToolChange={setTool}
                orientation="vertical"
                count={drawings.length}
                hidden={prefs.drawingsHidden}
                onHiddenChange={(hidden) => onPrefsChange({ ...prefs, drawingsHidden: hidden })}
                magnet={prefs.magnet}
                onMagnetChange={(magnet) => onPrefsChange({ ...prefs, magnet })}
                onClearAll={() => chartRef.current?.clearDrawings()}
                onUndo={() => chartRef.current?.undoDrawing()}
                canUndo={canUndo}
                className="-ml-1 shrink-0 border-r border-border pr-2"
              />
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
              {renderChart(mode)}
              {tableOn && series && series.bars.length > 0 ? (
                <ChartDataTable series={series} view={view} symbol={symbol} format={formatter} className="max-h-56 shrink-0" />
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {renderChart(mode)}
            {tableOn && series && series.bars.length > 0 ? <ChartDataTable series={series} view={view} symbol={symbol} format={formatter} /> : null}
          </>
        )}
      </>
    );
  };

  // React events cross the portal: pointer or focus in the full-screen dialog also counts as intent.
  return (
    <div
      ref={rootRef}
      className={cn("flex min-w-0 flex-col gap-3", className)}
      onPointerEnter={onIntent}
      onFocusCapture={onIntent}
      onKeyDown={onKeyDown}
    >
      {fullscreen ? (
        <>
          <div
            className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
            style={{ height: totalHeight + 96 }}
          >
            {t("action.fullscreenShort")}…
          </div>
          {createPortal(
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="fixed inset-0 z-[80] flex flex-col bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]"
            >
              <header className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 sm:px-4", short ? "py-1" : "py-2")}>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <h2 className="font-mono text-[15px] font-semibold tracking-tight text-foreground">{symbol}</h2>
                  {name ? <span className="hidden max-w-[16rem] truncate text-xs text-muted-foreground md:inline">{name}</span> : null}
                  {headline}
                </div>
                <SegmentedControl
                  label={periodLabel}
                  size="sm"
                  value={period}
                  options={periodOptions}
                  onChange={onPeriodChange}
                  className="order-last max-w-full sm:order-none"
                />
                <ToolButton label={t("action.exitFullscreen")} onClick={closeFullscreen} size="md" className="ml-auto">
                  <X />
                </ToolButton>
              </header>
              <div className={cn("flex min-h-0 flex-1 flex-col px-3 sm:px-4", short ? "gap-2 pb-1 pt-2" : "gap-3 pb-2 pt-3")}>{renderBody("fullscreen")}</div>
              <footer className="flex items-center justify-between gap-3 whitespace-nowrap border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground sm:px-4">
                <a
                  href="https://www.tradingview.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate underline-offset-2 hover:underline"
                >
                  {t("attribution")}
                </a>
                <span className="flex shrink-0 items-center gap-3 font-mono tabular-nums">
                  {market ? (
                    <span className="inline-flex items-center gap-1.5" title={t(market.isOpen ? "chart.marketOpen" : "chart.marketClosed")}>
                      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", market.isOpen ? "bg-up" : "bg-muted-foreground/60")} />
                      <span className="hidden sm:inline">{t(market.isOpen ? "chart.marketOpen" : "chart.marketClosed")}</span>
                    </span>
                  ) : null}
                  {clock ? (
                    <span>
                      {t("chart.istanbulTime", { time: clock })}
                      <span className="hidden sm:inline"> (UTC+3)</span>
                    </span>
                  ) : null}
                </span>
              </footer>
            </div>,
            document.body,
          )}
        </>
      ) : (
        renderBody("card")
      )}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/** Footer link required by the Lightweight Charts™ licence (Apache-2.0 NOTICE). */
export function ChartAttribution({ className }: { className?: string }) {
  const { t } = useChartI18n();
  return (
    <a
      href="https://www.tradingview.com/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn("underline-offset-2 hover:text-foreground hover:underline", className)}
    >
      {t("attribution")}
    </a>
  );
}
