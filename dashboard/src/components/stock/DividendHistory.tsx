"use client";

import { useState } from "react";
import { useNow } from "@/hooks/use-now";
import { formatCompact, formatDay, formatNumber, formatPercent } from "@/lib/format";
import { useDividends, useQuote } from "./hooks";
import { useStockI18n } from "./i18n";
import { trailingDividendYield } from "./parsers";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

const VISIBLE_ROWS = 8;

/** TL per share with up to 4 decimals (dividends like 0,1444 TL). */
function perShare(value: number | null): string {
  if (value == null) return formatNumber(null);
  return formatNumber(value, value < 1 ? 4 : 3);
}

/**
 * Cash dividends from İş Yatırım: gross/net TL per share, gross rate on
 * nominal value and total payout. Trailing yield = gross dividends paid in
 * the last 12 months / current price.
 */
export function DividendHistory({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const now = useNow();
  const [expanded, setExpanded] = useState(false);
  const dividendsQ = useDividends(ticker);
  const { quote } = useQuote(ticker);
  const dividends = dividendsQ.data ?? [];
  const trailing = now !== null ? trailingDividendYield(dividends, quote?.last ?? null, now) : null;
  const lastPaid = now !== null ? (dividends.find((d) => d.time <= now) ?? null) : null;
  const visible = expanded ? dividends : dividends.slice(0, VISIBLE_ROWS);

  return (
    <SectionCard title={t("div.title")} footer={t("div.footer")}>
      {dividendsQ.isPending ? (
        <SectionSkeleton rows={6} />
      ) : dividendsQ.isError ? (
        <SectionError error={dividendsQ.error} onRetry={() => void dividendsQ.refetch()} />
      ) : dividends.length === 0 ? (
        <SectionEmpty message={t("div.empty")} />
      ) : (
        <>
          {trailing && trailing.count > 0 ? (
            <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-muted/30 p-3 text-xs">
              <span className="text-muted-foreground">{t("div.trailingYield")}</span>
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">{formatPercent(trailing.yieldPct)}</span>
              <span className="text-muted-foreground">{t("div.trailingPerShare", { amount: perShare(trailing.perShare) })}</span>
            </div>
          ) : trailing ? (
            <p className="mb-4 text-xs text-muted-foreground">
              {lastPaid ? t("div.noTrailing", { date: formatDay(lastPaid.date) }) : t("div.noPaid")}
            </p>
          ) : null}
          <div className="relative -mx-4 overflow-x-auto scrollbar-thin sm:-mx-5">
            <table className="w-full min-w-[30rem] text-xs">
              <thead>
                <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-2 pl-4 pr-3 text-left font-semibold sm:pl-5">{t("div.date")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{t("div.gross")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{t("div.net")}</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">{t("div.grossRate")}</th>
                  <th scope="col" className="py-2 pl-3 pr-4 text-right font-semibold sm:pr-5">{t("div.total")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr key={`${d.date}-${d.grossPerShare}`} className="border-b border-border/20 transition-colors hover:bg-muted/20">
                    <th scope="row" className="whitespace-nowrap py-2 pl-4 pr-3 text-left font-mono font-normal text-muted-foreground sm:pl-5">
                      {formatDay(d.date)}
                      {now !== null && d.time > now ? (
                        <span className="ml-1.5 rounded bg-warn/10 px-1.5 py-0.5 font-sans text-[9px] font-semibold text-warn">{t("div.upcoming")}</span>
                      ) : null}
                    </th>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-foreground">{perShare(d.grossPerShare)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/85">{perShare(d.netPerShare)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground/85">{formatPercent(d.grossRate)}</td>
                    <td className="py-2 pl-3 pr-4 text-right font-mono tabular-nums text-foreground/85 sm:pr-5">{formatCompact(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dividends.length > VISIBLE_ROWS ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {expanded ? t("common.showLess") : t("common.showAllCount", { count: dividends.length })}
            </button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
