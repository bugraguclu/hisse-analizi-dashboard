"use client";

import { QueryClient, isServer } from "@tanstack/react-query";
import { isApiError } from "./api";
import { isLiveDataWindow } from "./market-hours";

/**
 * Freshness per data class (ms). Pick the class that matches how often the
 * backend data can actually change — the backend caches most live endpoints
 * for 60–600 s, so shorter stale times only add load.
 */
export const STALE_TIME = {
  /** Quotes/snapshots while the session is open. */
  live: 15_000,
  /** Index series, screener, index quotes (backend TTL ~120 s). */
  market: 60_000,
  /** KAP events and news. */
  events: 60_000,
  /** Technical/fundamental analysis (backend TTL 60–300 s). */
  analysis: 5 * 60_000,
  /** Company lists, sources, macro series — change daily at most. */
  reference: 30 * 60_000,
} as const;

/** Polling cadence for live data during the BIST session. */
export const LIVE_REFETCH_MS = 60_000;

/**
 * refetchInterval that only polls while live quotes can change (session plus
 * closing auction, see isLiveDataWindow). React Query re-evaluates it after every
 * fetch; components that must resume polling at the open should use
 * useLiveRefetchInterval() (hooks/use-market-status.ts).
 */
export function marketHoursRefetchInterval(intervalMs: number = LIVE_REFETCH_MS) {
  return () => (isLiveDataWindow() ? intervalMs : false);
}

/** Retry transient failures (network, timeout, 5xx) twice; never retry 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.isClientError) return false;
  return failureCount < 2;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.market,
        gcTime: 10 * 60_000,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
        // Only refetches queries that are already stale (see STALE_TIME).
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // Server: always a fresh client so data never leaks between requests.
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}
