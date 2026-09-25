"use client";

import { forwardRef, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { ErrorState } from "@/components/shared/ErrorState";
import { isApiError } from "@/lib/api";
import { formatNumber, getIntlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Company, EventOut } from "@/types";
import { EventRow } from "./EventRow";
import { useEventsI18n } from "./i18n";
import type { EventsKey } from "./i18n-dict";
import { eventDate, formatDayKey, groupByDay, MAX_OFFSET, pageWindow, shiftDay, type PageSize } from "./model";
import { buttonVariants } from "@/components/ui/button";
import { FOCUS_RING } from "./ui";

/** Items published within this window get the "Yeni" marker. */
const NEW_WINDOW_MS = 15 * 60_000;

function FeedSkeleton({ rows = 8 }: { rows?: number }) {
  const { t } = useEventsI18n();
  return (
    <div role="status">
      <span className="sr-only">{t("feed.loading")}</span>
      <div aria-hidden="true" className="divide-y divide-border">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:px-5">
            <div className="h-3.5 w-9 rounded-sm bg-muted/60 skeleton-shimmer" />
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-12 shrink-0 rounded-sm bg-muted/60 skeleton-shimmer" />
                <div className="h-3.5 rounded-sm bg-muted/40 skeleton-shimmer" style={{ width: `${[72, 56, 64, 48, 80, 60, 68, 52][index % 8]}%` }} />
              </div>
              <div className="h-3 rounded-sm bg-muted/40 skeleton-shimmer" style={{ width: `${[36, 44, 28, 40, 32, 46, 30, 38][index % 8]}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedMessage({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
  current = false,
}: {
  href: string;
  disabled?: boolean;
  label: string;
  children: ReactNode;
  current?: boolean;
}) {
  const className = cn(
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 font-mono text-xs transition-colors",
    current ? "border-foreground bg-muted font-semibold text-foreground" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
    FOCUS_RING,
  );
  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={label} className={cn(className, "pointer-events-none opacity-35")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} scroll={false} aria-label={label} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}

function Pagination({ page, pages, pageHref }: { page: number; pages: number; pageHref: (page: number) => string }) {
  const { t } = useEventsI18n();
  const slots = pageWindow(page, pages);
  return (
    <nav aria-label={t("pagination.label")} className="flex items-center gap-0.5">
      <PageLink href={pageHref(1)} disabled={page <= 1} label={t("pagination.first")}>
        <ChevronsLeft aria-hidden="true" className="h-4 w-4" />
      </PageLink>
      <PageLink href={pageHref(page - 1)} disabled={page <= 1} label={t("pagination.prev")}>
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      </PageLink>
      <ol className="hidden items-center gap-0.5 sm:flex">
        {slots.map((item, index) =>
          item === null ? (
            <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-xs text-muted-foreground">
              …
            </li>
          ) : (
            <li key={item}>
              <PageLink href={pageHref(item)} label={t("pagination.page", { page: item })} current={item === page}>
                {formatNumber(item, 0)}
              </PageLink>
            </li>
          ),
        )}
      </ol>
      <span className="px-2 font-mono text-xs text-muted-foreground sm:hidden">
        {t("pagination.pageOf", { page: formatNumber(page, 0), pages: formatNumber(pages, 0) })}
      </span>
      <PageLink href={pageHref(page + 1)} disabled={page >= pages} label={t("pagination.next")}>
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </PageLink>
      <PageLink href={pageHref(pages)} disabled={page >= pages} label={t("pagination.last")}>
        <ChevronsRight aria-hidden="true" className="h-4 w-4" />
      </PageLink>
    </nav>
  );
}

function errorMessage(error: unknown, fallback: string, t: (key: EventsKey) => string): string {
  if (!isApiError(error)) return fallback;
  if (error.code === "network") return t("error.network");
  if (error.code === "timeout") return t("error.timeout");
  if (error.status === 429) return t("error.rateLimited");
  // Validation errors carry a useful backend message; server errors do not.
  if (error.status !== null && error.status >= 400 && error.status < 500 && error.detail) return error.detail;
  return fallback;
}

export interface EventsFeedProps {
  items: EventOut[] | undefined;
  total: number | null;
  page: number;
  size: PageSize;
  grouped: boolean;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholder: boolean;
  error: unknown;
  filtersActive: boolean;
  now: number | null;
  today: string | null;
  selectedId: string | null;
  freshIds: ReadonlySet<string>;
  activeTickers: ReadonlySet<string>;
  companies: ReadonlyMap<string, Company> | null;
  pageHref: (page: number) => string;
  onRetry: () => void;
  onClearFilters: () => void;
  onOpen: (id: string) => void;
  onAddTicker: (ticker: string) => void;
}

export const EventsFeed = forwardRef<HTMLElement, EventsFeedProps>(function EventsFeed(
  {
    items,
    total,
    page,
    size,
    grouped,
    isPending,
    isFetching,
    isPlaceholder,
    error,
    filtersActive,
    now,
    today,
    selectedId,
    freshIds,
    activeTickers,
    companies,
    pageHref,
    onRetry,
    onClearFilters,
    onOpen,
    onAddTicker,
  },
  ref,
) {
  const { t, tp } = useEventsI18n();
  const groups = useMemo(() => (items && grouped ? groupByDay(items) : null), [items, grouped]);
  const currentYear = today ? today.slice(0, 4) : null;
  const yesterday = today ? shiftDay(today, -1) : null;
  const intlLocale = getIntlLocale();

  const pages = total !== null ? Math.max(1, Math.min(Math.ceil(total / size), Math.floor(MAX_OFFSET / size) + 1)) : 1;
  const from = total ? Math.min((page - 1) * size + 1, total) : 0;
  const to = total ? Math.min(from + (items?.length ?? 0) - 1, total) : 0;
  const showError = error !== null && !items;

  const renderRow = (event: EventOut) => {
    const published = eventDate(event)?.getTime();
    const isNew = now !== null && published !== undefined && now - published < NEW_WINDOW_MS && now - published > -5 * 60_000;
    return (
      <EventRow
        key={event.id}
        event={event}
        grouped={grouped}
        currentYear={currentYear}
        selected={event.id === selectedId}
        fresh={freshIds.has(event.id)}
        isNew={isNew}
        activeTickers={activeTickers}
        companies={companies}
        onOpen={onOpen}
        onAddTicker={onAddTicker}
      />
    );
  };

  let body: ReactNode;
  if (showError) {
    body = <ErrorState message={errorMessage(error, t("feed.error"), t)} onRetry={onRetry} />;
  } else if (isPending || !items) {
    body = <FeedSkeleton rows={Math.min(size, 10)} />;
  } else if (items.length === 0) {
    body =
      page > 1 && total !== null && total > 0 ? (
        <FeedMessage
          title={t("feed.emptyPage")}
          action={
            <Link href={pageHref(1)} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("feed.firstPage")}
            </Link>
          }
        />
      ) : filtersActive ? (
        <FeedMessage
          title={t("feed.emptyFiltered")}
          hint={t("feed.emptyFilteredHint")}
          action={
            <button type="button" onClick={onClearFilters} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("active.clearAll")}
            </button>
          }
        />
      ) : (
        <FeedMessage title={t("feed.empty")} />
      );
  } else if (groups) {
    body = groups.map((group) => {
      const headingId = `events-day-${group.key}`;
      const label =
        group.key === "unknown"
          ? "—"
          : [
              group.key === today ? t("feed.today") : group.key === yesterday ? t("feed.yesterday") : null,
              formatDayKey(group.key, intlLocale, currentYear),
            ]
              .filter(Boolean)
              .join(" · ");
      return (
        <section key={group.key} aria-labelledby={headingId}>
          <div className="sticky top-0 z-20 flex items-baseline justify-between gap-3 border-b border-border bg-surface px-4 py-1.5 sm:px-5">
            <h2 id={headingId} className="text-xs font-semibold text-foreground first-letter:uppercase">
              {label}
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              <span aria-hidden="true">{formatNumber(group.events.length, 0)}</span>
              <span className="sr-only">{tp("feed.count", group.events.length, { count: group.events.length })}</span>
            </span>
          </div>
          <ul className="divide-y divide-border">{group.events.map(renderRow)}</ul>
        </section>
      );
    });
  } else {
    body = <ul className="divide-y divide-border">{items.map(renderRow)}</ul>;
  }

  // The figure is set in Plex Mono inside the localized sentence ("4.133 bildirim" / "4,133 disclosures").
  const countParts = total !== null ? tp("feed.count", total, { count: "\u0000" }).split("\u0000") : null;

  return (
    <section ref={ref} aria-label={t("feed.label")} className="card-surface scroll-mt-20">
      <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 sm:px-5">
        <p aria-live="polite" aria-atomic="true" className="text-[13px] font-medium text-foreground">
          {countParts && total !== null ? (
            <>
              {countParts[0]}
              <span className="font-mono">{formatNumber(total, 0)}</span>
              {countParts.slice(1).join("")}
            </>
          ) : (
            <span aria-hidden="true" className="inline-block h-3.5 w-24 translate-y-0.5 rounded-sm bg-muted/60 skeleton-shimmer" />
          )}
        </p>
        {/* Refetch with data on screen: a hairline progress cue instead of a skeleton flash. */}
        {isFetching && !isPending ? (
          <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
            <span className="block h-full w-full animate-pulse bg-primary/60" />
          </span>
        ) : null}
      </div>

      <div aria-busy={isFetching} className={cn("transition-opacity duration-200", isPlaceholder && "opacity-60")}>
        {body}
      </div>

      {items && items.length > 0 && total !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2.5 sm:px-5">
          <p className="font-mono text-xs text-muted-foreground">
            {t("pagination.range", { from: formatNumber(from, 0), to: formatNumber(to, 0), total: formatNumber(total, 0) })}
          </p>
          {pages > 1 ? <Pagination page={page} pages={pages} pageHref={pageHref} /> : null}
        </div>
      ) : null}
    </section>
  );
});
