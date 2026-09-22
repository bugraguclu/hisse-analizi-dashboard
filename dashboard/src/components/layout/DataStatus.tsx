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
  fresh: "bg-emerald-500",
  stale: "bg-amber-500",
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
 * - `rail`: dot + label for the desktop sidebar (label hidden until the rail expands)
 * - `panel`: full per-feed breakdown for the mobile drawer
 */
export function DataStatus({ variant, labelClassName }: { variant: "rail" | "panel"; labelClassName?: string }) {
  const { t } = useLocale();
  const now = useNow();
  const { health, feeds, primary } = useDataStatus();
  const label = t(LABEL_KEY[health]);
  const detail = now !== null && primary ? feedLine(primary, t, now) : null;
  const tooltip = now !== null ? feeds.map((feed) => feedLine(feed, t, now)).join("\n") : undefined;

  // Only the health label is a live region: the relative times ("3 dk önce") change
  // every minute and would otherwise be re-announced by screen readers each time.
  if (variant === "rail") {
    return (
      <div className="flex items-center gap-3 px-3 py-2 text-xs text-sidebar-foreground/80" title={tooltip}>
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center" aria-hidden="true">
          <span className={cn("h-2 w-2 rounded-full", DOT_CLASS[health], health === "fresh" && "animate-pulse")} />
        </span>
        <span className={cn("min-w-0", labelClassName)}>
          <span className="block truncate font-medium" role="status">
            {label}
          </span>
          {detail && <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>}
        </span>
      </div>
    );
  }

  return (
    <section aria-label={t("status.title")} className="rounded-xl border border-sidebar-border/60 p-3 text-xs">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("status.title")}</p>
      <p className="flex items-center gap-2 font-medium text-sidebar-foreground" role="status">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASS[health])} aria-hidden="true" />
        {label}
      </p>
      {now !== null && feeds.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {feeds.map((feed) => (
            <li key={feed.code} className={cn(feed.stale && "text-amber-600 dark:text-amber-400")}>
              <span title={feed.lastSuccess ? formatMarketDate(feed.lastSuccess, "dateTime") : undefined}>{feedLine(feed, t, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
