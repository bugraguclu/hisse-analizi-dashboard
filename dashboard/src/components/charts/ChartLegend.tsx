"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { formatChangePercent, formatCompact, formatNumber, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatChartChange } from "./format";
import { seriesUnit } from "./units";
import { useChartI18n, type ChartKey } from "./i18n";
import { IndicatorSettingsPopover } from "./IndicatorSettings";
import { lineCss, localize, toneCss, type IndicatorView } from "./indicator-view";
import { barLabelStyle, formatBarTime } from "./time";
import type { ChartBar, ChartSeries, IndicatorConfig } from "./types";

/** Short coloured stroke that keys a value to its line on the canvas. */
export function LineKey({ color, dashed = false, className }: { color: string; dashed?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-0 w-3 shrink-0 border-t-2 align-middle", dashed && "border-dashed", className)}
      style={{ borderColor: color }}
    />
  );
}

function Item({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground", className)}>{value}</span>
    </span>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-4 w-4 items-center justify-center self-center rounded-sm text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 group-hover:opacity-100 pointer-coarse:opacity-100"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

/**
 * Legend entry of one indicator instance: its label opens the settings
 * (parameters, colour, hide, remove), values follow the crosshair, and a quiet
 * × removes it — TradingView's legend row, in the kit's type scale.
 */
export function IndicatorLegendItem({
  view,
  index,
  onChange,
  onRemove,
}: {
  view: IndicatorView;
  index: number;
  onChange?: (next: IndicatorConfig) => void;
  onRemove?: () => void;
}) {
  const { t, locale } = useChartI18n();
  const { output, config } = view;
  const firstLine = view.def.placement === "overlay" ? output?.lines[0] : undefined;
  const values: ReactNode[] = [];
  if (output) {
    const lines = output.lines.filter((line) => line.values[index] !== null && line.values[index] !== undefined);
    const multi = output.lines.length > 1;
    for (const line of lines.length > 0 ? lines : output.lines.slice(0, 1)) {
      const value = line.values[index];
      const tone = line.tones?.[index] ?? null;
      const color = tone ? toneCss(tone) : lineCss(config, line);
      values.push(
        <span key={line.key} className="inline-flex items-baseline gap-1">
          {multi ? <LineKey color={color} dashed={line.style === "dashed"} className="w-2" /> : null}
          <span className="font-medium text-foreground" title={localize(line.label, locale) ?? undefined}>
            {value === null || value === undefined ? "—" : view.format(value)}
          </span>
        </span>,
      );
    }
    const histogram = output.histogram?.values[index];
    if (output.histogram && histogram !== null && histogram !== undefined) {
      values.push(
        <span key="hist" className={cn("font-medium", TREND_TEXT_CLASS[trendTone(histogram)])}>
          {view.format(histogram)}
        </span>,
      );
    }
  }
  const note =
    view.status === "hidden"
      ? t("ind.hidden")
      : view.status === "needsIntraday"
        ? t("ind.needsIntraday")
        : view.status === "needsVolume"
          ? t("ind.needsVolume")
          : view.status === "suspended"
            ? t("ind.suspended")
            : null;
  const keyColor = firstLine ? lineCss(config, firstLine) : lineCss(config, { colorOffset: 0 });
  const label = (
    <>
      {view.def.placement === "overlay" ? <LineKey color={keyColor} dashed={firstLine?.style === "dashed"} /> : null}
      <span className={cn("text-muted-foreground", view.status !== "ok" && "line-through decoration-muted-foreground/50")}>{view.label}</span>
    </>
  );
  return (
    <span className={cn("group inline-flex items-baseline gap-1.5 whitespace-nowrap", view.status !== "ok" && "opacity-70")}>
      {onChange && onRemove ? (
        <IndicatorSettingsPopover view={view} onChange={onChange} onRemove={onRemove}>
          {label}
        </IndicatorSettingsPopover>
      ) : (
        <span className="inline-flex items-baseline gap-1">{label}</span>
      )}
      {note ? <span className="text-[10px] text-muted-foreground" title={note}>{view.status === "hidden" ? note : "—"}</span> : values}
      {onRemove ? <RemoveButton label={t("ind.removeNamed", { name: view.label })} onClick={onRemove} /> : null}
    </span>
  );
}

export interface LegendCompareItem {
  symbol: string;
  label: string;
  color: string;
  percent: number | null;
}

export interface LegendCompare {
  mainPercent: number | null;
  items: LegendCompareItem[];
  onRemove?: (symbol: string) => void;
}

/**
 * OHLC readout above the canvas (TradingView-style legend): follows the
 * crosshair, falls back to the latest bar. Values lead, labels are muted. The
 * second row keys comparison symbols and price overlays to their lines.
 */
export function ChartLegend({
  series,
  index,
  symbol,
  mainColor,
  format,
  showOhlc,
  showVolume,
  overlays,
  onIndicatorChange,
  onIndicatorRemove,
  baseline,
  compare,
  hovering,
  hideMain = false,
}: {
  series: ChartSeries;
  index: number;
  symbol: string;
  mainColor: string;
  format: (value: number) => string;
  showOhlc: boolean;
  showVolume: boolean;
  overlays: readonly IndicatorView[];
  onIndicatorChange?: (next: IndicatorConfig) => void;
  onIndicatorRemove?: (id: string) => void;
  baseline: { label: string; price: number } | null;
  compare: LegendCompare | null;
  hovering: boolean;
  /** Cards: the date/OHLC row is the card's summary line and the baseline is named on the price axis. */
  hideMain?: boolean;
}) {
  const { t } = useChartI18n();
  const bar: ChartBar | undefined = series.bars[index];
  if (!bar) return hideMain ? null : <div className="min-h-9" />;
  if (hideMain && overlays.length === 0 && !compare) return null;
  const unit = seriesUnit(series);
  const previous = index > 0 ? series.bars[index - 1] : null;
  const change = previous ? bar.close - previous.close : null;
  const changePercent = previous && change !== null ? (change / previous.close) * 100 : null;
  const tone = trendTone(change);
  const ohlc: Array<[ChartKey, ChartKey, number | null]> = [
    ["legend.open", "legend.openLong", bar.open],
    ["legend.high", "legend.highLong", bar.high],
    ["legend.low", "legend.lowLong", bar.low],
    ["legend.close", "legend.closeLong", bar.close],
  ];

  return (
    <div className={cn("space-y-0.5 font-mono text-[11px] leading-4 tabular-nums", !hideMain && "min-h-9")}>
      {hideMain ? null : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" aria-hidden>
          <span className={cn("whitespace-nowrap font-sans font-semibold", hovering ? "text-foreground" : "text-muted-foreground")}>
            {formatBarTime(bar.time, barLabelStyle(series.interval))}
          </span>
          {unit !== "TRY" ? (
            <span
              className="self-center rounded-sm border border-border px-1 font-sans text-[10px] font-medium leading-4 text-muted-foreground"
              title={unit === "USD" && series.fxRate ? t("unit.fxLegend", { rate: formatNumber(series.fxRate, 4) }) : `${t(`unit.long.${unit}`)} · ${t(`unit.hint.${unit}`)}`}
            >
              {t(`unit.short.${unit}`)}
            </span>
          ) : null}
          {showOhlc && bar.open !== null ? (
            ohlc.map(([short, long, value]) => (
              <Item key={short} label={<abbr title={t(long)} className="no-underline">{t(short)}</abbr>} value={value === null ? "—" : format(value)} />
            ))
          ) : (
            <Item label={symbol} value={format(bar.close)} />
          )}
          {change !== null ? (
            <span className={cn("whitespace-nowrap font-medium", TREND_TEXT_CLASS[tone])}>
              {formatChartChange(change, bar.close, unit)} ({formatChangePercent(changePercent)})
            </span>
          ) : null}
          {showVolume && bar.volume !== null ? <Item label={t("legend.volume")} value={formatCompact(bar.volume)} /> : null}
        </div>
      )}
      {overlays.length > 0 || (baseline && !hideMain) || compare ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {compare ? (
            <>
              <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                <LineKey color={mainColor} />
                <span className="text-muted-foreground">{symbol}</span>
                <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(compare.mainPercent)])}>{formatChangePercent(compare.mainPercent)}</span>
              </span>
              {compare.items.map((item) => (
                <span key={item.symbol} className="group inline-flex items-baseline gap-1 whitespace-nowrap">
                  <LineKey color={item.color} />
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(item.percent)])}>{formatChangePercent(item.percent)}</span>
                  {compare.onRemove ? (
                    <RemoveButton label={t("compare.remove", { symbol: item.label })} onClick={() => compare.onRemove?.(item.symbol)} />
                  ) : null}
                </span>
              ))}
            </>
          ) : null}
          {overlays.map((view) => (
            <IndicatorLegendItem
              key={view.config.id}
              view={view}
              index={index}
              onChange={onIndicatorChange}
              onRemove={onIndicatorRemove ? () => onIndicatorRemove(view.config.id) : undefined}
            />
          ))}
          {baseline && !compare && !hideMain ? (
            <span className="inline-flex items-baseline gap-1 whitespace-nowrap" aria-hidden>
              <LineKey color="var(--muted-foreground)" dashed />
              <span className="text-muted-foreground">{baseline.label}</span>
              <span className="font-medium text-foreground">{format(baseline.price)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
