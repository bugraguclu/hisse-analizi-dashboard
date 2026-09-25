"use client";

import { useState } from "react";
import { ChartAttribution, ChartWorkspace } from "@/components/charts/ChartWorkspace";
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
import { formatBarTime } from "@/components/charts/time";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useMarketStatus } from "@/hooks/use-market-status";
import { useNow } from "@/hooks/use-now";
import { formatChangePercent, formatMarketDate, formatNumber } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { istanbulClock, sessionQuoteTime } from "@/lib/market-hours";
import type { ChartPeriod, IndexQuote } from "@/types";
import { findQuote, quoteTimeMs, useIndexQuotes } from "./queries";
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

const INDEX_DEFAULTS: ChartPrefs = { type: "area", volume: false, overlays: [], panes: [] };
/** The home card stays compact; full screen brings every indicator along. */
const CARD_FEATURES = { volume: false, overlays: false, panes: false, compare: false };
const FULLSCREEN_FEATURES = { volume: true, overlays: true, panes: true, compare: false };

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
  const { t } = useLocale();
  const { t: tc } = useChartI18n();
  const [period, setPeriod] = useState<ChartPeriod>("1d");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [prefs, setPrefs] = useChartPrefs("hisse.chart.index.v1", INDEX_DEFAULTS);
  const historyQ = useChartHistory("index", SYMBOL, period);
  const prefetchPeriods = usePrefetchChartPeriods("index", SYMBOL);
  const quotesQ = useIndexQuotes();
  const now = useNow();

  const history = historyQ.data;
  const quote = mergeQuote(findQuote(quotesQ.data?.quotes, SYMBOL), (history?.info ?? undefined) as Partial<IndexQuote> | undefined);
  const quoteTime = quoteTimeMs(quote);
  // The last bar follows the live level, so the chart ends where the header does.
  const series = useLiveSeries(history, quote.last, quoteTime, true);
  const shownPeriod = series?.period ?? period;
  const intraday = shownPeriod === "1d";
  const market = useMarketStatus(quoteTime);
  const live = intraday && market?.isOpen === true;

  const prevClose = typeof quote.prev_close === "number" && quote.prev_close > 0 ? quote.prev_close : null;
  const periodWindow = series && series.bars.length > 0 ? windowView(series) : null;
  const stats = series && periodWindow ? rangeStats(series, periodWindow, intraday ? prevClose : null) : null;
  const baselinePrice = intraday ? (prevClose ?? stats?.base ?? null) : (stats?.base ?? null);
  const baseline =
    baselinePrice !== null ? { price: baselinePrice, label: intraday ? tc("baseline.prevClose") : tc("baseline.periodStart") } : null;

  // Header: live level and daily/period move, or the hovered bar when scrubbing the chart.
  const hovered = hoverIndex !== null && series ? series.bars[hoverIndex] : undefined;
  const level = hovered?.close ?? quote.last ?? stats?.last.close ?? null;
  const headerChange = hovered
    ? baselinePrice !== null
      ? hovered.close - baselinePrice
      : null
    : intraday
      ? (quote.change ?? stats?.change ?? null)
      : (stats?.change ?? null);
  const headerPercent = hovered
    ? baselinePrice
      ? ((hovered.close - baselinePrice) / baselinePrice) * 100
      : null
    : intraday
      ? (quote.change_percent ?? stats?.changePercent ?? null)
      : (stats?.changePercent ?? null);

  // The feed keeps stamping quotes after the close; the displayed time stops at the closing auction.
  const updatedAt = sessionQuoteTime(quoteTime) ?? stats?.last.time ?? null;
  const todayKey = now !== null ? istanbulClock(now).dateKey : null;
  const showsPastSession = intraday && stats !== null && todayKey !== null && istanbulClock(stats.last.time).dateKey !== todayKey;
  const hoverLabel = hovered ? formatBarTime(hovered.time, series?.interval === "intraday" ? "dayMonthTime" : "date") : null;

  const statItems: Array<[string, number | null | undefined]> = intraday
    ? [
        [t("index.open"), quote.open ?? stats?.first.open],
        [t("index.high"), quote.high ?? stats?.high],
        [t("index.low"), quote.low ?? stats?.low],
        [t("index.prevClose"), prevClose],
      ]
    : [
        [t("index.periodStart"), stats?.base],
        [shownPeriod === "1y" ? t("index.52wHigh") : t("index.periodHigh"), stats?.high],
        [shownPeriod === "1y" ? t("index.52wLow") : t("index.periodLow"), stats?.low],
      ];

  const periodOptions = CHART_PERIODS.map((value) => ({ value, label: t(PERIOD_LABEL[value]), title: t(PERIOD_DESCRIPTION[value]) }));
  const ariaLabel =
    stats && level !== null
      ? `${t("chart.ariaLabel")} · ${t(PERIOD_DESCRIPTION[shownPeriod])}: ${formatNumber(stats.first.close)} → ${formatNumber(stats.last.close)} (${formatChangePercent(stats.changePercent)})`
      : t("chart.ariaLabel");

  return (
    <DashboardCard labelledBy={HEADING_ID} className={className}>
      <div className="px-4 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={HEADING_ID} className="text-[13px] font-semibold text-foreground">
              BIST 100
            </h2>
            {level === null && (quotesQ.isPending || historyQ.isPending) ? (
              <div className="mt-2 h-9 w-56 animate-pulse rounded-md bg-muted/60" aria-hidden="true" />
            ) : (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-3xl font-semibold tracking-tight text-foreground">{formatNumber(level)}</span>
                <ChangeLine change={headerChange} percent={headerPercent} />
                <span className="text-xs text-muted-foreground">
                  {hoverLabel ?? (showsPastSession && stats ? formatMarketDate(stats.last.time, "dayMonth") : t(PERIOD_DESCRIPTION[shownPeriod]))}
                </span>
                {live && !hovered ? <LiveBadge label={tc("chart.live")} /> : null}
              </div>
            )}
            {updatedAt !== null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t("dashboard.updatedAt", { time: formatMarketDate(updatedAt, "dayMonthTime") })}
              </p>
            )}
          </div>
          {showsPastSession && stats && (
            <span className="rounded-sm border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t("chart.lastSession")} · {formatMarketDate(stats.last.time, "dayMonth")}
            </span>
          )}
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
          title="BIST 100"
          symbol={SYMBOL}
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
          periodLabel={t("chart.periodSelect")}
          onPeriodChange={setPeriod}
          prefs={prefs}
          onPrefsChange={setPrefs}
          features={CARD_FEATURES}
          fullscreenFeatures={FULLSCREEN_FEATURES}
          baseline={baseline}
          live={live}
          padToSessionEnd={live}
          height={240}
          onHoverChange={setHoverIndex}
          emptyMessage={t("dashboard.chartNoData")}
          errorMessage={t("chart.loadError")}
          downloadName={`BIST100-${shownPeriod}`}
          onIntent={prefetchPeriods}
        />
      </div>

      <dl className="mx-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border py-3 sm:grid-cols-4">
        {statItems.map(([label, value]) => (
          <StatItem key={label} label={label} value={formatNumber(value)} />
        ))}
        {!intraday && <StatItem label={t("index.periodReturn")} value={formatChangePercent(stats?.changePercent)} />}
      </dl>
      <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
        <ChartAttribution />
        <ApiDataMeta path={`/market/index/${SYMBOL}`} showDelay={false} className="mt-1" />
      </p>
    </DashboardCard>
  );
}
