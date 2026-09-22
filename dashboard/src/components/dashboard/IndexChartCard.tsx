"use client";

import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocale } from "@/lib/locale-context";
import { formatChangePercent, formatMarketDate, formatNumber, TREND_COLOR, trendTone } from "@/lib/format";
import { istanbulClock } from "@/lib/market-hours";
import type { TranslationKey } from "@/lib/i18n";
import type { ChartPeriod, IndexQuote } from "@/types";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { buildSeries, buildTicks, CHART_PERIODS, pointLabel, seriesStats, yDomain, type ChartPoint } from "./chart-data";
import { findQuote, quoteTimeMs, useIndexHistory, useIndexQuotes } from "./queries";
import { ChangeLine, DashboardCard, StatItem } from "./ui";

const SYMBOL = "XU100";
const HEADING_ID = "bist100-heading";

const PERIOD_LABEL: Record<ChartPeriod, TranslationKey> = {
  "1d": "period.1d",
  "5d": "period.5d",
  "1mo": "period.1mo",
  "3mo": "period.3mo",
  "6mo": "period.6mo",
  ytd: "period.ytd",
  "1y": "period.1y",
  "5y": "period.5y",
  max: "period.max",
};

const PERIOD_DESCRIPTION: Record<ChartPeriod, TranslationKey> = {
  "1d": "index.today",
  "5d": "index.5days",
  "1mo": "index.1month",
  "3mo": "index.3months",
  "6mo": "index.6months",
  ytd: "index.ytd",
  "1y": "index.1year",
  "5y": "index.5years",
  max: "index.allTime",
};

type LiveQuote = Pick<IndexQuote, "last" | "change" | "change_percent" | "open" | "high" | "low" | "prev_close" | "timestamp">;

/** The indices list is refreshed on its own cadence; the history response embeds a quote too. */
function mergeQuote(primary: IndexQuote | null, embedded: Partial<IndexQuote> | undefined): LiveQuote {
  const pick = <K extends keyof LiveQuote>(key: K): LiveQuote[K] => (primary?.[key] ?? embedded?.[key] ?? null) as LiveQuote[K];
  return {
    last: pick("last"),
    change: pick("change"),
    change_percent: pick("change_percent"),
    open: pick("open"),
    high: pick("high"),
    low: pick("low"),
    prev_close: pick("prev_close"),
    timestamp: pick("timestamp"),
  };
}

export function IndexChartCard({ className }: { className?: string }) {
  const { t, locale } = useLocale();
  const [period, setPeriod] = useState<ChartPeriod>("1d");
  const historyQ = useIndexHistory(SYMBOL, period);
  const quotesQ = useIndexQuotes();
  const now = useNow();
  const gradientId = `bist100-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // While a newly selected period loads, placeholderData still holds the previous
  // period's bars: window and label them with the period they were fetched for.
  const dataPeriod = historyQ.data?.period;
  const shownPeriod: ChartPeriod = CHART_PERIODS.find((p) => p === dataPeriod) ?? period;

  const quote = mergeQuote(findQuote(quotesQ.data?.quotes, SYMBOL), historyQ.data?.info);
  const points = useMemo(() => buildSeries(historyQ.data?.data, shownPeriod), [historyQ.data, shownPeriod]);
  const stats = useMemo(() => seriesStats(points), [points]);
  const { ticks, labels } = useMemo(() => buildTicks(points, shownPeriod, locale), [points, shownPeriod, locale]);

  const intraday = shownPeriod === "1d";
  const level = quote.last ?? stats?.last.close ?? null;
  // Window return is measured from the last close before the window (backend
  // `reference_close`, e.g. the prior year's final close for YTD); the first bar
  // inside the window is only a fallback.
  const referenceClose = historyQ.data?.reference_close;
  const windowBase = typeof referenceClose === "number" && referenceClose > 0 ? referenceClose : null;
  const windowChange = stats ? (windowBase !== null ? stats.last.close - windowBase : stats.change) : null;
  const windowPercent =
    stats && windowBase !== null ? ((stats.last.close - windowBase) / windowBase) * 100 : (stats?.changePercent ?? null);
  // Header change: daily move vs previous close for 1D, window return otherwise.
  const headerChange = intraday ? (quote.change ?? (stats ? stats.last.close - stats.open : null)) : windowChange;
  const headerPercent = intraday
    ? (quote.change_percent ?? (stats && stats.open ? ((stats.last.close - stats.open) / stats.open) * 100 : null))
    : windowPercent;
  const tone = trendTone(headerPercent ?? headerChange);
  const color = TREND_COLOR[tone];
  const baseline = intraday ? (quote.prev_close ?? null) : (windowBase ?? stats?.first.close ?? null);
  const domain = yDomain(points, baseline);

  const updatedAt = quoteTimeMs(quote) ?? stats?.last.t ?? null;
  const todayKey = now !== null ? istanbulClock(now).dateKey : null;
  const showsPastSession = intraday && stats !== null && todayKey !== null && stats.last.day !== todayKey;

  const statItems: Array<[string, number | null | undefined]> = intraday
    ? [
        [t("index.open"), quote.open ?? stats?.open],
        [t("index.high"), quote.high ?? stats?.high],
        [t("index.low"), quote.low ?? stats?.low],
        [t("index.prevClose"), quote.prev_close],
      ]
    : [
        [t("index.periodStart"), stats?.first.close],
        [shownPeriod === "1y" ? t("index.52wHigh") : t("index.periodHigh"), stats?.high],
        [shownPeriod === "1y" ? t("index.52wLow") : t("index.periodLow"), stats?.low],
      ];

  const chartSummary =
    stats && level !== null
      ? `${t("chart.ariaLabel")} · ${t(PERIOD_DESCRIPTION[shownPeriod])}: ${formatNumber(stats.first.close)} → ${formatNumber(stats.last.close)} (${formatChangePercent(stats.changePercent)})`
      : t("chart.ariaLabel");

  return (
    <DashboardCard labelledBy={HEADING_ID} className={className}>
      <div className="px-5 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={HEADING_ID} className="text-sm font-semibold text-muted-foreground">
              BIST 100
            </h2>
            {level === null && (quotesQ.isPending || historyQ.isPending) ? (
              <div className="mt-2 h-9 w-56 animate-pulse rounded-lg bg-muted/40" aria-hidden="true" />
            ) : (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">{formatNumber(level)}</span>
                <ChangeLine change={headerChange} percent={headerPercent} />
                <span className="text-xs text-muted-foreground">
                  {showsPastSession && stats ? formatMarketDate(stats.last.t, "dayMonth") : t(PERIOD_DESCRIPTION[shownPeriod])}
                </span>
              </div>
            )}
            {updatedAt !== null && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t("dashboard.updatedAt", { time: formatMarketDate(updatedAt, "dayMonthTime") })}
              </p>
            )}
          </div>
          {showsPastSession && stats && (
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {t("chart.lastSession")} · {formatMarketDate(stats.last.t, "dayMonth")}
            </span>
          )}
        </div>

        <div role="group" aria-label={t("chart.periodSelect")} className="-mx-1 mt-3 flex overflow-x-auto border-b border-border/40">
          {CHART_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={p === period}
              className={cn(
                "shrink-0 border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                p === period ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(PERIOD_LABEL[p])}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 pt-3 sm:px-3">
        {historyQ.isError && !historyQ.data ? (
          <ErrorState compact message={t("chart.loadError")} onRetry={() => void historyQ.refetch()} />
        ) : historyQ.isPending ? (
          <div className="h-[240px] animate-pulse rounded-xl bg-muted/20" aria-hidden="true" />
        ) : points.length === 0 ? (
          <EmptyState compact message={t("dashboard.chartNoData")} />
        ) : (
          <div
            role="img"
            aria-label={chartSummary}
            aria-busy={historyQ.isPlaceholderData}
            className={cn("h-[240px] transition-opacity", historyQ.isPlaceholderData && "opacity-50")}
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 320, height: 240 }}>
              <AreaChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="var(--color-muted-foreground)" strokeOpacity={0.12} />
                <XAxis
                  dataKey="i"
                  type="number"
                  domain={[0, Math.max(points.length - 1, 1)]}
                  ticks={ticks}
                  interval={0}
                  tickFormatter={(value) => labels.get(Number(value)) ?? ""}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickMargin={8}
                />
                <YAxis
                  orientation="right"
                  domain={domain}
                  tickFormatter={(value) => formatNumber(Number(value), 0)}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickCount={5}
                  width={58}
                />
                {baseline !== null && (
                  <ReferenceLine
                    y={baseline}
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{
                      value: `${intraday ? t("index.prevClose") : t("index.periodStart")} ${formatNumber(baseline)}`,
                      position: "insideTopLeft",
                      fontSize: 9,
                      fill: "var(--color-muted-foreground)",
                    }}
                  />
                )}
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "var(--color-muted-foreground)", strokeOpacity: 0.35 }}
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as ChartPoint | undefined) : undefined;
                    if (!point) return null;
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                        <p className="text-muted-foreground">{pointLabel(point, shownPeriod, locale)}</p>
                        <p className="font-mono font-semibold tabular-nums text-foreground">{formatNumber(point.close)}</p>
                      </div>
                    );
                  }}
                />
                <Area
                  type="linear"
                  dataKey="close"
                  stroke={color}
                  strokeWidth={1.75}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: color, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <dl className="mx-5 mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/40 py-3 sm:grid-cols-4">
        {statItems.map(([label, value]) => (
          <StatItem key={label} label={label} value={formatNumber(value)} />
        ))}
        {!intraday && <StatItem label={t("index.periodReturn")} value={formatChangePercent(stats?.changePercent)} />}
      </dl>
    </DashboardCard>
  );
}
