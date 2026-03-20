export interface Company {
  id: string;
  ticker: string;
  legal_name?: string;
  display_name?: string;
  name?: string;
  isin?: string;
  exchange?: string;
  is_active?: boolean;
  sector?: string;
}

export interface EventOut {
  id: string;
  ticker?: string;
  source_code: string;
  event_type?: string;
  title?: string;
  excerpt?: string;
  body_text?: string;
  summary?: string;
  event_url?: string;
  url?: string;
  severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category?: string;
  published_at?: string;
  created_at?: string;
}

export interface PriceOut {
  id?: string;
  ticker?: string;
  trading_date?: string;
  date?: string;
  timestamp?: string;
  interval?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface FinancialStatementOut {
  id: string;
  company_id: string;
  statement_type: "balance_sheet" | "income_stmt" | "cash_flow";
  period: string;
  period_type?: string;
  data_json?: Record<string, number | string>;
  currency?: string;
}

export interface FinancialRatioOut {
  id: string;
  company_id: string;
  period?: string;
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
  name?: string;
  longName?: string;
  shortName?: string;
  sector?: string;
  industry?: string;
  market_cap?: number;
  marketCap?: number;
  pe_ratio?: number;
  trailingPE?: number;
  dividend_yield?: number;
  dividendYield?: number;
  description?: string;
  longBusinessSummary?: string;
  website?: string;
  fullTimeEmployees?: number;
}

export interface StatsOut {
  total_raw_events?: number;
  total_normalized_events?: number;
  total_price_records?: number;
  total_notifications?: number;
  total_financial_records?: number;
  total_companies?: number;
  total_sources?: number;
  pending_outbox?: number;
  version?: string;
}

export interface ScreenerResult {
  ticker?: string;
  symbol?: string;
  code?: string;
  name?: string;
  price?: number;
  close?: number;
  last?: number;
  change_pct?: number;
  change_percent?: number;
  volume?: number;
  pe?: number;
  roe?: number;
  market_cap?: number;
}

export interface HealthResponse {
  status: string;
  version?: string;
  uptime?: number;
}
