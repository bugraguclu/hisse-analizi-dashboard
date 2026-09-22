"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Newspaper } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { isFeedStale } from "@/lib/market-hours";
import { STALE_TIME } from "@/lib/queryClient";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { CategoryBadge, SeverityBadge } from "@/components/shared/SeverityBadge";
import { useNow } from "@/hooks/use-now";
import type { EventOut } from "@/types";
import { CardHeading, DashboardCard, RowSkeleton } from "./ui";

const HEADING_ID = "latest-events-heading";
const MAX_ITEMS = 6;

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

  const events = (eventsQ.data ?? []).slice(0, MAX_ITEMS);
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
          <p role="status" className="mx-5 mb-2 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("events.staleHint", { time: formatRelativeTime(newest, now) })}
          </p>
        )}
        <ul className="divide-y divide-border/30">
          {events.map((event) => {
            const time = eventTime(event);
            return (
              <li key={event.id}>
                <Link
                  href={event.ticker ? `/hisse/${encodeURIComponent(event.ticker)}` : "/events"}
                  className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/20 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {event.ticker && <span className="font-mono text-xs font-bold text-primary">{event.ticker}</span>}
                      <CategoryBadge category={event.category} />
                      <SeverityBadge severity={event.severity} />
                    </div>
                    <p className="truncate text-sm text-foreground">{event.title || event.excerpt || t("events.untitled")}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {time ? (
                        <time dateTime={time.toISOString()} title={formatMarketDate(time, "dateTime")}>
                          {now !== null ? formatRelativeTime(time, now) : formatMarketDate(time, "dateTime")}
                        </time>
                      ) : null}
                      {event.source_code && <> · {event.source_code.toUpperCase()}</>}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
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
        icon={<Newspaper className="h-4 w-4" />}
        title={
          <>
            {t("dashboard.latestDevelopments")}
            {stale && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                {t("events.staleBadge")}
              </span>
            )}
          </>
        }
        action={
          <Link
            href="/events"
            className="flex items-center gap-0.5 rounded-md text-[11px] font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t("common.viewAll")} <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        }
      />
      {body}
    </DashboardCard>
  );
}
