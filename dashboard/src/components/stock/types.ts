/**
 * Normalised view models for the stock pages. Backend payloads are loosely
 * typed (borsapy/pandas records), so everything that reaches a component goes
 * through `parsers.ts` first and lands in one of these shapes. Missing
 * upstream values are always `null`, never `0`.
 */

export type SignalLevel = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

export interface SignalGroup {
  level: SignalLevel | null;
  raw: string | null;
  buy: number | null;
  neutral: number | null;
  sell: number | null;
  /** Per-indicator votes, e.g. { EMA10: "buy", RSI: "neutral" }. */
  compute: Record<string, SignalLevel | null>;
  /** Raw indicator values, e.g. { SMA50: 305.7, close: 300.25 }. */
  values: Record<string, number | null>;
}

export interface TechnicalSignals {
  summary: SignalGroup | null;
  oscillators: SignalGroup | null;
  movingAverages: SignalGroup | null;
  interval: string | null;
}

export interface TimeframeSignal {
  timeframe: string;
  /** null when upstream has no data for this timeframe (`{error: …}`). */
  summary: SignalGroup | null;
}

export interface Quote {
  last: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  /** Upstream quote timestamp (epoch ms), when provided. */
  updatedAt: number | null;
}

export interface FastInfo {
  last: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  /** Traded value in TRY. */
  amount: number | null;
  marketCap: number | null;
  shares: number | null;
  pe: number | null;
  pb: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  avg50: number | null;
  avg200: number | null;
  freeFloat: number | null;
  foreignRatio: number | null;
  currency: string | null;
  exchange: string | null;
  updatedAt: number | null;
}

export interface PriceBar {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface PriceHistory {
  bars: PriceBar[];
  interval: string | null;
  /** Last close strictly before the chart window (backend `reference_close`); null for "max". */
  referenceClose: number | null;
}

export type ChartPeriod = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "ytd" | "1y" | "5y" | "max";

export interface StockIdentity {
  ticker: string;
  name: string | null;
  legalName: string | null;
  /** true when the company is tracked in our DB (events, news). */
  tracked: boolean;
}

/** KAP company card fields from `GET /fundamentals/{t}/info` (values stay in Turkish). */
export interface CompanyProfile {
  legalName: string | null;
  sector: string | null;
  /** Borsa İstanbul market segment, e.g. "YILDIZ PAZAR". */
  market: string | null;
  website: string | null;
}

export type RatioKey =
  | "gross_margin"
  | "operating_margin"
  | "ebitda_margin"
  | "net_margin"
  | "roe"
  | "roa"
  | "current_ratio"
  | "net_debt_ebitda"
  | "debt_to_equity"
  | "pe_ratio"
  | "pb_ratio"
  | "ps_ratio"
  | "ev_ebitda"
  | "revenue_growth_yoy"
  | "net_income_growth_yoy";

export interface RatioPeriod {
  /** "2025" (fiscal year) or "2026/06". */
  label: string;
  /** Trailing twelve months ending at `label`. */
  ttm: boolean;
}

export interface RatioSet {
  values: Partial<Record<RatioKey, number>>;
  /** Period each value belongs to. */
  periods: Partial<Record<RatioKey, RatioPeriod>>;
  /** Most common period across the set (shown in the card header). */
  mainPeriod: RatioPeriod | null;
}

export interface StatementPeriod {
  key: string;
  year: number | null;
  month: number | null;
  /** Months covered by a flow figure (e.g. 6 for a cumulative H1), when known. */
  months: number | null;
  periodType: "annual" | "interim" | null;
  /** Sort key (yyyymm), higher = newer. */
  rank: number;
}

export interface StatementRow {
  label: string;
  depth: number;
  values: Array<number | null>;
}

export interface StatementTable {
  periods: StatementPeriod[];
  rows: StatementRow[];
  /** Single-quarter (de-cumulated) values for the same periods, when the backend provides them. */
  discreteRows: StatementRow[] | null;
  source: string | null;
  sourceUrl: string | null;
  /** Backend `value_basis`: interim flows are cumulative year-to-date (true) or not (false). */
  cumulative: boolean | null;
  /** Backend explanations (e.g. restatements, missing statements). */
  notes: string[];
  /** Backend says the statement does not exist for this company (e.g. bank cash flow). */
  unavailable: boolean;
}

export interface Dividend {
  date: string;
  time: number;
  grossPerShare: number | null;
  netPerShare: number | null;
  grossRate: number | null;
  total: number | null;
}

export interface Holder {
  name: string;
  percent: number;
  isOther: boolean;
}

export interface AnalystRecommendation {
  level: SignalLevel | null;
  raw: string | null;
  target: number | null;
  upside: number | null;
}

export interface PriceTargets {
  current: number | null;
  low: number | null;
  high: number | null;
  mean: number | null;
  median: number | null;
  analysts: number | null;
}

export interface EarningsDate {
  date: string;
  time: number;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
}

export interface KapItem {
  /** DB event id (opens the detail dialog); null for live-only items. */
  id: string | null;
  title: string;
  url: string | null;
  publishedAt: string | null;
  time: number;
  severity: string | null;
}

export type Sentiment = "positive" | "neutral" | "negative";
export type Impact = "low" | "medium" | "high";

export interface NewsItem {
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  sentiment: Sentiment | null;
  impact: Impact | null;
  rationale: string | null;
}

export interface Indicators {
  rsi: number | null;
  rsiPeriod: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null } | null;
  macdParams: string | null;
  bollinger: { upper: number | null; middle: number | null; lower: number | null; period: number | null; stdDev: number | null } | null;
  stochastic: { k: number | null; d: number | null } | null;
  stochasticParams: string | null;
  supertrend: { value: number | null; direction: number | null } | null;
  supertrendParams: string | null;
}

export interface Pivots {
  /** Session the levels were computed from ("YYYY-MM-DD"). */
  sessionDate: string | null;
  pivot: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
}

export interface MovingAverageCross {
  type: "golden" | "death";
  date: string | null;
  barsAgo: number | null;
}
