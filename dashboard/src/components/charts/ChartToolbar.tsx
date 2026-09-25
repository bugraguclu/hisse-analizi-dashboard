"use client";

import type { ReactNode } from "react";
import { Download, Maximize2, Minimize2, RotateCcw, Ruler, Table2, ZoomIn, ZoomOut } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { LineKey } from "./ChartLegend";
import { SERIES_CSS_VAR } from "./colors";
import { useChartI18n, type ChartKey } from "./i18n";
import type { ChartPrefs } from "./prefs";
import type { ChartType, OverlayKey, PaneKey } from "./types";

const TYPES: ReadonlyArray<{ value: ChartType; label: ChartKey; title: ChartKey }> = [
  { value: "area", label: "type.area", title: "type.area.title" },
  { value: "line", label: "type.line", title: "type.line.title" },
  { value: "candles", label: "type.candles", title: "type.candles.title" },
];

const OVERLAY_CHIPS: ReadonlyArray<{ key: OverlayKey; label: ChartKey; slot: number; title: ChartKey; n?: number }> = [
  { key: "ma20", label: "ind.ma20", slot: 0, title: "ind.ma.title", n: 20 },
  { key: "ma50", label: "ind.ma50", slot: 1, title: "ind.ma.title", n: 50 },
  { key: "ma200", label: "ind.ma200", slot: 2, title: "ind.ma.title", n: 200 },
  { key: "bb", label: "ind.bb", slot: 3, title: "ind.bb.title" },
];

const PANE_CHIPS: ReadonlyArray<{ key: PaneKey; label: ChartKey; title: ChartKey }> = [
  { key: "rsi", label: "ind.rsi", title: "ind.rsi.title" },
  { key: "macd", label: "ind.macd", title: "ind.macd.title" },
  { key: "stoch", label: "ind.stoch", title: "ind.stoch.title" },
];

function Chip({
  pressed,
  onClick,
  title,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap transition-colors duration-150",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40",
        pressed
          ? "border-border bg-muted text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  action,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  /** `data-chart-action` hook (e.g. focus returns to the full-screen button). */
  action?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-chart-action={action}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-150 [&>svg]:h-3.5 [&>svg]:w-3.5",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40",
        pressed ? "bg-muted text-foreground ring-1 ring-inset ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface ChartToolbarProps {
  prefs: ChartPrefs;
  onPrefsChange: (next: ChartPrefs) => void;
  /** Which toggles to offer. */
  features: { volume: boolean; overlays: boolean; panes: boolean; compare: boolean };
  compareOn?: boolean;
  onCompareChange?: (on: boolean) => void;
  compareLabel?: string;
  measureOn: boolean;
  onMeasureChange: (on: boolean) => void;
  tableOn: boolean;
  onTableChange: (on: boolean) => void;
  fullscreen: boolean;
  onFullscreenChange: (on: boolean) => void;
  zoomed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onDownload: () => void;
  className?: string;
}

/** Chart type, indicator toggles and view actions — one row that wraps on small screens. */
export function ChartToolbar({
  prefs,
  onPrefsChange,
  features,
  compareOn = false,
  onCompareChange,
  compareLabel,
  measureOn,
  onMeasureChange,
  tableOn,
  onTableChange,
  fullscreen,
  onFullscreenChange,
  zoomed,
  onZoomIn,
  onZoomOut,
  onReset,
  onDownload,
  className,
}: ChartToolbarProps) {
  const { t } = useChartI18n();
  const toggleOverlay = (key: OverlayKey) =>
    onPrefsChange({
      ...prefs,
      overlays: prefs.overlays.includes(key) ? prefs.overlays.filter((k) => k !== key) : [...prefs.overlays, key],
    });
  const togglePane = (key: PaneKey) =>
    onPrefsChange({ ...prefs, panes: prefs.panes.includes(key) ? prefs.panes.filter((k) => k !== key) : [...prefs.panes, key] });
  const hasToggles = features.volume || features.overlays || features.panes || features.compare;

  return (
    <div role="toolbar" aria-label={t("action.toolbar")} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}>
      <SegmentedControl
        label={t("type.label")}
        size="xs"
        value={prefs.type}
        onChange={(type) => onPrefsChange({ ...prefs, type })}
        options={TYPES.map((option) => ({ value: option.value, label: t(option.label), title: t(option.title) }))}
      />
      {hasToggles ? (
        <div className="-mx-1 flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto px-1 scrollbar-none">
          {features.volume ? (
            <Chip pressed={prefs.volume} onClick={() => onPrefsChange({ ...prefs, volume: !prefs.volume })} title={t("ind.volume.title")}>
              <span aria-hidden className="flex h-2.5 items-end gap-px">
                <span className="h-1.5 w-[3px] rounded-[1px] bg-up/70" />
                <span className="h-2.5 w-[3px] rounded-[1px] bg-down/70" />
              </span>
              {t("ind.volume")}
            </Chip>
          ) : null}
          {features.overlays
            ? OVERLAY_CHIPS.map((chip) => (
                <Chip
                  key={chip.key}
                  pressed={prefs.overlays.includes(chip.key) && !compareOn}
                  disabled={compareOn}
                  onClick={() => toggleOverlay(chip.key)}
                  title={compareOn ? t("ind.disabledInCompare") : t(chip.title, chip.n ? { n: chip.n } : undefined)}
                >
                  <LineKey color={SERIES_CSS_VAR[chip.slot]} />
                  {t(chip.label)}
                </Chip>
              ))
            : null}
          {features.panes ? (
            <>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
              {PANE_CHIPS.map((chip) => (
                <Chip key={chip.key} pressed={prefs.panes.includes(chip.key)} onClick={() => togglePane(chip.key)} title={t(chip.title)}>
                  {t(chip.label)}
                </Chip>
              ))}
            </>
          ) : null}
          {features.compare && onCompareChange ? (
            <>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
              <Chip pressed={compareOn} onClick={() => onCompareChange(!compareOn)} title={t("compare.title")}>
                <LineKey color={SERIES_CSS_VAR[0]} />
                {compareLabel ?? t("compare.label")}
              </Chip>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton label={measureOn ? t("action.measureOn") : t("action.measure")} pressed={measureOn} onClick={() => onMeasureChange(!measureOn)}>
          <Ruler />
        </ToolButton>
        <ToolButton label={t("action.zoomOut")} onClick={onZoomOut}>
          <ZoomOut />
        </ToolButton>
        <ToolButton label={t("action.zoomIn")} onClick={onZoomIn}>
          <ZoomIn />
        </ToolButton>
        <ToolButton label={t("action.reset")} onClick={onReset} disabled={!zoomed}>
          <RotateCcw />
        </ToolButton>
        <ToolButton label={tableOn ? t("action.hideTable") : t("action.table")} pressed={tableOn} onClick={() => onTableChange(!tableOn)}>
          <Table2 />
        </ToolButton>
        <ToolButton label={t("action.download")} onClick={onDownload}>
          <Download />
        </ToolButton>
        <ToolButton
          action="fullscreen"
          label={fullscreen ? t("action.exitFullscreen") : t("action.fullscreen")}
          onClick={() => onFullscreenChange(!fullscreen)}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </ToolButton>
      </div>
    </div>
  );
}
