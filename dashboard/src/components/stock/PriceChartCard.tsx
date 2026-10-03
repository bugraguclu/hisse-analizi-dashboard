"use client";

import { useState } from "react";
import { ChartAttribution, ChartWorkspace, type SummaryState } from "@/components/charts/ChartWorkspace";
import {
  CHART_PERIODS,
  quoteInSeriesCurrency,
  rangeStats,
  useChartHistory,
  useLiveSeries,
  usePrefetchChartPeriods,
  windowView,
} from "@/components/charts/data";
import { useChartI18n } from "@/components/charts/i18n";
import { LiveBadge } from "@/components/charts/LiveBadge";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { presetIndicator, useChartPrefs, type ChartPrefs } from "@/components/charts/prefs";
import { chartPriceFormatter, CURRENCY_UNIT, formatChartChange, formatUsdChartPrice } from "@/components/charts/format";
import { formatBarTime } from "@/components/charts/time";
import { useMarketStatus } from "@/hooks/use-market-status";
import { formatChangePercent, formatNumber, formatPrice, formatSigned, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuote, useStockIdentity } from "./hooks";
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

const BASE_PREFS = { scale: "normal", events: true, extremes: true, watermark: true, grid: true, magnet: true, drawingsHidden: false, currency: "TRY" } as const;
const OVERVIEW_DEFAULTS: ChartPrefs = { ...BASE_PREFS, type: "area", volume: true, indicators: [] };
const TECHNICAL_DEFAULTS: ChartPrefs = {
  ...BASE_PREFS,
  type: "candles",
  volume: true,
  indicators: [
    presetIndicator("sma", { length: 20 }, 0),
    presetIndicator("sma", { length: 50 }, 1),
    presetIndicator("rsi", { length: 14 }, 0),
    presetIndicator("macd", { fast: 12, slow: 26, signal: 9 }, 0),
  ],
};

const CARD_FEATURES = { indicators: true, compare: true, drawings: true, events: true };

/**
 * Stock price chart. `overview` (/hisse): area + volume for a quick read;
 * `technical` (/teknik): candles with SMA 20/50, RSI and MACD panes. Both have
 * the full toolset (seven chart styles, 17 configurable indicators, comparison
 * with indices or stocks, drawing tools, dividend/KAP events, log/% scale,
 * snapshot, full screen) and remember the viewer's setup separately.
 */
export function PriceChartCard({ ticker, variant = "overview" }: { ticker: string; variant?: "overview" | "technical" }) {
  const { t } = useStockI18n();
  const { t: tc } = useChartI18n();
  const technical = variant === "technical";
  const [period, setPeriod] = useState<ChartPeriod>(technical ? "6mo" : "3mo");
  const defaults = technical ? TECHNICAL_DEFAULTS : OVERVIEW_DEFAULTS;
  const [prefs, setPrefs] = useChartPrefs(technical ? "hisse.chart.technical.v2" : "hisse.chart.overview.v2", defaults);
  const historyQ = useChartHistory("ticker", ticker, period, { currency: prefs.currency });
  const warmPeriods = usePrefetchChartPeriods("ticker", ticker, prefs.currency);
  const { quote, updatedAt: quoteFetchedAt } = useQuote(ticker);
  const identity = useStockIdentity(ticker).identity;
  const market = useMarketStatus();

  // The last bar follows the live quote, so the chart ends where the page header's price is
  // (in dollars: the quote over the latest USD/TRY close, what that bar is divided by).
  const quoteTime = quote?.updatedAt ?? null;
  const liveLast = quoteInSeriesCurrency(historyQ.data, quote?.last);
  const series = useLiveSeries(historyQ.data, liveLast, quoteTime ?? quoteFetchedAt, quoteTime !== null);
  const shownPeriod = series?.period ?? period;
  const intraday = shownPeriod === "1d";
  const live = intraday && market?.isOpen === true;
  const usd = series?.currency === "USD";
  const formatBarPrice = chartPriceFormatter(series?.currency ?? "TRY");
  // The quote's previous close is in lira; in dollars 1D's reference is the previous session's close.
  const prevClose = usd ? (intraday ? (series?.referenceClose ?? null) : null) : (quote?.prevClose ?? null);
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
      prefs.type === "area" || prefs.type === "line" || prefs.type === "baseline" ? "close" : "wick",
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
          {formatChangePercent(percent)}{" "}
          <span className="text-xs font-medium">
            ({formatChartChange(change, stats.last.close, shown.currency)} {CURRENCY_UNIT[shown.currency]})
          </span>
        </span>
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">
          {t("chart.periodRange")}:{" "}
          <span className="font-mono tabular-nums text-foreground">
            {chartPriceFormatter(shown.currency)(stats.low)} – {chartPriceFormatter(shown.currency)(stats.high)}
          </span>
        </span>
        {live ? <LiveBadge label={tc("chart.live")} /> : null}
      </div>
    );
  };

  const last = series?.bars[series.bars.length - 1];
  const summaryVars = last
    ? {
        ticker,
        period: t(PERIOD_LABELS[shownPeriod].long),
        price: usd ? formatBarPrice(last.close) : formatPrice(last.close),
        change: formatChangePercent(baseline ? ((last.close - baseline.price) / baseline.price) * 100 : null),
      }
    : null;
  const ariaLabel = summaryVars ? (usd ? tc("currency.ariaSummary", summaryVars) : t("chart.ariaSummary", summaryVars)) : t("chart.title");

  const quoteTone = trendTone(quote?.change ?? null);
  const headline = usd ? (
    last ? (
      <span className="inline-flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-[15px] font-semibold text-foreground">
          {formatUsdChartPrice(last.close)} <span className="text-xs font-medium text-muted-foreground">USD</span>
        </span>
        {series?.fxRate ? <span className="text-xs text-muted-foreground">USD/TRY {formatNumber(series.fxRate, 4)}</span> : null}
        {live ? <LiveBadge label={tc("chart.live")} /> : null}
      </span>
    ) : null
  ) : quote ? (
    <span className="inline-flex items-baseline gap-2 font-mono tabular-nums">
      <span className="text-[15px] font-semibold text-foreground">{formatPrice(quote.last)}</span>
      {quote.change !== null ? (
        <span className={cn("text-xs font-medium", TREND_TEXT_CLASS[quoteTone])}>
          {formatSigned(quote.change)} ({formatChangePercent(quote.changePct)})
        </span>
      ) : null}
      {live ? <LiveBadge label={tc("chart.live")} /> : null}
    </span>
  ) : null;

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
          <ApiDataMeta path={`/market/ticker/${ticker}/history`} className="mt-1" />
        </>
      }
    >
      <ChartWorkspace
        title={`${ticker} · ${t("chart.title")}`}
        symbol={ticker}
        name={identity?.name ?? undefined}
        kind="ticker"
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
        defaults={defaults}
        features={CARD_FEATURES}
        baseline={baseline}
        live={live}
        padToSessionEnd={live}
        height={technical ? 340 : 300}
        summary={summary}
        headline={headline}
        emptyMessage={t("chart.empty")}
        errorMessage={tc("chart.error")}
        downloadName={`${ticker}-${shownPeriod}`}
        onIntent={warmPeriods}
      />
    </SectionCard>
  );
}
