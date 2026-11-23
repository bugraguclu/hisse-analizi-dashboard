/**
 * Shared FastAPI backend contract client for the iOS native app.
 * Uses the existing FastAPI routes, directly or through the web `/api` proxy.
 */

import type {
  ChartPeriod,
  Company,
  CompanySectorOut,
  EventOut,
  FinancialRatioOut,
  IndicesOut,
  ScreenerUniverseOut,
  SnapshotOut,
  SymbolSearchOut,
} from "../../dashboard/src/types/index.ts";
import type {
  FxBulletinOut,
  IndicatorsOut,
  InflationOut,
  MarketHistoryOut,
  MarketsOut,
  PolicyRateOut,
  TcmbCalendarOut,
  TcmbRatesOut,
} from "../../dashboard/src/components/makro/types.ts";
import {
  parseEconomicCalendar,
  parseMacroMarketHistory,
  parseMacroOverview,
  type EconomicCalendarEvent,
  type MacroMarketPeriod,
  type ParsedMacroOverview,
} from "./macroParsers.ts";
import {
  extractMovingAverageRows,
  mergeRatios,
  parseAllTimeframes,
  parseAnalystSummary,
  parseChartHistory,
  parseCompanyProfile,
  parseDividends,
  parseEarnings,
  parseFastInfo,
  parseHolders,
  parseMergedKap,
  parseMovingAverageCross,
  parsePivots,
  parseSnapshotQuote,
  parseStatement,
  parseStockNews,
  parseTechnicalSignals,
  quoteFromFastInfo,
  type AnalystSummary,
  type CompanyProfile,
  type DividendItem,
  type EarningsItem,
  type HolderItem,
  type MovingAverageCross,
  type MovingAverageRow,
  type ParsedChartHistory,
  type ParsedTechnicalSignals,
  type PivotLevels,
  type RatioSet,
  type StatementTable,
  type StockFastInfo,
  type StockKapItem,
  type StockNewsItem,
  type StockQuote,
  type TimeframeSignal,
} from "./stockParsers.ts";

const DEFAULT_API_BASE = "https://hisse-analizi.duckdns.org/api";
const REQUEST_TIMEOUT_MS = 15_000;

export type MobileApiErrorCode = "timeout" | "network" | "http" | "invalid_response" | "upstream_error";

export class MobileApiError extends Error {
  readonly status: number;
  readonly code: MobileApiErrorCode;

  constructor(status: number, message: string, code: MobileApiErrorCode = "http") {
    super(message);
    this.name = "MobileApiError";
    this.status = status;
    this.code = code;
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

export interface StockAnalysisOverview {
  ticker: string;
  name: string | null;
  quote: StockQuote | null;
  fastInfo: StockFastInfo | null;
  profile: CompanyProfile | null;
  ratios: RatioSet | null;
  fetchedAt: string;
}

export interface StockTechnicalPayload {
  ticker: string;
  signals: ParsedTechnicalSignals | null;
  timeframes: TimeframeSignal[];
  movingAverages: MovingAverageRow[];
  lastCross: MovingAverageCross | null;
  pivots: PivotLevels | null;
  fetchedAt: string;
}

export interface StockOverviewExtras {
  ticker: string;
  kap: StockKapItem[];
  news: StockNewsItem[];
  dividends: DividendItem[];
  analyst: AnalystSummary | null;
  earnings: EarningsItem[];
  fetchedAt: string;
}

export interface StockFundamentalsExtras {
  ticker: string;
  holders: HolderItem[];
  sector: CompanySectorOut | null;
  fetchedAt: string;
}

export type StatementKind = "balance" | "income" | "cashflow";

export interface MacroCalendarPayload {
  available: boolean;
  rows: EconomicCalendarEvent[];
  asOf: string | null;
}

function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function extractDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { detail?: unknown; message?: unknown; error?: unknown };
  for (const field of [obj.detail, obj.message, obj.error]) {
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return null;
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl()}${path}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timedOut) {
        throw new MobileApiError(0, "İstek zaman aşımına uğradı.", "timeout");
      }
      throw new MobileApiError(0, "Sunucuya ulaşılamıyor.", "network");
    }

    if (!response.ok) {
      let detail: string | null = null;
      try {
        detail = extractDetail(await response.json());
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new MobileApiError(response.status, detail ?? `HTTP ${response.status}`, "http");
    }

    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new MobileApiError(response.status, "Geçersiz sunucu yanıtı.", "invalid_response");
    }

    if (payload && typeof payload === "object" && "error" in payload) {
      const errText = (payload as { error?: unknown }).error;
      if (typeof errText === "string" && errText.trim()) {
        throw new MobileApiError(502, errText.trim(), "upstream_error");
      }
    }

    return payload;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function settleOptional<T>(promise: Promise<T>, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, error };
  }
}

const STATEMENT_ENDPOINT: Record<StatementKind, string> = {
  balance: "balance-sheet",
  income: "income-statement",
  cashflow: "cashflow",
};

export const mobileApi = {
  async marketOverview(signal?: AbortSignal): Promise<MarketOverviewPayload> {
    const data = await fetchJson<IndicesOut>("/market/indices", signal);
    return {
      indices: data.quotes.map((quote) => ({
        code: quote.symbol,
        name: quote.name ?? quote.description ?? quote.symbol,
        price: quote.last,
        change_pct: quote.change_percent,
      })),
    };
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

  async events(
    params?: { ticker?: string; severity?: string; category?: string },
    signal?: AbortSignal,
  ): Promise<{ items: EventItemPayload[] }> {
    const search = new URLSearchParams();
    if (params?.ticker) search.set("ticker", params.ticker);
    if (params?.severity) search.set("severity", params.severity);
    if (params?.category) search.set("category", params.category);
    const qs = search.toString();
    const items = await fetchJson<EventOut[]>(`/events${qs ? `?${qs}` : ""}`, signal);
    return {
      items: items.map((item) => ({
        ...item,
        ticker: item.ticker ?? undefined,
        title: item.summary ?? item.title ?? undefined,
        category: item.category ?? undefined,
        published_at: item.published_at ?? undefined,
      })),
    };
  },

  async screenerUniverse(signal?: AbortSignal): Promise<ScreenerUniverseOut> {
    return fetchJson<ScreenerUniverseOut>("/market/screener/universe", signal);
  },

  async searchSymbols(query: string, signal?: AbortSignal): Promise<SymbolSearchOut> {
    return fetchJson<SymbolSearchOut>(`/market/search?q=${encodeURIComponent(query.trim())}`, signal);
  },

  async stockAnalysisOverview(ticker: string, signal?: AbortSignal): Promise<StockAnalysisOverview> {
    const clean = ticker.trim().toUpperCase();
    const seg = encodeURIComponent(clean);
    const [snapshotRes, fastInfoRes, companyRes, infoRes, liveRatiosRes, dbRatiosRes] = await Promise.all([
      settleOptional(fetchJson<SnapshotOut>(`/market/snapshot?symbols=${seg}`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/fast-info`, signal), signal),
      settleOptional(fetchJson<Company>(`/companies/${seg}`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/info`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/live-ratios`, signal), signal),
      settleOptional(fetchJson<FinancialRatioOut[]>(`/financials/ratios?ticker=${seg}`, signal), signal),
    ]);

    const coreResults = [snapshotRes, fastInfoRes, companyRes, infoRes];
    if (coreResults.every((r) => !r.ok)) {
      const firstErr = coreResults.find((r) => !r.ok);
      throw firstErr && !firstErr.ok ? firstErr.error : new MobileApiError(503, "Hisse verisi alınamadı.");
    }

    const fastInfo = fastInfoRes.ok ? parseFastInfo(fastInfoRes.value) : null;
    const snapQuote = snapshotRes.ok ? parseSnapshotQuote(snapshotRes.value, clean) : null;
    const quote = snapQuote ?? quoteFromFastInfo(fastInfo);
    const profile = infoRes.ok ? parseCompanyProfile(infoRes.value) : null;
    const companyName =
      (companyRes.ok ? companyRes.value?.display_name ?? companyRes.value?.legal_name : null) ??
      profile?.legalName ??
      null;
    const ratios = mergeRatios(
      liveRatiosRes.ok ? liveRatiosRes.value : null,
      dbRatiosRes.ok ? dbRatiosRes.value : null,
    );

    return {
      ticker: clean,
      name: companyName,
      quote,
      fastInfo,
      profile,
      ratios,
      fetchedAt: new Date().toISOString(),
    };
  },

  async stockChartHistory(
    ticker: string,
    period: ChartPeriod,
    warmup = 80,
    signal?: AbortSignal,
  ): Promise<ParsedChartHistory> {
    const seg = encodeURIComponent(ticker.trim().toUpperCase());
    const qs = `period=${encodeURIComponent(period)}&warmup=${Math.max(0, Math.min(warmup, 250))}`;
    const raw = await fetchJson<unknown>(`/market/ticker/${seg}/history?${qs}`, signal);
    return parseChartHistory(raw);
  },

  async stockTechnical(ticker: string, signal?: AbortSignal): Promise<StockTechnicalPayload> {
    const clean = ticker.trim().toUpperCase();
    const seg = encodeURIComponent(clean);
    const [signalsRes, timeframesRes, maRes, pivotsRes] = await Promise.all([
      settleOptional(fetchJson<unknown>(`/technical/${seg}/signals`, signal), signal),
      settleOptional(fetchJson<unknown>(`/technical/${seg}/signals/all-timeframes`, signal), signal),
      settleOptional(fetchJson<unknown>(`/technical/${seg}/moving-averages`, signal), signal),
      settleOptional(fetchJson<unknown>(`/technical/${seg}/pivots`, signal), signal),
    ]);

    const all = [signalsRes, timeframesRes, maRes, pivotsRes];
    if (all.every((r) => !r.ok)) {
      const first = all[0];
      throw !first.ok ? first.error : new MobileApiError(503, "Teknik analiz verisi alınamadı.");
    }

    const signals = signalsRes.ok ? parseTechnicalSignals(signalsRes.value) : null;
    return {
      ticker: clean,
      signals,
      timeframes: timeframesRes.ok ? parseAllTimeframes(timeframesRes.value) : [],
      movingAverages: extractMovingAverageRows(signals?.movingAverages ?? null, maRes.ok ? maRes.value : null),
      lastCross: maRes.ok ? parseMovingAverageCross(maRes.value) : null,
      pivots: pivotsRes.ok ? parsePivots(pivotsRes.value) : null,
      fetchedAt: new Date().toISOString(),
    };
  },

  async stockOverviewExtras(ticker: string, signal?: AbortSignal): Promise<StockOverviewExtras> {
    const clean = ticker.trim().toUpperCase();
    const seg = encodeURIComponent(clean);
    const [dbKapRes, liveKapRes, newsRes, divRes, recRes, targetRes, earnRes] = await Promise.all([
      settleOptional(fetchJson<EventOut[]>(`/events?ticker=${seg}&limit=10`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/live-news`, signal), signal),
      settleOptional(fetchJson<unknown>(`/news/${seg}?hours=72`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/dividends`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/recommendations`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/price-targets`, signal), signal),
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/earnings-dates`, signal), signal),
    ]);

    const all = [dbKapRes, liveKapRes, newsRes, divRes, recRes, targetRes, earnRes];
    if (all.every((r) => !r.ok)) {
      const first = all[0];
      throw !first.ok ? first.error : new MobileApiError(503, "Ek hisse verileri alınamadı.");
    }

    return {
      ticker: clean,
      kap: parseMergedKap(dbKapRes.ok ? dbKapRes.value : null, liveKapRes.ok ? liveKapRes.value : null),
      news: newsRes.ok ? parseStockNews(newsRes.value) : [],
      dividends: divRes.ok ? parseDividends(divRes.value) : [],
      analyst: parseAnalystSummary(recRes.ok ? recRes.value : null, targetRes.ok ? targetRes.value : null),
      earnings: earnRes.ok ? parseEarnings(earnRes.value) : [],
      fetchedAt: new Date().toISOString(),
    };
  },

  async stockStatement(
    ticker: string,
    kind: StatementKind,
    quarterly: boolean,
    signal?: AbortSignal,
  ): Promise<StatementTable | null> {
    const seg = encodeURIComponent(ticker.trim().toUpperCase());
    const raw = await fetchJson<unknown>(
      `/fundamentals/${seg}/${STATEMENT_ENDPOINT[kind]}?quarterly=${quarterly ? "true" : "false"}`,
      signal,
    );
    return parseStatement(raw, 4);
  },

  async stockFundamentalsExtras(ticker: string, signal?: AbortSignal): Promise<StockFundamentalsExtras> {
    const clean = ticker.trim().toUpperCase();
    const seg = encodeURIComponent(clean);
    const [holdersRes, sectorRes] = await Promise.all([
      settleOptional(fetchJson<unknown>(`/fundamentals/${seg}/holders`, signal), signal),
      settleOptional(fetchJson<CompanySectorOut>(`/fundamentals/${seg}/sector`, signal), signal),
    ]);

    if (!holdersRes.ok && !sectorRes.ok) {
      throw holdersRes.error;
    }

    return {
      ticker: clean,
      holders: holdersRes.ok ? parseHolders(holdersRes.value) : [],
      sector: sectorRes.ok ? sectorRes.value : null,
      fetchedAt: new Date().toISOString(),
    };
  },

  async macroOverview(signal?: AbortSignal): Promise<ParsedMacroOverview> {
    const [policyRes, tcmbRes, tcmbCalRes, inflationRes, marketsRes, fxRes, indicatorsRes] = await Promise.all([
      settleOptional(fetchJson<PolicyRateOut>("/macro/policy-rate", signal), signal),
      settleOptional(fetchJson<TcmbRatesOut>("/macro/tcmb", signal), signal),
      settleOptional(fetchJson<TcmbCalendarOut>("/macro/tcmb-calendar", signal), signal),
      settleOptional(fetchJson<InflationOut>("/macro/inflation", signal), signal),
      settleOptional(fetchJson<MarketsOut>("/macro/markets", signal), signal),
      settleOptional(fetchJson<FxBulletinOut>("/macro/fx-bulletin", signal), signal),
      settleOptional(fetchJson<IndicatorsOut>("/macro/indicators", signal), signal),
    ]);

    const core = [policyRes, inflationRes, marketsRes];
    if (core.every((r) => !r.ok)) {
      const first = core[0];
      throw !first.ok ? first.error : new MobileApiError(503, "Makro veriler alınamadı.");
    }

    return parseMacroOverview({
      policyRate: policyRes.ok ? policyRes.value : null,
      tcmbRates: tcmbRes.ok ? tcmbRes.value : null,
      tcmbCalendar: tcmbCalRes.ok ? tcmbCalRes.value : null,
      inflation: inflationRes.ok ? inflationRes.value : null,
      markets: marketsRes.ok ? marketsRes.value : null,
      fxBulletin: fxRes.ok ? fxRes.value : null,
      indicators: indicatorsRes.ok ? indicatorsRes.value : null,
    });
  },

  async macroMarketHistory(
    key: string,
    period: MacroMarketPeriod,
    signal?: AbortSignal,
  ): Promise<MarketHistoryOut | null> {
    const seg = encodeURIComponent(key.trim());
    const raw = await fetchJson<unknown>(
      `/macro/markets/${seg}/history?period=${encodeURIComponent(period)}`,
      signal,
    );
    return parseMacroMarketHistory(raw);
  },

  async macroCalendar(
    params?: { countries?: string[]; start?: string; end?: string; importance?: "high" | "mid" | "low" },
    signal?: AbortSignal,
  ): Promise<MacroCalendarPayload> {
    const search = new URLSearchParams();
    if (params?.countries && params.countries.length > 0) {
      search.set("countries", params.countries.join(","));
    }
    // The default window is two calendar months (~1.3 MB for TR+US); phones ask for less.
    if (params?.start) search.set("start", params.start);
    if (params?.end) search.set("end", params.end);
    if (params?.importance) search.set("importance", params.importance);
    const qs = search.toString();
    const raw = await fetchJson<unknown>(`/macro/calendar${qs ? `?${qs}` : ""}`, signal);
    return parseEconomicCalendar(raw);
  },
};
