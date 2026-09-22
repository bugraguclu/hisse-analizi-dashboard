"use client";

import { Users } from "lucide-react";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useHolders } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

/** Shareholder structure (percent of capital, 0-100). "Diğer" is listed last. */
export function HoldersCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const holdersQ = useHolders(ticker);
  const holders = holdersQ.data ?? [];

  return (
    <SectionCard title={t("holders.title")} icon={<Users className="text-teal-500" />} footer={t("holders.footer")}>
      {holdersQ.isPending ? (
        <SectionSkeleton rows={4} />
      ) : holdersQ.isError ? (
        <SectionError error={holdersQ.error} onRetry={() => void holdersQ.refetch()} />
      ) : holders.length === 0 ? (
        <SectionEmpty message={t("holders.empty")} />
      ) : (
        <ul className="space-y-2.5">
          {holders.slice(0, 12).map((holder) => (
            <li key={holder.name} className="grid grid-cols-[minmax(0,1fr)_5rem_3.5rem] items-center gap-3">
              <span className={cn("truncate text-sm", holder.isOther ? "text-muted-foreground" : "text-foreground")} title={holder.name}>
                {holder.isOther ? t("holders.other") : holder.name}
              </span>
              <span aria-hidden className="h-2 overflow-hidden rounded-full bg-muted/50">
                <span
                  className={cn("block h-full rounded-full", holder.isOther ? "bg-muted-foreground/40" : "bg-teal-500")}
                  style={{ width: `${Math.min(holder.percent, 100)}%` }}
                />
              </span>
              <span className="text-right font-mono text-xs font-semibold tabular-nums text-foreground">{formatPercent(holder.percent)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
