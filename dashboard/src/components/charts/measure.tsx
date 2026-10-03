"use client";

import type { IChartApi, ISeriesApi, Logical, SeriesType } from "lightweight-charts";
import { formatChangePercent, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatChartChange, formatSpan } from "./format";
import { seriesUnit } from "./units";
import { useChartI18n } from "./i18n";
import { formatBarTime } from "./time";
import type { ChartBar, ChartSeries } from "./types";

/** Drag-to-measure between two bars (measure tool, or Shift + drag). */
export interface MeasureState {
  start: number;
  end: number;
  dragging: boolean;
}

export interface MeasureGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  plotWidth: number;
  plotHeight: number;
}

export interface MeasureInfo {
  change: number;
  /** `change` signed, with the decimals of the series' prices. */
  changeText: string;
  percent: number;
  bars: number;
  span: string;
  from: string;
  to: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function measureGeometry(
  chart: IChartApi,
  main: ISeriesApi<SeriesType> | undefined,
  measure: MeasureState,
  bars: readonly ChartBar[],
): MeasureGeometry | null {
  const start = bars[measure.start];
  const end = bars[measure.end];
  if (!main || !start || !end) return null;
  const timeScale = chart.timeScale();
  const x1 = timeScale.logicalToCoordinate(measure.start as Logical);
  const x2 = timeScale.logicalToCoordinate(measure.end as Logical);
  const y1 = main.priceToCoordinate(start.close);
  const y2 = main.priceToCoordinate(end.close);
  if (x1 === null || x2 === null || y1 === null || y2 === null) return null;
  return { x1, y1, x2, y2, plotWidth: timeScale.width(), plotHeight: chart.panes()[0]?.getHeight() ?? 0 };
}

export function describeMeasure(measure: MeasureState, bars: readonly ChartBar[], series: ChartSeries, locale: Locale): MeasureInfo | null {
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
    changeText: formatChartChange(change, origin.close, seriesUnit(series)),
    percent: (change / origin.close) * 100,
    bars: b - a,
    span: formatSpan(first.time, last.time, series.interval, locale),
    from: formatBarTime(origin.time, style),
    to: formatBarTime(target.time, style),
  };
}

export function MeasureOverlay({ geometry, info }: { geometry: MeasureGeometry; info: MeasureInfo }) {
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
          {info.changeText} ({formatChangePercent(info.percent)})
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
