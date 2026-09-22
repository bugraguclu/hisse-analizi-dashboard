"use client";

import { useId, useMemo, useState } from "react";
import { LineChart as LineChartIcon, Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TREND_COLOR,
  TREND_TEXT_CLASS,
  formatChangePercent,
  formatCompact,
  formatMarketDate,
  formatNumber,
  formatPrice,
  formatSigned,
  trendTone,
  type MarketDateStyle,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceHistory, useQuote } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { sliceChartWindow } from "./parsers";
import type { ChartPeriod } from "./types";
import { SectionCard, SectionEmpty, SectionError, Segmented } from "./ui";

const PERIODS: Array<{ value: ChartPeriod; short: StockKey; long: StockKey }> = [
  { value: "1d", short: "period.1d", long: "period.1d.long" },
  { value: "5d", short: "period.5d", long: "period.5d.long" },
  { value: "1mo", short: "period.1mo", long: "period.1mo.long" },
  { value: "3mo", short: "period.3mo", long: "period.3mo.long" },
  { value: "6mo", short: "period.6mo", long: "period.6mo.long" },
  { value: "ytd", short: "period.ytd", long: "period.ytd.long" },
  { value: "1y", short: "period.1y", long: "period.1y.long" },
  { value: "5y", short: "period.5y", long: "period.5y.long" },
  { value: "max", short: "period.max", long: "period.max.long" },
];

const TICK_STYLE: Record<ChartPeriod, MarketDateStyle> = {
  "1d": "time",
  "5d": "dayMonth",
  "1mo": "dayMonth",
  "3mo": "dayMonth",
  "6mo": "dayMonth",
  ytd: "dayMonth",
  "1y": "monthYear",
  "5y": "monthYear",
  max: "year",
};

const TOOLTIP_STYLE: Record<ChartPeriod, MarketDateStyle> = {
  "1d": "dayMonthTime",
  "5d": "dayMonthTime",
  "1mo": "date",
  "3mo": "date",
  "6mo": "date",
  ytd: "date",
  "1y": "date",
  "5y": "date",
  max: "monthYear",
};

interface ChartPoint {
  time: number;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  up: boolean;
}

function PriceTooltip({
  active,
  payload,
  period,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  period: ChartPeriod;
}) {
  const { t } = useStockI18n();
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as ChartPoint | undefined;
  if (!point) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-xl">
      <div className="mb-1 text-[11px] text-muted-foreground">{formatMarketDate(point.time, TOOLTIP_STYLE[period])}</div>
      <div className="font-mono text-sm font-bold tabular-nums">{formatPrice(point.close)} TL</div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
        <dt>{t("quote.open")}</dt>
        <dd className="text-right text-foreground">{formatPrice(point.open)}</dd>
        <dt>{t("quote.high")}</dt>
        <dd className="text-right text-foreground">{formatPrice(point.high)}</dd>
        <dt>{t("quote.low")}</dt>
        <dd className="text-right text-foreground">{formatPrice(point.low)}</dd>
        <dt>{t("quote.volume")}</dt>
        <dd className="text-right text-foreground">{formatCompact(point.volume)}</dd>
      </dl>
    </div>
  );
}

export function PriceChartCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const [period, setPeriod] = useState<ChartPeriod>("3mo");
  const historyQ = usePriceHistory(ticker, period);
  const { quote } = useQuote(ticker);
  const gradientId = `price-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // While a new period loads, the previous period's bars stay on screen (placeholder).
  const shownPeriod = historyQ.data?.period ?? period;
  const allBars = historyQ.data?.bars;
  const windowed = useMemo(() => sliceChartWindow(allBars ?? [], shownPeriod), [allBars, shownPeriod]);

  const points: ChartPoint[] = windowed.bars.map((bar) => ({
    time: bar.time,
    close: bar.close,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    volume: bar.volume,
    up: bar.open == null || bar.close >= bar.open,
  }));
  // Intraday: measure against the official previous close, not the last 15-min bar. Other
  // periods: the last close before the window (YTD from the prior year's final close).
  const baseline =
    shownPeriod === "1d" && quote?.prevClose ? quote.prevClose : (historyQ.data?.referenceClose ?? windowed.baseline);
  const lastClose = points.length > 0 ? points[points.length - 1].close : null;
  const change = lastClose != null && baseline ? lastClose - baseline : null;
  const changePct = change != null && baseline ? (change / baseline) * 100 : null;
  const tone = trendTone(change);
  const stroke = TREND_COLOR[tone];
  const highs = points.map((p) => p.high ?? p.close);
  const lows = points.map((p) => p.low ?? p.close);
  const periodHigh = highs.length ? Math.max(...highs) : null;
  const periodLow = lows.length ? Math.min(...lows) : null;
  const hasVolume = points.some((p) => p.volume != null && p.volume > 0);
  const periodMeta = PERIODS.find((p) => p.value === shownPeriod) ?? PERIODS[3];

  const summary =
    lastClose != null
      ? t("chart.ariaSummary", {
          ticker,
          period: t(periodMeta.long),
          price: formatPrice(lastClose),
          change: formatChangePercent(changePct),
        })
      : t("chart.title");

  return (
    <SectionCard
      title={t("chart.title")}
      icon={<LineChartIcon />}
      actions={
        <Segmented
          label={t("chart.periodLabel")}
          value={period}
          onChange={setPeriod}
          size="xs"
          options={PERIODS.map((p) => ({ value: p.value, label: t(p.short), title: t(p.long) }))}
        />
      }
      footer={t("chart.footer")}
    >
      {historyQ.isPending ? (
        <div role="status" className="space-y-3">
          <span className="sr-only">{t("state.loading")}</span>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-[260px] w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : historyQ.isError && !historyQ.data ? (
        <SectionError error={historyQ.error} onRetry={() => void historyQ.refetch()} />
      ) : points.length === 0 ? (
        <SectionEmpty message={t("chart.empty")} />
      ) : (
        <figure aria-label={summary} className="relative m-0">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <span className={cn("font-mono text-sm font-semibold tabular-nums", TREND_TEXT_CLASS[tone])}>
              {formatChangePercent(changePct)}{" "}
              <span className="text-xs">({formatSigned(change)} TL)</span>
            </span>
            <span className="text-muted-foreground">{t("chart.periodChange", { period: t(periodMeta.long) })}</span>
            <span className="text-muted-foreground">
              {t("chart.periodRange")}:{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatPrice(periodLow)} – {formatPrice(periodHigh)}
              </span>
            </span>
            {historyQ.isPlaceholderData || (historyQ.isFetching && !historyQ.isPending) ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground" role="status">
                <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> {t("state.updating")}
              </span>
            ) : null}
          </div>

          <div className={cn("transition-opacity", historyQ.isPlaceholderData && "opacity-60")}>
            <ResponsiveContainer width="100%" height={260} minWidth={0} initialDimension={{ width: 320, height: 260 }}>
              <AreaChart data={points} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} syncId={`price-${ticker}`}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(value: number) => formatMarketDate(value, TICK_STYLE[shownPeriod])}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  interval="preserveStartEnd"
                />
                <YAxis
                  orientation="right"
                  domain={["auto", "auto"]}
                  tickFormatter={(value: number) => formatNumber(value, value >= 1000 ? 0 : 2)}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                />
                {baseline ? (
                  <ReferenceLine y={baseline} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeOpacity={0.6} ifOverflow="extendDomain" />
                ) : null}
                <Tooltip
                  content={(props) => <PriceTooltip active={props.active} payload={props.payload} period={shownPeriod} />}
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3", strokeOpacity: 0.6 }}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={stroke}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: stroke }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
            {hasVolume ? (
              <div aria-hidden>
                <ResponsiveContainer width="100%" height={64} minWidth={0} initialDimension={{ width: 320, height: 64 }}>
                  <BarChart data={points} margin={{ top: 4, right: 62, left: 0, bottom: 0 }} syncId={`price-${ticker}`}>
                    <XAxis dataKey="time" hide />
                    <YAxis hide domain={[0, "dataMax"]} />
                    <Tooltip content={() => null} cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} />
                    <Bar dataKey="volume" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                      {points.map((p) => (
                        <Cell key={p.time} fill={p.up ? TREND_COLOR.up : TREND_COLOR.down} fillOpacity={0.45} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-1 text-[10px] text-muted-foreground">{t("chart.volumeLegend")}</p>
              </div>
            ) : null}
          </div>
        </figure>
      )}
    </SectionCard>
  );
}
