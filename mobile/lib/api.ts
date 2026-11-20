/**
 * Shared FastAPI backend contract client for the iOS native foundation.
 * Points at the same `/api/v1/...` endpoints as `dashboard/src/lib/api.ts`.
 */

const DEFAULT_API_BASE = "http://localhost:8000";
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
  marketOverview(signal?: AbortSignal) {
    return fetchJson<MarketOverviewPayload>("/api/v1/market/overview", signal);
  },
  stockSummary(ticker: string, signal?: AbortSignal) {
    return fetchJson<StockSummaryPayload>(`/api/v1/stocks/${encodeURIComponent(ticker)}`, signal);
  },
  events(params?: { ticker?: string; severity?: string; category?: string }, signal?: AbortSignal) {
    const search = new URLSearchParams();
    if (params?.ticker) search.set("ticker", params.ticker);
    if (params?.severity) search.set("severity", params.severity);
    if (params?.category) search.set("category", params.category);
    const qs = search.toString();
    return fetchJson<{ items?: EventItemPayload[] }>(`/api/v1/events${qs ? `?${qs}` : ""}`, signal);
  },
};
