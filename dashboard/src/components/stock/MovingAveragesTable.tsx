"use client";

import { ArrowDownRight, ArrowUpRight, Layers, LineChart } from "lucide-react";
import { TREND_PILL_CLASS, TREND_TEXT_CLASS, formatChangePercent, formatDay, formatPrice, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMovingAverageCross, usePivots, useQuote, useSignals } from "./hooks";
import { useStockI18n } from "./i18n";
import { movingAverageRows } from "./parsers";
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
      icon={<LineChart />}
      actions={
        <>
          {golden != null ? (
            <span className={cn("rounded-lg px-2 py-1 text-[11px] font-semibold", TREND_PILL_CLASS[golden ? "up" : "down"])}>
              {golden ? t("ma.golden") : t("ma.death")}
            </span>
          ) : null}
          {lastCross?.date ? (
            <span className="text-[11px] text-muted-foreground">
              {t(lastCross.type === "golden" ? "ma.lastGolden" : "ma.lastDeath", { date: formatDay(lastCross.date) })}
            </span>
          ) : null}
        </>
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
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full min-w-[30rem] text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pl-4 pr-3 text-left font-semibold sm:pl-5">{t("ma.period")}</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">SMA</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">EMA</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{t("ma.priceVsSma")}</th>
                <th scope="col" className="py-2 pl-3 pr-4 text-right font-semibold sm:pr-5">{t("ma.votes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const distance = price != null && row.sma ? (price / row.sma - 1) * 100 : null;
                return (
                  <tr key={row.period} className="border-b border-border/20 transition-colors hover:bg-muted/20">
                    <th scope="row" className="py-2 pl-4 pr-3 text-left font-medium text-foreground sm:pl-5">
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
      )}
    </SectionCard>
  );
}

/** Classic pivot points (support/resistance) from the backend. */
export function PivotsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const pivotsQ = usePivots(ticker);
  const pivots = pivotsQ.data ?? null;
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
      icon={<Layers />}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-down/20 bg-down/5 p-3">
            <div className="flex items-center gap-1 text-xs font-bold text-down">
              <ArrowUpRight aria-hidden className="h-3.5 w-3.5" /> {t("pivots.resistance")}
            </div>
            <dl className="space-y-1.5 font-mono text-xs">{levels(["r3", "r2", "r1"])}</dl>
          </div>
          <div className="flex flex-col items-center justify-center rounded-xl border border-primary/20 bg-primary/5 p-3 text-center">
            <span className="mb-1 text-xs font-bold text-primary">{t("pivots.pivot")}</span>
            <span className="font-mono text-lg font-bold tabular-nums text-foreground">{formatPrice(pivots.pivot)}</span>
          </div>
          <div className="space-y-2 rounded-xl border border-up/20 bg-up/5 p-3">
            <div className="flex items-center gap-1 text-xs font-bold text-up">
              <ArrowDownRight aria-hidden className="h-3.5 w-3.5" /> {t("pivots.support")}
            </div>
            <dl className="space-y-1.5 font-mono text-xs">{levels(["s1", "s2", "s3"])}</dl>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
