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
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  adjusted_close?: number | null;
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
}
