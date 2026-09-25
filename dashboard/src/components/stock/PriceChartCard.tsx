"use client";

import { useState } from "react";
import { ChartAttribution, ChartWorkspace, type SummaryState } from "@/components/charts/ChartWorkspace";
import {
  CHART_PERIODS,
  rangeStats,
  useChartHistory,
  useLiveSeries,
  usePrefetchChartPeriods,
  windowView,
} from "@/components/charts/data";
import { useChartI18n } from "@/components/charts/i18n";
import { LiveBadge } from "@/components/charts/LiveBadge";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { useChartPrefs, type ChartPrefs } from "@/components/charts/prefs";
import { formatChartPrice } from "@/components/charts/format";
import { formatBarTime } from "@/components/charts/time";
import { useMarketStatus } from "@/hooks/use-market-status";
import { formatChangePercent, formatPrice, formatSigned, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuote } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { ChartPeriod } from "./types";
import { SectionCard, Segmented } from "./ui";

const PERIOD_LABELS: Record<ChartPeriod, { short: StockKey; long: StockKey }> = {
  "1d": { short: "period.1d", long: "period.1d.long" },
  "5d": { short: "period.5d", long: "period.5d.long" },
  "1mo": { short: "period.1mo", long: "period.1mo.long" },
  "3mo": { short: "period.3mo", long: "period.3mo.long" },
  "6mo": { short: "period.6mo", long: "period.6mo.long" },
  ytd: { short: "period.ytd", long: "period.ytd.long" },
  "1y": { short: "period.1y", long: "period.1y.long" },
  "5y": { short: "period.5y", long: "period.5y.long" },
  max: { short: "period.max", long: "period.max.long" },
};

const OVERVIEW_DEFAULTS: ChartPrefs = { type: "area", volume: true, overlays: [], panes: [] };
const TECHNICAL_DEFAULTS: ChartPrefs = { type: "candles", volume: true, overlays: ["ma20", "ma50"], panes: ["rsi", "macd"] };

const CARD_FEATURES = { volume: true, overlays: true, panes: true, compare: true };

/**
 * Stock price chart. `overview` (/hisse): area + volume for a quick read;
 * `technical` (/teknik): candles with SMA 20/50, RSI and MACD panes. Both have
 * the full toolset (overlays, panes, XU100 comparison, measure, zoom, table,
 * full screen) and remember the viewer's choices separately.
 */
export function PriceChartCard({ ticker, variant = "overview" }: { ticker: string; variant?: "overview" | "technical" }) {
  const { t } = useStockI18n();
  const { t: tc } = useChartI18n();
  const technical = variant === "technical";
  const [period, setPeriod] = useState<ChartPeriod>(technical ? "6mo" : "3mo");
  const [compareOn, setCompareOn] = useState(false);
  const [prefs, setPrefs] = useChartPrefs(
    technical ? "hisse.chart.technical.v1" : "hisse.chart.overview.v1",
    technical ? TECHNICAL_DEFAULTS : OVERVIEW_DEFAULTS,
  );
  const historyQ = useChartHistory("ticker", ticker, period);
  const compareQ = useChartHistory("index", "XU100", period, { enabled: compareOn });
  const prefetchPeriods = usePrefetchChartPeriods("ticker", ticker);
  const prefetchComparePeriods = usePrefetchChartPeriods("index", "XU100");
  const warmPeriods = () => {
    prefetchPeriods();
    if (compareOn) prefetchComparePeriods();
  };
  const { quote, updatedAt: quoteFetchedAt } = useQuote(ticker);
  const market = useMarketStatus();

  // The last bar follows the live quote, so the chart ends where the page header's price is.
  const quoteTime = quote?.updatedAt ?? null;
  const series = useLiveSeries(historyQ.data, quote?.last, quoteTime ?? quoteFetchedAt, quoteTime !== null);
  const shownPeriod = series?.period ?? period;
  const intraday = shownPeriod === "1d";
  const live = intraday && market?.isOpen === true;
  const prevClose = quote?.prevClose ?? null;
  const baseline =
    intraday && prevClose
      ? { price: prevClose, label: tc("baseline.prevClose") }
      : series?.referenceClose
        ? { price: series.referenceClose, label: tc("baseline.periodStart") }
        : null;

  const periodOptions = CHART_PERIODS.map((value) => ({
    value,
    label: t(PERIOD_LABELS[value].short),
    title: t(PERIOD_LABELS[value].long),
  }));

  const summary = ({ series: shown, view, hoverIndex }: SummaryState) => {
    const range = view ?? windowView(shown);
    // Default 1D window: measure from the official previous close like the page header.
    const stats = rangeStats(
      shown,
      range,
      range.isDefault && shown.period === "1d" ? prevClose : null,
      prefs.type === "candles" ? "wick" : "close",
    );
    if (!stats) return null;
    const hovered = hoverIndex !== null && hoverIndex >= range.from && hoverIndex <= range.to ? shown.bars[hoverIndex] : null;
    const change = (hovered?.close ?? stats.last.close) - stats.base;
    const percent = (change / stats.base) * 100;
    const tone = trendTone(change);
    const style = shown.interval === "intraday" ? "dayMonthTime" : shown.interval === "monthly" ? "monthYear" : "date";
    const baseLabel = stats.baseTime !== null ? formatBarTime(stats.baseTime, style) : tc(shown.period === "1d" ? "baseline.prevClose" : "baseline.periodStart");
    const label = hovered
      ? `${baseLabel} → ${formatBarTime(hovered.time, style)}`
      : range.isDefault
        ? t("chart.periodChange", { period: t(PERIOD_LABELS[shown.period].long) })
        : tc("chart.rangeLabel", { from: formatBarTime(stats.first.time, style), to: formatBarTime(stats.last.time, style) });
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs" aria-live="off">
        <span className={cn("font-mono text-sm font-semibold tabular-nums", TREND_TEXT_CLASS[tone])}>
          {formatChangePercent(percent)} <span className="text-xs font-medium">({formatSigned(change)} TL)</span>
        </span>
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {t("chart.periodRange")}:{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatChartPrice(stats.low)} – {formatChartPrice(stats.high)}
          </span>
        </span>
        {live ? <LiveBadge label={tc("chart.live")} /> : null}
      </div>
    );
  };

  const last = series?.bars[series.bars.length - 1];
  const ariaLabel = last
    ? t("chart.ariaSummary", {
        ticker,
        period: t(PERIOD_LABELS[shownPeriod].long),
        price: formatPrice(last.close),
        change: formatChangePercent(baseline ? ((last.close - baseline.price) / baseline.price) * 100 : null),
      })
    : t("chart.title");

  return (
    <SectionCard
      title={t("chart.title")}
      actions={
        <div className="contents" onPointerEnter={warmPeriods} onFocusCapture={warmPeriods}>
          <Segmented
            label={t("chart.periodLabel")}
            value={period}
            onChange={setPeriod}
            size="xs"
            options={periodOptions}
          />
        </div>
      }
      footer={
        <>
          {t("chart.footer")} <ChartAttribution />
          <ApiDataMeta path={`/market/ticker/${ticker}/history`} showDelay={false} className="mt-1" />
        </>
      }
    >
      <ChartWorkspace
        title={`${ticker} · ${t("chart.title")}`}
        symbol={ticker}
        ariaLabel={ariaLabel}
        series={series}
        status={{
          pending: historyQ.isPending,
          error: historyQ.isError,
          placeholder: historyQ.isPlaceholderData,
          onRetry: () => void historyQ.refetch(),
        }}
        period={period}
        periodOptions={periodOptions}
        periodLabel={t("chart.periodLabel")}
        onPeriodChange={setPeriod}
        prefs={prefs}
        onPrefsChange={setPrefs}
        features={CARD_FEATURES}
        compare={{
          label: "XU100",
          on: compareOn,
          onChange: setCompareOn,
          series: compareQ.data,
          pending: compareOn && (compareQ.isPending || compareQ.isPlaceholderData),
        }}
        baseline={baseline}
        live={live}
        padToSessionEnd={live}
        height={technical ? 340 : 300}
        summary={summary}
        emptyMessage={t("chart.empty")}
        errorMessage={tc("chart.error")}
        downloadName={`${ticker}-${shownPeriod}`}
        onIntent={warmPeriods}
      />
    </SectionCard>
  );
}
