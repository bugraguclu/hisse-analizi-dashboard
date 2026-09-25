/**
 * Frontend types aligned with backend Pydantic schemas.
 *
 * Source of truth: src/schemas/events.py
 * Keep in sync when backend schemas change.
 */

export interface Company {
  id: string;
  ticker: string;
  legal_name: string;
  display_name: string;
  isin?: string | null;
  exchange?: string | null;
  is_active: boolean;
}

export interface EventOut {
  id: string;
  event_type: "KAP_DISCLOSURE" | "OFFICIAL_NEWS" | "OFFICIAL_IR_UPDATE";
  title?: string | null;
  excerpt?: string | null;
  published_at?: string | null;
  event_url?: string | null;
  source_code: string;
  severity: "INFO" | "WATCH" | "HIGH";
  is_notifiable: boolean;
  ticker?: string | null;
  category?: string | null;
  created_at: string;
  // KAP overhaul fields — optional because older backends omit them.
  /** EventCategory enum name (DIVIDEND, CAPITAL_INCREASE, …); prefer it over the legacy `category` slug. */
  category_code?: string | null;
  /** KAP "Özet" headline, only when it adds information beyond `title` (the form name). */
  summary?: string | null;
  /** All tracked tickers of this disclosure, sorted (`ticker` is the first one). */
  tickers?: string[];
  /** Display name of `ticker`'s company. */
  company_name?: string | null;
  /** KAP publisher title, e.g. "İSTANBUL TAKAS VE SAKLAMA BANKASI A.Ş.". */
  publisher?: string | null;
  /** Corrected ("düzeltme") disclosure. */
  is_correction?: boolean;
  attachment_count?: number | null;
}

export interface EventDetailOut extends EventOut {
  body_text?: string | null;
  metadata_json?: Record<string, unknown> | null;
  raw_event_id: string;
}

/** GET /events `sort` values. */
export type EventSort = "newest" | "oldest" | "severity" | "ticker";

/** GET /events/facets — counts for the filter chips (standard faceted-search semantics). */
export interface EventFacetsOut {
  /** Matches with every filter applied. */
  total: number;
  /** Keyed by category code; ignores the `category` filter. */
  categories: Record<string, number>;
  /** Ignores the `severity` filter. */
  severities: Partial<Record<"HIGH" | "WATCH" | "INFO", number>>;
  /** Only the codes asked for with `ticker_facet`; ignores the `ticker` filter. */
  tickers?: Record<string, number>;
}

/** One block of a disclosure body (GET /events/{id}/content). */
export type EventContentBlock =
  | { type: "heading"; text: string }
  | { type: "field"; label: string; value: string }
  /** Paragraphs separated by "\n\n", line breaks "\n". */
  | { type: "text"; text: string }
  /** First row is the header row. */
  | { type: "table"; rows: string[][] };

/** GET /events/{id}/content — full disclosure text fetched from KAP on first view, then cached. */
export interface EventContentOut {
  event_id: string;
  /** KAP page of the disclosure. */
  source_url: string | null;
  blocks: EventContentBlock[];
  /** File names only; downloads happen on KAP. */
  attachments: { name: string }[];
  /** Very large disclosures (financial reports) are cut. */
  truncated: boolean;
  fetched_at: string;
}

export interface PriceOut {
  id: string;
  ticker: string;
  source: string;
  // Decimal columns arrive as strings ("330.2500"); use toFiniteNumber().
  open?: string | null;
  high?: string | null;
  low?: string | null;
  close?: string | null;
  adjusted_close?: string | null;
  volume?: number | null;
  trading_date: string;
  interval: "1d" | "1h" | "15m";
  fetched_at: string;
}

export interface FinancialStatementOut {
  id: string;
  period: string;
  statement_type: string;
  period_type?: string | null;
  currency: string;
  data_json: Record<string, number | string | null>;
  fetched_at: string;
}

export interface FinancialRatioOut {
  id: string;
  period: string;
  roe?: number | null;
  roa?: number | null;
  net_margin?: number | null;
  gross_margin?: number | null;
  ebitda_margin?: number | null;
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  ps_ratio?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  net_debt_ebitda?: number | null;
  calculated_at: string;
}

export interface TechnicalSignals {
  ticker?: string;
  summary?: {
    signal: "AL" | "SAT" | "NOTR";
    buy_count: number;
    sell_count: number;
    neutral_count: number;
  };
  signals?: Record<string, string>;
  rsi?: number;
  macd?: { macd: number; signal: number; histogram: number };
  bollinger?: { upper: number; middle: number; lower: number };
}

export interface MovingAveragesOut {
  ticker: string;
  sma: Record<string, number | null>;
  ema: Record<string, number | null>;
  golden_cross?: boolean | null;
}

export interface PivotsOut {
  ticker: string;
  pivots?: {
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
    s1: number;
    s2: number;
    s3: number;
  } | null;
}

export interface CompanyInfo {
  ticker?: string;
  info?: Record<string, unknown>;
}

export interface StatsOut {
  total_raw_events: number;
  total_normalized_events: number;
  total_price_records: number;
  total_notifications: number;
  total_financial_records: number;
  pending_outbox: number;
}

export interface ScreenerResult {
  ticker?: string;
  symbol?: string;
  name?: string;
  price?: number;
  close?: number;
  change_pct?: number;
  volume?: number;
  pe?: number;
  roe?: number;
  market_cap?: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  environment: string;
  /** Database connectivity check ("ok" when reachable). */
  database?: string;
}

export interface SourceOut {
  id: string;
  code: string;
  name: string;
  base_url?: string | null;
  kind: string;
  poll_interval_seconds: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Polling / market endpoints (shapes verified against the live backend).
// Declared as `type` aliases (not interfaces) so they stay assignable to
// Record<string, unknown> for pages that still index them generically.
// ---------------------------------------------------------------------------

/** GET /polling-state */
export type PollingStateOut = {
  id: string;
  source_id: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_seen_external_id: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

/** Live index quote (TradingView via borsapy). Pre-market fields can be null. */
export type IndexQuote = {
  symbol: string;
  name?: string | null;
  description?: string | null;
  exchange?: string | null;
  currency?: string | null;
  type?: string | null;
  last: number | null;
  change: number | null;
  /** Percent units: -0.78 means -0.78 %. */
  change_percent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  /** Share (lot) volume, not TRY turnover. */
  volume: number | null;
  bid?: number | null;
  ask?: number | null;
  bid_size?: number | null;
  ask_size?: number | null;
  /** Unix epoch seconds of the last update. */
  timestamp: number | null;
};

/** GET /market/indices */
export type IndicesOut = {
  source?: string;
  indices: string[];
  quotes: IndexQuote[];
};

/** One OHLCV bar from borsapy history (pandas column names). */
export type OhlcvBar = {
  /** ISO timestamp with offset, e.g. "2026-09-22T14:30:00+03:00". */
  Date?: string | null;
  Datetime?: string | null;
  Open?: number | null;
  High?: number | null;
  Low?: number | null;
  Close?: number | null;
  Volume?: number | null;
};

/** GET /market/index/{symbol}?period= */
export type IndexHistoryOut = {
  symbol: string;
  period: string;
  interval?: string;
  source?: string;
  /** Live quote; `{}` when the quote could not be fetched. */
  info?: Partial<IndexQuote>;
  data: OhlcvBar[];
  /** Last close strictly before the chart window (null for "max"). */
  reference_close?: number | null;
  /** Istanbul date (YYYY-MM-DD) of `reference_close`. */
  reference_date?: string | null;
};

/** Canonical chart periods accepted by /market/index and /market/ticker/.../history. */
export type ChartPeriod = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "ytd" | "1y" | "5y" | "max";

/** Per-symbol quote in GET /market/snapshot. */
export type SnapshotQuote = {
  currency?: string | null;
  exchange?: string | null;
  timezone?: string | null;
  last_price: number | null;
  open: number | null;
  day_high: number | null;
  day_low: number | null;
  previous_close: number | null;
  /** Percent units. */
  change_percent: number | null;
  volume: number | null;
  market_cap: number | null;
};

/** GET /market/snapshot?symbols=A,B */
export type SnapshotOut = {
  symbols: string[];
  snapshot: Record<string, SnapshotQuote | undefined>;
  source?: string;
};

/** Row of GET /market/screener (extra criteria_* columns vary by filter). */
export type ScreenerRow = {
  symbol: string;
  name?: string | null;
  close?: number | null;
  /** Percent units. */
  change_pct?: number | null;
  change_percent?: number | null;
  volume?: number | null;
  market_cap?: number | null;
  [criteria: string]: unknown;
};

/** GET /market/screener */
export type ScreenerOut = {
  filters?: Record<string, unknown>;
  source?: string;
  results: ScreenerRow[];
};

/**
 * Row of GET /market/screener/universe. Missing values are omitted (never null).
 * Units: prices/`target_price` in TL; `turnover`, `avg_turnover` (30-day average
 * share volume × price) and `market_cap` in TL; `pe`/`pb`/`ev_ebitda` multiples;
 * every other number is in percent except `rsi` (0–100), `rel_volume` (×) and
 * `tech_rating` (TradingView Recommend.All, −1…+1).
 */
export type ScreenerUniverseRow = {
  symbol: string;
  name?: string;
  /** TradingView sector/industry keys (English); labels come from the payload. */
  sector?: string;
  industry?: string;
  /** Curated BIST index codes the stock belongs to (e.g. "XU030"). */
  indices?: string[];
  close?: number;
  change_pct?: number;
  turnover?: number;
  avg_turnover?: number;
  market_cap?: number;
  /** Trailing P/E; absent for loss makers (then `loss` is true). */
  pe?: number;
  loss?: true;
  pb?: number;
  ev_ebitda?: number;
  dividend_yield?: number;
  roe?: number;
  net_margin?: number;
  rsi?: number;
  /** Close vs. SMA50 / SMA200, in percent. */
  sma50_dist?: number;
  sma200_dist?: number;
  /** SMA50/SMA200 cross on the latest daily bar. */
  cross?: "golden" | "death";
  tech_rating?: number;
  rel_volume?: number;
  /** Close vs. the 52-week high (≤ 0) / low (≥ 0), in percent. */
  high_52w_dist?: number;
  low_52w_dist?: number;
  perf_1w?: number;
  perf_1m?: number;
  perf_3m?: number;
  perf_ytd?: number;
  perf_1y?: number;
  /** İş Yatırım research rating. */
  recommendation?: "AL" | "TUT" | "SAT";
  target_price?: number;
  upside?: number;
  foreign_ratio?: number;
};

/** GET /market/screener/universe — every BIST stock for client-side screening. */
export type ScreenerUniverseOut = {
  /** ISO timestamp of the market-data fetch. */
  as_of: string;
  source?: string;
  /** The TradingView feed is delayed by this many minutes. */
  delay_minutes?: number;
  count: number;
  priced?: number;
  indices: Array<{ code: string; count: number }>;
  sectors: Array<{ key: string; name_tr: string; count: number }>;
  /** English industry key → Turkish label. */
  industries: Record<string, string>;
  /** Degraded parts: "analyst" (İş Yatırım), "indices" (index membership). */
  warnings: string[];
  rows: ScreenerUniverseRow[];
};

/** Result of GET /market/search */
export type SymbolSearchResult = {
  symbol: string;
  ticker?: string | null;
  name?: string | null;
  full_name?: string | null;
  description?: string | null;
  exchange?: string | null;
  type?: string | null;
  currency?: string | null;
  country?: string | null;
  sector?: string | null;
};

/** GET /market/search?q= */
export type SymbolSearchOut = {
  query: string;
  source?: string;
  results: SymbolSearchResult[];
};

/** GET /market/companies/all — the BIST equity universe (İş Yatırım screener). */
export type AllCompaniesOut = {
  count: number;
  source?: string;
  /** `criteria_8` is İş Yatırım's market value column, million TL. */
  companies: Array<{ symbol: string; name?: string | null; criteria_8?: number | null }>;
  error?: string;
};

/**
 * GET /market/ticker/{t}/history and /market/index/{s} with `warmup` > 0 (used by
 * components/charts). `data` is the period's window, `warmup` the bars right
 * before it (same interval, ascending, may be empty).
 */
export type ChartHistoryOut = {
  period: string;
  interval?: string;
  info?: Record<string, unknown>;
  data: OhlcvBar[];
  warmup?: OhlcvBar[];
  /** Last close strictly before the window (null for "max"). */
  reference_close?: number | null;
  reference_date?: string | null;
  error?: string;
};
