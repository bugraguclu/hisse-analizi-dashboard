"use client";

import { useMarketStatus } from "@/hooks/use-market-status";
import { formatCompact, formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { useFastInfo, useQuote } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionError, Stat } from "./ui";

/** P/E and P/B are meaningless when ≤ 0 (losses / negative equity). */
function positiveMultiple(value: number | null | undefined): string {
  return formatNumber(value != null && value > 0 ? value : null);
}

/**
 * Today's session (open/high/low/previous close/last/volume) plus market
 * statistics from TradingView fast_info. "Son" is shown while the session is
 * open, "Kapanış" after it closes.
 */
export function QuoteStats({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const { quote, isPending: quotePending } = useQuote(ticker);
  const fastQ = useFastInfo(ticker);
  const market = useMarketStatus();
  const fi = fastQ.data ?? null;
  const fastPending = fastQ.isPending;

  const session = [
    { key: "open", label: t("quote.open"), value: formatPrice(quote?.open ?? fi?.open) },
    { key: "high", label: t("quote.high"), value: formatPrice(quote?.high ?? fi?.dayHigh) },
    { key: "low", label: t("quote.low"), value: formatPrice(quote?.low ?? fi?.dayLow) },
    { key: "prev", label: t("quote.prevClose"), value: formatPrice(quote?.prevClose) },
    { key: "last", label: market?.isOpen ? t("quote.last") : t("quote.close"), value: formatPrice(quote?.last) },
    { key: "volume", label: t("quote.volume"), value: formatCompact(quote?.volume ?? fi?.volume) },
    { key: "amount", label: t("quote.amount"), value: formatCompact(fi?.amount) },
  ];

  const stats = [
    { key: "mcap", label: t("stats.marketCap"), value: formatCompact(fi?.marketCap ?? quote?.marketCap) },
    { key: "pe", label: t("stats.pe"), value: positiveMultiple(fi?.pe) },
    { key: "pb", label: t("stats.pb"), value: positiveMultiple(fi?.pb) },
    { key: "hi52", label: t("stats.yearHigh"), value: formatPrice(fi?.yearHigh) },
    { key: "lo52", label: t("stats.yearLow"), value: formatPrice(fi?.yearLow) },
    { key: "avg50", label: t("stats.avg50"), value: formatPrice(fi?.avg50) },
    { key: "avg200", label: t("stats.avg200"), value: formatPrice(fi?.avg200) },
    { key: "float", label: t("stats.freeFloat"), value: formatPercent(fi?.freeFloat, 1) },
    { key: "foreign", label: t("stats.foreignRatio"), value: formatPercent(fi?.foreignRatio, 1) },
  ];

  return (
    <section aria-label={t("quote.sectionLabel")} className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-7">
        {session.map((item) => (
          <Stat
            key={item.key}
            label={item.label}
            value={item.value}
            pending={item.key === "amount" ? fastPending : quotePending && fastPending}
          />
        ))}
      </dl>
      <div className="mt-4 border-t border-border/40 pt-4">
        {fastQ.isError && !fi ? (
          <SectionError compact error={fastQ.error} onRetry={() => void fastQ.refetch()} />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-9">
            {stats.map((item) => (
              <Stat key={item.key} label={item.label} value={item.value} pending={fastPending} />
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
