"use client";

import { formatChangePercent, formatCompact, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useChartI18n } from "./i18n";
import { barLabelStyle, formatBarTime } from "./time";
import type { ChartSeries, ChartView } from "./types";

const MAX_ROWS = 400;

/**
 * Table twin of the chart (visible range, newest first): every value the chart
 * shows is reachable without hovering, by keyboard and screen readers.
 */
export function ChartDataTable({
  series,
  view,
  symbol,
  format,
  className,
}: {
  series: ChartSeries;
  view: ChartView | null;
  symbol: string;
  format: (value: number) => string;
  className?: string;
}) {
  const { t } = useChartI18n();
  const { bars } = series;
  const from = Math.max(0, view?.from ?? series.windowStart);
  const to = Math.min(bars.length - 1, view?.to ?? bars.length - 1);
  const indices: number[] = [];
  for (let i = to; i >= from && indices.length < MAX_ROWS; i -= 1) indices.push(i);
  const hasOhlc = bars.some((bar) => bar.open !== null);
  const hasVolume = bars.some((bar) => bar.volume !== null && bar.volume > 0);
  const style = barLabelStyle(series.interval) === "weekdayDate" ? "date" : barLabelStyle(series.interval);
  const truncated = to - from + 1 > MAX_ROWS;

  return (
    <div className={cn("max-h-80 overflow-auto rounded-md border border-border scrollbar-thin", className)}>
      <table className="w-full border-collapse text-right font-mono text-[11px] tabular-nums">
        <caption className="sr-only">{t("table.caption", { symbol })}</caption>
        <thead className="sticky top-0 z-[1] bg-card font-sans text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t("table.date")}
            </th>
            {hasOhlc ? (
              <>
                <th scope="col" className="px-3 py-2 font-medium">{t("legend.openLong")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("legend.highLong")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("legend.lowLong")}</th>
              </>
            ) : null}
            <th scope="col" className="px-3 py-2 font-medium">{t("legend.closeLong")}</th>
            <th scope="col" className="px-3 py-2 font-medium">{t("legend.change")}</th>
            {hasVolume ? <th scope="col" className="px-3 py-2 font-medium">{t("legend.volumeLong")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {indices.map((i) => {
            const bar = bars[i];
            const previous = i > 0 ? bars[i - 1] : null;
            const change = previous ? ((bar.close - previous.close) / previous.close) * 100 : null;
            return (
              <tr key={bar.time} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                <th scope="row" className="px-3 py-1.5 text-left font-sans font-normal text-muted-foreground">
                  {formatBarTime(bar.time, style)}
                </th>
                {hasOhlc ? (
                  <>
                    <td className="px-3 py-1.5">{bar.open === null ? "—" : format(bar.open)}</td>
                    <td className="px-3 py-1.5">{bar.high === null ? "—" : format(bar.high)}</td>
                    <td className="px-3 py-1.5">{bar.low === null ? "—" : format(bar.low)}</td>
                  </>
                ) : null}
                <td className="px-3 py-1.5 font-medium text-foreground">{format(bar.close)}</td>
                <td className={cn("px-3 py-1.5", TREND_TEXT_CLASS[trendTone(change)])}>{formatChangePercent(change)}</td>
                {hasVolume ? <td className="px-3 py-1.5 text-muted-foreground">{formatCompact(bar.volume)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {truncated ? (
        <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">{t("table.truncated", { n: MAX_ROWS })}</p>
      ) : null}
    </div>
  );
}
