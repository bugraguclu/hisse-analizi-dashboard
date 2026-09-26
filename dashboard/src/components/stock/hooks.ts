"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, isApiError } from "@/lib/api";
import { STALE_TIME } from "@/lib/queryClient";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import {
  findSearchMatch,
  mergeKapItems,
  mergeRatios,
  parseCompany,
  parseCompanyProfile,
  parseDbEvents,
  parseDividends,
  parseEarnings,
  parseFastInfo,
  parseHistory,
  parseHolders,
  parseIndicators,
  parseLiveKap,
  parseMovingAverageCross,
  parseNews,
  parsePivots,
  parseRecommendation,
  parseSignals,
  parseSnapshotQuote,
  parseStatement,
  parseTargets,
  parseTimeframes,
  quoteFromFastInfo,
} from "./parsers";
import type { ChartPeriod, PriceHistory, StockIdentity } from "./types";

/** All stock-page queries live under ["stock", TICKER, …] so they never collide with other pages. */
export const stockKeys = {
  company: (t: string) => ["stock", t, "company"] as const,
  profile: (t: string) => ["stock", t, "profile"] as const,
  search: (t: string) => ["stock", t, "search"] as const,
  snapshot: (t: string) => ["stock", t, "snapshot"] as const,
  fastInfo: (t: string) => ["stock", t, "fastInfo"] as const,
  history: (t: string, period: ChartPeriod) => ["stock", t, "history", period] as const,
  signals: (t: string) => ["stock", t, "signals"] as const,
  timeframes: (t: string) => ["stock", t, "timeframes"] as const,
  indicator: (t: string, name: string) => ["stock", t, "indicator", name] as const,
  pivots: (t: string) => ["stock", t, "pivots"] as const,
  movingAverages: (t: string) => ["stock", t, "movingAverages"] as const,
  liveRatios: (t: string) => ["stock", t, "liveRatios"] as const,
  dbRatios: (t: string) => ["stock", t, "dbRatios"] as const,
  statement: (t: string, kind: StatementKind, quarterly: boolean) => ["stock", t, "statement", kind, quarterly] as const,
  dividends: (t: string) => ["stock", t, "dividends"] as const,
  holders: (t: string) => ["stock", t, "holders"] as const,
  recommendation: (t: string) => ["stock", t, "recommendation"] as const,
  targets: (t: string) => ["stock", t, "targets"] as const,
  earnings: (t: string) => ["stock", t, "earnings"] as const,
  events: (t: string) => ["stock", t, "events"] as const,
  liveKap: (t: string) => ["stock", t, "liveKap"] as const,
  news: (t: string, hours: number) => ["stock", t, "news", hours] as const,
  eventDetail: (id: string) => ["stock", "eventDetail", id] as const,
};

export type StatementKind = "balance" | "income" | "cashflow";

export function isNotFoundError(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}

// ---------------------------------------------------------------------------
// Identity / existence
// ---------------------------------------------------------------------------

export type IdentityState =
  | { status: "loading"; identity: null }
  | { status: "found"; identity: StockIdentity }
  | { status: "notFound"; identity: null }
  /** Lookup itself failed (network/5xx): render the page and let sections report errors. */
  | { status: "unknown"; identity: null };

/**
 * DB companies (BIST-100) are "tracked" (events, news). Other BIST
 * symbols still have live market data, so a DB miss falls back to an exact
 * symbol-search match before declaring the ticker unknown.
 */
export function useStockIdentity(ticker: string): IdentityState {
  const companyQ = useQuery({
    queryKey: stockKeys.company(ticker),
    queryFn: () => api.company(ticker),
    select: parseCompany,
    staleTime: STALE_TIME.reference,
  });
  const notInDb = companyQ.isError && isNotFoundError(companyQ.error);
  const selectMatch = useCallback((data: unknown) => findSearchMatch(data, ticker), [ticker]);
  const searchQ = useQuery({
    queryKey: stockKeys.search(ticker),
    queryFn: ({ signal }) => api.search(ticker, signal),
    select: selectMatch,
    enabled: notInDb,
    staleTime: STALE_TIME.reference,
  });

  if (companyQ.isSuccess) {
    return {
      status: "found",
      identity: { ticker, name: companyQ.data?.name ?? null, legalName: companyQ.data?.legalName ?? null, tracked: true },
    };
  }
  if (companyQ.isPending) return { status: "loading", identity: null };
  if (!notInDb) return { status: "unknown", identity: null };
  if (searchQ.isPending) return { status: "loading", identity: null };
  if (searchQ.isError) return { status: "unknown", identity: null };
  return searchQ.data
    ? { status: "found", identity: { ticker, name: searchQ.data.name, legalName: null, tracked: false } }
    : { status: "notFound", identity: null };
}

/** KAP company card (sector, market segment, website); works for untracked BIST symbols too. */
export function useCompanyProfile(ticker: string) {
  return useQuery({
    queryKey: stockKeys.profile(ticker),
    queryFn: () => api.companyInfo(ticker),
    select: parseCompanyProfile,
    staleTime: STALE_TIME.reference,
  });
}

// ---------------------------------------------------------------------------
// Quote, fast info, price history
// ---------------------------------------------------------------------------

function historyOptions(ticker: string, period: ChartPeriod) {
  return queryOptions({
    queryKey: stockKeys.history(ticker, period),
    // Keep the period next to the payload so placeholder data (previous period)
    // is always sliced with the period it was fetched for.
    queryFn: async () => ({ period, payload: await api.tickerHistory(ticker, period) }),
    staleTime: period === "1d" || period === "5d" ? STALE_TIME.market : STALE_TIME.analysis,
  });
}

function selectHistory(data: { period: ChartPeriod; payload: unknown }): PriceHistory & { period: ChartPeriod } {
  return { period: data.period, ...parseHistory(data.payload) };
}

export function useFastInfo(ticker: string, enabled = true) {
  return useQuery({
    queryKey: stockKeys.fastInfo(ticker),
    queryFn: () => api.fastInfo(ticker),
    select: parseFastInfo,
    staleTime: STALE_TIME.market,
    enabled,
  });
}

/**
 * Daily quote. Primary source is the (fast) snapshot endpoint, whose change is
 * vs previous close. Some symbols are missing from the scanner snapshot; then
 * the quote is rebuilt from fast_info + daily bars.
 */
export function useQuote(ticker: string) {
  const refetchInterval = useLiveRefetchInterval();
  const selectSnapshot = useCallback((data: unknown) => parseSnapshotQuote(data, ticker), [ticker]);
  const snapshotQ = useQuery({
    queryKey: stockKeys.snapshot(ticker),
    queryFn: ({ signal }) => api.snapshot([ticker], signal),
    select: selectSnapshot,
    staleTime: STALE_TIME.live,
    refetchInterval,
  });
  const needFallback = snapshotQ.isError || (snapshotQ.isSuccess && snapshotQ.data === null);
  const fastQ = useFastInfo(ticker, needFallback);
  const dailyQ = useQuery({ ...historyOptions(ticker, "1mo"), select: selectHistory, enabled: needFallback });

  // Reference "today" for the fallback = when the snapshot attempt settled (keeps render pure).
  const settledAt = snapshotQ.dataUpdatedAt || snapshotQ.errorUpdatedAt;
  const quote =
    snapshotQ.data ??
    (needFallback ? quoteFromFastInfo(fastQ.data ?? null, dailyQ.data?.bars ?? [], settledAt) : null);
  const fallbackPending = needFallback && fastQ.isPending && dailyQ.isPending;
  return {
    quote,
    isPending: !quote && (snapshotQ.isPending || fallbackPending),
    isError: !quote && needFallback && fastQ.isError && dailyQ.isError,
    updatedAt: snapshotQ.data ? snapshotQ.dataUpdatedAt : fastQ.dataUpdatedAt,
    refetch: () => {
      void snapshotQ.refetch();
      if (needFallback) {
        void fastQ.refetch();
        void dailyQ.refetch();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

export function useSignals(ticker: string) {
  return useQuery({
    queryKey: stockKeys.signals(ticker),
    queryFn: () => api.signals(ticker),
    select: parseSignals,
    staleTime: STALE_TIME.market,
  });
}

export function useTimeframeSignals(ticker: string) {
  return useQuery({
    queryKey: stockKeys.timeframes(ticker),
    queryFn: () => api.signalsAllTimeframes(ticker),
    select: parseTimeframes,
    staleTime: STALE_TIME.market,
  });
}

/** RSI, MACD, Bollinger, Stochastic and SuperTrend (each can fail independently). */
export function useIndicators(ticker: string) {
  const opts = { staleTime: STALE_TIME.market };
  const rsiQ = useQuery({ queryKey: stockKeys.indicator(ticker, "rsi"), queryFn: () => api.rsi(ticker), ...opts });
  const macdQ = useQuery({ queryKey: stockKeys.indicator(ticker, "macd"), queryFn: () => api.macd(ticker), ...opts });
  const bollQ = useQuery({ queryKey: stockKeys.indicator(ticker, "bollinger"), queryFn: () => api.bollinger(ticker), ...opts });
  const stochQ = useQuery({ queryKey: stockKeys.indicator(ticker, "stochastic"), queryFn: () => api.stochastic(ticker), ...opts });
  const stQ = useQuery({ queryKey: stockKeys.indicator(ticker, "supertrend"), queryFn: () => api.supertrend(ticker), ...opts });
  const queries = { rsi: rsiQ, macd: macdQ, bollinger: bollQ, stochastic: stochQ, supertrend: stQ };
  return {
    data: parseIndicators({
      rsi: rsiQ.data,
      macd: macdQ.data,
      bollinger: bollQ.data,
      stochastic: stochQ.data,
      supertrend: stQ.data,
    }),
    queries,
  };
}

/** Actual SMA50/SMA200 crossover (type + date) from the moving-averages endpoint. */
export function useMovingAverageCross(ticker: string) {
  return useQuery({
    queryKey: stockKeys.movingAverages(ticker),
    queryFn: () => api.movingAverages(ticker),
    select: parseMovingAverageCross,
    staleTime: STALE_TIME.market,
  });
}

export function usePivots(ticker: string) {
  return useQuery({
    queryKey: stockKeys.pivots(ticker),
    queryFn: () => api.pivots(ticker),
    select: parsePivots,
    staleTime: STALE_TIME.market,
  });
}

// ---------------------------------------------------------------------------
// Fundamentals
// ---------------------------------------------------------------------------

export function useRatios(ticker: string) {
  const liveQ = useQuery({
    queryKey: stockKeys.liveRatios(ticker),
    queryFn: () => api.liveRatios(ticker),
    staleTime: STALE_TIME.analysis,
  });
  const dbQ = useQuery({
    queryKey: stockKeys.dbRatios(ticker),
    queryFn: () => api.financialRatios(ticker),
    staleTime: STALE_TIME.analysis,
  });
  return {
    data: mergeRatios(liveQ.data, dbQ.data),
    isPending: liveQ.isPending || dbQ.isPending,
    isError: liveQ.isError && dbQ.isError,
    error: liveQ.error ?? dbQ.error,
    refetch: () => {
      void liveQ.refetch();
      void dbQ.refetch();
    },
  };
}

const STATEMENT_FETCHERS: Record<StatementKind, (ticker: string, quarterly: boolean) => Promise<unknown>> = {
  balance: api.balanceSheet,
  income: api.incomeStatement,
  cashflow: api.cashflow,
};

const selectAnnualStatement = (data: unknown) => parseStatement(data, 5);
const selectInterimStatement = (data: unknown) => parseStatement(data, 8);

export function useStatement(ticker: string, kind: StatementKind, quarterly: boolean) {
  return useQuery({
    queryKey: stockKeys.statement(ticker, kind, quarterly),
    queryFn: () => STATEMENT_FETCHERS[kind](ticker, quarterly),
    select: quarterly ? selectInterimStatement : selectAnnualStatement,
    staleTime: STALE_TIME.analysis,
  });
}

export function useDividends(ticker: string) {
  return useQuery({
    queryKey: stockKeys.dividends(ticker),
    queryFn: () => api.dividends(ticker),
    select: parseDividends,
    staleTime: STALE_TIME.reference,
  });
}

export function useHolders(ticker: string) {
  return useQuery({
    queryKey: stockKeys.holders(ticker),
    queryFn: () => api.holders(ticker),
    select: parseHolders,
    staleTime: STALE_TIME.reference,
  });
}

export function useRecommendation(ticker: string) {
  return useQuery({
    queryKey: stockKeys.recommendation(ticker),
    queryFn: () => api.recommendations(ticker),
    select: parseRecommendation,
    staleTime: STALE_TIME.analysis,
  });
}

export function usePriceTargets(ticker: string) {
  return useQuery({
    queryKey: stockKeys.targets(ticker),
    queryFn: () => api.priceTargets(ticker),
    select: parseTargets,
    staleTime: STALE_TIME.analysis,
  });
}

export function useEarningsCalendar(ticker: string) {
  return useQuery({
    queryKey: stockKeys.earnings(ticker),
    queryFn: () => api.earningsDates(ticker),
    select: parseEarnings,
    staleTime: STALE_TIME.reference,
  });
}

// ---------------------------------------------------------------------------
// KAP disclosures, news, event detail
// ---------------------------------------------------------------------------

/** DB events merged with live KAP disclosures (the DB can lag behind KAP). */
export function useKapItems(ticker: string, limit = 10) {
  const dbQ = useQuery({
    queryKey: stockKeys.events(ticker),
    queryFn: () => api.events({ ticker, limit }),
    select: parseDbEvents,
    staleTime: STALE_TIME.events,
  });
  const liveQ = useQuery({
    queryKey: stockKeys.liveKap(ticker),
    queryFn: () => api.liveNews(ticker),
    select: parseLiveKap,
    staleTime: STALE_TIME.events,
  });
  return {
    items: mergeKapItems(dbQ.data ?? [], liveQ.data ?? [], limit),
    isPending: dbQ.isPending || liveQ.isPending,
    isError: dbQ.isError && liveQ.isError,
    partialError: dbQ.isError !== liveQ.isError,
    error: dbQ.error ?? liveQ.error,
    refetch: () => {
      void dbQ.refetch();
      void liveQ.refetch();
    },
  };
}

export function useTickerNews(ticker: string, hours: number, enabled = true) {
  return useQuery({
    queryKey: stockKeys.news(ticker, hours),
    queryFn: () => api.tickerNews(ticker, hours),
    select: parseNews,
    staleTime: STALE_TIME.events,
    enabled,
  });
}

export function useEventDetail(eventId: string | null) {
  return useQuery({
    queryKey: stockKeys.eventDetail(eventId ?? ""),
    queryFn: () => api.eventDetail(eventId ?? ""),
    enabled: eventId !== null,
    staleTime: STALE_TIME.reference,
  });
}
