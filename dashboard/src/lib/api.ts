import type {
  Company,
  EventOut,
  EventDetailOut,
  PriceOut,
  FinancialStatementOut,
  FinancialRatioOut,
  TechnicalSignals,
  MovingAveragesOut,
  PivotsOut,
  CompanyInfo,
  StatsOut,
  HealthResponse,
} from "@/types";

/**
 * Single source of truth for browser requests.
 *
 * Same-origin `/api` is the safe production default: the browser never needs
 * to know a Docker-internal hostname and Next.js can proxy to the backend.
 * A public URL remains supported for deployments that intentionally expose
 * the API on a separate origin.
 */
const configuredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();
export const API_BASE = (configuredApiBase || "/api").replace(/\/$/, "");

export class ApiError extends Error {
  status: number | null;
  path: string;

  constructor(message: string, path: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
  }
}

/**
 * Endpoint-appropriate caching:
 * - "no-store": real-time data that must always be fresh (events, prices, outbox)
 * - "default": let browser/CDN cache with revalidation (companies, macro, fundamentals)
 * React Query handles client-side staleness via staleTime.
 *
 * Errors are THROWN (not swallowed) so React Query can retry and surface
 * error states instead of rendering misleading "no data" screens.
 */
type CacheStrategy = "no-store" | "default";

const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getErrorMessage(res: Response, path: string): Promise<string> {
  try {
    const payload = (await res.json()) as { detail?: unknown; message?: unknown };
    const detail = payload.detail ?? payload.message;
    if (typeof detail === "string" && detail.trim()) return detail;
  } catch {
    // Non-JSON error responses fall back to a stable, user-safe message.
  }
  return `API ${res.status}: ${path}`;
}

async function get<T>(path: string, cache: CacheStrategy = "default"): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}${path}`, { cache });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      timedOut ? `İstek zaman aşımına uğradı: ${path}` : `API'ye ulaşılamıyor: ${path}`,
      path,
    );
  }
  if (!res.ok) {
    throw new ApiError(await getErrorMessage(res, path), path, res.status);
  }
  const payload = (await res.json()) as T;
  if (payload && typeof payload === "object" && "error" in payload) {
    const upstreamError = (payload as { error?: unknown }).error;
    if (typeof upstreamError === "string" && upstreamError.trim()) {
      throw new ApiError(upstreamError, path, 502);
    }
  }
  return payload;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      timedOut ? `İstek zaman aşımına uğradı: ${path}` : `API'ye ulaşılamıyor: ${path}`,
      path,
    );
  }
  if (!res.ok) {
    throw new ApiError(await getErrorMessage(res, path), path, res.status);
  }
  const payload = (await res.json()) as T;
  if (payload && typeof payload === "object" && "error" in payload) {
    const upstreamError = (payload as { error?: unknown }).error;
    if (typeof upstreamError === "string" && upstreamError.trim()) {
      throw new ApiError(upstreamError, path, 502);
    }
  }
  return payload;
}

export const api = {
  // Core
  health: () => get<HealthResponse>("/health"),
  stats: () => get<StatsOut>("/stats", "no-store"),
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
  eventDetail: (eventId: string) => get<EventDetailOut>(`/events/${eventId}`, "no-store"),

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
  movingAverages: (ticker: string) =>
    get<MovingAveragesOut>(`/technical/${ticker}/moving-averages`),
  pivots: (ticker: string) =>
    get<PivotsOut>(`/technical/${ticker}/pivots`),

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
  liveRatios: (ticker: string) =>
    get(`/fundamentals/${ticker}/live-ratios`),
  liveNews: (ticker: string) =>
    get(`/fundamentals/${ticker}/live-news`),
  tickerNews: (ticker: string, hours = 48) =>
    get(`/news/${ticker}?hours=${hours}`),

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
  tickerHistory: (ticker: string, period = "1ay") =>
    get<{ ticker: string; period: string; data: Array<Record<string, unknown>> }>(
      `/market/ticker/${ticker}/history?period=${period}`,
    ),

  // Polling
  pollingState: () => get("/polling-state", "no-store"),
};
