"use client";

import { useLocale } from "@/lib/locale-context";
import { formatNumber } from "@/lib/format";
import { ErrorState } from "@/components/shared/ErrorState";
import { useIndexQuotes } from "./queries";
import { ChangePercent, DashboardCard, RowSkeleton } from "./ui";

const HEADING_ID = "indices-heading";

/** Live quotes for every BIST index the backend tracks. */
export function IndicesGrid({ className }: { className?: string }) {
  const { t } = useLocale();
  const quotesQ = useIndexQuotes();
  const quotes = quotesQ.data?.quotes ?? [];
  const total = quotesQ.data?.indices.length ?? 0;

  return (
    <DashboardCard labelledBy={HEADING_ID} className={className}>
      <div className="flex items-center justify-between border-b border-border/40 px-5 py-4">
        <h2 id={HEADING_ID} className="text-sm font-semibold text-foreground">
          {t("tarama.bistIndices")}
        </h2>
        {quotes.length > 0 && (
          <span className="rounded bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {quotes.length}/{total}
          </span>
        )}
      </div>
      {quotesQ.isPending ? (
        <RowSkeleton rows={3} className="pt-4" />
      ) : quotesQ.isError && quotes.length === 0 ? (
        <ErrorState compact message={t("indices.loadError")} onRetry={() => void quotesQ.refetch()} />
      ) : quotes.length === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">{t("common.noData")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-px bg-border/30 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {quotes.map((quote) => (
            <li key={quote.symbol} className="bg-card px-4 py-3" title={quote.name ?? quote.description ?? quote.symbol}>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {quote.symbol}
                {quote.name && <span className="ml-1 font-normal normal-case tracking-normal">· {quote.name}</span>}
              </p>
              <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-foreground">
                {/* An index level is never 0 — treat it as missing upstream data. */}
                {formatNumber(quote.last !== null && quote.last > 0 ? quote.last : null)}
              </p>
              <ChangePercent value={quote.change_percent} className="text-[11px] font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}
