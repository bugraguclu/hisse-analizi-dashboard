"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, WifiOff } from "lucide-react";
import { useIsDisconnected, useOfflineSummary } from "@/hooks/use-network-status";
import { useNow } from "@/hooks/use-now";
import { formatMarketDate } from "@/lib/format";
import { evaluateOfflineFreshness } from "@/lib/local-store/offline-cache";
import { useLocale } from "@/lib/locale-context";
import { useShell } from "./shell-context";

/**
 * Calm status strip shown only while offline or when the market API is
 * unreachable. Surfaces the cached snapshot date, BIST delay context, and quick
 * actions to inspect the offline summary or retry.
 */
export function OfflineBanner() {
  const disconnected = useIsDisconnected();
  const offlineSummary = useOfflineSummary();
  const now = useNow();
  const { t } = useLocale();
  const { openWorkspaceManager } = useShell();
  const queryClient = useQueryClient();

  const freshness = useMemo(
    () => (now !== null ? evaluateOfflineFreshness(offlineSummary, now, !disconnected) : null),
    [offlineSummary, now, disconnected],
  );

  if (!disconnected) return null;

  return (
    <div role="status" className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs md:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
          {freshness?.hasData && freshness.savedAt ? (
            <p className="min-w-0 text-pretty">
              <span className="font-medium text-warn">{t("offline.bannerTitle")}</span>
              {" · "}
              <span className="font-mono text-[11px] tabular-nums">
                {t("offline.lastSaved", { time: formatMarketDate(freshness.savedAt, "dayMonthTime") })}
              </span>
              <span className="hidden text-muted-foreground sm:inline">
                {" · "}
                {freshness.staleDuringSession ? t("offline.sessionOpenStaleHint") : t("offline.delayNote")}
              </span>
            </p>
          ) : (
            <p className="text-pretty text-warn">{t("offline.bannerNoCache")}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => openWorkspaceManager("offline")}
            className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("offline.openSummary")}
          </button>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ refetchType: "active" })}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground motion-press-subtle hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {t("common.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
