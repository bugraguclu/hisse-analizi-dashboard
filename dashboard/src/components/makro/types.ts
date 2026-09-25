/** Response shapes of the /macro/* endpoints used by the macro page. */

export interface PolicyRateChange {
  /** Effective date (ISO day) — the business day after the MPC decision. */
  date: string;
  rate: number;
  previous: number | null;
  change_bp: number | null;
}

export interface PolicyRateOut {
  source?: string;
  source_url?: string;
  as_of?: string;
  policy_rate?: { value?: number; date?: string };
  history?: Array<{ date?: string; borrowing?: number | null; lending?: number | null }>;
  /** Every change since 2010, ascending. */
  changes?: PolicyRateChange[];
  last_change?: PolicyRateChange | null;
}

export interface TcmbRateRow {
  type?: "policy" | "overnight" | "late_liquidity" | (string & {});
  date?: string;
  borrowing?: number | null;
  lending?: number | null;
}

export interface TcmbRatesOut {
  source?: string;
  source_url?: string;
  as_of?: string;
  data?: TcmbRateRow[];
}

export type TcmbEventType = "mpc_decision" | "mpc_summary" | "inflation_report" | "financial_stability_report";

export interface TcmbEvent {
  type: TcmbEventType;
  date: string;
  /** Announcement time (Istanbul), rate decisions only. */
  time?: string;
}

export interface TcmbCalendarOut {
  source?: string;
  source_url?: string;
  events?: TcmbEvent[];
  next?: Partial<Record<TcmbEventType, TcmbEvent>>;
  last?: Partial<Record<TcmbEventType, TcmbEvent>>;
}

export interface InflationRow {
  Date?: string;
  YearMonth?: string;
  YearlyInflation?: number | null;
  MonthlyInflation?: number | null;
}

export interface InflationLatest {
  date?: string;
  year_month?: string;
  yearly_inflation?: number | null;
  monthly_inflation?: number | null;
  type?: string;
}

export interface InflationOut {
  source?: string;
  source_url?: string;
  as_of?: string;
  latest?: InflationLatest;
  /** Newest first. */
  tufe_history?: InflationRow[];
  ufe_latest?: InflationLatest | null;
  /** Newest first. */
  ufe_history?: InflationRow[];
}

export type IndicatorGroup = "growth" | "labor" | "prices" | "external" | "fiscal" | "monetary" | "global";
export type IndicatorUnit = "percent" | "index" | "USD" | "TRY" | "tonnes";
export type IndicatorFrequency = "decision" | "week" | "month" | "quarter" | "year";

export interface MacroIndicator {
  key: string;
  symbol: string;
  group: IndicatorGroup;
  name: string;
  unit: IndicatorUnit;
  frequency: IndicatorFrequency;
  value: number;
  previous: number | null;
  /** Absolute change in the series' own unit (percentage points for rates). */
  change: number | null;
  /** End of the reference period (ISO day); the decision day for policy rates. */
  period: string | null;
}

export interface IndicatorsOut {
  source?: string;
  as_of?: string;
  indicators?: MacroIndicator[];
}

export type MarketGroup = "fx" | "commodity" | "bond" | "global";
export type MarketUnit = "TRY" | "USD" | "percent" | "index";

export interface MarketQuote {
  key: string;
  group: MarketGroup;
  name: string;
  unit: MarketUnit;
  symbol: string | null;
  tenor_years: number | null;
  derived: boolean;
  last: number;
  previous_close: number | null;
  /** Absolute change vs the previous close (percentage points for yields). */
  change: number | null;
  change_percent: number | null;
  updated_at: string | null;
}

export interface MarketsOut {
  source?: string;
  as_of?: string | null;
  instruments?: MarketQuote[];
}

export type MarketPeriod = "1ay" | "3ay" | "6ay" | "ytd" | "1y" | "2y" | "5y";

export interface MarketHistoryOut {
  key: string;
  name: string;
  unit: MarketUnit;
  group: MarketGroup;
  period: MarketPeriod;
  interval: string;
  source: string;
  points: Array<{ date: string; close: number }>;
  reference_close: number | null;
  reference_date: string | null;
  change: number | null;
  change_percent: number | null;
  high: number | null;
  low: number | null;
}

export interface FxBulletinRate {
  currency: string;
  /** Always 1 — rates are normalized to one unit. */
  unit: number;
  /** Unit TCMB quotes the currency in (100 for JPY). */
  quoted_unit: number;
  name: string;
  forex_buying: number | null;
  forex_selling: number | null;
  banknote_buying: number | null;
  banknote_selling: number | null;
  previous_selling: number | null;
  change_percent: number | null;
}

export interface FxBulletinOut {
  source?: string;
  source_url?: string;
  date?: string;
  previous_date?: string | null;
  rates?: FxBulletinRate[];
}
