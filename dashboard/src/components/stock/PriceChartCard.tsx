"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChartAttribution, ChartWorkspace, type SummaryState } from "@/components/charts/ChartWorkspace";
import { LineKey } from "@/components/charts/ChartLegend";
import type { CompareSuggestion } from "@/components/charts/ComparePicker";
import { CostEditor, useCostPref } from "@/components/charts/cost";
import {
  CHART_PERIODS,
  quoteInSeriesCurrency,
  rangeStats,
  useChartHistory,
  useLiveSeries,
  usePrefetchChartPeriods,
  windowView,
} from "@/components/charts/data";
import type { ExtraLine, PriceLevel, PriceTargets } from "@/components/charts/FinancialChart";
import { chartPriceFormatter, formatChartChange } from "@/components/charts/format";
import { useChartI18n } from "@/components/charts/i18n";
import { LiveBadge } from "@/components/charts/LiveBadge";
import { presetIndicator, useChartPrefs, type ChartPrefs } from "@/components/charts/prefs";
import { sectorIndexOf } from "@/components/charts/sector-index";
import { formatBarTime } from "@/components/charts/time";
import { totalReturn } from "@/components/charts/total-return";
import type { ChartBar, ChartEvent, ChartSeries, ChartType, ChartUnit, ChartView } from "@/components/charts/types";
import { requestCurrency, seriesUnit } from "@/components/charts/units";
import { useUnitConversion } from "@/components/charts/use-unit";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { useMarketStatus } from "@/hooks/use-market-status";
import { useNow } from "@/hooks/use-now";
import { formatChangePercent, formatCompact, formatMarketDate, formatNumber, formatPrice, formatSigned, trendTone, TREND_TEXT_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCompanySector, useDividends, useEarningsCalendar, usePriceTargets, useQuote, useStockIdentity } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { rebasedDividends } from "./parsers";
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

const BASE_PREFS = {
  scale: "normal",
  events: true,
  extremes: true,
  targets: true,
  watermark: true,
  grid: true,
  magnet: true,
  drawingsHidden: false,
  unit: "TRY",
} as const;
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
const CANDLE_TYPES: ReadonlySet<ChartType> = new Set(["candles", "hollow", "heikin", "bars"]);
const BENCHMARK = { symbol: "XU100", name: "BIST 100" } as const;
/** Largest companies of the stock's sector offered as one-click comparisons. */
const PEER_SUGGESTIONS = 3;
const DAY_MS = 86_400_000;

/** Index of the last bar at or before `time` (ascending bars); -1 when none. */
function barAtOrBefore(bars: readonly ChartBar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The benchmark's % move over the stretch the stock's figure covers: from the period's
 * reference close (or the visible range's base bar) to the shown or hovered bar.
 */
function benchmarkChange(bench: ChartSeries, range: ChartView, baseTime: number | null, endTime: number): number | null {
  // Bar times of the stock and the index may differ by seconds; a minute of slack lines them up.
  const end = barAtOrBefore(bench.bars, endTime + 60_000);
  let base: number | null;
  if (range.isDefault || baseTime === null) {
    base = bench.referenceClose ?? bench.bars[Math.max(0, bench.windowStart - 1)]?.close ?? null;
  } else {
    const at = barAtOrBefore(bench.bars, baseTime + 60_000);
    base = at >= 0 ? bench.bars[at].close : null;
  }
  const last = end >= 0 ? bench.bars[end].close : null;
  return base && last ? ((last - base) / base) * 100 : null;
}

/**
 * Stock price chart. `overview` (/hisse): area + volume for a quick read; `technical`
 * (/teknik): candles with SMA 20/50, RSI and MACD panes. The card shows a short tool row
 * (style, unit, indicators, comparison, "Diğer") and one summary line; full screen has the
 * whole toolset. Both remember the viewer's setup separately.
 *
 * Layers drawn from the stock's own data: BIST 100 over the same stretch (summary), the
 * sector index and peers as one-click comparisons, the analyst target fan, the
 * dividend-reinvested line, the viewer's average cost and the next expected report and
 * dividend. Prices can be shown in lira, dollars, euros, grams of gold or real lira.
 */
export function PriceChartCard({ ticker, variant = "overview" }: { ticker: string; variant?: "overview" | "technical" }) {
  const { t } = useStockI18n();
  const { t: tc } = useChartI18n();
  const technical = variant === "technical";
  const [period, setPeriod] = useState<ChartPeriod>(technical ? "6mo" : "3mo");
  const defaults = technical ? TECHNICAL_DEFAULTS : OVERVIEW_DEFAULTS;
  const [prefs, setPrefs] = useChartPrefs(technical ? "hisse.chart.technical.v2" : "hisse.chart.overview.v2", defaults);
  const {
    unit: chosenUnit,
    pending: conversionPending,
    error: conversionError,
    retry: retryConversion,
    convert,
    baseMonth,
  } = useUnitConversion(prefs.unit, period);
  const currency = requestCurrency(chosenUnit);
  const historyQ = useChartHistory("ticker", ticker, period, { currency });
  const warmPeriods = usePrefetchChartPeriods("ticker", ticker, currency);
  const { quote, updatedAt: quoteFetchedAt } = useQuote(ticker);
  const identity = useStockIdentity(ticker).identity;
  const market = useMarketStatus();
  const now = useNow();

  // The last bar follows the live quote, so the chart ends where the page header's price is
  // (in dollars: the quote over the latest USD/TRY close, what that bar is divided by). Euros,
  // gold and real lira convert the bars after that merge.
  const quoteTime = quote?.updatedAt ?? null;
  const liveLast = quoteInSeriesCurrency(historyQ.data, quote?.last);
  const liveSeries = useLiveSeries(historyQ.data, liveLast, quoteTime ?? quoteFetchedAt, quoteTime !== null);
  const series = useMemo(() => convert(liveSeries), [convert, liveSeries]);
  // What is on screen labels the figures: a lira stand-in stays "TL" while the euro rates load.
  const unit: ChartUnit = series?.unit ?? series?.currency ?? chosenUnit;
  const lira = unit === "TRY";
  const daily = series !== undefined && series.interval !== "intraday";
  const shownPeriod = series?.period ?? period;
  const intraday = shownPeriod === "1d";
  const live = intraday && market?.isOpen === true;
  const formatBarPrice = chartPriceFormatter(unit);
  const suffix = tc(`unit.suffix.${unit}`);
  // The quote's previous close is in lira; in dollars 1D's reference is the previous session's close.
  const prevClose = lira ? (quote?.prevClose ?? null) : intraday ? (series?.referenceClose ?? null) : null;
  const baseline =
    intraday && prevClose
      ? { price: prevClose, label: tc("baseline.prevClose") }
      : series?.referenceClose
        ? { price: series.referenceClose, label: tc("baseline.periodStart") }
        : null;

  // BIST 100 over the same stretch and in the same unit, for the summary's "ahead of / behind the index".
  const benchQ = useChartHistory("index", BENCHMARK.symbol, period, { currency });
  const benchmark = useMemo(() => convert(benchQ.data), [convert, benchQ.data]);

  // One-click comparisons: the market, the sector's index, the sector's largest peers.
  const sectorQ = useCompanySector(ticker);
  const compareSuggestions = useMemo<CompareSuggestion[]>(() => {
    const out: CompareSuggestion[] = [{ symbol: BENCHMARK.symbol, kind: "index", label: BENCHMARK.symbol, name: BENCHMARK.name, hint: tc("bench.market") }];
    const sectorIndex = sectorIndexOf(sectorQ.data?.key);
    if (sectorIndex) out.push({ symbol: sectorIndex.symbol, kind: "index", label: sectorIndex.symbol, name: sectorIndex.name, hint: tc("bench.sector") });
    for (const peer of (sectorQ.data?.peers ?? []).filter((peer) => peer.symbol !== ticker).slice(0, PEER_SUGGESTIONS)) {
      out.push({ symbol: peer.symbol, kind: "ticker", label: peer.symbol, name: peer.name ?? peer.symbol });
    }
    return out;
  }, [sectorQ.data, ticker, tc]);

  // Analyst consensus (today's lira): drawn on lira and real-lira charts of daily or longer bars.
  const targetsQ = usePriceTargets(ticker);
  const targetData = targetsQ.data;
  const targets = useMemo<PriceTargets | null>(() => {
    if (!prefs.targets || !targetData || !daily || !(unit === "TRY" || unit === "REAL")) return null;
    const mean = targetData.mean ?? targetData.median;
    if (!targetData.low || !targetData.high || !mean) return null;
    return { low: targetData.low, mean, high: targetData.high, analysts: targetData.analysts };
  }, [prefs.targets, targetData, daily, unit]);
  const hasTargets = Boolean(targetData && targetData.low && targetData.high && (targetData.mean ?? targetData.median));

  // Dividend-reinvested line (lira charts of daily or longer bars).
  const dividendsQ = useDividends(ticker);
  const dividends = dividendsQ.data;
  const dividendPoints = useMemo(() => (dividends ? rebasedDividends(dividends) : []), [dividends]);
  const withDividends = useMemo(
    () => (series && lira && daily && dividendPoints.length > 0 ? totalReturn(series, dividendPoints) : null),
    [series, lira, daily, dividendPoints],
  );
  const extraLines = useMemo<ExtraLine[] | undefined>(
    () => (withDividends && withDividends.count > 0 ? [{ key: "total-return", label: tc("totalReturn.label"), values: withDividends.values, slot: 3 }] : undefined),
    [withDividends, tc],
  );

  // The viewer's average cost (lira), kept in this browser.
  const [cost, setCost] = useCostPref(ticker);
  const [costOpen, setCostOpen] = useState(false);
  const levels = useMemo<PriceLevel[] | undefined>(
    () => (cost !== null && lira ? [{ price: cost, label: tc("cost.label"), tone: "primary" }] : undefined),
    [cost, lira, tc],
  );

  // Next expected financial report (KAP's calendar) and an announced dividend, after the last bar.
  const earningsQ = useEarningsCalendar(ticker);
  const nextReport = now !== null ? (earningsQ.data?.find((item) => item.time > now) ?? null) : null;
  const nextDividend =
    now !== null ? ((dividends ?? []).filter((row) => row.time > now - DAY_MS).sort((a, b) => a.time - b.time)[0] ?? null) : null;
  const upcoming = useMemo<ChartEvent[] | undefined>(() => {
    if (!daily) return undefined;
    const out: ChartEvent[] = [];
    if (nextReport) {
      out.push({ id: "upcoming-report", kind: "earnings", time: nextReport.time, title: tc("upcoming.earnings"), detail: tc("upcoming.earningsDetail"), url: null });
    }
    if (nextDividend) {
      out.push({
        id: "upcoming-dividend",
        kind: "dividend",
        time: nextDividend.time,
        title: tc("upcoming.dividend"),
        detail: nextDividend.grossPerShare ? tc("upcoming.dividendDetail", { gross: formatNumber(nextDividend.grossPerShare, 2) }) : null,
        url: null,
      });
    }
    return out.length > 0 ? out : undefined;
  }, [daily, nextReport, nextDividend, tc]);

  const periodOptions = CHART_PERIODS.map((value) => ({
    value,
    label: t(PERIOD_LABELS[value].short),
    title: t(PERIOD_LABELS[value].long),
  }));

  const summary = ({ series: shown, view, hoverIndex, mode }: SummaryState) => {
    const range = view ?? windowView(shown);
    // Default 1D window: measure from the official previous close like the page header.
    const stats = rangeStats(
      shown,
      range,
      range.isDefault && shown.period === "1d" ? prevClose : null,
      prefs.type === "area" || prefs.type === "line" || prefs.type === "baseline" ? "close" : "wick",
    );
    if (!stats) return null;
    const shownUnit = seriesUnit(shown);
    const format = chartPriceFormatter(shownUnit);
    const hovered = hoverIndex !== null && hoverIndex >= range.from && hoverIndex <= range.to ? shown.bars[hoverIndex] : null;
    const bar = hovered ?? stats.last;
    const change = bar.close - stats.base;
    const percent = (change / stats.base) * 100;
    const style = shown.interval === "intraday" ? "dayMonthTime" : shown.interval === "monthly" ? "monthYear" : "date";
    const baseLabel = stats.baseTime !== null ? formatBarTime(stats.baseTime, style) : tc(shown.period === "1d" ? "baseline.prevClose" : "baseline.periodStart");
    const label = hovered
      ? `${baseLabel} → ${formatBarTime(hovered.time, style)}`
      : range.isDefault
        ? t(PERIOD_LABELS[shown.period].long)
        : tc("chart.rangeLabel", { from: formatBarTime(stats.first.time, style), to: formatBarTime(stats.last.time, style) });
    // Cards have no legend row: the line carries the price and, while hovering, the bar's figures.
    const card = mode === "card";

    const extras: ReactNode[] = [];
    if (benchmark && benchmark.period === shown.period && seriesUnit(benchmark) === shownUnit && benchmark.bars.length > 0) {
      const bench = benchmarkChange(benchmark, range, stats.baseTime, bar.time);
      if (bench !== null) {
        const diff = percent - bench;
        extras.push(
          <span key="bench" className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-muted-foreground">
            <span>{BENCHMARK.name}</span>
            <span className={cn("font-mono font-medium tabular-nums", TREND_TEXT_CLASS[trendTone(bench)])}>{formatChangePercent(bench)}</span>
            <span aria-hidden>·</span>
            <span className={cn("font-medium", TREND_TEXT_CLASS[trendTone(diff)])}>
              {tc(diff >= 0 ? "bench.ahead" : "bench.behind", { diff: formatNumber(Math.abs(diff), 1) })}
            </span>
          </span>,
        );
      }
    }
    if (withDividends && withDividends.count > 0 && shown === series) {
      const value = withDividends.values[hovered ? (hoverIndex ?? -1) : shown.bars.length - 1];
      if (value != null) {
        extras.push(
          <span key="total-return" className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-muted-foreground">
            <LineKey color="var(--chart-4)" dashed />
            <span>{tc("totalReturn.label")}</span>
            <span className={cn("font-mono font-medium tabular-nums", TREND_TEXT_CLASS[trendTone(value - stats.base)])}>
              {formatChangePercent(((value - stats.base) / stats.base) * 100)}
            </span>
          </span>,
        );
      }
    }
    if (cost !== null && shownUnit === "TRY") {
      const vsCost = ((bar.close - cost) / cost) * 100;
      extras.push(
        <span key="cost" className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-muted-foreground">
          <LineKey color="var(--primary)" dashed />
          <span>
            {tc("cost.label")} {format(cost)}
          </span>
          <span aria-hidden>·</span>
          <span className={cn("font-mono font-medium tabular-nums", TREND_TEXT_CLASS[trendTone(vsCost)])}>{formatChangePercent(vsCost)}</span>
        </span>,
      );
    }
    if (!hovered && now !== null) {
      if (nextDividend) {
        extras.push(
          <span key="next-dividend" className="whitespace-nowrap text-muted-foreground">
            {tc("upcoming.nextDividend", {
              date: formatMarketDate(nextDividend.time, "dayMonth"),
              days: Math.max(0, Math.round((nextDividend.time - now) / DAY_MS)),
              gross: nextDividend.grossPerShare ? formatNumber(nextDividend.grossPerShare, 2) : "—",
            })}
          </span>,
        );
      }
      if (nextReport) {
        extras.push(
          <span key="next-report" className="whitespace-nowrap text-muted-foreground">
            {tc("upcoming.nextReport", { date: formatMarketDate(nextReport.time, "dayMonth"), days: Math.max(0, Math.round((nextReport.time - now) / DAY_MS)) })}
          </span>,
        );
      }
    }
    if (shownUnit === "REAL" && baseMonth && !hovered) {
      extras.push(
        <span key="real" className="whitespace-nowrap text-muted-foreground">
          {tc("unit.long.REAL")} · {tc("unit.realNote", { month: formatMarketDate(`${baseMonth}-15T12:00:00+03:00`, "monthYear") })}
        </span>,
      );
    }

    const candles = CANDLE_TYPES.has(prefs.type) && bar.open !== null;
    return (
      <div className="flex min-h-5 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs" aria-live="off">
        {card ? (
          <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-foreground">
            {format(bar.close)} <span className="text-[11px] font-medium text-muted-foreground">{tc(`unit.suffix.${shownUnit}`)}</span>
          </span>
        ) : null}
        <span className={cn("whitespace-nowrap font-mono text-sm font-semibold tabular-nums", TREND_TEXT_CLASS[trendTone(change)])}>
          {formatChangePercent(percent)} <span className="text-xs font-medium">({formatChartChange(change, stats.last.close, shownUnit)})</span>
        </span>
        <span className="text-muted-foreground">{label}</span>
        {card && hovered && candles ? (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
            {tc("legend.open")} <span className="text-foreground">{format(bar.open ?? bar.close)}</span> {tc("legend.high")}{" "}
            <span className="text-foreground">{format(bar.high ?? bar.close)}</span> {tc("legend.low")}{" "}
            <span className="text-foreground">{format(bar.low ?? bar.close)}</span>
          </span>
        ) : null}
        {card && hovered && hovered.volume !== null && prefs.volume ? (
          <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
            {tc("legend.volume")} <span className="text-foreground">{formatCompact(hovered.volume)}</span>
          </span>
        ) : null}
        {extras}
        {live && !hovered ? <LiveBadge label={tc("chart.live")} /> : null}
      </div>
    );
  };

  const last = series?.bars[series.bars.length - 1];
  const summaryVars = last
    ? {
        ticker,
        period: t(PERIOD_LABELS[shownPeriod].long),
        price: lira ? formatPrice(last.close) : formatBarPrice(last.close),
        change: formatChangePercent(baseline ? ((last.close - baseline.price) / baseline.price) * 100 : null),
      }
    : null;
  const ariaLabel = summaryVars
    ? lira
      ? t("chart.ariaSummary", summaryVars)
      : tc("unit.ariaSummary", { ...summaryVars, unit: tc(`unit.long.${unit}`), suffix })
    : t("chart.title");

  // Full-screen header: the live quote in lira; other units show the last bar, which carries it.
  const quoteTone = trendTone(quote?.change ?? null);
  const headline = !lira ? (
    last ? (
      <span className="inline-flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-[15px] font-semibold text-foreground">
          {formatBarPrice(last.close)} <span className="text-xs font-medium text-muted-foreground">{suffix}</span>
        </span>
        {unit === "USD" && series?.fxRate ? <span className="text-xs text-muted-foreground">USD/TRY {formatNumber(series.fxRate, 4)}</span> : null}
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
          <Segmented label={t("chart.periodLabel")} value={period} onChange={setPeriod} size="xs" options={periodOptions} />
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
          error: historyQ.isError || conversionError,
          // Converting units waits for rates: the lira bars stay dimmed meanwhile.
          placeholder: historyQ.isPlaceholderData || conversionPending,
          onRetry: () => {
            void historyQ.refetch();
            retryConversion();
          },
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
        convertSeries={convert}
        layers={{ targets, levels, extraLines, upcoming }}
        targetsToggle={hasTargets ? { on: prefs.targets, onChange: (on) => setPrefs({ ...prefs, targets: on }) } : null}
        onCostEdit={() => setCostOpen(true)}
        belowToolbar={costOpen ? <CostEditor cost={cost} onSave={setCost} onClose={() => setCostOpen(false)} /> : null}
        compareSuggestions={compareSuggestions}
      />
    </SectionCard>
  );
}
