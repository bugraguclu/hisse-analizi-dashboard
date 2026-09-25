"use client";

import type { ReactNode } from "react";
import { formatChangePercent, formatCompact, formatSigned, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChartI18n, type ChartKey } from "./i18n";
import { barLabelStyle, formatBarTime } from "./time";
import type { ChartBar, ChartSeries, OverlayKey } from "./types";

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

export interface LegendOverlayValue {
  key: OverlayKey | "bbUpper" | "bbLower";
  label: string;
  color: string;
  dashed?: boolean;
  value: number | null;
}

export interface LegendCompare {
  label: string;
  color: string;
  mainPercent: number | null;
  comparePercent: number | null;
}

/**
 * One-line OHLC readout above the canvas (TradingView-style legend): follows the
 * crosshair, falls back to the latest bar. Values lead, labels are muted.
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
  baseline,
  compare,
  hovering,
}: {
  series: ChartSeries;
  index: number;
  symbol: string;
  mainColor: string;
  format: (value: number) => string;
  showOhlc: boolean;
  showVolume: boolean;
  overlays: LegendOverlayValue[];
  baseline: { label: string; price: number } | null;
  compare: LegendCompare | null;
  hovering: boolean;
}) {
  const { t } = useChartI18n();
  const bar: ChartBar | undefined = series.bars[index];
  if (!bar) return <div className="min-h-9" />;
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
    <div className="min-h-9 space-y-0.5 font-mono text-[11px] leading-4 tabular-nums" aria-hidden>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={cn("whitespace-nowrap font-sans font-semibold", hovering ? "text-foreground" : "text-muted-foreground")}>
          {formatBarTime(bar.time, barLabelStyle(series.interval))}
        </span>
        {showOhlc && bar.open !== null ? (
          ohlc.map(([short, long, value]) => (
            <Item key={short} label={<abbr title={t(long)} className="no-underline">{t(short)}</abbr>} value={value === null ? "—" : format(value)} />
          ))
        ) : (
          <Item label={symbol} value={format(bar.close)} />
        )}
        {change !== null ? (
          <span className={cn("whitespace-nowrap font-medium", TREND_TEXT_CLASS[tone])}>
            {formatSigned(change)} ({formatChangePercent(changePercent)})
          </span>
        ) : null}
        {showVolume && bar.volume !== null ? <Item label={t("legend.volume")} value={formatCompact(bar.volume)} /> : null}
      </div>
      {overlays.length > 0 || baseline || compare ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          {compare ? (
            <>
              <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                <LineKey color={mainColor} />
                <span className="text-muted-foreground">{symbol}</span>
                <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(compare.mainPercent)])}>{formatChangePercent(compare.mainPercent)}</span>
              </span>
              <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                <LineKey color={compare.color} />
                <span className="text-muted-foreground">{compare.label}</span>
                <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(compare.comparePercent)])}>
                  {formatChangePercent(compare.comparePercent)}
                </span>
              </span>
            </>
          ) : null}
          {overlays.map((overlay) => (
            <span key={overlay.key} className="inline-flex items-baseline gap-1 whitespace-nowrap">
              <LineKey color={overlay.color} dashed={overlay.dashed} />
              <span className="text-muted-foreground">{overlay.label}</span>
              <span className="font-medium text-foreground">{overlay.value === null ? "—" : format(overlay.value)}</span>
            </span>
          ))}
          {baseline ? (
            <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
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
