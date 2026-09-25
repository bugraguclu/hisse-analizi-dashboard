"use client";

import { useMemo } from "react";
import { getMarketStatus, isLiveDataWindow, type MarketStatus } from "@/lib/market-hours";
import { LIVE_REFETCH_MS } from "@/lib/queryClient";
import { useNow } from "./use-now";

/**
 * BIST session status, re-evaluated every 30 s. `null` until mounted (SSR).
 * Pass the latest quote time (epoch ms or a Date — IndexQuote.timestamp is in
 * seconds, convert it with quoteTimeMs()) so holidays / early closes read as
 * "no trading".
 */
export function useMarketStatus(lastQuoteAt?: Date | number | null): MarketStatus | null {
  const now = useNow();
  return useMemo(() => (now === null ? null : getMarketStatus(now, lastQuoteAt)), [now, lastQuoteAt]);
}

/**
 * refetchInterval for live queries: polls from the open until the closing-auction
 * prints have come through the delayed feed (isLiveDataWindow, 10:00–18:30) and
 * resumes automatically at the open (useNow re-renders every 30 s).
 */
export function useLiveRefetchInterval(intervalMs: number = LIVE_REFETCH_MS): number | false {
  const now = useNow();
  return now !== null && isLiveDataWindow(now) ? intervalMs : false;
}
