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
}

export interface EventDetailOut extends EventOut {
  body_text?: string | null;
  metadata_json?: Record<string, unknown> | null;
  raw_event_id: string;
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
