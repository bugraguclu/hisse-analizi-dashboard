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
  SourceOut,
  IndicesOut,
  IndexHistoryOut,
  ChartHistoryOut,
  ChartPeriod,
  SnapshotOut,
  ScreenerOut,
  ScreenerUniverseOut,
  SymbolSearchOut,
  AllCompaniesOut,
  PollingStateOut,
  EventFacetsOut,
  EventContentOut,
} from "@/types";
import { recordApiMeta } from "./api-meta";

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

/**
 * Machine-readable failure reason: the backend's `code` field when it sends
 * one, otherwise a client-side reason for requests that never produced a
 * usable response.
 */
export type ApiErrorCode = "timeout" | "network" | "invalid_response" | "upstream_error" | (string & {});

/**
 * Every failed request rejects with an ApiError:
 * - `status`: HTTP status, or null when no response arrived (network/timeout)
 * - `detail`: human-readable reason (FastAPI `detail`; Turkish fallback)
 * - `code`:   optional machine-readable reason (see ApiErrorCode)
 */
export class ApiError extends Error {
  status: number | null;
  path: string;
  detail: string;
  code?: ApiErrorCode;

  constructor(message: string, path: string, status: number | null = null, code?: ApiErrorCode) {
    super(message);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
    this.detail = message;
    this.code = code;
  }

  /** 4xx — the request itself is invalid/forbidden/missing; retrying won't help. */
  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
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

/** Slightly above the proxy's 30 s upstream budget, so its JSON 504 arrives first. */
const REQUEST_TIMEOUT_MS = 35_000;

interface RequestOptions {
  cache?: CacheStrategy;
  /** Cancellation (React Query passes `signal` to queryFn for superseded requests). */
  signal?: AbortSignal;
  method?: "GET" | "POST";
  body?: unknown;
}

function describeDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() || null;
  // FastAPI validation errors: [{ loc: [...], msg: "...", type: "..." }, ...]
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : ""))
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : null;
  }
  return null;
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  let detail: string | null = null;
  let code: string | undefined;
  try {
    const payload = (await res.json()) as { detail?: unknown; message?: unknown; code?: unknown };
    detail = describeDetail(payload.detail) ?? describeDetail(payload.message);
    if (typeof payload.code === "string" && payload.code) code = payload.code;
  } catch {
    // Non-JSON error responses fall back to a stable, user-safe message.
  }
  return new ApiError(detail ?? `API ${res.status}: ${path}`, path, res.status, code);
}

async function request<T>(path: string, { cache = "default", signal, method = "GET", body }: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  // Rethrow caller cancellations untouched so React Query treats them as such.
  const failure = (err: unknown, fallback: ApiError): unknown => {
    if (timedOut) return new ApiError(`İstek zaman aşımına uğradı: ${path}`, path, null, "timeout");
    if (signal?.aborted) return err;
    return fallback;
  };

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method,
        cache: method === "GET" ? cache : "no-store",
        signal: controller.signal,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw failure(err, new ApiError(`API'ye ulaşılamıyor: ${path}`, path, null, "network"));
    }
    if (!res.ok) throw await toApiError(res, path);

    let payload: T;
    try {
      payload = (await res.json()) as T;
    } catch (err) {
      throw failure(err, new ApiError(`Geçersiz API yanıtı: ${path}`, path, res.status, "invalid_response"));
    }
    if (payload && typeof payload === "object" && "error" in payload) {
      const upstreamError = (payload as { error?: unknown }).error;
      if (typeof upstreamError === "string" && upstreamError.trim()) {
        throw new ApiError(upstreamError, path, 502, "upstream_error");
      }
    }
    if (method === "GET") recordApiMeta(path, payload);
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

function get<T>(path: string, cache: CacheStrategy = "default", signal?: AbortSignal): Promise<T> {
  return request<T>(path, { cache, signal });
}

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: "POST", body, signal });
}

/** Encode a path parameter (ticker, symbol, id) for safe interpolation. */
const seg = (value: string) => encodeURIComponent(value.trim());

export const api = {
  // Core
  health: () => get<HealthResponse>("/health"),
  stats: () => get<StatsOut>("/stats", "no-store"),
  companies: () => get<Company[]>("/companies"),
  company: (ticker: string) => get<Company>(`/companies/${ticker}`),
  sources: () => get<SourceOut[]>("/sources"),

  // Events (real-time, no cache)
  events: (params?: {
    source_code?: string;
    ticker?: string;
    since?: string;
    until?: string;
    limit?: number;
    offset?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.source_code) q.set("source_code", params.source_code);
    if (params?.ticker) q.set("ticker", params.ticker);
    if (params?.since) q.set("since", params.since);
    if (params?.until) q.set("until", params.until);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<EventOut[]>(`/events${qs ? `?${qs}` : ""}`, "no-store");
  },
  latestEvents: () => get<EventOut[]>("/events/latest", "no-store"),
  eventDetail: (eventId: string, signal?: AbortSignal) => get<EventDetailOut>(`/events/${eventId}`, "no-store", signal),
  /**
   * GET /events with real pagination: reads the `X-Total-Count` header
   * (not carried by the plain `events()` above, which returns just the
   * array) so the UI can page over the server-side filtered count instead
   * of a client-side slice. Supports the full B3 filter set, including the
   * comma-separated `category`/`severity` lists and the free-text `search`.
   */
  eventsPage: async (params?: {
    source_code?: string;
    event_type?: string;
    ticker?: string;
    category?: string;
    severity?: string;
    since?: string;
    until?: string;
    search?: string;
    /** newest (default) | oldest | severity | ticker — see EventSort. */
    sort?: string;
    limit?: number;
    offset?: number;
  }, signal?: AbortSignal): Promise<{ items: EventOut[]; total: number }> => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    }
    const qs = q.toString();
    const path = `/events${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { cache: "no-store", signal, headers: { Accept: "application/json" } });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ApiError(`API'ye ulaşılamıyor: ${path}`, path, null, "network");
    }
    if (!res.ok) throw await toApiError(res, path);
    const items = (await res.json()) as EventOut[];
    const totalHeader = Number(res.headers.get("X-Total-Count"));
    return { items, total: Number.isFinite(totalHeader) ? totalHeader : items.length };
  },
  /** GET /events/facets — filter-chip counts; same filter params as eventsPage (no sort/limit/offset). */
  eventFacets: (params?: {
    ticker?: string;
    category?: string;
    severity?: string;
    since?: string;
    until?: string;
    search?: string;
    /** Comma-separated codes whose disclosure counts are wanted (a filter panel's choices). */
    ticker_facet?: string;
  }, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
    }
    const qs = q.toString();
    return get<EventFacetsOut>(`/events/facets${qs ? `?${qs}` : ""}`, "no-store", signal);
  },
  /** GET /events/{id}/content — full disclosure body (fetched from KAP on first view; 503/429 when KAP is unreachable). */
  eventContent: (eventId: string, signal?: AbortSignal) =>
    get<EventContentOut>(`/events/${seg(eventId)}/content`, "no-store", signal),

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
  /**
   * Economic calendar (backend default TR,US, last month → next month); rows carry `tags` /
   * `key_event`, see components/makro/calendar. `start` / `end` ("YYYY-MM-DD") pick another window.
   */
  economicCalendar: (params: { countries?: string[]; start?: string; end?: string } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    const countries = (params.countries ?? []).filter(Boolean);
    if (countries.length > 0) query.set("countries", countries.join(","));
    if (params.start) query.set("start", params.start);
    if (params.end) query.set("end", params.end);
    const qs = query.toString();
    return get<unknown>(`/macro/calendar${qs ? `?${qs}` : ""}`, "default", signal);
  },
  tcmbCalendar: (signal?: AbortSignal) => get("/macro/tcmb-calendar", "default", signal),
  fxBulletin: (signal?: AbortSignal) => get("/macro/fx-bulletin", "default", signal),
  /** Bond yields, FX, gold/silver, Brent, DXY — one snapshot (backend caches 60 s). */
  macroMarkets: (signal?: AbortSignal) => get("/macro/markets", "no-store", signal),
  macroMarketHistory: (key: string, period: string, signal?: AbortSignal) =>
    get(`/macro/markets/${seg(key)}/history?period=${encodeURIComponent(period)}`, "default", signal),
  /** Growth, labour, external, fiscal indicators (backend caches 1 h). */
  macroIndicators: (signal?: AbortSignal) => get("/macro/indicators", "default", signal),

  // Market (backend caches 120s)
  screener: (filters?: Record<string, unknown>, signal?: AbortSignal) =>
    filters
      ? post<ScreenerOut>("/market/screener", filters, signal)
      : get<ScreenerOut>("/market/screener", "default", signal),
  screenerTemplates: () => get("/market/screener/templates"),
  /** Every BIST stock with price, ratio, technical and analyst fields (the /tarama page filters it client-side). */
  screenerUniverse: (signal?: AbortSignal) =>
    get<ScreenerUniverseOut>("/market/screener/universe", "default", signal),
  scanner: (condition?: string) =>
    get(`/market/scanner${condition ? `?condition=${condition}` : ""}`),
  indices: (signal?: AbortSignal) => get<IndicesOut>("/market/indices", "default", signal),
  /** Canonical yfinance-style periods (1d, 5d, 1mo, 3mo, 6mo, ytd, 1y, 5y, max). */
  indexData: (symbol: string, period: ChartPeriod | (string & {}) = "1mo", signal?: AbortSignal) =>
    get<IndexHistoryOut>(`/market/index/${seg(symbol)}?period=${encodeURIComponent(period)}`, "default", signal),
  search: (q: string, signal?: AbortSignal) =>
    get<SymbolSearchOut>(`/market/search?q=${encodeURIComponent(q)}`, "default", signal),
  allCompanies: (signal?: AbortSignal) => get<AllCompaniesOut>("/market/companies/all", "default", signal),
  snapshot: (symbols: string[], signal?: AbortSignal) =>
    get<SnapshotOut>(`/market/snapshot?symbols=${symbols.map(seg).join(",")}`, "no-store", signal),
  tickerHistory: (ticker: string, period = "1ay") =>
    get<{ ticker: string; period: string; data: Array<Record<string, unknown>> }>(
      `/market/ticker/${ticker}/history?period=${period}`,
    ),
  /**
   * Chart series for the interactive charts (components/charts): the period's
   * window in `data` plus up to `warmup` earlier bars (same interval) in `warmup`,
   * so indicators are valid from the first visible bar.
   */
  chartHistory: (
    kind: "ticker" | "index",
    symbol: string,
    period: ChartPeriod,
    warmup: number,
    signal?: AbortSignal,
  ) =>
    get<ChartHistoryOut>(
      kind === "index"
        ? `/market/index/${seg(symbol)}?period=${encodeURIComponent(period)}&warmup=${warmup}`
        : `/market/ticker/${seg(symbol)}/history?period=${encodeURIComponent(period)}&warmup=${warmup}`,
      "default",
      signal,
    ),

  // Polling
  pollingState: (signal?: AbortSignal) => get<PollingStateOut[]>("/polling-state", "no-store", signal),
};
