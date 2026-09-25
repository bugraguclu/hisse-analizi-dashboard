"use client";

import { RefreshCw } from "lucide-react";
import { formatMarketDate, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useEventsI18n } from "./i18n";
import type { FeedStatusInfo } from "./queries";
import { IconButton } from "./ui";

/** "● Canlı · 1 dakika önce güncellendi" + refresh — the KAP poller's health, not the page's. */
export function FeedStatus({
  status,
  now,
  refreshing,
  onRefresh,
}: {
  status: FeedStatusInfo;
  now: number | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useEventsI18n();
  const { health, lastSuccess, failures, pollSeconds } = status;

  // "loading" also covers hydration (now === null): render nothing data-driven until then,
  // the polling query is shared with the footer and may already be cached.
  const tooltip =
    health === "loading"
      ? ""
      : [
          lastSuccess ? t("status.lastSuccess", { time: formatMarketDate(lastSuccess, "dateTime") }) : null,
          failures > 0 ? t("status.failures", { count: failures }) : null,
          pollSeconds ? t("status.interval", { seconds: pollSeconds }) : null,
        ]
          .filter(Boolean)
          .join("\n");

  const when =
    health === "live" || health === "delayed"
      ? lastSuccess && now !== null
        ? t("status.updated", { time: formatRelativeTime(lastSuccess, now) })
        : t("status.never")
      : null;

  return (
    <div className="flex items-center gap-1.5">
      <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" title={tooltip || undefined}>
        {health === "loading" ? (
          <span aria-hidden="true" className="inline-block h-3 w-44 rounded-sm bg-muted/60 skeleton-shimmer" />
        ) : (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                health === "live" ? "bg-up" : health === "delayed" ? "bg-warn" : "bg-muted-foreground/50",
              )}
            />
            <span
              role="status"
              className={cn("font-medium", health === "live" ? "text-foreground" : health === "delayed" ? "text-warn" : "text-muted-foreground")}
            >
              <span className="sr-only">{t("status.label")}: </span>
              {health === "live" ? t("status.live") : health === "delayed" ? t("status.delayed") : t("status.unknown")}
            </span>
            {when ? <span className="truncate">· {when}</span> : null}
          </>
        )}
      </p>
      <IconButton onClick={onRefresh} aria-label={t("action.refresh")} title={t("action.refresh")} aria-busy={refreshing}>
        <RefreshCw aria-hidden="true" className={cn("h-4 w-4", refreshing && "animate-spin")} />
      </IconButton>
    </div>
  );
}
