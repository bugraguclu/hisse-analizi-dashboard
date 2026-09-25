"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { STALE_TIME } from "@/lib/queryClient";
import type {
  FxBulletinOut,
  IndicatorsOut,
  InflationOut,
  MarketHistoryOut,
  MarketPeriod,
  MarketsOut,
  PolicyRateOut,
  TcmbCalendarOut,
  TcmbRatesOut,
} from "./types";

/**
 * Query keys live under ["macro", …] so they never collide with other pages
 * (the top market strip owns ["fx-usd"] / ["fx-eur"] with a different shape).
 */
export const MACRO_QUERY_ROOT = ["macro"] as const;

const MARKETS_REFRESH_MS = 60_000;

export function usePolicyRate() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "policy-rate"],
    queryFn: () => api.policyRate() as Promise<PolicyRateOut>,
    staleTime: STALE_TIME.reference,
  });
}

export function useTcmbRates() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "tcmb-rates"],
    queryFn: () => api.tcmb() as Promise<TcmbRatesOut>,
    staleTime: STALE_TIME.reference,
  });
}

export function useTcmbCalendar() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "tcmb-calendar"],
    queryFn: ({ signal }) => api.tcmbCalendar(signal) as Promise<TcmbCalendarOut>,
    staleTime: STALE_TIME.reference,
  });
}

export function useInflation() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "inflation"],
    queryFn: () => api.inflation() as Promise<InflationOut>,
    staleTime: STALE_TIME.reference,
  });
}

export function useIndicators() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "indicators"],
    queryFn: ({ signal }) => api.macroIndicators(signal) as Promise<IndicatorsOut>,
    staleTime: STALE_TIME.reference,
  });
}

/** FX, gold, oil and bond yields; FX trades around the clock on weekdays, so poll every minute. */
export function useMarkets() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "markets"],
    queryFn: ({ signal }) => api.macroMarkets(signal) as Promise<MarketsOut>,
    staleTime: STALE_TIME.market,
    refetchInterval: MARKETS_REFRESH_MS,
  });
}

export function useMarketHistory(key: string, period: MarketPeriod) {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "market-history", key, period],
    queryFn: ({ signal }) => api.macroMarketHistory(key, period, signal) as Promise<MarketHistoryOut>,
    staleTime: STALE_TIME.analysis,
    placeholderData: (previous) => (previous?.key === key ? previous : undefined),
  });
}

export function useFxBulletin() {
  return useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "fx-bulletin"],
    queryFn: ({ signal }) => api.fxBulletin(signal) as Promise<FxBulletinOut>,
    staleTime: STALE_TIME.analysis,
  });
}
