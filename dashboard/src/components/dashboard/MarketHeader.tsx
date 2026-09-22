"use client";

import { useLocale } from "@/lib/locale-context";
import { formatMarketDate } from "@/lib/format";
import type { MarketPhase } from "@/lib/market-hours";
import type { TranslationKey } from "@/lib/i18n";
import { useNow } from "@/hooks/use-now";
import { useMarketStatus } from "@/hooks/use-market-status";
import { cn } from "@/lib/utils";
import { findQuote, quoteTimeMs, useIndexQuotes } from "./queries";

const PHASE_HINT: Partial<Record<MarketPhase, TranslationKey>> = {
  preOpen: "market.preOpen",
  afterClose: "market.afterClose",
  weekend: "market.weekend",
  noTrading: "market.noTrading",
};

/** Page title with the Istanbul date and the BIST session status. */
export function MarketHeader() {
  const { t } = useLocale();
  const now = useNow();
  const quotesQ = useIndexQuotes();
  const quoteAt = quoteTimeMs(findQuote(quotesQ.data?.quotes, "XU100"));
  const status = useMarketStatus(quoteAt);
  const hintKey = status ? PHASE_HINT[status.phase] : undefined;

  return (
    <div className="flex flex-col gap-1">
      {now === null ? (
        <div className="h-5 w-40 animate-pulse rounded bg-muted/50" aria-hidden="true" />
      ) : (
        <p className="text-sm capitalize text-muted-foreground">{formatMarketDate(now, "weekdayLong")}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("dashboard.marketOverview")}</h1>
        {status && (
          <span
            title={t("dashboard.sessionHours")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              status.isOpen ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", status.isOpen ? "animate-pulse bg-emerald-500" : "bg-muted-foreground")}
            />
            {status.isOpen ? t("dashboard.marketOpen") : t("dashboard.marketClosed")}
            {hintKey && <span className="font-normal opacity-80">· {t(hintKey)}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
