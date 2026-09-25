"use client";

import { Info, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketStatus } from "@/hooks/use-market-status";
import { useNow } from "@/hooks/use-now";
import {
  TREND_TEXT_CLASS,
  formatChangePercent,
  formatMarketDate,
  formatPrice,
  formatSigned,
  trendTone,
} from "@/lib/format";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { sessionQuoteTime } from "@/lib/market-hours";
import { cn } from "@/lib/utils";
import { useQuote, useSignals, type IdentityState } from "./hooks";
import { useStockI18n } from "./i18n";
import { InfoPopover, SignalBadge, VoteBar } from "./ui";

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

/** " · " whose leading space is non-breaking, so a wrapped line ends with the dot instead of starting with it. */
const SEPARATOR = " · ";

/** Daily technical summary (TradingView), explicitly labelled as a technical signal, with an explainer. */
function TechnicalSignal({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalsQ = useSignals(ticker);
  const summary = signalsQ.data?.summary ?? null;
  // Hold the chip's place while loading so the header does not jump when it arrives.
  if (signalsQ.isPending) return <Skeleton className="h-7 w-52" />;
  if (!summary?.level) return null;
  return (
    <InfoPopover
      label={t("header.signalInfo")}
      triggerClassName="h-7 border border-border px-2 text-xs pointer-coarse:h-8"
      trigger={
        <>
          <span className="text-muted-foreground">{t("header.technicalSignal")}:</span>
          <SignalBadge level={summary.level} raw={summary.raw} />
          <Info aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        </>
      }
    >
      <p className="mb-1.5 text-[13px] font-semibold text-foreground">{t("header.signalInfoTitle")}</p>
      <p className="mb-3 text-muted-foreground">{t("header.signalInfoBody")}</p>
      <VoteBar buy={summary.buy} neutral={summary.neutral} sell={summary.sell} className="mb-3" />
      <p className="text-[11px] text-muted-foreground">{t("common.notAdvice")}</p>
    </InfoPopover>
  );
}

/**
 * Stock masthead: exchange line, ticker + company name (serif h1 like every page
 * title) and the daily quote. Phones stack identity → quote → technical signal;
 * from md the quote sits on the right, spanning both rows.
 */
export function StockHeader({ ticker, identity }: { ticker: string; identity: IdentityState }) {
  const { t } = useStockI18n();
  const { quote, isPending, isError, updatedAt, refetch } = useQuote(ticker);
  const market = useMarketStatus();
  const now = useNow();
  const tone = trendTone(quote?.change ?? null);
  const TrendIcon = TREND_ICON[tone];
  // Upstream quote time when available, otherwise when we fetched it; with the date once it is not today.
  // The feed keeps stamping quotes after the session, so the time stops at the closing auction.
  const quoteTime = sessionQuoteTime(quote?.updatedAt ?? (updatedAt || null));
  const quoteIsToday = quoteTime === null || now === null || formatMarketDate(quoteTime, "date") === formatMarketDate(now, "date");
  const quoteTimeLabel = quoteTime !== null ? formatMarketDate(quoteTime, quoteIsToday ? "time" : "dayMonthTime") : null;
  const name = identity.identity?.name;
  const legalName = identity.identity?.legalName;

  return (
    <header className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-muted-foreground">
          {t("header.exchange")}
          {identity.status === "found" && !identity.identity.tracked ? ` · ${t("header.notTracked")}` : ""}
        </p>
        <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[28px] font-semibold leading-tight text-foreground md:text-[32px]">
          <span>{ticker}</span>
          {name ? (
            <span className="min-w-0 font-sans text-base font-normal leading-snug text-muted-foreground md:text-lg" title={legalName ?? undefined}>
              {name}
            </span>
          ) : identity.status === "loading" ? (
            <span aria-hidden className="skeleton-shimmer inline-block h-4 w-36 rounded-sm bg-muted/70" />
          ) : null}
        </h1>
      </div>

      <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1 md:max-w-[28rem] md:text-right">
        {isPending ? (
          <div role="status" className="flex flex-col gap-2 md:items-end">
            <span className="sr-only">{t("state.loading")}</span>
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
        ) : quote ? (
          <>
            <p className="flex items-baseline gap-1.5 md:justify-end">
              <AnimatedNumber
                value={quote.last}
                format={formatPrice}
                flash
                className="font-mono text-[28px] font-semibold leading-none text-foreground md:text-[32px]"
              />
              <span className="text-sm text-muted-foreground">TL</span>
            </p>
            <p className={cn("mt-2 flex flex-wrap items-center gap-x-1.5 font-mono text-sm font-medium tabular-nums md:justify-end", TREND_TEXT_CLASS[tone])}>
              <TrendIcon aria-hidden className="h-4 w-4 shrink-0" />
              <AnimatedNumber value={quote.change} format={formatSigned} />
              <span>
                (<AnimatedNumber value={quote.changePct} format={formatChangePercent} />)
              </span>
              <span className="font-sans text-xs font-normal text-muted-foreground">{t("header.today")}</span>
            </p>
            {/* Chunks never break inside; lines break after a "·" (the space before it is non-breaking). */}
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              {/* The market strip shows the session status from sm up. */}
              {market ? (
                <span className="sm:hidden">
                  <span className="whitespace-nowrap">{market.isOpen ? t("header.sessionOpen") : t("header.sessionClosed")}</span>
                  {SEPARATOR}
                </span>
              ) : null}
              <span className="whitespace-nowrap">
                {t("header.prevClose")}: <span className="font-mono tabular-nums text-foreground">{formatPrice(quote.prevClose)}</span>
              </span>
              {quoteTimeLabel ? (
                <>
                  {SEPARATOR}
                  <span className="whitespace-nowrap">{t("header.updatedAt", { time: quoteTimeLabel })}</span>
                </>
              ) : null}
              {SEPARATOR}
              <span className="whitespace-nowrap">{t("header.delayed")}</span>
            </p>
            <ApiDataMeta path={`/market/snapshot?symbols=${ticker}`} showDelay={false} />
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {t("header.liveQuote", {
                price: formatPrice(quote.last),
                change: formatSigned(quote.change),
                percent: formatChangePercent(quote.changePct),
              })}
            </p>
          </>
        ) : isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground md:justify-end">
            <span>{t("header.quoteUnavailable")}</span>
            <button type="button" onClick={refetch} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-coarse:h-8")}>
              {t("state.retry")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-7 flex-wrap items-center gap-2 md:col-start-1 md:row-start-2">
        <TechnicalSignal ticker={ticker} />
      </div>
    </header>
  );
}
