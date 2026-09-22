"use client";

import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimeframeSignals } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, SignalBadge, VoteBar } from "./ui";

const TIMEFRAME_LABELS: Record<string, StockKey> = {
  "1m": "tf.1m",
  "5m": "tf.5m",
  "15m": "tf.15m",
  "30m": "tf.30m",
  "1h": "tf.1h",
  "2h": "tf.2h",
  "4h": "tf.4h",
  "1d": "tf.1d",
  "1W": "tf.1W",
  "1M": "tf.1M",
};

/** TradingView technical summary for every timeframe (1 minute → monthly). */
export function AllTimeframeSignals({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalsQ = useTimeframeSignals(ticker);

  return (
    <SectionCard title={t("tf.title")} icon={<Layers />} footer={t("tf.footer")}>
      {signalsQ.isPending ? (
        <SectionSkeleton rows={7} />
      ) : signalsQ.isError ? (
        <SectionError error={signalsQ.error} onRetry={() => void signalsQ.refetch()} />
      ) : signalsQ.data.length === 0 ? (
        <SectionEmpty message={t("tf.empty")} />
      ) : (
        <ul className="divide-y divide-border/30">
          {signalsQ.data.map(({ timeframe, summary }) => {
            const labelKey = TIMEFRAME_LABELS[timeframe];
            return (
              <li
                key={timeframe}
                className={cn("grid grid-cols-[5.5rem_6.5rem_1fr] items-center gap-2 py-2 first:pt-0 last:pb-0", !summary && "opacity-60")}
              >
                <span className="truncate text-[11px] font-medium text-muted-foreground">{labelKey ? t(labelKey) : timeframe}</span>
                {summary ? (
                  <>
                    <span>
                      <SignalBadge level={summary.level} raw={summary.raw} />
                    </span>
                    <VoteBar buy={summary.buy} neutral={summary.neutral} sell={summary.sell} />
                  </>
                ) : (
                  <span className="col-span-2 text-[11px] text-muted-foreground">{t("tf.noData")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
