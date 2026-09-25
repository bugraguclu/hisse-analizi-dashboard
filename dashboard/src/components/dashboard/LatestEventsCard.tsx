"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { isFeedStale } from "@/lib/market-hours";
import { STALE_TIME } from "@/lib/queryClient";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { categoryKeys, severityKeys, toCategoryKey, toSeverity, type SeverityKey } from "@/components/shared/SeverityBadge";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { EventOut } from "@/types";
import { CardHeading, DashboardCard, RowSkeleton } from "./ui";

const HEADING_ID = "latest-events-heading";
const MAX_ITEMS = 6;

/** Severity is shown as a thin rule at the row's edge plus a word; routine items stay unmarked. */
const SEVERITY_RULE: Record<SeverityKey, string | null> = { HIGH: "bg-destructive", WATCH: "bg-warn", INFO: null };
const SEVERITY_TEXT: Record<SeverityKey, string> = { HIGH: "text-destructive", WATCH: "text-warn", INFO: "" };

/** Optional fields the KAP pass adds to EventOut (older backends omit them). */
type LatestEvent = EventOut & { summary?: string | null; tickers?: string[] | null };

function eventTime(event: EventOut): Date | null {
  return parseDate(event.published_at ?? event.created_at);
}

export function LatestEventsCard({ className }: { className?: string }) {
  const { t } = useLocale();
  const now = useNow();
  // KAP disclosures (results, dividends) mostly arrive after the close — refresh around the clock.
  const refetchInterval = 180_000;
  const eventsQ = useQuery({
    queryKey: ["latestEvents"],
    queryFn: () => api.latestEvents(),
    staleTime: STALE_TIME.events,
    refetchInterval,
  });

  const events: LatestEvent[] = (eventsQ.data ?? []).slice(0, MAX_ITEMS);
  const newest = events.reduce<Date | null>((latest, event) => {
    const time = eventTime(event);
    return time && (!latest || time > latest) ? time : latest;
  }, null);
  const stale = now !== null && newest !== null && isFeedStale(newest, now);

  let body: React.ReactNode;
  if (eventsQ.isPending) {
    body = <RowSkeleton rows={4} />;
  } else if (eventsQ.isError) {
    body = <ErrorState compact message={t("events.loadError")} onRetry={() => void eventsQ.refetch()} />;
  } else if (events.length === 0) {
    body = <EmptyState compact message={t("dashboard.noEventsYet")} />;
  } else {
    body = (
      <>
        {stale && newest && now !== null && (
          <p role="status" className="border-b border-border bg-warn/10 px-4 py-2 text-[11px] text-warn">
            {t("events.staleHint", { time: formatRelativeTime(newest, now) })}
          </p>
        )}
        <ul className="divide-y divide-border">
          {events.map((event) => {
            const time = eventTime(event);
            const severity = toSeverity(event.severity);
            const category = toCategoryKey(event.category);
            const rule = SEVERITY_RULE[severity];
            return (
              <li key={event.id}>
                <Link
                  href={event.ticker ? `/hisse/${encodeURIComponent(event.ticker)}` : "/events"}
                  className="relative grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  {rule && <span aria-hidden="true" className={cn("absolute inset-y-2.5 left-0 w-0.5", rule)} />}
                  <span className="font-mono text-xs font-semibold text-foreground">{event.ticker ?? event.tickers?.[0] ?? "KAP"}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-foreground">
                      {event.summary || event.title || event.excerpt || t("events.untitled")}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {category ? t(categoryKeys[category]) : null}
                      {severity !== "INFO" && (
                        <>
                          {category ? " · " : null}
                          <span className={SEVERITY_TEXT[severity]}>{t(severityKeys[severity])}</span>
                        </>
                      )}
                      {event.source_code && <> · {event.source_code.toUpperCase()}</>}
                    </span>
                  </span>
                  {time ? (
                    <time
                      dateTime={time.toISOString()}
                      title={formatMarketDate(time, "dateTime")}
                      className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
                    >
                      {now !== null ? formatRelativeTime(time, now) : formatMarketDate(time, "dayMonthTime")}
                    </time>
                  ) : (
                    <span />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <DashboardCard labelledBy={HEADING_ID} className={className}>
      <CardHeading
        id={HEADING_ID}
        title={
          <span className="flex items-baseline gap-2">
            {t("dashboard.latestDevelopments")}
            {stale && <span className="text-[11px] font-normal text-warn">{t("events.staleBadge")}</span>}
          </span>
        }
        action={
          <Link
            href="/events"
            className="inline-flex items-center gap-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("common.viewAll")} <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        }
      />
      {body}
    </DashboardCard>
  );
}
