"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { useDataStatus } from "@/components/layout/DataStatus";
import { cn } from "@/lib/utils";

/** Low-prominence data-freshness line: ingestion health + stored record counts. */
export function DashboardFooter() {
  const { t } = useLocale();
  const now = useNow();
  const { health, primary, feeds } = useDataStatus();
  const statsQ = useQuery({ queryKey: ["stats"], queryFn: () => api.stats(), staleTime: 5 * 60_000 });

  const parts: string[] = [];
  if (primary && now !== null) {
    parts.push(`${primary.label}: ${primary.lastSuccess ? formatRelativeTime(primary.lastSuccess, now) : t("status.never")}`);
  }
  if (statsQ.data) {
    parts.push(
      t("status.totals", {
        events: formatNumber(statsQ.data.total_normalized_events, 0),
        prices: formatNumber(statsQ.data.total_price_records, 0),
      }),
    );
  }
  const statusLabel =
    health === "fresh" ? t("status.fresh") : health === "stale" ? t("status.stale") : health === "unknown" ? t("status.unknown") : null;

  if (!statusLabel && parts.length === 0) return null;

  return (
    <footer className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/40 pt-4 text-[11px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wider">{t("status.title")}</span>
      {statusLabel && (
        <span
          className={cn("inline-flex items-center gap-1.5", health === "stale" && "text-amber-700 dark:text-amber-400")}
          title={now !== null ? feeds.map((f) => `${f.label}: ${f.lastSuccess ? formatRelativeTime(f.lastSuccess, now) : t("status.never")}`).join("\n") : undefined}
        >
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", health === "fresh" ? "bg-emerald-500" : health === "stale" ? "bg-amber-500" : "bg-muted-foreground")}
          />
          {statusLabel}
        </span>
      )}
      {parts.map((part) => (
        <span key={part}>· {part}</span>
      ))}
    </footer>
  );
}
