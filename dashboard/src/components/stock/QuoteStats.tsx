"use client";

import type { ReactNode } from "react";
import { useMarketStatus } from "@/hooks/use-market-status";
import { formatCompact, formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { useCompanySector, useFastInfo, useQuote } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectorMedianSub } from "./sector-ui";
import { SectionError, Stat } from "./ui";

/** P/E and P/B are meaningless when ≤ 0 (losses / negative equity). */
function positiveMultiple(value: number | null | undefined): number | null {
  return value != null && value > 0 ? value : null;
}

interface StatItem {
  key: string;
  label: string;
  value: string;
  /** Still waiting for a source that can provide this value. */
  pending: boolean;
  /** Small line under the value (the sector median). */
  sub?: ReactNode;
}

/**
 * 3 columns on phones, 4 from a 512px card, one row of 8 from 896px — both
 * groups have 8 stats, so every step fills its rows and the columns line up.
 */
const GRID = "grid grid-cols-3 gap-x-3 gap-y-3.5 @lg:grid-cols-4 @lg:gap-x-5 @4xl:grid-cols-8";

/**
 * Values sit on the bottom line of their cell (labels may wrap). When some stats
 * carry a sub line, the others get an empty one, so the values of a row stay level.
 */
function StatGrid({ items }: { items: StatItem[] }) {
  const anySub = items.some((item) => item.sub !== undefined);
  return (
    <dl className={GRID}>
      {items.map((item) => (
        <Stat
          key={item.key}
          label={item.label}
          value={item.value}
          pending={item.pending}
          sub={item.sub ?? (anySub ? <span aria-hidden>{"\u00a0"}</span> : undefined)}
          wrapLabel
        />
      ))}
    </dl>
  );
}

/**
 * Today's trading (open/high/low/previous close/last, volume, turnover, market
 * value) above valuation multiples, 52-week and average price levels and
 * ownership (TradingView fast_info). "Son" is shown while the session is open,
 * "Kapanış" after it closes.
 */
export function QuoteStats({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const { quote, isPending: quotePending } = useQuote(ticker);
  const fastQ = useFastInfo(ticker);
  const sectorQ = useCompanySector(ticker);
  const market = useMarketStatus();
  const fi = fastQ.data ?? null;
  const fastPending = fastQ.isPending;
  const eitherPending = quotePending || fastPending;

  const item = (key: string, label: string, raw: number | null | undefined, format: (v: number | null) => string, waiting: boolean): StatItem => ({
    key,
    label,
    value: format(raw ?? null),
    pending: raw == null && waiting,
  });
  const percent = (v: number | null) => formatPercent(v, 1);
  // İş Yatırım publishes foreign ownership with two decimals (THYAO 22,95).
  const percent2 = (v: number | null) => formatPercent(v, 2);

  const session: StatItem[] = [
    item("open", t("quote.open"), quote?.open ?? fi?.open, formatPrice, eitherPending),
    item("high", t("quote.high"), quote?.high ?? fi?.dayHigh, formatPrice, eitherPending),
    item("low", t("quote.low"), quote?.low ?? fi?.dayLow, formatPrice, eitherPending),
    item("prev", t("quote.prevClose"), quote?.prevClose ?? fi?.prevClose, formatPrice, eitherPending),
    item("last", market?.isOpen ? t("quote.last") : t("quote.close"), quote?.last, formatPrice, quotePending),
    item("volume", t("quote.volume"), quote?.volume ?? fi?.volume, formatCompact, eitherPending),
    item("amount", t("quote.amount"), fi?.amount, formatCompact, fastPending),
    item("mcap", t("stats.marketCap"), fi?.marketCap ?? quote?.marketCap, formatCompact, eitherPending),
  ];

  // "Sektör: …" under the figures the sector is compared on, in the figure's own format
  // (reserved while the sector loads; none when the sector is too small for a median).
  const sectorSub = (metric: "pe" | "pb" | "foreign_ratio", format: (v: number) => string) =>
    sectorQ.isPending || sectorQ.data?.metrics[metric]?.median != null ? (
      <SectorMedianSub sector={sectorQ.data} metric={metric} format={format} pending={sectorQ.isPending} />
    ) : undefined;
  const valuation: StatItem[] = [
    { ...item("pe", t("stats.pe"), positiveMultiple(fi?.pe), formatNumber, fastPending), sub: sectorSub("pe", formatNumber) },
    { ...item("pb", t("stats.pb"), positiveMultiple(fi?.pb), formatNumber, fastPending), sub: sectorSub("pb", formatNumber) },
    item("float", t("stats.freeFloat"), fi?.freeFloat, percent, fastPending),
    { ...item("foreign", t("stats.foreignRatio"), fi?.foreignRatio, percent2, fastPending), sub: sectorSub("foreign_ratio", percent2) },
    item("hi52", t("stats.yearHigh"), fi?.yearHigh, formatPrice, fastPending),
    item("lo52", t("stats.yearLow"), fi?.yearLow, formatPrice, fastPending),
    item("avg50", t("stats.avg50"), fi?.avg50, formatPrice, fastPending),
    item("avg200", t("stats.avg200"), fi?.avg200, formatPrice, fastPending),
  ];

  return (
    <section aria-label={t("quote.sectionLabel")} className="card-surface @container">
      <div className="px-4 py-4">
        <StatGrid items={session} />
      </div>
      <div className="border-t border-border px-4 py-4">
        {fastQ.isError && !fi ? (
          <SectionError compact error={fastQ.error} onRetry={() => void fastQ.refetch()} />
        ) : (
          <StatGrid items={valuation} />
        )}
      </div>
    </section>
  );
}
