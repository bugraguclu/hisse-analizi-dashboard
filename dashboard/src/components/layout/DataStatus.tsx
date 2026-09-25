"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { STALE_TIME } from "@/lib/queryClient";
import { isPollerStale } from "@/lib/market-hours";
import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<string, TranslationKey> = {
  kap: "status.source.kap",
  price: "status.source.price",
  financials: "status.source.financials",
};

/** KAP drives "latest developments", so it decides the overall status. */
const PRIMARY_SOURCE = "kap";

export type DataHealth = "loading" | "fresh" | "stale" | "unknown";

export interface FeedStatus {
  code: string;
  label: string;
  lastSuccess: Date | null;
  stale: boolean;
  failures: number;
}

/** Ingestion health from /polling-state (+ /sources for names). */
export function useDataStatus(): { health: DataHealth; feeds: FeedStatus[]; primary: FeedStatus | null } {
  const { t } = useLocale();
  const now = useNow();
  const pollingQ = useQuery({
    queryKey: ["polling-state"],
    queryFn: ({ signal }) => api.pollingState(signal),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const sourcesQ = useQuery({
    queryKey: ["sources"],
    queryFn: () => api.sources(),
    staleTime: STALE_TIME.reference,
  });

  return useMemo(() => {
    if (pollingQ.isPending || sourcesQ.isPending || now === null) return { health: "loading", feeds: [], primary: null };
    if (pollingQ.isError || sourcesQ.isError) return { health: "unknown", feeds: [], primary: null };
    const sourcesById = new Map(sourcesQ.data.map((s) => [s.id, s]));
    const feeds: FeedStatus[] = pollingQ.data
      .map((state) => {
        const source = sourcesById.get(state.source_id);
        if (!source || !source.enabled) return null;
        const lastSuccess = parseDate(state.last_success_at);
        const labelKey = SOURCE_LABELS[source.code];
        return {
          code: source.code,
          label: labelKey ? t(labelKey) : source.name,
          lastSuccess,
          stale: isPollerStale(lastSuccess, source.poll_interval_seconds, now),
          failures: state.consecutive_failures,
        };
      })
      .filter((feed): feed is FeedStatus => feed !== null)
      .sort((a, b) => (a.code === PRIMARY_SOURCE ? -1 : b.code === PRIMARY_SOURCE ? 1 : a.label.localeCompare(b.label)));
    const primary = feeds.find((f) => f.code === PRIMARY_SOURCE) ?? null;
    const health: DataHealth = primary ? (primary.stale ? "stale" : "fresh") : feeds.some((f) => !f.stale) ? "fresh" : "unknown";
    return { health, feeds, primary };
  }, [pollingQ.isPending, pollingQ.isError, pollingQ.data, sourcesQ.isPending, sourcesQ.isError, sourcesQ.data, now, t]);
}

const DOT_CLASS: Record<DataHealth, string> = {
  loading: "bg-muted-foreground/40",
  fresh: "bg-up",
  stale: "bg-warn",
  unknown: "bg-muted-foreground/60",
};

const LABEL_KEY: Record<DataHealth, TranslationKey> = {
  loading: "common.loading",
  fresh: "status.fresh",
  stale: "status.stale",
  unknown: "status.unknown",
};

function feedLine(feed: FeedStatus, t: (key: TranslationKey, vars?: Record<string, string | number>) => string, now: number): string {
  const when = feed.lastSuccess ? formatRelativeTime(feed.lastSuccess, now) : t("status.never");
  const failures = feed.failures > 0 ? ` · ${t("status.failures", { count: feed.failures })}` : "";
  return `${feed.label}: ${when}${failures}`;
}

/**
 * Low-prominence ingestion indicator.
 * - `inline`: dot + label + primary feed age, for the site footer (per-feed detail in the tooltip)
 * - `panel`: full per-feed breakdown for the mobile drawer
 */
export function DataStatus({ variant, className }: { variant: "inline" | "panel"; className?: string }) {
  const { t } = useLocale();
  const now = useNow();
  const { health, feeds, primary } = useDataStatus();
  const label = t(LABEL_KEY[health]);
  const detail = now !== null && primary ? feedLine(primary, t, now) : null;
  const tooltip = now !== null ? feeds.map((feed) => feedLine(feed, t, now)).join("\n") : undefined;

  // Only the health label is a live region: the relative times ("3 dk önce") change
  // every minute and would otherwise be re-announced by screen readers each time.
  if (variant === "inline") {
    return (
      <p className={cn("flex min-w-0 items-center gap-2", className)} title={tooltip}>
        <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[health])} />
        <span role="status" className={cn(health === "stale" && "text-warn")}>
          {label}
        </span>
        {detail && <span className="truncate">· {detail}</span>}
      </p>
    );
  }

  return (
    <section aria-label={t("status.title")} className={cn("text-xs", className)}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("status.title")}</p>
      <p className="flex items-center gap-2 text-foreground" role="status">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[health])} aria-hidden="true" />
        {label}
      </p>
      {now !== null && feeds.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {feeds.map((feed) => (
            <li key={feed.code} className={cn(feed.stale && "text-warn")}>
              <span title={feed.lastSuccess ? formatMarketDate(feed.lastSuccess, "dateTime") : undefined}>{feedLine(feed, t, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
