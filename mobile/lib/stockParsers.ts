/**
 * Pure backend-response parsers for mobile stock analysis screens.
 * Mirrors web `dashboard/src/components/stock/parsers.ts`:
 *  - Missing / NaN / invalid upstream values always become `null` (never `0`).
 *  - Prices and price-like fields must be > 0 to count as present.
 */

import { parseIsoOrEpoch, toFiniteNumber } from "./format.ts";

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStr(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function pos(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function pick(obj: Obj | null | undefined, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (val !== undefined && val !== null) return val;
  }
  return undefined;
}

function records(resp: unknown, ...keys: string[]): Obj[] {
  const root = asObj(resp);
  const rows = Array.isArray(resp) ? resp : asArr(pick(root, ...keys));
  return rows.map(asObj).filter((r): r is Obj => r !== null);
}

function safeUrl(value: unknown): string | null {
  const s = asStr(value);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Quote & FastInfo & Price History
// ---------------------------------------------------------------------------

export interface StockQuote {
  last: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  updatedAt: number | null;
  source: string | null;
  delayMinutes: number | null;
}

export interface StockFastInfo {
  last: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  amount: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  avg50: number | null;
  avg200: number | null;
  freeFloat: number | null;
  foreignRatio: number | null;
  updatedAt: number | null;
}

export function parseSnapshotQuote(resp: unknown, ticker: string): StockQuote | null {
  const root = asObj(resp);
  const row = asObj(asObj(root?.snapshot)?.[ticker]);
  if (!row || row.error) return null;
  const last = pos(row.last_price);
  if (last === null) return null;
  const pct = toFiniteNumber(row.change_percent);
  let prevClose = pos(row.previous_close);
  if (prevClose === null && pct !== null && pct > -100) {
    prevClose = last / (1 + pct / 100);
  }
  const meta = asObj(root?.meta);
  return {
    last,
    prevClose,
    change: toFiniteNumber(row.change) ?? (prevClose !== null ? last - prevClose : null),
    changePct: pct ?? (prevClose !== null ? (last / prevClose - 1) * 100 : null),
    open: pos(row.open),
    high: pos(row.day_high),
    low: pos(row.day_low),
    volume: toFiniteNumber(row.volume),
    marketCap: pos(row.market_cap),
    updatedAt: parseIsoOrEpoch(pick(row, "updated_at", "timestamp") as string | number | null) ??
      parseIsoOrEpoch(pick(meta, "as_of", "fetched_at") as string | number | null),
    source: asStr(root?.source) ?? asStr(meta?.source),
    delayMinutes: toFiniteNumber(pick(root, "delay_minutes")) ?? 15,
  };
}

export function parseFastInfo(resp: unknown): StockFastInfo | null {
  const root = asObj(resp);
  const fi = asObj(root?.fast_info) ?? asObj(root?.info) ?? root;
  if (!fi) return null;
  const out: StockFastInfo = {
    last: pos(fi.last_price),
    open: pos(fi.open),
    dayHigh: pos(fi.day_high),
    dayLow: pos(fi.day_low),
    prevClose: pos(fi.previous_close),
    change: toFiniteNumber(fi.change),
    changePct: toFiniteNumber(fi.change_percent),
    volume: toFiniteNumber(fi.volume),
    amount: pos(fi.amount),
    marketCap: pos(fi.market_cap),
    pe: toFiniteNumber(fi.pe_ratio),
    pb: toFiniteNumber(fi.pb_ratio),
    yearHigh: pos(fi.year_high),
    yearLow: pos(fi.year_low),
    avg50: pos(fi.fifty_day_average),
    avg200: pos(fi.two_hundred_day_average),
    freeFloat: toFiniteNumber(fi.free_float),
    foreignRatio: toFiniteNumber(fi.foreign_ratio),
    updatedAt: parseIsoOrEpoch(fi.updated_at as string | number | null),
  };
  const hasAny = Object.values(out).some((v) => v !== null);
  return hasAny ? out : null;
}

export function quoteFromFastInfo(fi: StockFastInfo | null, fallbackClose: number | null = null): StockQuote | null {
  const last = fi?.last ?? fallbackClose;
  if (last === null || last <= 0) return null;
  const prevClose = fi?.prevClose ?? null;
  return {
    last,
    prevClose,
    change: fi?.change ?? (prevClose !== null ? last - prevClose : null),
    changePct: fi?.changePct ?? (prevClose !== null ? (last / prevClose - 1) * 100 : null),
    open: fi?.open ?? null,
    high: fi?.dayHigh ?? null,
    low: fi?.dayLow ?? null,
    volume: fi?.volume ?? null,
    marketCap: fi?.marketCap ?? null,
    updatedAt: fi?.updatedAt ?? null,
    source: null,
    delayMinutes: 15,
  };
}

export interface ChartBar {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

export interface ParsedChartHistory {
  period: string;
  interval: string | null;
  bars: ChartBar[];
  warmup: ChartBar[];
  referenceClose: number | null;
  referenceDate: string | null;
}

function parseBars(rows: Obj[]): ChartBar[] {
  const bars: ChartBar[] = [];
  for (const row of rows) {
    const time = parseIsoOrEpoch(pick(row, "Date", "Datetime", "date", "datetime", "timestamp") as string | number | null);
    const close = pos(pick(row, "Close", "close"));
    if (time === null || close === null) continue;
    bars.push({
      time,
      close,
      open: pos(pick(row, "Open", "open")),
      high: pos(pick(row, "High", "high")),
      low: pos(pick(row, "Low", "low")),
      volume: toFiniteNumber(pick(row, "Volume", "volume")),
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

export function parseChartHistory(resp: unknown): ParsedChartHistory {
  const root = asObj(resp);
  return {
    period: asStr(root?.period) ?? "",
    interval: asStr(root?.interval),
    bars: parseBars(records(root, "data")),
    warmup: parseBars(records(root, "warmup")),
    referenceClose: pos(root?.reference_close),
    referenceDate: asStr(root?.reference_date),
  };
}

// ---------------------------------------------------------------------------
// Company Profile & Ratios
// ---------------------------------------------------------------------------

export interface CompanyProfile {
  legalName: string | null;
  sector: string | null;
  market: string | null;
  website: string | null;
}

export function parseCompanyProfile(resp: unknown): CompanyProfile | null {
  const info = asObj(asObj(resp)?.info);
  const out: CompanyProfile = {
    legalName: asStr(info?.longName),
    sector: asStr(info?.sector) ?? asStr(info?.industry),
    market: asStr(info?.market),
    website: asStr(info?.website),
  };
  return out.legalName || out.sector || out.market || out.website ? out : null;
}

export type RatioKey =
  | "pe_ratio"
  | "pb_ratio"
  | "ps_ratio"
  | "ev_ebitda"
  | "gross_margin"
  | "operating_margin"
  | "ebitda_margin"
  | "net_margin"
  | "roe"
  | "roa"
  | "current_ratio"
  | "debt_to_equity"
  | "net_debt_ebitda"
  | "revenue_growth_yoy"
  | "net_income_growth_yoy";

const RATIO_KEYS: readonly RatioKey[] = [
  "pe_ratio",
  "pb_ratio",
  "ps_ratio",
  "ev_ebitda",
  "gross_margin",
  "operating_margin",
  "ebitda_margin",
  "net_margin",
  "roe",
  "roa",
  "current_ratio",
  "debt_to_equity",
  "net_debt_ebitda",
  "revenue_growth_yoy",
  "net_income_growth_yoy",
];

export interface RatioPeriod {
  label: string;
  ttm: boolean;
}

export interface RatioSet {
  values: Partial<Record<RatioKey, number>>;
  periods: Partial<Record<RatioKey, RatioPeriod>>;
  mainPeriod: RatioPeriod | null;
}

export function fiscalPeriodLabel(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{4})(?:[/-](\d{1,2}))?$/);
  if (!match) return raw;
  if (!match[2] || Number(match[2]) === 12) return match[1];
  return `${match[1]}/${match[2].padStart(2, "0")}`;
}

export function mergeRatios(liveResp: unknown, dbResp: unknown): RatioSet | null {
  const liveRoot = asObj(liveResp);
  const live = asObj(liveRoot?.ratios);
  const liveLabel = fiscalPeriodLabel(asStr(liveRoot?.as_of));
  const livePeriod: RatioPeriod | null = liveLabel
    ? { label: liveLabel, ttm: asStr(liveRoot?.basis) === "ttm" }
    : null;

  const dbRows = records(dbResp, "data").sort((a, b) =>
    String(b.period ?? "").localeCompare(String(a.period ?? "")),
  );
  const db = dbRows[0] ?? null;
  const dbLabel = fiscalPeriodLabel(asStr(db?.period));
  const dbPeriod: RatioPeriod | null = dbLabel
    ? { label: dbLabel, ttm: asStr(db?.basis) === "ttm" }
    : null;

  const values: RatioSet["values"] = {};
  const periods: RatioSet["periods"] = {};
  let usedLive = false;

  for (const key of RATIO_KEYS) {
    const liveVal = toFiniteNumber(live?.[key]);
    if (liveVal !== null) {
      values[key] = liveVal;
      if (livePeriod) periods[key] = livePeriod;
      usedLive = true;
      continue;
    }
    const dbVal = toFiniteNumber(db?.[key]);
    if (dbVal !== null) {
      values[key] = dbVal;
      if (dbPeriod) periods[key] = dbPeriod;
    }
  }
  if (Object.keys(values).length === 0) return null;
  return {
    values,
    periods,
    mainPeriod: (usedLive ? livePeriod : dbPeriod) ?? livePeriod ?? dbPeriod,
  };
}

// ---------------------------------------------------------------------------
// Financial Statements
// ---------------------------------------------------------------------------

export interface StatementPeriod {
  key: string;
  year: number | null;
  month: number | null;
  months: number | null;
  periodType: "annual" | "interim" | null;
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
  discreteRows: StatementRow[] | null;
  source: string | null;
  cumulative: boolean | null;
  notes: string[];
  unavailable: boolean;
  unitLabel: string;
}

export function parseStatementPeriod(key: string): StatementPeriod {
  const make = (year: number | null, month: number | null): StatementPeriod => ({
    key,
    year,
    month,
    months: month,
    periodType: month === null ? null : month === 12 ? "annual" : "interim",
    rank: year !== null && month !== null ? year * 100 + month : 0,
  });
  let m = key.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m) return make(Number(m[1]), Number(m[2]));
  m = key.match(/^(\d{4})\s*[Qq]([1-4])$/);
  if (m) return make(Number(m[1]), Number(m[2]) * 3);
  m = key.match(/^(\d{4})$/);
  if (m) return make(Number(m[1]), 12);
  return make(null, null);
}

function buildStatementRows(input: Obj[], periods: StatementPeriod[]): StatementRow[] {
  const out: StatementRow[] = [];
  for (const row of input) {
    const rawLabel = typeof row.Item === "string" ? row.Item : "";
    const label = rawLabel.trim().replace(/\s{2,}/g, " ");
    if (!label) continue;
    const values = periods.map((p) => toFiniteNumber(row[p.key]));
    if (values.every((v) => v === null || v === 0)) continue;
    const indent = rawLabel.length - rawLabel.trimStart().length;
    out.push({ label, depth: Math.min(indent, 2), values });
  }
  return out;
}

export function parseStatement(resp: unknown, maxPeriods = 4): StatementTable | null {
  const root = asObj(resp);
  if (!root) return null;
  const rowsIn = records(root, "data");
  const periodKeys: string[] = [];
  for (const row of rowsIn) {
    for (const key of Object.keys(row)) {
      if (key !== "Item" && key !== "index" && !periodKeys.includes(key)) periodKeys.push(key);
    }
  }
  const infoMap = new Map<string, Obj>();
  for (const item of asArr(root.period_info)) {
    const o = asObj(item);
    const key = asStr(o?.period);
    if (o && key) infoMap.set(key, o);
  }
  const periods = periodKeys
    .map((key) => {
      const p = parseStatementPeriod(key);
      const meta = infoMap.get(key);
      if (!meta) return p;
      const pt = asStr(meta.period_type);
      return {
        ...p,
        months: toFiniteNumber(meta.months) ?? p.months,
        periodType: pt === "annual" || pt === "interim" ? pt : p.periodType,
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxPeriods);

  const basis = asStr(root.value_basis);
  const legacyFlag = pick(root, "cumulative", "is_cumulative");
  const discrete = buildStatementRows(records(root, "discrete"), periods);

  return {
    periods,
    rows: buildStatementRows(rowsIn, periods),
    discreteRows: discrete.length > 0 ? discrete : null,
    source: asStr(root.source),
    cumulative:
      basis === "cumulative_ytd"
        ? true
        : basis === "discrete"
          ? false
          : typeof legacyFlag === "boolean"
            ? legacyFlag
            : null,
    notes: asArr(root.notes).map(asStr).filter((n): n is string => n !== null),
    unavailable: root.available === false,
    unitLabel: "Milyon ₺",
  };
}

export const CASHFLOW_SUMMARY_ITEMS = new Set([
  "İşletme Faaliyetlerinden Kaynaklanan Net Nakit",
  "Amortisman & İtfa Payları",
  "İşletme Sermayesindeki Değişiklikler",
  "Sabit Sermaye Yatırımları",
  "Yatırım Faaliyetlerinden Kaynaklanan Nakit",
  "Serbest Nakit Akım",
  "Finansal Borçlardaki Değişim",
  "Temettü Ödemeleri",
  "Finansman Faaliyetlerden Kaynaklanan Nakit",
  "Nakit ve Benzerlerindeki Değişim",
  "Dönem Sonu Nakit",
]);

export function isStatementEmphasisLine(label: string): boolean {
  return /toplam|^hasılat$|^brüt kâr \(zarar\)$|^esas faaliyet kârı|^net dönem kârı|^özkaynaklar$|^net faiz geliri|^faaliyet brüt kârı|^net faaliyet kârı|kaynaklanan (net )?nakit$|^serbest nakit akım$|^dönem sonu nakit$/i.test(
    label,
  );
}

// ---------------------------------------------------------------------------
// Technical Signals, Moving Averages & Pivots
// ---------------------------------------------------------------------------

export type SignalLevel = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

const SIGNAL_ALIASES: Record<string, SignalLevel> = {
  STRONG_BUY: "strongBuy",
  GÜÇLÜ_AL: "strongBuy",
  GUCLU_AL: "strongBuy",
  BUY: "buy",
  AL: "buy",
  OUTPERFORM: "buy",
  NEUTRAL: "neutral",
  NÖTR: "neutral",
  NOTR: "neutral",
  HOLD: "neutral",
  TUT: "neutral",
  SELL: "sell",
  SAT: "sell",
  UNDERPERFORM: "sell",
  STRONG_SELL: "strongSell",
  GÜÇLÜ_SAT: "strongSell",
  GUCLU_SAT: "strongSell",
};

export function normalizeSignal(raw: unknown): SignalLevel | null {
  const s = asStr(raw);
  if (!s) return null;
  return SIGNAL_ALIASES[s.toUpperCase().replace(/[\s-]+/g, "_")] ?? null;
}

export function signalLabelTr(level: SignalLevel | null): string {
  switch (level) {
    case "strongBuy":
      return "Güçlü Al";
    case "buy":
      return "Al";
    case "neutral":
      return "Nötr";
    case "sell":
      return "Sat";
    case "strongSell":
      return "Güçlü Sat";
    default:
      return "—";
  }
}

export interface SignalGroup {
  level: SignalLevel | null;
  buy: number | null;
  neutral: number | null;
  sell: number | null;
  compute: Record<string, SignalLevel | null>;
  values: Record<string, number | null>;
}

export interface ParsedTechnicalSignals {
  summary: SignalGroup | null;
  oscillators: SignalGroup | null;
  movingAverages: SignalGroup | null;
  interval: string | null;
}

function parseSignalGroup(value: unknown): SignalGroup | null {
  const o = asObj(value);
  if (!o) return null;
  const raw = asStr(pick(o, "recommendation", "signal"));
  const compute: Record<string, SignalLevel | null> = {};
  for (const [k, v] of Object.entries(asObj(o.compute) ?? {})) compute[k] = normalizeSignal(v);
  const values: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(asObj(o.values) ?? {})) values[k] = toFiniteNumber(v);
  const group: SignalGroup = {
    level: normalizeSignal(raw),
    buy: toFiniteNumber(pick(o, "buy", "buy_count")),
    neutral: toFiniteNumber(pick(o, "neutral", "neutral_count")),
    sell: toFiniteNumber(pick(o, "sell", "sell_count")),
    compute,
    values,
  };
  if (!group.level && group.buy === null && group.sell === null && group.neutral === null) return null;
  return group;
}

export function parseTechnicalSignals(resp: unknown): ParsedTechnicalSignals | null {
  const root = asObj(resp);
  const s = asObj(root?.signals) ?? root;
  if (!s) return null;
  const parsed: ParsedTechnicalSignals = {
    summary: parseSignalGroup(s.summary),
    oscillators: parseSignalGroup(s.oscillators),
    movingAverages: parseSignalGroup(s.moving_averages),
    interval: asStr(s.interval),
  };
  return parsed.summary || parsed.oscillators || parsed.movingAverages ? parsed : null;
}

const TIMEFRAME_ORDER = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1W", "1M"];

export interface TimeframeSignal {
  timeframe: string;
  summary: SignalGroup | null;
}

export function parseAllTimeframes(resp: unknown): TimeframeSignal[] {
  const root = asObj(resp);
  const frames = asObj(root?.timeframes) ?? asObj(root?.data);
  if (!frames) return [];
  const out: TimeframeSignal[] = [];
  for (const [timeframe, val] of Object.entries(frames)) {
    const o = asObj(val);
    const summary = o && !o.error ? parseSignalGroup(o.summary ?? o) : null;
    out.push({ timeframe, summary });
  }
  const rank = (tf: string) => {
    const idx = TIMEFRAME_ORDER.indexOf(tf);
    return idx === -1 ? TIMEFRAME_ORDER.length : idx;
  };
  return out.sort((a, b) => rank(a.timeframe) - rank(b.timeframe));
}

export interface MovingAverageRow {
  period: number;
  sma: number | null;
  ema: number | null;
  smaVote: SignalLevel | null;
  emaVote: SignalLevel | null;
}

export function extractMovingAverageRows(
  group: SignalGroup | null,
  maResp?: unknown,
): MovingAverageRow[] {
  const periods = new Set<number>();
  const smaFallback = asObj(asObj(maResp)?.sma);
  const emaFallback = asObj(asObj(maResp)?.ema);

  for (const key of Object.keys(group?.values ?? {})) {
    const m = key.match(/^(?:SMA|EMA)(\d+)$/);
    if (m) periods.add(Number(m[1]));
  }
  for (const key of Object.keys(smaFallback ?? {})) {
    const p = Number(key.replace(/\D+/g, ""));
    if (p > 0) periods.add(p);
  }
  for (const key of Object.keys(emaFallback ?? {})) {
    const p = Number(key.replace(/\D+/g, ""));
    if (p > 0) periods.add(p);
  }

  return [...periods]
    .sort((a, b) => a - b)
    .map((period) => ({
      period,
      sma: group?.values[`SMA${period}`] ?? toFiniteNumber(smaFallback?.[String(period)] ?? smaFallback?.[`sma_${period}`]),
      ema: group?.values[`EMA${period}`] ?? toFiniteNumber(emaFallback?.[String(period)] ?? emaFallback?.[`ema_${period}`]),
      smaVote: group?.compute[`SMA${period}`] ?? null,
      emaVote: group?.compute[`EMA${period}`] ?? null,
    }))
    .filter((r) => r.sma !== null || r.ema !== null);
}

export interface MovingAverageCross {
  type: "golden" | "death";
  date: string | null;
  barsAgo: number | null;
}

export function parseMovingAverageCross(resp: unknown): MovingAverageCross | null {
  const cross = asObj(asObj(resp)?.last_cross);
  const type = asStr(cross?.type)?.toLowerCase();
  if (type !== "golden" && type !== "death") return null;
  return { type, date: asStr(cross?.date), barsAgo: toFiniteNumber(cross?.bars_ago) };
}

export interface PivotLevels {
  sessionDate: string | null;
  pivot: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
}

export function parsePivots(resp: unknown): PivotLevels | null {
  const root = asObj(resp);
  const p = asObj(root?.pivots);
  if (!p) return null;
  const pivot = pos(p.pivot);
  if (pivot === null) return null;
  return {
    sessionDate: asStr(root?.session_date),
    pivot,
    r1: pos(p.r1),
    r2: pos(p.r2),
    r3: pos(p.r3),
    s1: pos(p.s1),
    s2: pos(p.s2),
    s3: pos(p.s3),
  };
}

// ---------------------------------------------------------------------------
// Dividends, Holders, Analysts, Earnings, KAP & News
// ---------------------------------------------------------------------------

export interface DividendItem {
  date: string;
  time: number;
  grossPerShare: number | null;
  netPerShare: number | null;
  grossRate: number | null;
  total: number | null;
}

export function parseDividends(resp: unknown): DividendItem[] {
  const out: DividendItem[] = [];
  for (const row of records(resp, "dividends", "data")) {
    const date = asStr(pick(row, "Date", "date", "ex_date", "exDate"));
    const time = parseIsoOrEpoch(date);
    const gross = pos(pick(row, "Amount", "amount", "Dividends", "dividend"));
    if (!date || time === null || gross === null) continue;
    const grossRate = pos(pick(row, "GrossRate", "gross_rate"));
    const netRate = toFiniteNumber(pick(row, "NetRate", "net_rate"));
    out.push({
      date,
      time,
      grossPerShare: gross,
      netPerShare: grossRate !== null && netRate !== null ? (gross * netRate) / grossRate : null,
      grossRate,
      total: pos(pick(row, "TotalDividend", "total_dividend")),
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

export function computeTrailingDividendYield(
  dividends: readonly DividendItem[],
  price: number | null,
  now = Date.now(),
): { perShare: number; yieldPct: number | null; count: number } {
  const newest = dividends.find((d) => d.total !== null && d.grossPerShare !== null && d.grossPerShare > 0);
  const shares = newest?.total && newest.grossPerShare ? newest.total / newest.grossPerShare : null;
  const cutoff = now - 365 * 86_400_000;
  let perShare = 0;
  let count = 0;
  for (const d of dividends) {
    if (d.time < cutoff || d.time > now || d.grossPerShare === null) continue;
    const rebased = shares && d.total !== null ? d.total / shares : d.grossPerShare;
    if (rebased > 0) {
      perShare += rebased;
      count += 1;
    }
  }
  return {
    perShare,
    yieldPct: price && price > 0 && count > 0 ? (perShare / price) * 100 : null,
    count,
  };
}

export interface HolderItem {
  name: string;
  percent: number;
  isOther: boolean;
}

export function parseHolders(resp: unknown): HolderItem[] {
  const out: HolderItem[] = [];
  for (const row of records(resp, "holders", "data")) {
    const name = asStr(pick(row, "Holder", "holder", "name", "Name"));
    const percent = toFiniteNumber(pick(row, "Percentage", "percentage", "percent", "Percent"));
    if (!name || percent === null || percent < 0) continue;
    out.push({ name, percent, isOther: /^(diğer|diger|other|others)$/i.test(name) });
  }
  return out.sort((a, b) => Number(a.isOther) - Number(b.isOther) || b.percent - a.percent);
}

export interface AnalystSummary {
  level: SignalLevel | null;
  raw: string | null;
  target: number | null;
  upside: number | null;
  low: number | null;
  high: number | null;
  mean: number | null;
  median: number | null;
  analysts: number | null;
}

export function parseAnalystSummary(recResp: unknown, targetsResp: unknown): AnalystSummary | null {
  const rec = asObj(asObj(recResp)?.recommendations);
  const t = asObj(asObj(targetsResp)?.targets);
  const raw = asStr(pick(rec, "recommendation", "consensus", "rating"));
  const out: AnalystSummary = {
    level: normalizeSignal(raw),
    raw,
    target: pos(pick(rec, "target_price", "targetPrice")),
    upside: toFiniteNumber(pick(rec, "upside_potential", "upsidePotential")),
    low: pos(pick(t, "low", "targetLowPrice")),
    high: pos(pick(t, "high", "targetHighPrice")),
    mean: pos(pick(t, "mean", "targetMeanPrice")),
    median: pos(pick(t, "median", "targetMedianPrice")),
    analysts: toFiniteNumber(pick(t, "numberOfAnalysts", "numberOfAnalystOpinions", "number_of_analysts")),
  };
  const hasAny =
    out.raw !== null || out.target !== null || out.mean !== null || out.low !== null || out.high !== null;
  return hasAny ? out : null;
}

export interface EarningsItem {
  date: string;
  time: number;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
}

export function parseEarnings(resp: unknown): EarningsItem[] {
  const seen = new Set<string>();
  const out: EarningsItem[] = [];
  for (const row of records(resp, "earnings_dates", "data")) {
    const date = asStr(pick(row, "Earnings Date", "earningsDate", "date", "Date"));
    const time = parseIsoOrEpoch(date);
    if (!date || time === null) continue;
    const item: EarningsItem = {
      date,
      time,
      epsEstimate: toFiniteNumber(pick(row, "EPS Estimate", "epsEstimate", "eps_estimate")),
      epsActual: toFiniteNumber(pick(row, "Reported EPS", "epsActual", "eps_actual")),
      surprisePct: toFiniteNumber(pick(row, "Surprise(%)", "surprise_pct")),
    };
    const key = `${date.slice(0, 10)}|${item.epsEstimate}|${item.epsActual}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => a.time - b.time);
}

export interface StockKapItem {
  id: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  time: number;
  severity: string | null;
}

export function parseMergedKap(dbResp: unknown, liveResp: unknown, limit = 10): StockKapItem[] {
  const dbItems: StockKapItem[] = records(dbResp, "events", "data")
    .map((row) => ({
      id: asStr(row.id),
      title: asStr(row.title) ?? asStr(row.excerpt) ?? "",
      summary: asStr(row.summary),
      url: safeUrl(row.event_url),
      publishedAt: asStr(row.published_at),
      time: parseIsoOrEpoch(row.published_at as string | null) ?? 0,
      severity: asStr(row.severity),
    }))
    .filter((item) => Boolean(item.title));

  const kapKey = (url: string | null): string | null => {
    if (!url) return null;
    const id = url.match(/Bildirim\/(\d+)/i)?.[1];
    return id ? `kap:${id}` : url.replace(/\/+$/, "").toLowerCase();
  };

  const known = new Set(dbItems.map((i) => kapKey(i.url)).filter((k): k is string => k !== null));
  const merged = [...dbItems];

  for (const row of records(liveResp, "news")) {
    const title = asStr(pick(row, "Title", "title"));
    const time = parseIsoOrEpoch(pick(row, "Date", "date") as string | null);
    if (!title || time === null) continue;
    const url = safeUrl(pick(row, "URL", "url"));
    const key = kapKey(url);
    if (key && known.has(key)) continue;
    merged.push({
      id: null,
      title,
      summary: null,
      url,
      publishedAt: new Date(time).toISOString(),
      time,
      severity: null,
    });
  }
  return merged.sort((a, b) => b.time - a.time).slice(0, limit);
}

export interface StockNewsItem {
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  time: number;
}

export function parseStockNews(resp: unknown, limit = 8): StockNewsItem[] {
  const out: StockNewsItem[] = [];
  for (const row of records(resp, "news")) {
    const title = asStr(row.title);
    if (!title) continue;
    const publishedAt = asStr(row.published_at);
    out.push({
      title,
      url: safeUrl(row.url),
      source: asStr(row.source),
      publishedAt,
      time: parseIsoOrEpoch(publishedAt) ?? 0,
    });
  }
  return out.sort((a, b) => b.time - a.time).slice(0, limit);
}
