"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { STALE_TIME } from "@/lib/queryClient";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import type { ChartPeriod, IndexQuote } from "@/types";

/** Live quotes for all BIST indices (shared cache key with the screening page). */
export function useIndexQuotes() {
  const refetchInterval = useLiveRefetchInterval(60_000);
  return useQuery({
    queryKey: ["indexQuotes"],
    queryFn: ({ signal }) => api.indices(signal),
    staleTime: STALE_TIME.market,
    refetchInterval,
  });
}

export function findQuote(quotes: readonly IndexQuote[] | undefined, symbol: string): IndexQuote | null {
  return quotes?.find((q) => q.symbol === symbol) ?? null;
}

/** Quote timestamps are epoch seconds. */
export function quoteTimeMs(quote: Pick<IndexQuote, "timestamp"> | null | undefined): number | null {
  const ts = quote?.timestamp;
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
}

export function useIndexHistory(symbol: string, period: ChartPeriod) {
  const liveInterval = useLiveRefetchInterval(60_000);
  const intraday = period === "1d" || period === "5d";
  return useQuery({
    queryKey: ["indexChart", symbol, period],
    queryFn: ({ signal }) => api.indexData(symbol, period, signal),
    staleTime: intraday ? STALE_TIME.market : STALE_TIME.analysis,
    refetchInterval: period === "1d" ? liveInterval : false,
    placeholderData: (previous) => previous,
  });
}

/** Default screener rows (all BIST stocks with close / change_pct / volume / market_cap). */
export function useScreenerRows() {
  const refetchInterval = useLiveRefetchInterval(120_000);
  return useQuery({
    queryKey: ["screener", "dashboard-default"],
    queryFn: ({ signal }) => api.screener(undefined, signal),
    staleTime: STALE_TIME.market,
    refetchInterval,
  });
}

/** Tracked companies (BIST 100 constituents at seed time) with display names. */
export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    queryFn: () => api.companies(),
    staleTime: STALE_TIME.reference,
  });
}
