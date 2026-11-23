/**
 * Shared FastAPI backend contract client for the iOS native foundation.
 * Uses the existing FastAPI routes, directly or through the web `/api` proxy.
 */

import type { Company, EventOut, FinancialRatioOut, IndicesOut, SnapshotOut } from "../../dashboard/src/types/index.ts";

const DEFAULT_API_BASE = "https://hisse-analizi.duckdns.org/api";
const REQUEST_TIMEOUT_MS = 10_000;

export class MobileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MobileApiError";
    this.status = status;
  }
}

export interface MarketIndexQuote {
  code: string;
  name: string;
  price: number | null;
  change_pct: number | null;
}

export interface MarketOverviewPayload {
  indices?: MarketIndexQuote[];
  updated_at?: string;
}

export interface StockSummaryPayload {
  ticker: string;
  name?: string;
  close?: number | null;
  change_pct?: number | null;
  pe?: number | null;
  pb?: number | null;
  sector?: string | null;
}

export interface EventItemPayload {
  id: number | string;
  ticker?: string;
  title?: string;
  category?: string;
  severity?: string;
  published_at?: string;
}

function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new MobileApiError(response.status, `HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export const mobileApi = {
  async marketOverview(signal?: AbortSignal): Promise<MarketOverviewPayload> {
    const data = await fetchJson<IndicesOut>("/market/indices", signal);
    return { indices: data.quotes.map((quote) => ({
      code: quote.symbol,
      name: quote.name ?? quote.description ?? quote.symbol,
      price: quote.last,
      change_pct: quote.change_percent,
    })) };
  },
  async stockSummary(ticker: string, signal?: AbortSignal): Promise<StockSummaryPayload> {
    const symbol = encodeURIComponent(ticker);
    const [prices, company, ratios] = await Promise.all([
      fetchJson<SnapshotOut>(`/market/snapshot?symbols=${symbol}`, signal),
      fetchJson<Company>(`/companies/${symbol}`, signal).catch(() => null),
      fetchJson<FinancialRatioOut[]>(`/financials/ratios?ticker=${symbol}`, signal).catch(() => []),
    ]);
    const quote = prices.snapshot[ticker];
    return {
      ticker,
      name: company?.display_name,
      close: quote?.last_price ?? null,
      change_pct: quote?.change_percent ?? null,
      pe: ratios[0]?.pe_ratio ?? null,
      pb: ratios[0]?.pb_ratio ?? null,
    };
  },
  async events(params?: { ticker?: string; severity?: string; category?: string }, signal?: AbortSignal): Promise<{ items: EventItemPayload[] }> {
    const search = new URLSearchParams();
    if (params?.ticker) search.set("ticker", params.ticker);
    if (params?.severity) search.set("severity", params.severity);
    if (params?.category) search.set("category", params.category);
    const qs = search.toString();
    const items = await fetchJson<EventOut[]>(`/events${qs ? `?${qs}` : ""}`, signal);
    return { items: items.map((item) => ({ ...item, ticker: item.ticker ?? undefined, title: item.summary ?? item.title ?? undefined, category: item.category ?? undefined, published_at: item.published_at ?? undefined })) };
  },
};
