import type {
  Company,
  EventOut,
  PriceOut,
  FinancialStatementOut,
  FinancialRatioOut,
  TechnicalSignals,
  CompanyInfo,
  StatsOut,
  HealthResponse,
} from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Endpoint-appropriate caching:
 * - "no-store": real-time data that must always be fresh (events, prices, outbox)
 * - "default": let browser/CDN cache with revalidation (companies, macro, fundamentals)
 * React Query handles client-side staleness via staleTime.
 */
type CacheStrategy = "no-store" | "default";

async function get<T>(path: string, cache: CacheStrategy = "default"): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache });
    if (!res.ok) {
      console.warn(`API ${res.status}: ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`API error: ${path}`, err);
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error(`API error: ${path}`, err);
    return null;
  }
}

export const api = {
  // Core
  health: () => get<HealthResponse>("/health"),
  stats: () => get<StatsOut>("/admin/stats", "no-store"),
  companies: () => get<Company[]>("/companies"),
  company: (ticker: string) => get<Company>(`/companies/${ticker}`),

  // Events (real-time, no cache)
  events: (params?: {
    source_code?: string;
    ticker?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.source_code) q.set("source_code", params.source_code);
    if (params?.ticker) q.set("ticker", params.ticker);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<EventOut[]>(`/events${qs ? `?${qs}` : ""}`, "no-store");
  },
  latestEvents: () => get<EventOut[]>("/events/latest", "no-store"),

  // Prices (real-time, no cache)
  prices: (ticker: string, limit = 90) =>
    get<PriceOut[]>(`/prices?ticker=${ticker}&limit=${limit}`, "no-store"),
  latestPrice: (ticker: string) =>
    get<PriceOut>(`/prices/latest?ticker=${ticker}`, "no-store"),

  // Financials (DB, cacheable)
  financials: (ticker: string, statementType?: string) => {
    const q = new URLSearchParams({ ticker });
    if (statementType) q.set("statement_type", statementType);
    return get<FinancialStatementOut[]>(`/financials?${q}`);
  },
  financialRatios: (ticker: string) =>
    get<FinancialRatioOut[]>(`/financials/ratios?ticker=${ticker}`),

  // Technical (backend caches 60s, let fetch cache too)
  rsi: (ticker: string, period?: number) =>
    get(`/technical/${ticker}/rsi${period ? `?period=${period}` : ""}`),
  macd: (ticker: string) => get(`/technical/${ticker}/macd`),
  bollinger: (ticker: string) => get(`/technical/${ticker}/bollinger`),
  signals: (ticker: string) =>
    get<TechnicalSignals>(`/technical/${ticker}/signals`),
  signalsAllTimeframes: (ticker: string) =>
    get(`/technical/${ticker}/signals/all-timeframes`),
  supertrend: (ticker: string) => get(`/technical/${ticker}/supertrend`),
  stochastic: (ticker: string) => get(`/technical/${ticker}/stochastic`),
  sma: (ticker: string, period?: number) =>
    get(`/technical/${ticker}/sma${period ? `?period=${period}` : ""}`),
  ema: (ticker: string, period?: number) =>
    get(`/technical/${ticker}/ema${period ? `?period=${period}` : ""}`),

  // Fundamentals (backend caches 300s)
  companyInfo: (ticker: string) =>
    get<CompanyInfo>(`/fundamentals/${ticker}/info`),
  fastInfo: (ticker: string) => get(`/fundamentals/${ticker}/fast-info`),
  balanceSheet: (ticker: string, quarterly = false) =>
    get(`/fundamentals/${ticker}/balance-sheet?quarterly=${quarterly}`),
  incomeStatement: (ticker: string, quarterly = false) =>
    get(`/fundamentals/${ticker}/income-statement?quarterly=${quarterly}`),
  cashflow: (ticker: string, quarterly = false) =>
    get(`/fundamentals/${ticker}/cashflow?quarterly=${quarterly}`),
  dividends: (ticker: string) =>
    get(`/fundamentals/${ticker}/dividends`),
  holders: (ticker: string) =>
    get(`/fundamentals/${ticker}/holders`),
  recommendations: (ticker: string) =>
    get(`/fundamentals/${ticker}/recommendations`),
  priceTargets: (ticker: string) =>
    get(`/fundamentals/${ticker}/price-targets`),
  earningsDates: (ticker: string) =>
    get(`/fundamentals/${ticker}/earnings-dates`),

  // Macro (backend caches 600s)
  tcmb: () => get("/macro/tcmb"),
  policyRate: () => get("/macro/policy-rate"),
  inflation: () => get("/macro/inflation"),
  fx: (symbol: string) => get(`/macro/fx/${symbol}`),
  calendar: () => get("/macro/calendar"),

  // Market (backend caches 120s)
  screener: (filters?: Record<string, unknown>) =>
    filters ? post("/market/screener", filters) : get("/market/screener"),
  screenerTemplates: () => get("/market/screener/templates"),
  scanner: (condition?: string) =>
    get(`/market/scanner${condition ? `?condition=${condition}` : ""}`),
  indices: () => get("/market/indices"),
  indexData: (symbol: string, period = "1ay") =>
    get(`/market/index/${symbol}?period=${period}`),
  search: (q: string) =>
    get(`/market/search?q=${encodeURIComponent(q)}`),
  allCompanies: () => get("/market/companies/all"),
  tweets: (ticker: string, limit = 10) =>
    get(`/market/tweets/${ticker}?limit=${limit}`),
  snapshot: (symbols: string[]) =>
    get(`/market/snapshot?symbols=${symbols.join(",")}`, "no-store"),

  // Polling
  pollingState: () => get("/polling-state", "no-store"),
};
