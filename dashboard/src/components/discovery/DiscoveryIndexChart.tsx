"use client";

import { useMemo, useState } from "react";
import { ChartAttribution, ChartWorkspace } from "@/components/charts/ChartWorkspace";
import {
  CHART_PERIODS,
  quoteInSeriesCurrency,
  rangeStats,
  useChartHistory,
  useLiveSeries,
  usePrefetchChartPeriods,
  windowView,
} from "@/components/charts/data";
import { chartPriceFormatter, formatChartChange } from "@/components/charts/format";
import { useChartI18n } from "@/components/charts/i18n";
import { LiveBadge } from "@/components/charts/LiveBadge";
import { useChartPrefs, type ChartPrefs } from "@/components/charts/prefs";
import { formatBarTime } from "@/components/charts/time";
import { requestCurrency, seriesUnit } from "@/components/charts/units";
import { useUnitConversion } from "@/components/charts/use-unit";
import { findQuote, quoteTimeMs, useIndexQuotes } from "@/components/dashboard/queries";
import { ChangeLine, StatItem } from "@/components/dashboard/ui";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketStatus } from "@/hooks/use-market-status";
import { formatChangePercent, formatMarketDate, formatNumber, formatSigned } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { sessionQuoteTime } from "@/lib/market-hours";
import type { ChartPeriod, IndexQuote } from "@/types";

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

const DEFAULT_PREFS: ChartPrefs = {
  type: "area",
  volume: false,
  indicators: [],
  scale: "normal",
  events: false,
  extremes: true,
  targets: false,
  watermark: true,
  grid: true,
  magnet: true,
  drawingsHidden: false,
  unit: "TRY",
};

const CARD_FEATURES = { indicators: false, compare: true, drawings: false, events: false };
const FULLSCREEN_FEATURES = { indicators: true, compare: true, drawings: true, events: false };

type LiveQuote = Pick<IndexQuote, "last" | "change" | "change_percent" | "open" | "high" | "low" | "prev_close" | "timestamp">;

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

export function DiscoveryIndexChart({ symbol, title }: { symbol: string; title: string }) {
  const { t } = useLocale();
  const { t: tc } = useChartI18n();
  const [period, setPeriod] = useState<ChartPeriod>("3mo");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [prefs, setPrefs] = useChartPrefs(`hisse.chart.discovery.${symbol}.v1`, DEFAULT_PREFS);
  const { unit: chosenUnit, pending: conversionPending, error: conversionError, retry: retryConversion, convert } =
    useUnitConversion(prefs.unit, period);
  const currency = requestCurrency(chosenUnit);
  const historyQ = useChartHistory("index", symbol, period, { currency });
  const prefetchPeriods = usePrefetchChartPeriods("index", symbol, currency);
  const quotesQ = useIndexQuotes();

  const history = historyQ.data;
  const quote = mergeQuote(findQuote(quotesQ.data?.quotes, symbol), (history?.info ?? undefined) as Partial<IndexQuote> | undefined);
  const quoteTime = quoteTimeMs(quote);
  const liveLevel = quoteInSeriesCurrency(history, quote.last) ?? null;
  const liveSeries = useLiveSeries(history, liveLevel, quoteTime, true);
  const series = useMemo(() => convert(liveSeries), [convert, liveSeries]);
  const shownPeriod = series?.period ?? period;
  const intraday = shownPeriod === "1d";
  const market = useMarketStatus(quoteTime);
  const live = intraday && market?.isOpen === true;
  const unit = series ? seriesUnit(series) : chosenUnit;
  const lira = unit === "TRY";
  const formatLevel = lira ? formatNumber : chartPriceFormatter(unit);

  const prevClose = !lira
    ? intraday
      ? (series?.referenceClose ?? null)
      : null
    : typeof quote.prev_close === "number" && quote.prev_close > 0
      ? quote.prev_close
      : null;

  const periodWindow = series && series.bars.length > 0 ? windowView(series) : null;
  const stats = series && periodWindow ? rangeStats(series, periodWindow, intraday ? prevClose : null) : null;
  const baselinePrice = intraday ? (prevClose ?? stats?.base ?? null) : (stats?.base ?? null);
  const baseline =
    baselinePrice !== null ? { price: baselinePrice, label: intraday ? tc("baseline.prevClose") : tc("baseline.periodStart") } : null;

  const hovered = hoverIndex !== null && series ? series.bars[hoverIndex] : undefined;
  const level = hovered?.close ?? (lira || unit === "USD" ? liveLevel : null) ?? stats?.last.close ?? null;
  const levelPending = level === null && (quotesQ.isPending || historyQ.isPending);
  const formatChange = (change: number | null | undefined) =>
    lira || change == null || level === null ? formatSigned(change) : formatChartChange(change, level, unit);
  const headerChange = hovered
    ? baselinePrice !== null
      ? hovered.close - baselinePrice
      : null
    : intraday && lira
      ? (quote.change ?? stats?.change ?? null)
      : (stats?.change ?? null);
  const headerPercent = hovered
    ? baselinePrice
      ? ((hovered.close - baselinePrice) / baselinePrice) * 100
      : null
    : intraday && lira
      ? (quote.change_percent ?? stats?.changePercent ?? null)
      : (stats?.changePercent ?? null);

  const updatedAt = sessionQuoteTime(quoteTime) ?? stats?.last.time ?? null;
  const hoverLabel = hovered ? formatBarTime(hovered.time, series?.interval === "intraday" ? "dayMonthTime" : "date") : null;
  const periodOptions = CHART_PERIODS.map((value) => ({
    value,
    label: t(PERIOD_LABEL[value]),
    title: t(PERIOD_DESCRIPTION[value]),
  }));
  const unitTag = lira ? null : (
    <span className="text-xs font-medium text-muted-foreground" title={tc(`unit.long.${unit}`)}>
      {tc(`unit.suffix.${unit}`)}
    </span>
  );

  const statPlaceholder = <Skeleton as="span" className="inline-block h-3 w-16 align-middle" />;
  const statItems: Array<[string, number | null | undefined]> = intraday
    ? [
        [t("index.open"), (lira ? quote.open : null) ?? stats?.first.open],
        [t("index.high"), (lira ? quote.high : null) ?? stats?.high],
        [t("index.low"), (lira ? quote.low : null) ?? stats?.low],
        [t("index.prevClose"), prevClose],
      ]
    : [
        [t("index.periodStart"), stats?.base],
        [shownPeriod === "1y" ? t("index.52wHigh") : t("index.periodHigh"), stats?.high],
        [shownPeriod === "1y" ? t("index.52wLow") : t("index.periodLow"), stats?.low],
      ];

  return (
    <section className="card-surface overflow-hidden" aria-label={`${title} (${symbol})`}>
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="font-mono text-xs font-medium text-muted-foreground">{symbol}</p>
            {levelPending ? (
              <div className="mt-1 flex h-9 items-center gap-3" aria-hidden="true">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3.5 w-20 bg-skeleton/70" />
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 motion-data-in">
                <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                  {level === null ? formatNumber(null) : formatLevel(level)}
                </span>
                {unitTag}
                <ChangeLine change={headerChange} percent={headerPercent} formatChange={formatChange} />
                <span className="text-xs text-muted-foreground">{hoverLabel ?? t(PERIOD_DESCRIPTION[shownPeriod])}</span>
                {live && !hovered ? <LiveBadge label={tc("chart.live")} /> : null}
              </div>
            )}
            {updatedAt !== null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("dashboard.updatedAt", { time: formatMarketDate(updatedAt, "dayMonthTime") })}
              </p>
            )}
          </div>
        </div>

        <div className="contents" onPointerEnter={prefetchPeriods} onFocusCapture={prefetchPeriods}>
          <SegmentedControl
            label={t("chart.periodSelect")}
            variant="underline"
            size="sm"
            value={period}
            onChange={setPeriod}
            options={periodOptions}
            className="-mx-1 mt-3"
          />
        </div>
      </div>

      <div className="px-4 pt-3">
        <ChartWorkspace
          title={title}
          symbol={symbol}
          name={title}
          kind="index"
          ariaLabel={`${title} (${symbol})`}
          series={series}
          status={{
            pending: historyQ.isPending,
            error: historyQ.isError || conversionError,
            placeholder: historyQ.isPlaceholderData || conversionPending,
            onRetry: () => {
              void historyQ.refetch();
              retryConversion();
            },
          }}
          period={period}
          periodOptions={periodOptions}
          periodLabel={t("chart.periodSelect")}
          onPeriodChange={setPeriod}
          prefs={prefs}
          onPrefsChange={setPrefs}
          defaults={DEFAULT_PREFS}
          features={CARD_FEATURES}
          fullscreenFeatures={FULLSCREEN_FEATURES}
          baseline={baseline}
          padToSessionEnd={live}
          height={250}
          onHoverChange={setHoverIndex}
          headline={
            level !== null ? (
              <span className="inline-flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-[15px] font-semibold text-foreground">{formatLevel(level)}</span>
                {unitTag}
                <ChangeLine change={headerChange} percent={headerPercent} formatChange={formatChange} />
              </span>
            ) : null
          }
          emptyMessage={t("dashboard.chartNoData")}
          errorMessage={t("common.dataLoadError")}
          downloadName={`${symbol}-${shownPeriod}`}
          onIntent={prefetchPeriods}
          convertSeries={convert}
        />
      </div>

      <dl className="mx-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border py-3 sm:grid-cols-4">
        {statItems.map(([label, value]) => (
          <StatItem
            key={label}
            label={label}
            value={historyQ.isPending && value == null ? statPlaceholder : value == null ? formatNumber(null) : formatLevel(value)}
          />
        ))}
        {!intraday && (
          <StatItem
            label={t("index.periodReturn")}
            value={historyQ.isPending ? statPlaceholder : formatChangePercent(stats?.changePercent)}
          />
        )}
      </dl>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        <ChartAttribution />
        <ApiDataMeta path={`/market/index/${symbol}`} className="mt-1" />
      </p>
    </section>
  );
}
