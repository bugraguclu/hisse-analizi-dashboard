"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { TREND_PILL_CLASS, TREND_TEXT_CLASS, formatChangePercent, formatDay, formatPrice, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMovingAverageCross, usePivots, useQuote, useSignals } from "./hooks";
import { useStockI18n } from "./i18n";
import { movingAverageRows } from "./parsers";
import type { Pivots } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, SignalBadge } from "./ui";

/**
 * SMA/EMA values and per-average votes from TradingView's daily technical
 * summary (same source as the signal cards), with the price's distance to
 * each average and the SMA50/SMA200 regime (golden / death cross).
 */
export function MovingAveragesTable({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalsQ = useSignals(ticker);
  const crossQ = useMovingAverageCross(ticker);
  const { quote } = useQuote(ticker);
  const group = signalsQ.data?.movingAverages ?? null;
  const lastCross = crossQ.data ?? null;
  const rows = movingAverageRows(group);
  const price = quote?.last ?? group?.values.close ?? null;
  const sma50 = group?.values.SMA50 ?? null;
  const sma200 = group?.values.SMA200 ?? null;
  const golden = sma50 != null && sma200 != null ? sma50 > sma200 : null;

  return (
    <SectionCard
      title={t("ma.title")}
      actions={
        golden != null ? (
          <span className={cn("rounded-lg px-2 py-1 text-[11px] font-semibold", TREND_PILL_CLASS[golden ? "up" : "down"])}>
            {golden ? t("ma.goldenBadge") : t("ma.deathBadge")}
          </span>
        ) : null
      }
      footer={t("ma.footer")}
    >
      {signalsQ.isPending ? (
        <SectionSkeleton rows={7} />
      ) : signalsQ.isError ? (
        <SectionError error={signalsQ.error} onRetry={() => void signalsQ.refetch()} />
      ) : rows.length === 0 ? (
        <SectionEmpty message={t("ma.empty")} />
      ) : (
        <>
          {golden != null ? (
            <p className="mb-3 text-[11px] text-muted-foreground">
              {golden ? t("ma.golden") : t("ma.death")}
              {lastCross?.date ? (
                <> · {t(lastCross.type === "golden" ? "ma.lastGolden" : "ma.lastDeath", { date: formatDay(lastCross.date) })}</>
              ) : null}
            </p>
          ) : null}
          <div className="relative -mx-4 overflow-x-auto scrollbar-thin sm:-mx-5">
            <table className="w-full min-w-[30rem] text-xs">
              <thead>
                <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="sticky left-0 top-0 z-20 bg-card py-2 pl-4 pr-3 text-left font-semibold sm:pl-5">{t("ma.period")}</th>
                  <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-right font-semibold">SMA</th>
                  <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-right font-semibold">EMA</th>
                  <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-right font-semibold">{t("ma.priceVsSma")}</th>
                  <th scope="col" className="sticky top-0 z-10 bg-card py-2 pl-3 pr-4 text-right font-semibold sm:pr-5">{t("ma.votes")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const distance = price != null && row.sma ? (price / row.sma - 1) * 100 : null;
                  return (
                    <tr key={row.period} className="group border-b border-border/20 transition-colors hover:bg-muted/20">
                      <th scope="row" className="sticky left-0 z-10 bg-card py-2 pl-4 pr-3 text-left font-medium text-foreground group-hover:bg-muted/20 sm:pl-5">
                        {t("ma.days", { count: row.period })}
                      </th>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{formatPrice(row.sma)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{formatPrice(row.ema)}</td>
                      <td className={cn("px-3 py-2 text-right font-mono tabular-nums", TREND_TEXT_CLASS[trendTone(distance)])}>
                        {formatChangePercent(distance)}
                      </td>
                      <td className="py-2 pl-3 pr-4 text-right sm:pr-5">
                        {row.smaVote && row.emaVote && row.smaVote !== row.emaVote ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-muted-foreground">
                            SMA <SignalBadge level={row.smaVote} /> EMA <SignalBadge level={row.emaVote} />
                          </span>
                        ) : row.smaVote || row.emaVote ? (
                          <SignalBadge level={row.smaVote ?? row.emaVote} />
                        ) : (
                          <span className="text-muted-foreground" title={t("ma.noVote")}>
                            —<span className="sr-only"> {t("ma.noVote")}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/** Simple CSS number-line spanning S3…R3 (spaced by value), with a marker for the last price. */
function PivotLadder({ pivots, price }: { pivots: Pivots; price: number | null }) {
  const { t } = useStockI18n();
  const min = pivots.s3 ?? pivots.s2 ?? pivots.s1 ?? pivots.pivot;
  const max = pivots.r3 ?? pivots.r2 ?? pivots.r1 ?? pivots.pivot;
  if (min == null || max == null) return null;
  const span = max - min || 1;
  const pct = (value: number) => Math.min(Math.max(((value - min) / span) * 100, 0), 100);
  const allTicks: Array<[string, number | null]> = [
    ["s2", pivots.s2],
    ["s1", pivots.s1],
    ["pivot", pivots.pivot],
    ["r1", pivots.r1],
    ["r2", pivots.r2],
  ];
  const ticks = allTicks.filter((row): row is [string, number] => row[1] != null);
  const pricePct = price != null ? pct(price) : null;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("pivots.ladderLabel")}</span>
        {price != null ? <span className="font-mono text-xs font-bold tabular-nums text-foreground">{formatPrice(price)}</span> : null}
      </div>
      <div className="relative mt-2.5 h-1.5 rounded-full bg-muted">
        {ticks.map(([key, value]) => (
          <span
            key={key}
            aria-hidden
            className={cn(
              "absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-border",
              key === "pivot" ? "h-3 bg-muted-foreground/70" : "h-2",
            )}
            style={{ left: `${pct(value)}%` }}
          />
        ))}
        {pricePct != null ? (
          <span
            aria-hidden
            title={formatPrice(price)}
            className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${pricePct}%` }}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>
          S3 <span className="text-foreground">{formatPrice(min)}</span>
        </span>
        <span>
          R3 <span className="text-foreground">{formatPrice(max)}</span>
        </span>
      </div>
    </div>
  );
}

/** Classic pivot points (support/resistance) from the backend. */
export function PivotsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const pivotsQ = usePivots(ticker);
  const { quote } = useQuote(ticker);
  const pivots = pivotsQ.data ?? null;
  const price = quote?.last ?? null;
  const levels = (keys: Array<"r1" | "r2" | "r3" | "s1" | "s2" | "s3">) =>
    keys.map((key) => (
      <div key={key} className="flex justify-between gap-2">
        <dt className="uppercase text-muted-foreground">{key}</dt>
        <dd className="font-semibold tabular-nums text-foreground">{formatPrice(pivots?.[key])}</dd>
      </div>
    ));

  return (
    <SectionCard
      title={t("pivots.title")}
      footer={
        pivots?.sessionDate
          ? `${t("pivots.session", { date: formatDay(pivots.sessionDate) })} ${t("pivots.footer")}`
          : t("pivots.footer")
      }
    >
      {pivotsQ.isPending ? (
        <SectionSkeleton rows={4} />
      ) : pivotsQ.isError ? (
        <SectionError error={pivotsQ.error} onRetry={() => void pivotsQ.refetch()} />
      ) : !pivots ? (
        <SectionEmpty message={t("pivots.empty")} />
      ) : (
        <div className="space-y-4">
          <PivotLadder pivots={pivots} price={price} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-2 rounded-lg border border-border/60 bg-surface p-3">
              <div className="flex items-center gap-1 text-xs font-bold text-foreground">
                <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {t("pivots.resistance")}
              </div>
              <dl className="space-y-1.5 font-mono text-xs">{levels(["r3", "r2", "r1"])}</dl>
            </div>
            <div className="flex flex-col items-center justify-center rounded-lg border border-border/60 bg-surface p-3 text-center">
              <span className="mb-1 text-xs font-bold text-foreground">{t("pivots.pivot")}</span>
              <span className="font-mono text-lg font-bold tabular-nums text-foreground">{formatPrice(pivots.pivot)}</span>
            </div>
            <div className="space-y-2 rounded-lg border border-border/60 bg-surface p-3">
              <div className="flex items-center gap-1 text-xs font-bold text-foreground">
                <ArrowDownRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" /> {t("pivots.support")}
              </div>
              <dl className="space-y-1.5 font-mono text-xs">{levels(["s1", "s2", "s3"])}</dl>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
