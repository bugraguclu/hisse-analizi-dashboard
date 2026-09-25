"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { useNow } from "@/hooks/use-now";
import { DEFAULT_WATCHLIST_ID, useWatchlists } from "@/hooks/use-watchlists";
import type { EventOut } from "@/types";
import { EventDrawer } from "./EventDrawer";
import { EventsFeed } from "./EventsFeed";
import { EventsToolbar } from "./EventsToolbar";
import { FeedStatus } from "./FeedStatus";
import { useEventsI18n } from "./i18n";
import { hasActiveFilters, isChronological, istanbulDayKey, MAX_OFFSET, MAX_TICKERS, rangeDays } from "./model";
import {
  buildFacetParams,
  buildListParams,
  eventsKeys,
  fetchEventsPage,
  useEventFacets,
  useEventsList,
  useKapFeedStatus,
  useTrackedCompanies,
  type EventsPage,
  type FacetQueryParams,
} from "./queries";
import { useEventsUrlState } from "./use-events-url";

const EMPTY_IDS: ReadonlySet<string> = new Set();
const NO_ROWS: readonly EventOut[] = [];

interface SeenPage {
  key: string;
  data: EventsPage;
  /** Rows that were not on the previous version of the same page. */
  fresh: ReadonlySet<string>;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** /events — KAP disclosure feed with URL-driven filters, live refresh and a detail drawer. */
export function EventsView() {
  const { t } = useEventsI18n();
  const now = useNow();
  const queryClient = useQueryClient();
  const { state, hrefFor, setFilters, openEvent, closeEvent, focusTicker } = useEventsUrlState();

  // Presets are Istanbul calendar days; they resolve once the clock is known (after hydration).
  const today = now === null ? null : istanbulDayKey(new Date(now));
  const days = rangeDays(state, today);
  const daysReady = days !== null;
  const dayFrom = days?.from ?? null;
  const dayTo = days?.to ?? null;

  const { lists } = useWatchlists();
  const watchlist = lists.find((list) => list.id === DEFAULT_WATCHLIST_ID) ?? lists[0];

  // The Hisse group of the filter panel: picked tickers, those picked earlier in this
  // visit (options must not vanish when unticked) and the watchlist.
  const [seenTickers, setSeenTickers] = useState<string[]>(state.tickers);
  const unseen = state.tickers.filter((ticker) => !seenTickers.includes(ticker));
  if (unseen.length > 0) setSeenTickers([...seenTickers, ...unseen]);
  const watchTickers = watchlist?.tickers;
  const tickerChoices = useMemo(
    () => Array.from(new Set([...state.tickers, ...seenTickers, ...(watchTickers ?? [])])).slice(0, MAX_TICKERS),
    [state.tickers, seenTickers, watchTickers],
  );

  const listParams = useMemo(
    () => (daysReady ? buildListParams(state, { from: dayFrom, to: dayTo }) : null),
    [daysReady, dayFrom, dayTo, state],
  );
  const facetParams = useMemo<FacetQueryParams | null>(
    () =>
      daysReady
        ? {
            ...buildFacetParams(state, { from: dayFrom, to: dayTo }),
            ticker_facet: tickerChoices.length ? [...tickerChoices].sort().join(",") : undefined,
          }
        : null,
    [daysReady, dayFrom, dayTo, state, tickerChoices],
  );

  // Live refresh only where new disclosures would appear: the first page, newest first.
  const live = state.page === 1 && state.sort === "newest";
  const listQ = useEventsList(listParams, live);
  const facets = useEventFacets(facetParams, live);
  const feedStatus = useKapFeedStatus(now, live);
  const { companies, byTicker } = useTrackedCompanies();

  const data = listQ.data;
  const items = data?.items;
  const total = data ? data.total : null;

  // Rows that arrived with a background refresh of the same page flash once.
  const listKey = listParams ? JSON.stringify(listParams) : "";
  const [seen, setSeen] = useState<SeenPage | null>(null);
  if (data && !listQ.isPlaceholderData && seen?.data !== data) {
    const previous = seen && seen.key === listKey ? new Set(seen.data.items.map((item) => item.id)) : null;
    const fresh = previous ? new Set(data.items.filter((item) => !previous.has(item.id)).map((item) => item.id)) : EMPTY_IDS;
    setSeen({ key: listKey, data, fresh });
  }
  const freshIds = seen && seen.key === listKey && seen.data === data ? seen.fresh : EMPTY_IDS;

  // Prefetch the next page so paging feels instant.
  useEffect(() => {
    if (!listParams || !data || listQ.isPlaceholderData) return;
    const offset = listParams.offset + listParams.limit;
    if (offset >= data.total || offset > MAX_OFFSET) return;
    const next = { ...listParams, offset };
    void queryClient.prefetchQuery({
      queryKey: eventsKeys.list(next),
      queryFn: ({ signal }) => fetchEventsPage(next, signal),
      staleTime: 30_000,
    });
  }, [listParams, data, listQ.isPlaceholderData, queryClient]);

  // Bring the top of the feed into view after paging.
  const feedRef = useRef<HTMLElement>(null);
  const lastPage = useRef(state.page);
  useEffect(() => {
    if (lastPage.current === state.page) return;
    lastPage.current = state.page;
    const feed = feedRef.current;
    if (!feed) return;
    const { top } = feed.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight * 0.6) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      feed.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [state.page]);

  // "/" focuses the page search. Registered in the capture phase so it wins over the
  // header's stock search on this page; ignored while typing or when a dialog is open.
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const input = searchInputRef.current;
      if (!input || input.getClientRects().length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      input.focus();
      input.select();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, []);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: eventsKeys.lists });
    void queryClient.invalidateQueries({ queryKey: eventsKeys.facetsAll });
    void queryClient.invalidateQueries({ queryKey: eventsKeys.pollingState });
  }, [queryClient]);

  const addTicker = useCallback(
    (ticker: string) => {
      setFilters((current) => ({
        tickers: current.tickers.includes(ticker) ? current.tickers : [...current.tickers, ticker].slice(0, MAX_TICKERS),
      }));
    },
    [setFilters],
  );
  const clearFilters = useCallback(
    () => setFilters({ q: "", tickers: [], categories: [], severities: [], range: "all", since: null, until: null }),
    [setFilters],
  );
  const pageHref = useCallback((page: number) => hrefFor({ ...state, page, event: null }), [hrefFor, state]);
  const activeTickers = useMemo(() => new Set(state.tickers), [state.tickers]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title={t("page.title")}
        description={t("page.subtitle")}
        actions={
          <FeedStatus status={feedStatus} now={now} refreshing={listQ.isFetching || feedStatus.isFetching} onRefresh={refresh} />
        }
      />

      <EventsToolbar
        state={state}
        today={today}
        counts={facets.counts}
        total={total}
        companies={companies}
        watchlist={watchlist}
        tickerChoices={tickerChoices}
        searchInputRef={searchInputRef}
        onChange={setFilters}
      />

      <EventsFeed
        ref={feedRef}
        items={items}
        total={total}
        page={state.page}
        size={state.size}
        grouped={isChronological(state.sort)}
        isPending={listQ.isPending}
        isFetching={listQ.isFetching}
        isPlaceholder={listQ.isPlaceholderData}
        error={listQ.isError ? listQ.error : null}
        filtersActive={hasActiveFilters(state)}
        now={now}
        today={today}
        selectedId={state.event}
        freshIds={freshIds}
        activeTickers={activeTickers}
        companies={byTicker}
        pageHref={pageHref}
        onRetry={() => void listQ.refetch()}
        onClearFilters={clearFilters}
        onOpen={openEvent}
        onAddTicker={addTicker}
      />

      <EventDrawer
        eventId={state.event}
        rows={items ?? NO_ROWS}
        companies={byTicker}
        onNavigate={openEvent}
        onClose={closeEvent}
        onFocusTicker={focusTicker}
      />
    </div>
  );
}

/** Suspense fallback while the search params resolve (no text: the locale is not known yet). */
export function EventsViewFallback() {
  return (
    <div aria-hidden="true" className="mx-auto max-w-7xl space-y-5">
      <div className="space-y-2 border-b border-border pb-4">
        <div className="h-8 w-56 rounded-sm bg-muted/60 skeleton-shimmer" />
        <div className="h-3.5 w-80 max-w-full rounded-sm bg-muted/40 skeleton-shimmer" />
      </div>
      <div className="card-surface h-36" />
      <div className="card-surface h-96" />
    </div>
  );
}
