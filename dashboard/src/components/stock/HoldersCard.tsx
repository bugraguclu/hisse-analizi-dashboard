"use client";

import { useState } from "react";
import { CATEGORICAL_TONES, SegmentBar, TONE_BG, useMiniChartI18n, type Tone } from "@/components/charts/mini";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useHolders } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

const LIST_LIMIT = 12;
/** Named holders that get their own colour; the rest (and "Diğer") share the grey segment. chart-5 is grey too, so stop at 4. */
const TOP_COUNT = 4;

/** Shareholder structure (percent of capital, 0-100). "Diğer" is listed last. */
export function HoldersCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const { t: tMini } = useMiniChartI18n();
  const holdersQ = useHolders(ticker);
  const holders = holdersQ.data ?? [];
  const [highlight, setHighlight] = useState<string | null>(null);

  const top = holders.filter((holder) => !holder.isOther).slice(0, TOP_COUNT);
  const restTotal = holders.reduce((sum, holder) => (top.includes(holder) ? sum : sum + holder.percent), 0);
  const segmentOf = (holder: (typeof holders)[number]): { key: string; tone: Tone } => {
    const i = top.indexOf(holder);
    return i >= 0 ? { key: `holder-${i}`, tone: CATEGORICAL_TONES[i] } : { key: "other", tone: "muted" };
  };

  const segments = [
    ...top.map((holder, i) => ({ key: `holder-${i}`, label: holder.name, value: holder.percent, tone: CATEGORICAL_TONES[i] })),
    ...(restTotal > 0 ? [{ key: "other", label: tMini("otherSegment"), value: restTotal, tone: "muted" as Tone }] : []),
  ];

  return (
    <SectionCard title={t("holders.title")} footer={t("holders.footer")}>
      {holdersQ.isPending ? (
        <SectionSkeleton rows={4} />
      ) : holdersQ.isError ? (
        <SectionError error={holdersQ.error} onRetry={() => void holdersQ.refetch()} />
      ) : holders.length === 0 ? (
        <SectionEmpty message={t("holders.empty")} />
      ) : (
        <div className="space-y-3">
          <SegmentBar
            segments={segments}
            ariaLabel={t("holders.title")}
            highlightKey={highlight}
            onHighlightChange={setHighlight}
          />
          <ul className="space-y-0.5">
            {holders.slice(0, LIST_LIMIT).map((holder) => {
              const { key: segKey, tone } = segmentOf(holder);
              const dimmed = highlight != null && highlight !== segKey;
              return (
                <li
                  key={holder.name}
                  tabIndex={0}
                  className={cn(
                    "-mx-1.5 grid min-h-7 grid-cols-[minmax(0,1fr)_5rem_3.5rem] items-center gap-3 rounded-sm px-1.5 outline-none transition-opacity hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60",
                    dimmed && "opacity-60",
                  )}
                  onMouseEnter={() => setHighlight(segKey)}
                  onMouseLeave={() => setHighlight(null)}
                  onFocus={() => setHighlight(segKey)}
                  onBlur={() => setHighlight(null)}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", TONE_BG[tone])} />
                    <span className={cn("truncate text-sm", holder.isOther ? "text-muted-foreground" : "text-foreground")} title={holder.name}>
                      {holder.isOther ? t("holders.other") : holder.name}
                    </span>
                  </span>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className={cn("block h-full rounded-full", TONE_BG[tone])} style={{ width: `${Math.min(holder.percent, 100)}%` }} />
                  </span>
                  <span className="text-right font-mono text-xs font-semibold tabular-nums text-foreground">{formatPercent(holder.percent)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
