"use client";

import { TargetRange } from "@/components/charts/mini";
import { TREND_TEXT_CLASS, formatChangePercent, formatNumber, formatPrice, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceTargets, useQuote, useRecommendation } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, SignalBadge } from "./ui";

/** Potential = target / current price − 1 (in %), always against the live price. */
function upsidePct(target: number | null | undefined, price: number | null | undefined): number | null {
  if (target == null || price == null || price <= 0) return null;
  return (target / price - 1) * 100;
}

/**
 * Analyst view: İş Yatırım's own rating/target plus the consensus target range.
 * Upside is recomputed from the live quote (upstream figures use a stale price).
 */
export function AnalystRecommendations({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const recQ = useRecommendation(ticker);
  const targetsQ = usePriceTargets(ticker);
  const { quote } = useQuote(ticker);
  const rec = recQ.data ?? null;
  const targets = targetsQ.data ?? null;
  const price = quote?.last ?? targets?.current ?? null;

  const pending = recQ.isPending || targetsQ.isPending;
  const failed = recQ.isError && targetsQ.isError;
  const recUpside = upsidePct(rec?.target, price);
  const consensusTarget = targets?.mean ?? targets?.median ?? null;
  const consensusUpside = upsidePct(consensusTarget, price);

  return (
    <SectionCard title={t("analyst.title")} footer={t("analyst.footerSources")}>
      {pending ? (
        <SectionSkeleton rows={5} />
      ) : failed ? (
        <SectionError
          error={recQ.error}
          onRetry={() => {
            void recQ.refetch();
            void targetsQ.refetch();
          }}
        />
      ) : !rec && !targets ? (
        <SectionEmpty message={t("analyst.empty")} />
      ) : (
        <div className="space-y-4">
          {rec ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 p-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("analyst.brokerRating")}</div>
                <div className="mt-1">
                  <SignalBadge level={rec.level} raw={rec.raw} size="md" />
                </div>
              </div>
              {rec.target != null ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("analyst.target")}</div>
                  <div className="mt-1 font-mono text-sm font-bold tabular-nums text-foreground">{formatPrice(rec.target)} TL</div>
                </div>
              ) : null}
              {recUpside != null ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("analyst.upside")}</div>
                  <div className={cn("mt-1 font-mono text-sm font-bold tabular-nums", TREND_TEXT_CLASS[trendTone(recUpside)])}>
                    {formatChangePercent(recUpside)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {targets ? (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-foreground">
                  {targets.analysts != null
                    ? t("analyst.consensusWithCount", { count: formatNumber(targets.analysts, 0) })
                    : t("analyst.consensus")}
                </h3>
                {consensusUpside != null ? (
                  <span className={cn("font-mono text-xs font-semibold tabular-nums", TREND_TEXT_CLASS[trendTone(consensusUpside)])}>
                    {t("analyst.upsideToMean", { value: formatChangePercent(consensusUpside) })}
                  </span>
                ) : null}
              </div>
              {targets.low != null && targets.high != null ? (
                <TargetRange
                  low={targets.low}
                  high={targets.high}
                  mean={targets.mean}
                  median={targets.median}
                  current={price}
                  formatPrice={(value) => formatPrice(value)}
                  labels={{
                    current: t("analyst.currentPrice"),
                    mean: t("analyst.mean"),
                    median: t("analyst.median"),
                    low: t("analyst.low"),
                    high: t("analyst.high"),
                  }}
                />
              ) : null}
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {[
                  { key: "low", label: t("analyst.low"), value: targets.low },
                  { key: "mean", label: t("analyst.mean"), value: targets.mean },
                  { key: "median", label: t("analyst.median"), value: targets.median },
                  { key: "high", label: t("analyst.high"), value: targets.high },
                ].map((item) => (
                  <div key={item.key}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.label}</dt>
                    <dd className="mt-0.5 font-mono text-xs font-bold tabular-nums text-foreground">{formatPrice(item.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
