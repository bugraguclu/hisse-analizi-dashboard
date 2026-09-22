"use client";

import { Target } from "lucide-react";
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

function RangeBar({ low, high, current, mean }: { low: number; high: number; current: number | null; mean: number | null }) {
  const { t } = useStockI18n();
  const min = Math.min(low, current ?? low);
  const max = Math.max(high, current ?? high);
  const span = max - min || 1;
  const pos = (v: number) => `${((v - min) / span) * 100}%`;
  const currentRatio = current != null ? (current - min) / span : 0.5;
  // Keep the price label inside the card when the marker sits at an edge.
  const labelAlign = currentRatio < 0.15 ? "left-0" : currentRatio > 0.85 ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div className="pt-5 pb-1">
      <div className="relative h-2 rounded-full bg-muted/60">
        <div className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: pos(low), width: `${((high - low) / span) * 100}%` }} />
        {mean != null ? (
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2 border-card bg-primary"
            style={{ left: pos(mean) }}
            title={`${t("analyst.mean")}: ${formatPrice(mean)}`}
          />
        ) : null}
        {current != null ? (
          <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: pos(current) }}>
            <span className="block h-4 w-1 rounded-full bg-foreground" />
            <span
              className={cn(
                "absolute bottom-full mb-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 font-mono text-[9px] font-semibold text-background",
                labelAlign,
              )}
            >
              {formatPrice(current)}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono tabular-nums">{formatPrice(low)}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="h-3 w-1 rounded-full bg-foreground" /> {t("analyst.currentPrice")}
          </span>
          {mean != null ? (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="h-2 w-2 rotate-45 rounded-[2px] bg-primary" /> {t("analyst.mean")}
            </span>
          ) : null}
        </span>
        <span className="font-mono tabular-nums">{formatPrice(high)}</span>
      </div>
    </div>
  );
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
    <SectionCard title={t("analyst.title")} icon={<Target />} footer={t("analyst.footer")}>
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
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-muted/30 p-3">
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
                <RangeBar low={targets.low} high={targets.high} current={price} mean={targets.mean} />
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
