"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { ChartPeriod } from "@/types";
import { ChartDataTable } from "./ChartDataTable";
import { ChartToolbar, type ChartToolbarProps } from "./ChartToolbar";
import { FinancialChart, type FinancialChartHandle } from "./FinancialChart";
import { formatChartPrice } from "./format";
import { useChartI18n } from "./i18n";
import type { ChartPrefs } from "./prefs";
import type { ChartSeries, ChartView } from "./types";

export type ToolbarFeatures = ChartToolbarProps["features"];

const ALL_FEATURES: ToolbarFeatures = { volume: true, overlays: true, panes: true, compare: true };

export interface WorkspaceStatus {
  /** First load (nothing to show yet). */
  pending: boolean;
  /** Failed with nothing cached. */
  error: boolean;
  /** Showing the previous period while the selected one loads. */
  placeholder: boolean;
  onRetry: () => void;
}

export interface WorkspaceCompare {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  series: ChartSeries | undefined;
  pending: boolean;
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
  ariaLabel: string;
  series: ChartSeries | undefined;
  status: WorkspaceStatus;
  period: ChartPeriod;
  periodOptions: ReadonlyArray<SegmentedOption<ChartPeriod>>;
  periodLabel: string;
  onPeriodChange: (period: ChartPeriod) => void;
  prefs: ChartPrefs;
  onPrefsChange: (next: ChartPrefs) => void;
  /** Toggles offered inside the card; full screen offers `fullscreenFeatures` (default: all). */
  features: ToolbarFeatures;
  fullscreenFeatures?: ToolbarFeatures;
  compare?: WorkspaceCompare | null;
  baseline?: { price: number; label: string } | null;
  live?: boolean;
  padToSessionEnd?: boolean;
  /** Main pane height in px; every indicator pane adds `paneHeight`. */
  height: number;
  paneHeight?: number;
  /** Line above the toolbar (period change, range...) — follows the crosshair. */
  summary?: (state: SummaryState) => ReactNode;
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

/**
 * Card body of an interactive chart: summary line, toolbar, the chart (with a
 * placeholder while a new period loads), the optional data table, and a
 * full-screen mode that brings the whole toolset along.
 */
export function ChartWorkspace({
  title,
  symbol,
  ariaLabel,
  series,
  status,
  period,
  periodOptions,
  periodLabel,
  onPeriodChange,
  prefs,
  onPrefsChange,
  features,
  fullscreenFeatures = ALL_FEATURES,
  compare = null,
  baseline = null,
  live = false,
  padToSessionEnd = false,
  height,
  paneHeight = 110,
  summary,
  onHoverChange,
  emptyMessage,
  errorMessage,
  downloadName,
  valueFormatter = formatChartPrice,
  onIntent,
  className,
}: ChartWorkspaceProps) {
  const { t } = useChartI18n();
  const chartRef = useRef<FinancialChartHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [measureOn, setMeasureOn] = useState(false);
  const [tableOn, setTableOn] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [view, setView] = useState<ChartView | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const handleHover = (index: number | null) => {
    setHoverIndex(index);
    onHoverChange?.(index);
  };

  const openFullscreen = (on: boolean) => {
    setFullscreen(on);
    setView(null);
    handleHover(null);
  };

  // Full screen: lock page scroll, close on Escape, give focus to the chart and back afterwards.
  useEffect(() => {
    if (!fullscreen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFullscreen(false);
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

  const compareSeries = compare?.on ? compare.series : undefined;
  const totalHeight = height + prefs.panes.length * paneHeight;

  const renderBody = (mode: "card" | "fullscreen") => {
    const activeFeatures = mode === "fullscreen" ? fullscreenFeatures : features;
    const chartPrefs: ChartPrefs = {
      ...prefs,
      volume: activeFeatures.volume && prefs.volume,
      overlays: activeFeatures.overlays ? prefs.overlays : [],
      panes: activeFeatures.panes ? prefs.panes : [],
    };
    // Only a wait the viewer caused is announced; background refreshes swap the data in silently.
    const busy = status.placeholder || (compare?.on && compare.pending);
    let chartArea: ReactNode;
    if (status.pending && !series) {
      chartArea = <ChartSkeleton height={mode === "fullscreen" ? 480 : height + 44} label={t("chart.loading")} />;
    } else if (status.error && !series) {
      chartArea = <ErrorState compact message={errorMessage} onRetry={status.onRetry} />;
    } else if (!series || series.bars.length === 0) {
      chartArea = <EmptyState compact message={emptyMessage} />;
    } else {
      chartArea = (
        <div className={cn("relative flex min-h-0 flex-col", mode === "fullscreen" && "flex-1")}>
          <div
            className={cn(
              "flex min-h-0 flex-col transition-opacity duration-200",
              mode === "fullscreen" && "flex-1",
              status.placeholder && "opacity-50",
            )}
            aria-busy={status.placeholder || undefined}
          >
            <FinancialChart
              handleRef={chartRef}
              series={series}
              type={chartPrefs.type}
              overlays={chartPrefs.overlays}
              panes={chartPrefs.panes}
              volume={chartPrefs.volume}
              compare={compareSeries ? { label: compare?.label ?? "", series: compareSeries } : null}
              baseline={baseline}
              live={live}
              padToSessionEnd={padToSessionEnd}
              height={mode === "fullscreen" ? "fill" : height + chartPrefs.panes.length * paneHeight}
              paneHeight={paneHeight}
              measureMode={measureOn}
              onMeasureModeChange={setMeasureOn}
              onHoverChange={handleHover}
              onViewChange={setView}
              wheelZoom={mode === "fullscreen" ? "always" : "modifier"}
              ariaLabel={ariaLabel}
              symbol={symbol}
              valueFormatter={valueFormatter}
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
    }

    return (
      <>
        {series && series.bars.length > 0 && summary ? summary({ series, view, hoverIndex }) : null}
        <ChartToolbar
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          features={activeFeatures}
          compareOn={compare?.on ?? false}
          onCompareChange={compare?.onChange}
          compareLabel={compare?.label}
          measureOn={measureOn}
          onMeasureChange={setMeasureOn}
          tableOn={tableOn}
          onTableChange={setTableOn}
          fullscreen={mode === "fullscreen"}
          onFullscreenChange={openFullscreen}
          zoomed={view !== null && !view.isDefault}
          onZoomIn={() => chartRef.current?.zoomIn()}
          onZoomOut={() => chartRef.current?.zoomOut()}
          onReset={() => chartRef.current?.reset()}
          onDownload={() => chartRef.current?.download(`${downloadName}.png`)}
        />
        {chartArea}
        {tableOn && series && series.bars.length > 0 ? (
          <ChartDataTable
            series={series}
            view={view}
            symbol={symbol}
            format={valueFormatter}
            className={mode === "fullscreen" ? "max-h-56 shrink-0" : undefined}
          />
        ) : null}
      </>
    );
  };

  // React events cross the portal: pointer or focus in the full-screen dialog also counts as intent.
  return (
    <div ref={rootRef} className={cn("flex min-w-0 flex-col gap-3", className)} onPointerEnter={onIntent} onFocusCapture={onIntent}>
      {fullscreen ? (
        <>
          <div
            className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
            style={{ height: totalHeight + 96 }}
          >
            {t("action.fullscreen")}…
          </div>
          {createPortal(
            <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[80] flex flex-col bg-card">
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">{title}</h2>
                <SegmentedControl label={periodLabel} size="sm" value={period} options={periodOptions} onChange={onPeriodChange} />
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">{renderBody("fullscreen")}</div>
              <footer className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                  {t("attribution")}
                </a>
              </footer>
            </div>,
            document.body,
          )}
        </>
      ) : (
        renderBody("card")
      )}
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
