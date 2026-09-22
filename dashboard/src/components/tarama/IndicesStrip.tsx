"use client";

import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { formatNumber, formatChangePercent } from "@/lib/format";
import { trendOf, trendText } from "@/lib/trend";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import type { IndicesOut } from "@/types";

const INDEX_NAMES = ["XU100", "XU030", "XUSIN", "XBANK"];

export function IndicesStrip({
  data,
  isLoading,
  isError,
  errorMessage,
  onRetry,
}: {
  data: IndicesOut | undefined;
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  const { t } = useLocale();
  const quotes = data?.quotes ?? [];
  const indices = INDEX_NAMES.map((sym) => quotes.find((q) => q.symbol === sym) ?? { symbol: sym, last: null, change_percent: null });

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5">
      <h2 className="text-sm font-semibold text-foreground mb-3">{t("tarama.bistIndices")}</h2>
      {isError ? (
        <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />
      ) : isLoading ? (
        <LoadingSpinner text={t("common.loading")} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {indices.map((idx) => {
            const hasQuote = idx.last != null;
            const tone = trendOf(idx.change_percent);
            return (
              <div key={idx.symbol} className="bg-muted/30 rounded-xl p-4 hover:bg-muted/50 transition-colors">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{idx.symbol}</div>
                <div className="text-xl font-bold font-mono text-foreground">{hasQuote ? formatNumber(idx.last, 2) : "-"}</div>
                {hasQuote && idx.change_percent != null && (
                  <div className={`flex items-center gap-1 text-xs font-semibold mt-1.5 ${trendText(idx.change_percent)}`}>
                    {tone === "down" ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                    {formatChangePercent(idx.change_percent)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
