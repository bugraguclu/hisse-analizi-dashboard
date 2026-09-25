"use client";

import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, isApiError } from "@/lib/api";
import { parseDate } from "@/lib/format";
import { STALE_TIME } from "@/lib/queryClient";
import { toCategoryKey, type CategoryKey, type SeverityKey } from "@/components/shared/SeverityBadge";
import type { Company, EventOut } from "@/types";
import { MIN_QUERY_LENGTH, toApiBounds, type DayBounds, type EventsUrlState } from "./model";

/** Feed data refreshes every minute while the first "newest" page is on screen. */
export const LIVE_REFRESH_MS = 60_000;
const FEED_STALE_MS = 30_000;
/** A KAP poller silent for longer than this is shown as delayed. */
const LIVE_THRESHOLD_MS = 10 * 60_000;

export const eventsKeys = {
  all: ["events-feed"] as const,
  lists: ["events-feed", "list"] as const,
  list: (params: ListParams) => ["events-feed", "list", params] as const,
  facetsAll: ["events-feed", "facets"] as const,
  facets: (params: FacetQueryParams) => ["events-feed", "facets", params] as const,
  detail: (id: string) => ["events-feed", "detail", id] as const,
  content: (id: string) => ["events-feed", "content", id] as const,
  // Shared with the site footer's DataStatus / TickerSearch (same query functions).
  pollingState: ["polling-state"] as const,
  sources: ["sources"] as const,
  companies: ["companies"] as const,
};

export interface FacetParams {
  ticker?: string;
  search?: string;
  category?: string;
  severity?: string;
  since?: string;
  until?: string;
}

/** Facet request: the list filters plus the tickers whose counts the Hisse group shows. */
export interface FacetQueryParams extends FacetParams {
  ticker_facet?: string;
}

export interface ListParams extends FacetParams {
  sort?: string;
  limit: number;
  offset: number;
}

export function buildFacetParams(state: EventsUrlState, days: DayBounds): FacetParams {
  const q = state.q.trim();
  return {
    ticker: state.tickers.length ? state.tickers.join(",") : undefined,
    search: q.length >= MIN_QUERY_LENGTH ? q : undefined,
    category: state.categories.length ? state.categories.join(",") : undefined,
    severity: state.severities.length ? state.severities.join(",") : undefined,
    ...toApiBounds(days),
  };
}

export function buildListParams(state: EventsUrlState, days: DayBounds, page = state.page): ListParams {
  return {
    ...buildFacetParams(state, days),
    sort: state.sort === "newest" ? undefined : state.sort,
    limit: state.size,
    offset: (page - 1) * state.size,
  };
}

export interface EventsPage {
  items: EventOut[];
  total: number;
}

export async function fetchEventsPage(params: ListParams, signal?: AbortSignal): Promise<EventsPage> {
  const result = await api.eventsPage(params, signal);
  const items = Array.isArray(result.items) ? result.items : [];
  // A proxy that drops X-Total-Count reads as 0 — never report fewer than we hold.
  return { items, total: Math.max(result.total, params.offset + items.length) };
}

export function useEventsList(params: ListParams | null, live: boolean) {
  return useQuery({
    queryKey: params ? eventsKeys.list(params) : [...eventsKeys.lists, "idle"],
    queryFn: ({ signal }) => fetchEventsPage(params as ListParams, signal),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: FEED_STALE_MS,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

export interface FacetCounts {
  total: number | null;
  categories: Partial<Record<CategoryKey, number>>;
  severities: Partial<Record<SeverityKey, number>>;
  /** Only the asked-for tickers (empty on a backend without the ticker facet). */
  tickers: Partial<Record<string, number>>;
}

/**
 * Chip counts from GET /events/facets. `counts` is null while unknown or when
 * the endpoint is unavailable (older backend) — the chips then render without
 * numbers and nothing is hidden.
 */
export function useEventFacets(params: FacetQueryParams | null, live: boolean): { counts: FacetCounts | null; isFetching: boolean } {
  const query = useQuery({
    queryKey: params ? eventsKeys.facets(params) : [...eventsKeys.facetsAll, "idle"],
    queryFn: ({ signal }) => api.eventFacets(params ?? undefined, signal),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: FEED_STALE_MS,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    // 404/422 until the endpoint exists: do not hammer it.
    retry: (failureCount, error) => !(isApiError(error) && error.isClientError) && failureCount < 1,
  });
  const data = query.isError ? undefined : query.data;
  const counts = useMemo<FacetCounts | null>(() => {
    if (!data || typeof data !== "object") return null;
    const categories: Partial<Record<CategoryKey, number>> = {};
    for (const [key, value] of Object.entries(data.categories ?? {})) {
      const code = toCategoryKey(key);
      if (code && typeof value === "number") categories[code] = (categories[code] ?? 0) + value;
    }
    const severities: Partial<Record<SeverityKey, number>> = {};
    for (const level of ["HIGH", "WATCH", "INFO"] as const) {
      const value = data.severities?.[level];
      if (typeof value === "number") severities[level] = value;
    }
    const tickers: Partial<Record<string, number>> = {};
    for (const [ticker, value] of Object.entries(data.tickers ?? {})) {
      if (typeof value === "number") tickers[ticker] = value;
    }
    return { total: typeof data.total === "number" ? data.total : null, categories, severities, tickers };
  }, [data]);
  return { counts, isFetching: query.isFetching };
}

export function useTrackedCompanies() {
  const query = useQuery({
    queryKey: eventsKeys.companies,
    queryFn: () => api.companies(),
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
  });
  const companies = query.data;
  const byTicker = useMemo(
    () => (Array.isArray(companies) ? new Map<string, Company>(companies.map((company) => [company.ticker.toUpperCase(), company])) : null),
    [companies],
  );
  return { companies: Array.isArray(companies) ? companies : undefined, byTicker, isPending: query.isPending };
}

export type FeedHealth = "loading" | "live" | "delayed" | "unknown";

export interface FeedStatusInfo {
  health: FeedHealth;
  lastSuccess: Date | null;
  failures: number;
  pollSeconds: number | null;
  isFetching: boolean;
}

/** KAP poller health from /polling-state (+ /sources to find the KAP source). */
export function useKapFeedStatus(now: number | null, live: boolean): FeedStatusInfo {
  const pollingQ = useQuery({
    queryKey: eventsKeys.pollingState,
    queryFn: ({ signal }) => api.pollingState(signal),
    staleTime: FEED_STALE_MS,
    refetchInterval: live ? LIVE_REFRESH_MS : 5 * 60_000,
  });
  const sourcesQ = useQuery({
    queryKey: eventsKeys.sources,
    queryFn: () => api.sources(),
    staleTime: STALE_TIME.reference,
  });
  return useMemo<FeedStatusInfo>(() => {
    const isFetching = pollingQ.isFetching;
    if (pollingQ.isPending || sourcesQ.isPending) return { health: "loading", lastSuccess: null, failures: 0, pollSeconds: null, isFetching };
    if (pollingQ.isError || sourcesQ.isError || !Array.isArray(pollingQ.data) || !Array.isArray(sourcesQ.data)) {
      return { health: "unknown", lastSuccess: null, failures: 0, pollSeconds: null, isFetching };
    }
    const source = sourcesQ.data.find((s) => s.code === "kap");
    const state = source ? pollingQ.data.find((p) => p.source_id === source.id) : undefined;
    if (!source || !state) return { health: "unknown", lastSuccess: null, failures: 0, pollSeconds: null, isFetching };
    const lastSuccess = parseDate(state.last_success_at);
    const failures = state.consecutive_failures ?? 0;
    const fresh = lastSuccess !== null && now !== null && now - lastSuccess.getTime() < LIVE_THRESHOLD_MS;
    return {
      health: now === null ? "loading" : fresh && failures === 0 ? "live" : "delayed",
      lastSuccess,
      failures,
      pollSeconds: source.poll_interval_seconds ?? null,
      isFetching,
    };
  }, [pollingQ.isPending, pollingQ.isError, pollingQ.data, pollingQ.isFetching, sourcesQ.isPending, sourcesQ.isError, sourcesQ.data, now]);
}

export function useEventDetail(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: eventsKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.eventDetail(id ?? "", signal),
    enabled: enabled && !!id,
    staleTime: 5 * 60_000,
  });
}

/** 404 / 503 / 429: the body is not retrievable right now — show the fallback instead of retrying. */
function retryContent(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && (error.isClientError || error.status === 503)) return false;
  return failureCount < 1;
}

export function useEventContent(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: eventsKeys.content(id ?? ""),
    queryFn: ({ signal }) => api.eventContent(id ?? "", signal),
    enabled: enabled && !!id,
    // Disclosures do not change once published; the backend caches the KAP fetch too.
    staleTime: 60 * 60_000,
    gcTime: 30 * 60_000,
    retry: retryContent,
  });
}
