/**
 * Pure parsers that turn loosely-typed backend payloads into the view models
 * in `types.ts`. Shapes were verified against the live API for THYAO, GARAN,
 * ASELS and AKBNK (industrial and bank statement layouts). Rules:
 *   - missing / NaN / non-numeric values become `null` (never 0),
 *   - prices and prices-like fields must be > 0 to count as present,
 *   - nothing here touches React, so it is safe in server components.
 */
import { toFiniteNumber } from "@/lib/format";
import { safeExternalUrl } from "@/lib/url";
import type {
  AnalystRecommendation,
  CompanyProfile,
  MovingAverageCross,
  RatioPeriod,
  ChartPeriod,
  Dividend,
  EarningsDate,
  FastInfo,
  Holder,
  Indicators,
  KapItem,
  NewsItem,
  Pivots,
  PriceBar,
  PriceHistory,
  PriceTargets,
  Quote,
  RatioKey,
  RatioSet,
  SignalGroup,
  SignalLevel,
  StatementPeriod,
  StatementRow,
  StatementTable,
  TechnicalSignals,
  TimeframeSignal,
} from "./types";

type Obj = Record<string, unknown>;

export const toNum = toFiniteNumber;

/** Positive finite number (prices, market caps, share counts) or null. */
function pos(value: unknown): number | null {
  const n = toFiniteNumber(value);
  return n != null && n > 0 ? n : null;
}

export function asObj(value: unknown): Obj | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStr(value: unknown): string | null {
  if (typeof value === "string") {
    const s = value.trim();
    return s ? s : null;
  }
  return null;
}

function pick(o: Obj | null | undefined, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const key of keys) {
    const value = o[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Records either sit at the top level (bare array) or under one of `keys`. */
function records(resp: unknown, ...keys: string[]): Obj[] {
  const root = asObj(resp);
  const rows = Array.isArray(resp) ? resp : asArr(pick(root, ...keys));
  return rows.map(asObj).filter((row): row is Obj => row !== null);
}

// ---------------------------------------------------------------------------
// Time helpers (Borsa İstanbul is UTC+3 all year)
// ---------------------------------------------------------------------------

const ISTANBUL_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in Istanbul as "YYYY-MM-DD". */
export function istanbulDay(time: number): string {
  return ISTANBUL_DAY.format(time);
}

/**
 * Epoch ms for the timestamp shapes the backend emits. KAP "DD.MM.YYYY HH:mm:ss"
 * and naive ISO strings are Istanbul wall-clock time.
 */
export function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = asStr(raw);
  if (!s) return null;
  const kap = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (kap) {
    const [, d, m, y, hh = "00", mm = "00", ss = "00"] = kap;
    const t = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}+03:00`);
    return Number.isFinite(t) ? t : null;
  }
  let iso = s.includes("T") ? s : s.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += "T00:00:00";
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += "+03:00";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

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

/** "BUY" / "AL" / "strong buy" / "TUT" → normalised level (null if unknown). */
export function normalizeSignal(raw: unknown): SignalLevel | null {
  const s = asStr(raw);
  if (!s) return null;
  return SIGNAL_ALIASES[s.toUpperCase().replace(/[\s-]+/g, "_")] ?? null;
}

/** Bullish levels map to the "up" tone, bearish to "down". */
export function signalTone(level: SignalLevel | null): "up" | "down" | "flat" {
  if (level === "buy" || level === "strongBuy") return "up";
  if (level === "sell" || level === "strongSell") return "down";
  return "flat";
}

function parseSignalGroup(value: unknown): SignalGroup | null {
  const o = asObj(value);
  if (!o) return null;
  const raw = asStr(pick(o, "recommendation", "signal"));
  const compute: Record<string, SignalLevel | null> = {};
  for (const [key, vote] of Object.entries(asObj(o.compute) ?? {})) compute[key] = normalizeSignal(vote);
  const values: Record<string, number | null> = {};
  for (const [key, v] of Object.entries(asObj(o.values) ?? {})) values[key] = toNum(v);
  const group: SignalGroup = {
    level: normalizeSignal(raw),
    raw,
    buy: toNum(pick(o, "buy", "buy_count")),
    neutral: toNum(pick(o, "neutral", "neutral_count")),
    sell: toNum(pick(o, "sell", "sell_count")),
    compute,
    values,
  };
  if (!group.level && group.buy == null && group.sell == null && group.neutral == null) return null;
  return group;
}

/** `GET /technical/{t}/signals` → { signals: { summary, oscillators, moving_averages, interval } }. */
export function parseSignals(resp: unknown): TechnicalSignals | null {
  const root = asObj(resp);
  const s = asObj(root?.signals) ?? root;
  if (!s) return null;
  const parsed: TechnicalSignals = {
    summary: parseSignalGroup(s.summary),
    oscillators: parseSignalGroup(s.oscillators),
    movingAverages: parseSignalGroup(s.moving_averages),
    interval: asStr(s.interval),
  };
  return parsed.summary || parsed.oscillators || parsed.movingAverages ? parsed : null;
}

const TIMEFRAME_ORDER = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1W", "1M"];

/** `GET /technical/{t}/signals/all-timeframes` → { timeframes: { "1m": {summary…}, … } }. */
export function parseTimeframes(resp: unknown): TimeframeSignal[] {
  const root = asObj(resp);
  const frames = asObj(root?.timeframes) ?? asObj(root?.data);
  if (!frames) return [];
  const out: TimeframeSignal[] = [];
  for (const [timeframe, value] of Object.entries(frames)) {
    const o = asObj(value);
    // `{error: …}` = no data for this timeframe: keep it (rendered greyed out), never as "neutral".
    const summary = o && !o.error ? parseSignalGroup(o.summary ?? o) : null;
    out.push({ timeframe, summary });
  }
  const rank = (tf: string) => {
    const i = TIMEFRAME_ORDER.indexOf(tf);
    return i === -1 ? TIMEFRAME_ORDER.length : i;
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

/** SMA/EMA table from the TradingView moving-average group (values + votes). */
export function movingAverageRows(group: SignalGroup | null): MovingAverageRow[] {
  if (!group) return [];
  const periods = new Set<number>();
  for (const key of Object.keys(group.values)) {
    const m = key.match(/^(?:SMA|EMA)(\d+)$/);
    if (m) periods.add(Number(m[1]));
  }
  return [...periods]
    .sort((a, b) => a - b)
    .map((period) => ({
      period,
      sma: group.values[`SMA${period}`] ?? null,
      ema: group.values[`EMA${period}`] ?? null,
      smaVote: group.compute[`SMA${period}`] ?? null,
      emaVote: group.compute[`EMA${period}`] ?? null,
    }))
    .filter((row) => row.sma != null || row.ema != null);
}

/** `GET /technical/{t}/moving-averages` → `last_cross: {type, date, bars_ago}` (actual SMA50/SMA200 cross). */
export function parseMovingAverageCross(resp: unknown): MovingAverageCross | null {
  const cross = asObj(asObj(resp)?.last_cross);
  const type = asStr(cross?.type)?.toLowerCase();
  if (type !== "golden" && type !== "death") return null;
  return { type, date: asStr(cross?.date), barsAgo: toNum(cross?.bars_ago) };
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

function indicatorData(resp: unknown): Obj | null {
  const root = asObj(resp);
  return asObj(root?.data) ?? root;
}

function allNull(values: Array<number | null>) {
  return values.every((v) => v == null);
}

/** `params: {fast: 12, slow: 26, signal: 9}` → "12, 26, 9" (only the listed keys, in order). */
function paramList(resp: unknown, keys: string[]): string | null {
  const params = asObj(asObj(resp)?.params);
  if (!params) return null;
  const values = keys.map((key) => toNum(params[key])).filter((v): v is number => v != null);
  return values.length > 0 ? values.join(", ") : null;
}

export function parseIndicators(parts: {
  rsi?: unknown;
  macd?: unknown;
  bollinger?: unknown;
  stochastic?: unknown;
  supertrend?: unknown;
}): Indicators {
  const rsiRoot = asObj(parts.rsi);
  const macd = indicatorData(parts.macd);
  const boll = indicatorData(parts.bollinger);
  const stoch = indicatorData(parts.stochastic);
  const st = indicatorData(parts.supertrend);

  const macdValues = { macd: toNum(macd?.macd), signal: toNum(macd?.signal), histogram: toNum(macd?.histogram) };
  const bollValues = {
    upper: pos(boll?.upper),
    middle: pos(boll?.middle),
    lower: pos(boll?.lower),
    period: toNum(asObj(parts.bollinger)?.period),
    stdDev: toNum(asObj(parts.bollinger)?.std_dev),
  };
  const stochValues = { k: toNum(stoch?.k), d: toNum(stoch?.d) };
  const stValues = { value: pos(st?.value), direction: toNum(st?.direction) };

  return {
    rsi: toNum(rsiRoot?.value ?? asObj(rsiRoot?.data)?.value),
    rsiPeriod: toNum(rsiRoot?.period),
    macd: allNull([macdValues.macd, macdValues.signal, macdValues.histogram]) ? null : macdValues,
    macdParams: paramList(parts.macd, ["fast", "slow", "signal"]),
    bollinger: allNull([bollValues.upper, bollValues.middle, bollValues.lower]) ? null : bollValues,
    stochastic: allNull([stochValues.k, stochValues.d]) ? null : stochValues,
    stochasticParams: paramList(parts.stochastic, ["k", "smooth_k", "d"]),
    supertrend: allNull([stValues.value, stValues.direction]) ? null : stValues,
    supertrendParams: paramList(parts.supertrend, ["atr_period", "multiplier"]),
  };
}

/** `GET /technical/{t}/pivots` → { pivots: { pivot, r1…r3, s1…s3 } }. */
export function parsePivots(resp: unknown): Pivots | null {
  const root = asObj(resp);
  const p = asObj(root?.pivots);
  if (!p) return null;
  const out: Pivots = {
    sessionDate: asStr(root?.session_date),
    pivot: pos(p.pivot),
    r1: pos(p.r1),
    r2: pos(p.r2),
    r3: pos(p.r3),
    s1: pos(p.s1),
    s2: pos(p.s2),
    s3: pos(p.s3),
  };
  return out.pivot == null ? null : out;
}

// ---------------------------------------------------------------------------
// Quote / fast info / price history
// ---------------------------------------------------------------------------

/**
 * `GET /market/snapshot?symbols=T` → daily quote. `previous_close` is derived
 * by the backend from `change_percent`; the change is always vs previous close.
 */
export function parseSnapshotQuote(resp: unknown, ticker: string): Quote | null {
  const row = asObj(asObj(asObj(resp)?.snapshot)?.[ticker]);
  if (!row || row.error) return null;
  const last = pos(row.last_price);
  if (last == null) return null;
  const pct = toNum(row.change_percent);
  let prevClose = pos(row.previous_close);
  if (prevClose == null && pct != null && pct > -100) prevClose = last / (1 + pct / 100);
  return {
    last,
    prevClose,
    change: toNum(row.change) ?? (prevClose != null ? last - prevClose : null),
    changePct: pct ?? (prevClose != null ? (last / prevClose - 1) * 100 : null),
    open: pos(row.open),
    high: pos(row.day_high),
    low: pos(row.day_low),
    volume: toNum(row.volume),
    marketCap: pos(row.market_cap),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

/** `GET /fundamentals/{t}/fast-info` → { fast_info: {...} } (also accepts a bare object). */
export function parseFastInfo(resp: unknown): FastInfo | null {
  const root = asObj(resp);
  const fi = asObj(root?.fast_info) ?? asObj(root?.info) ?? root;
  if (!fi) return null;
  const out: FastInfo = {
    last: pos(fi.last_price),
    open: pos(fi.open),
    dayHigh: pos(fi.day_high),
    dayLow: pos(fi.day_low),
    prevClose: pos(fi.previous_close),
    change: toNum(fi.change),
    changePct: toNum(fi.change_percent),
    volume: toNum(fi.volume),
    amount: pos(fi.amount),
    marketCap: pos(fi.market_cap),
    shares: pos(fi.shares),
    pe: toNum(fi.pe_ratio),
    pb: toNum(fi.pb_ratio),
    yearHigh: pos(fi.year_high),
    yearLow: pos(fi.year_low),
    avg50: pos(fi.fifty_day_average),
    avg200: pos(fi.two_hundred_day_average),
    freeFloat: toNum(fi.free_float),
    foreignRatio: toNum(fi.foreign_ratio),
    currency: asStr(fi.currency),
    exchange: asStr(fi.exchange),
    updatedAt: parseTimestamp(fi.updated_at),
  };
  const hasData = Object.entries(out).some(([key, v]) => key !== "currency" && key !== "exchange" && v != null);
  return hasData ? out : null;
}

/**
 * Fallback quote when the snapshot endpoint has no row for the symbol:
 * live fast_info; when its previous_close is missing, the previous session
 * close is taken from daily bars.
 */
export function quoteFromFastInfo(fi: FastInfo | null, dailyBars: PriceBar[], now = Date.now()): Quote | null {
  const lastBar = dailyBars.length > 0 ? dailyBars[dailyBars.length - 1] : null;
  const last = fi?.last ?? lastBar?.close ?? null;
  if (last == null) return null;
  let prevClose = fi?.prevClose ?? null;
  if (prevClose == null && lastBar && dailyBars.length >= 2) {
    const lastBarIsToday = istanbulDay(lastBar.time) === istanbulDay(now);
    const lastBarIsLive = Math.abs(lastBar.close - last) <= last * 1e-4;
    prevClose = lastBarIsToday || lastBarIsLive ? dailyBars[dailyBars.length - 2].close : lastBar.close;
  }
  const upstreamChange = fi?.prevClose != null ? fi.change : null;
  return {
    last,
    prevClose,
    change: upstreamChange ?? (prevClose != null ? last - prevClose : null),
    changePct: (fi?.prevClose != null ? fi.changePct : null) ?? (prevClose != null ? (last / prevClose - 1) * 100 : null),
    open: fi?.open ?? null,
    high: fi?.dayHigh ?? null,
    low: fi?.dayLow ?? null,
    volume: fi?.volume ?? null,
    marketCap: fi?.marketCap ?? null,
    updatedAt: fi?.updatedAt ?? null,
  };
}

/** `GET /market/ticker/{t}/history` → { interval, data: [{Date, Open, High, Low, Close, Volume}] }. */
export function parseHistory(resp: unknown): PriceHistory {
  const root = asObj(resp);
  const bars: PriceBar[] = [];
  for (const row of records(root, "data")) {
    const time = parseTimestamp(pick(row, "Date", "Datetime", "date", "datetime", "timestamp"));
    const close = pos(pick(row, "Close", "close"));
    if (time == null || close == null) continue;
    bars.push({
      time,
      close,
      open: pos(pick(row, "Open", "open")),
      high: pos(pick(row, "High", "high")),
      low: pos(pick(row, "Low", "low")),
      volume: toNum(pick(row, "Volume", "volume")),
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return { bars, interval: asStr(root?.interval), referenceClose: pos(root?.reference_close) };
}

const PERIOD_MONTHS: Partial<Record<ChartPeriod, number>> = { "1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "5y": 60 };

/**
 * borsapy treats periods as bar counts (e.g. "3mo" = 90 daily bars ≈ 4.3
 * months, "ytd" = 265 bars reaching into the previous year), so the chart is
 * trimmed to the calendar window here. The baseline for the period change is
 * the close of the last bar *before* the window (i.e. previous close), falling
 * back to the first bar when the payload does not reach further back. Callers
 * prefer the backend's `reference_close` (see `PriceHistory.referenceClose`)
 * because the backend already trims its payload to the window.
 */
export function sliceChartWindow(bars: PriceBar[], period: ChartPeriod): { bars: PriceBar[]; baseline: number | null } {
  if (bars.length === 0) return { bars, baseline: null };
  const last = bars[bars.length - 1];
  let start: number | null = null;

  if (period === "1d" || period === "5d") {
    const days = [...new Set(bars.map((b) => istanbulDay(b.time)))];
    const firstDay = days[Math.max(0, days.length - (period === "1d" ? 1 : 5))];
    start = bars.find((b) => istanbulDay(b.time) === firstDay)?.time ?? null;
  } else if (period === "ytd") {
    start = Date.parse(`${istanbulDay(last.time).slice(0, 4)}-01-01T00:00:00+03:00`);
  } else if (PERIOD_MONTHS[period]) {
    const d = new Date(last.time);
    d.setUTCMonth(d.getUTCMonth() - (PERIOD_MONTHS[period] ?? 0));
    start = d.getTime();
  }

  if (start == null) return { bars, baseline: bars[0].close };
  const startTime = start;
  const firstIdx = bars.findIndex((b) => b.time >= startTime);
  if (firstIdx <= 0) return { bars, baseline: bars[0].close };
  const windowBars = bars.slice(firstIdx);
  if (windowBars.length < 2 && period !== "1d") return { bars, baseline: bars[0].close };
  return { bars: windowBars, baseline: bars[firstIdx - 1].close };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function parseCompany(resp: unknown): { name: string | null; legalName: string | null } | null {
  const o = asObj(resp);
  if (!o) return null;
  return { name: asStr(o.display_name) ?? asStr(o.legal_name), legalName: asStr(o.legal_name) };
}

/** `GET /fundamentals/{t}/info` → { info: { longName, sector, market, website, … } }. */
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

/** Exact symbol match in `GET /market/search?q=T` results. */
export function findSearchMatch(resp: unknown, ticker: string): { name: string | null } | null {
  for (const row of records(resp, "results", "data")) {
    const symbol = asStr(pick(row, "symbol", "ticker"))?.toUpperCase();
    if (symbol === ticker) return { name: asStr(pick(row, "name", "description")) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ratios
// ---------------------------------------------------------------------------

const RATIO_KEYS: RatioKey[] = [
  "gross_margin",
  "operating_margin",
  "ebitda_margin",
  "net_margin",
  "roe",
  "roa",
  "current_ratio",
  "net_debt_ebitda",
  "debt_to_equity",
  "pe_ratio",
  "pb_ratio",
  "ps_ratio",
  "ev_ebitda",
  "revenue_growth_yoy",
  "net_income_growth_yoy",
];

/** "2025/12" or "2025" → "2025"; "2026/06" → "2026/06". */
export function fiscalPeriodLabel(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})(?:[/-](\d{1,2}))?$/);
  if (!m) return raw;
  if (!m[2] || Number(m[2]) === 12) return m[1];
  return `${m[1]}/${m[2].padStart(2, "0")}`;
}

/**
 * Live ratios (KAP statements + live valuation, `as_of` = fiscal period) are
 * preferred per field; DB ratios fill the gaps (e.g. net debt/EBITDA).
 */
export function mergeRatios(liveResp: unknown, dbResp: unknown): RatioSet | null {
  const liveRoot = asObj(liveResp);
  const live = asObj(liveRoot?.ratios);
  const liveLabel = fiscalPeriodLabel(asStr(liveRoot?.as_of));
  // `basis: "ttm"` = trailing twelve months ending at `as_of` (flows summed over 4 quarters).
  const livePeriod: RatioPeriod | null = liveLabel ? { label: liveLabel, ttm: asStr(liveRoot?.basis) === "ttm" } : null;
  const dbRows = records(dbResp, "data").sort((a, b) =>
    String(b.period ?? "").localeCompare(String(a.period ?? "")),
  );
  const db = dbRows[0] ?? null;
  const dbLabel = fiscalPeriodLabel(asStr(db?.period));
  // Stored rows carry `basis` ("ttm" | "annual") once the data-platform store serves them.
  const dbPeriod: RatioPeriod | null = dbLabel ? { label: dbLabel, ttm: asStr(db?.basis) === "ttm" } : null;

  const values: RatioSet["values"] = {};
  const periods: RatioSet["periods"] = {};
  for (const key of RATIO_KEYS) {
    const liveValue = toNum(live?.[key]);
    if (liveValue != null) {
      values[key] = liveValue;
      if (livePeriod) periods[key] = livePeriod;
      continue;
    }
    const dbValue = toNum(db?.[key]);
    if (dbValue != null) {
      values[key] = dbValue;
      if (dbPeriod) periods[key] = dbPeriod;
    }
  }
  if (Object.keys(values).length === 0) return null;

  // Header period = the live (primary) source whenever it contributed; DB periods are shown per row.
  const usedLive = RATIO_KEYS.some((key) => toNum(live?.[key]) != null);
  const mainPeriod = (usedLive ? livePeriod : dbPeriod) ?? livePeriod ?? dbPeriod;
  return { values, periods, mainPeriod };
}

// ---------------------------------------------------------------------------
// Financial statements
// ---------------------------------------------------------------------------

/** "2025/12", "2026-06", "2026Q2" (İş Yatırım) or "2025" → sortable period. */
export function parseStatementPeriod(key: string): StatementPeriod {
  const make = (year: number | null, month: number | null): StatementPeriod => ({
    key,
    year,
    month,
    months: month,
    periodType: month == null ? null : month === 12 ? "annual" : "interim",
    rank: year != null && month != null ? year * 100 + month : 0,
  });
  let m = key.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m) return make(Number(m[1]), Number(m[2]));
  m = key.match(/^(\d{4})\s*[Qq]([1-4])$/);
  if (m) return make(Number(m[1]), Number(m[2]) * 3);
  m = key.match(/^(\d{4})$/);
  if (m) return make(Number(m[1]), 12);
  return make(null, null);
}

function statementRows(records_: Obj[], periods: StatementPeriod[]): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const row of records_) {
    const rawLabel = typeof row.Item === "string" ? row.Item : "";
    const label = rawLabel.trim().replace(/\s{2,}/g, " ");
    if (!label) continue;
    const values = periods.map((p) => toNum(row[p.key]));
    // Lines that are empty (or all zero) in every period are noise, e.g. "Durdurulan faaliyetler".
    if (values.every((v) => v == null || v === 0)) continue;
    const indent = rawLabel.length - rawLabel.trimStart().length;
    rows.push({ label, depth: Math.min(indent, 2), values });
  }
  return rows;
}

/**
 * Statement payloads are one record per line item and one column per period:
 * { Item: "Hasılat", "2024/12": 7.4e11, "2025/12": 9.5e11 }. Periods are
 * returned newest first; values stay in TRY.
 */
export function parseStatement(resp: unknown, maxPeriods = 5): StatementTable | null {
  const root = asObj(resp);
  if (!root) return null;
  const rowsIn = records(root, "data");
  const periodKeys: string[] = [];
  for (const row of rowsIn) {
    for (const key of Object.keys(row)) {
      if (key !== "Item" && key !== "index" && !periodKeys.includes(key)) periodKeys.push(key);
    }
  }
  // Prefer the backend's `period_info` (months covered, annual vs interim) over inference.
  const info = new Map<string, Obj>();
  for (const item of asArr(root.period_info)) {
    const o = asObj(item);
    const key = asStr(o?.period);
    if (o && key) info.set(key, o);
  }
  const periods = periodKeys
    .map((key) => {
      const period = parseStatementPeriod(key);
      const meta = info.get(key);
      if (!meta) return period;
      const type = asStr(meta.period_type);
      return {
        ...period,
        months: toNum(meta.months) ?? period.months,
        periodType: type === "annual" || type === "interim" ? type : period.periodType,
      };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, maxPeriods);

  const basis = asStr(root.value_basis);
  const legacyFlag = pick(root, "cumulative", "is_cumulative");
  // Rows that cannot be de-cumulated are all null (e.g. a bank with only H1 + annual
  // columns); when none survive there is no single-quarter view to offer.
  const discrete = statementRows(records(root, "discrete"), periods);
  return {
    periods,
    rows: statementRows(rowsIn, periods),
    discreteRows: discrete.length > 0 ? discrete : null,
    source: asStr(root.source),
    sourceUrl: safeExternalUrl(root.source_url),
    cumulative:
      basis === "cumulative_ytd" ? true : basis === "discrete" ? false : typeof legacyFlag === "boolean" ? legacyFlag : null,
    notes: asArr(root.notes).map(asStr).filter((note): note is string => note !== null),
    unavailable: root.available === false,
  };
}

// ---------------------------------------------------------------------------
// Dividends / holders / analysts / earnings
// ---------------------------------------------------------------------------

/**
 * İş Yatırım dividends: Amount = gross TL per share, GrossRate/NetRate = % of
 * nominal value, TotalDividend = total gross payout (TL). Newest first.
 */
export function parseDividends(resp: unknown): Dividend[] {
  const out: Dividend[] = [];
  for (const row of records(resp, "dividends", "data")) {
    const date = asStr(pick(row, "Date", "date", "ex_date", "exDate"));
    const time = parseTimestamp(date);
    const gross = pos(pick(row, "Amount", "amount", "Dividends", "dividend"));
    if (!date || time == null || gross == null) continue;
    const grossRate = pos(pick(row, "GrossRate", "gross_rate"));
    const netRate = toNum(pick(row, "NetRate", "net_rate"));
    out.push({
      date,
      time,
      grossPerShare: gross,
      netPerShare: grossRate != null && netRate != null ? (gross * netRate) / grossRate : null,
      grossRate,
      total: pos(pick(row, "TotalDividend", "total_dividend")),
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * Gross dividends paid in the last 365 days, per share of today's capital, and the
 * resulting yield at `price`. Per-share amounts before a bonus issue refer to the old
 * share count (BIMAS paid 5,00 TL on 600 mn shares before its 2026 2:1 bonus), so
 * each payment is re-based as total payout ÷ the share count implied by the newest
 * row (total ÷ per-share); rows without a total keep their per-share amount.
 */
export function trailingDividendYield(
  dividends: Dividend[],
  price: number | null,
  now = Date.now(),
): { perShare: number; yieldPct: number | null; count: number } {
  const cutoff = now - 365 * 86_400_000;
  const newest = dividends.find((d) => d.total != null && d.grossPerShare != null && d.grossPerShare > 0);
  const shares = newest?.total != null && newest.grossPerShare ? newest.total / newest.grossPerShare : null;
  const paid = dividends.filter((d) => d.time >= cutoff && d.time <= now && d.grossPerShare != null);
  const perShare = paid.reduce((sum, d) => sum + (shares && d.total != null ? d.total / shares : (d.grossPerShare ?? 0)), 0);
  return { perShare, yieldPct: price && price > 0 ? (perShare / price) * 100 : null, count: paid.length };
}

/** `{ holders: [{ Holder, Percentage }] }`, percentages already 0-100. "Diğer" last. */
export function parseHolders(resp: unknown): Holder[] {
  const out: Holder[] = [];
  for (const row of records(resp, "holders", "data")) {
    const name = asStr(pick(row, "Holder", "holder", "name", "Name"));
    const percent = toNum(pick(row, "Percentage", "percentage", "percent", "Percent"));
    if (!name || percent == null || percent < 0) continue;
    out.push({ name, percent, isOther: /^(diğer|diger|other|others)$/i.test(name) });
  }
  return out.sort((a, b) => Number(a.isOther) - Number(b.isOther) || b.percent - a.percent);
}

/** `{ recommendations: { recommendation: "AL", target_price, upside_potential } }`. */
export function parseRecommendation(resp: unknown): AnalystRecommendation | null {
  const rec = asObj(asObj(resp)?.recommendations);
  if (!rec) return null;
  const raw = asStr(pick(rec, "recommendation", "consensus", "rating"));
  const out: AnalystRecommendation = {
    level: normalizeSignal(raw),
    raw,
    target: pos(pick(rec, "target_price", "targetPrice")),
    upside: toNum(pick(rec, "upside_potential", "upsidePotential")),
  };
  return out.raw || out.target != null ? out : null;
}

/** `{ targets: { current, low, high, mean, median, numberOfAnalysts } }`. */
export function parseTargets(resp: unknown): PriceTargets | null {
  const t = asObj(asObj(resp)?.targets);
  if (!t) return null;
  const out: PriceTargets = {
    current: pos(pick(t, "current", "currentPrice")),
    low: pos(pick(t, "low", "targetLowPrice")),
    high: pos(pick(t, "high", "targetHighPrice")),
    mean: pos(pick(t, "mean", "targetMeanPrice")),
    median: pos(pick(t, "median", "targetMedianPrice")),
    analysts: toNum(pick(t, "numberOfAnalysts", "numberOfAnalystOpinions", "number_of_analysts")),
  };
  return out.low != null || out.high != null || out.mean != null || out.median != null ? out : null;
}

/** KAP expected-disclosure calendar; upstream repeats rows, so dedupe. Oldest first. */
export function parseEarnings(resp: unknown): EarningsDate[] {
  const seen = new Set<string>();
  const out: EarningsDate[] = [];
  for (const row of records(resp, "earnings_dates", "data")) {
    const date = asStr(pick(row, "Earnings Date", "earningsDate", "date", "Date"));
    const time = parseTimestamp(date);
    if (!date || time == null) continue;
    const item: EarningsDate = {
      date,
      time,
      epsEstimate: toNum(pick(row, "EPS Estimate", "epsEstimate", "eps_estimate")),
      epsActual: toNum(pick(row, "Reported EPS", "epsActual", "eps_actual")),
      surprisePct: toNum(pick(row, "Surprise(%)", "surprise_pct")),
    };
    const key = `${istanbulDay(time)}|${item.epsEstimate}|${item.epsActual}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// KAP disclosures & news
// ---------------------------------------------------------------------------

function kapKey(url: string | null): string | null {
  if (!url) return null;
  const id = url.match(/Bildirim\/(\d+)/i)?.[1];
  return id ? `kap:${id}` : url.replace(/\/+$/, "").toLowerCase();
}

/** DB events (`GET /events?ticker=T`). */
export function parseDbEvents(resp: unknown): KapItem[] {
  return records(resp, "events", "data").map((row) => ({
    id: asStr(row.id),
    title: asStr(row.title) ?? asStr(row.excerpt) ?? "",
    url: safeExternalUrl(row.event_url),
    publishedAt: asStr(row.published_at),
    time: parseTimestamp(row.published_at) ?? 0,
    severity: asStr(row.severity),
    summary: asStr(row.summary),
    categoryCode: asStr(row.category_code),
    tickerCount: Array.isArray(row.tickers) ? row.tickers.length : null,
    isCorrection: row.is_correction === true,
    attachmentCount: pos(row.attachment_count),
  }));
}

/** Live KAP disclosures (`GET /fundamentals/{t}/live-news`): { news: [{Date, Title, URL}] }. */
export function parseLiveKap(resp: unknown): KapItem[] {
  const out: KapItem[] = [];
  for (const row of records(resp, "news")) {
    const title = asStr(pick(row, "Title", "title"));
    const time = parseTimestamp(pick(row, "Date", "date"));
    if (!title || time == null) continue;
    out.push({
      id: null,
      title,
      url: safeExternalUrl(pick(row, "URL", "url")),
      publishedAt: new Date(time).toISOString(),
      time,
      severity: null,
    });
  }
  return out;
}

/** Union of DB events and live KAP disclosures (deduped by KAP id), newest first. */
export function mergeKapItems(dbItems: KapItem[], liveItems: KapItem[], limit = 10): KapItem[] {
  const known = new Set(dbItems.map((item) => kapKey(item.url)).filter((k): k is string => k !== null));
  const merged = [...dbItems];
  for (const item of liveItems) {
    const key = kapKey(item.url);
    if (key && known.has(key)) continue;
    merged.push(item);
  }
  return merged.sort((a, b) => b.time - a.time).slice(0, limit);
}

/** `GET /news/{t}?hours=N` → { news: [{ title, url, source, published_at }] }. */
export function parseNews(resp: unknown): NewsItem[] {
  const out: NewsItem[] = [];
  for (const row of records(resp, "news")) {
    const title = asStr(row.title);
    if (!title) continue;
    out.push({
      title,
      url: safeExternalUrl(row.url),
      source: asStr(row.source),
      publishedAt: asStr(row.published_at),
    });
  }
  return out.sort((a, b) => (parseTimestamp(b.publishedAt) ?? 0) - (parseTimestamp(a.publishedAt) ?? 0));
}
