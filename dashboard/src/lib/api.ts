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

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
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
  stats: () => get<StatsOut>("/admin/stats"),
  companies: () => get<Company[]>("/companies"),
  company: (ticker: string) => get<Company>(`/companies/${ticker}`),

  // Events
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
    return get<EventOut[]>(`/events${qs ? `?${qs}` : ""}`);
  },
  latestEvents: () => get<EventOut[]>("/events/latest"),

  // Prices
  prices: (ticker: string, limit = 90) =>
    get<PriceOut[]>(`/prices?ticker=${ticker}&limit=${limit}`),
  latestPrice: (ticker: string) =>
    get<PriceOut | PriceOut[]>(`/prices/latest?ticker=${ticker}`),

  // Financials (DB)
  financials: (ticker: string, statementType?: string) => {
    const q = new URLSearchParams({ ticker });
    if (statementType) q.set("statement_type", statementType);
    return get<FinancialStatementOut[]>(`/financials?${q}`);
  },
  financialRatios: (ticker: string) =>
    get<FinancialRatioOut[]>(`/financials/ratios?ticker=${ticker}`),

  // Technical
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

  // Fundamentals
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

  // Macro
  tcmb: () => get("/macro/tcmb"),
  policyRate: () => get("/macro/policy-rate"),
  inflation: () => get("/macro/inflation"),
  fx: (symbol: string) => get(`/macro/fx/${symbol}`),
  calendar: () => get("/macro/calendar"),

  // Market
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
    get(`/market/snapshot?symbols=${symbols.join(",")}`),

  // Polling
  pollingState: () => get("/polling-state"),
};
