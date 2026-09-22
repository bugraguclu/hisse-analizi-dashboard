"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketStatus } from "@/hooks/use-market-status";
import {
  TREND_TEXT_CLASS,
  formatChangePercent,
  formatMarketDate,
  formatPrice,
  formatSigned,
  trendTone,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuote, useSignals, type IdentityState } from "./hooks";
import { useStockI18n } from "./i18n";
import { InfoPopover, SignalBadge, VoteBar } from "./ui";

function TrendIcon({ tone }: { tone: "up" | "down" | "flat" }) {
  if (tone === "up") return <TrendingUp aria-hidden className="h-4 w-4" />;
  if (tone === "down") return <TrendingDown aria-hidden className="h-4 w-4" />;
  return <Minus aria-hidden className="h-4 w-4" />;
}

/** Technical summary pill next to the price, explicitly labelled as a technical signal. */
function TechnicalSignalPill({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalsQ = useSignals(ticker);
  const summary = signalsQ.data?.summary ?? null;
  if (!summary?.level) return null;
  return (
    <InfoPopover
      label={t("header.signalInfo")}
      triggerClassName="rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-[11px]"
      trigger={
        <>
          <span className="font-medium text-muted-foreground">{t("header.technicalSignal")}:</span>
          <SignalBadge level={summary.level} raw={summary.raw} />
        </>
      }
    >
      <p className="mb-2 font-semibold text-foreground">{t("header.signalInfoTitle")}</p>
      <p className="mb-2 text-muted-foreground">{t("header.signalInfoBody")}</p>
      <VoteBar buy={summary.buy} neutral={summary.neutral} sell={summary.sell} className="mb-2" />
      <p className="text-[11px] text-muted-foreground">{t("common.notAdvice")}</p>
    </InfoPopover>
  );
}

export function StockHeader({ ticker, identity }: { ticker: string; identity: IdentityState }) {
  const { t } = useStockI18n();
  const { quote, isPending, isError, updatedAt, refetch } = useQuote(ticker);
  const market = useMarketStatus();
  const tone = trendTone(quote?.change ?? null);
  // Upstream quote time when available, otherwise when we fetched it.
  const quoteTime = quote?.updatedAt ?? (updatedAt || null);
  const name = identity.identity?.name;
  const legalName = identity.identity?.legalName;

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary"
        >
          {ticker.slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{ticker}</h1>
            {identity.status === "loading" ? (
              <Skeleton className="h-4 w-36" />
            ) : name ? (
              <span className="truncate text-sm font-medium text-muted-foreground" title={legalName ?? undefined}>
                {name}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("header.exchange")}
            {identity.status === "found" && !identity.identity.tracked ? ` · ${t("header.notTracked")}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 md:items-end" aria-live="polite">
        {isPending ? (
          <div role="status" className="space-y-2">
            <span className="sr-only">{t("state.loading")}</span>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        ) : quote ? (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-foreground">{formatPrice(quote.last)}</span>
              <span className="text-sm font-medium text-muted-foreground">TL</span>
            </div>
            <div className={cn("flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums", TREND_TEXT_CLASS[tone])}>
              <TrendIcon tone={tone} />
              <span>{formatSigned(quote.change)}</span>
              <span>({formatChangePercent(quote.changePct)})</span>
              <span className="font-sans text-[11px] font-medium text-muted-foreground">{t("header.today")}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {market ? (market.isOpen ? t("header.sessionOpen") : t("header.sessionClosed")) : null}
              {market ? " · " : null}
              {t("header.prevClose")}: <span className="font-mono tabular-nums">{formatPrice(quote.prevClose)}</span>
              {quoteTime ? ` · ${t("header.updatedAt", { time: formatMarketDate(quoteTime, "time") })}` : null}
            </p>
          </>
        ) : isError ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" role="alert">
            <span>{t("header.quoteUnavailable")}</span>
            <button
              type="button"
              onClick={refetch}
              className="rounded-md border border-border/60 px-2 py-1 font-medium text-primary hover:bg-muted/50"
            >
              {t("state.retry")}
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <TechnicalSignalPill ticker={ticker} />
          <span className="text-[10px] text-muted-foreground">{t("header.delayed")}</span>
        </div>
      </div>
    </header>
  );
}
