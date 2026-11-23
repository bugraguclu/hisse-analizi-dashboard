/**
 * Pure macroeconomic data parsers and time-series builders for the mobile Makro screen.
 * Mirrors `dashboard/src/components/makro/series.ts` and `calendar/utils.ts` so
 * values, dates, real-rate calculations, and calendar rows match web exactly.
 */

import type {
  FxBulletinOut,
  FxBulletinRate,
  IndicatorsOut,
  InflationLatest,
  InflationOut,
  InflationRow,
  MacroIndicator,
  MarketHistoryOut,
  MarketQuote,
  MarketsOut,
  PolicyRateChange,
  PolicyRateOut,
  TcmbCalendarOut,
  TcmbEvent,
  TcmbRatesOut,
} from "../../dashboard/src/components/makro/types.ts";
import { toFiniteNumber } from "./format.ts";

export type MacroHistoryRange = "1y" | "3y" | "5y" | "10y" | "all";
export type MacroMarketPeriod = "1ay" | "3ay" | "6ay" | "ytd" | "1y" | "2y" | "5y";

export const MACRO_RANGES: readonly { id: MacroHistoryRange; label: string; months: number | null }[] = [
  { id: "1y", label: "1Y", months: 12 },
  { id: "3y", label: "3Y", months: 36 },
  { id: "5y", label: "5Y", months: 60 },
  { id: "10y", label: "10Y", months: 120 },
  { id: "all", label: "Tümü", months: null },
];

export const MACRO_MARKET_PERIODS: readonly { id: MacroMarketPeriod; label: string }[] = [
  { id: "1ay", label: "1A" },
  { id: "3ay", label: "3A" },
  { id: "6ay", label: "6A" },
  { id: "ytd", label: "YBB" },
  { id: "1y", label: "1Y" },
  { id: "2y", label: "2Y" },
  { id: "5y", label: "5Y" },
];

export interface MonthlyInflationPoint {
  month: string;
  yearly: number | null;
  monthly: number | null;
}

export interface PolicyInflationPoint {
  month: string;
  policy: number | null;
  cpi: number | null;
  real: number | null;
}

export interface TcmbCorridorSummary {
  policy: number | null;
  policyDate: string | null;
  overnightBorrowing: number | null;
  overnightLending: number | null;
  lateLiquidityLending: number | null;
  lastChange: PolicyRateChange | null;
  recentChanges: PolicyRateChange[];
  nextMpc: TcmbEvent | null;
  lastMpc: TcmbEvent | null;
  upcomingPublications: TcmbEvent[];
}

export interface InflationSummary {
  cpiYearly: number | null;
  cpiYearlyDelta: number | null;
  cpiMonthly: number | null;
  cpiMonthlyDelta: number | null;
  cpiDate: string | null;
  ppiYearly: number | null;
  ppiYearlyDelta: number | null;
  ppiMonthly: number | null;
  ppiDate: string | null;
  cpiSeries: MonthlyInflationPoint[];
  ppiSeries: MonthlyInflationPoint[];
}

export interface EconomicCalendarEvent {
  id: string;
  date: string;
  time: string | null;
  countryCode: string;
  countryName: string;
  importance: "high" | "mid" | "low";
  title: string;
  period: string | null;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  keyEvent: boolean;
}

export interface ParsedMacroOverview {
  asOf: string | null;
  corridor: TcmbCorridorSummary;
  inflation: InflationSummary;
  policyInflationSeries: PolicyInflationPoint[];
  latestRealRate: number | null;
  markets: MarketQuote[];
  marketsAsOf: string | null;
  fxBulletinDate: string | null;
  fxBulletinRates: FxBulletinRate[];
  indicators: MacroIndicator[];
  indicatorsAsOf: string | null;
}

function monthKey(date: string | null | undefined): string | null {
  if (!date) return null;
  const match = date.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(lastDay).padStart(2, "0")}`;
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function buildInflationSeries(rows: readonly InflationRow[] | undefined): MonthlyInflationPoint[] {
  const byMonth = new Map<string, MonthlyInflationPoint>();
  for (const row of rows ?? []) {
    const ym = monthKey(row.Date ?? row.YearMonth);
    if (!ym || byMonth.has(ym)) continue;
    byMonth.set(ym, {
      month: ym,
      yearly: toFiniteNumber(row.YearlyInflation),
      monthly: toFiniteNumber(row.MonthlyInflation),
    });
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function policyAtDate(changes: readonly PolicyRateChange[], day: string): number | null {
  let rate: number | null = null;
  for (const change of changes) {
    if (change.date > day) break;
    rate = change.rate;
  }
  return rate;
}

export function buildPolicyInflationSeries(
  changes: readonly PolicyRateChange[] | undefined,
  cpi: readonly MonthlyInflationPoint[],
  todayIso: string,
): PolicyInflationPoint[] {
  const ordered = [...(changes ?? [])]
    .filter((c) => Boolean(c.date) && Number.isFinite(c.rate))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ordered.length === 0) return [];
  const cpiByMonth = new Map(cpi.map((p) => [p.month, p.yearly]));
  const first = monthKey(ordered[0].date);
  const todayMonth = monthKey(todayIso);
  const lastCpiMonth = cpi.length > 0 ? cpi[cpi.length - 1].month : null;
  if (!first || !todayMonth) return [];
  const last = lastCpiMonth && lastCpiMonth > todayMonth ? lastCpiMonth : todayMonth;

  const out: PolicyInflationPoint[] = [];
  for (let ym = first; ym <= last; ym = addMonths(ym, 1)) {
    const day = ym === todayMonth ? todayIso.slice(0, 10) : monthEnd(ym);
    const policy = policyAtDate(ordered, day);
    const cpiVal = cpiByMonth.get(ym) ?? null;
    const real =
      policy !== null && cpiVal !== null ? Math.round((policy - cpiVal) * 100) / 100 : null;
    out.push({ month: ym, policy, cpi: cpiVal, real });
  }
  return out;
}

export function sliceLastMonths<T extends { month: string }>(
  points: readonly T[],
  months: number | null,
): T[] {
  if (months === null || points.length === 0) return [...points];
  const cutoff = addMonths(points[points.length - 1].month, -months);
  return points.filter((p) => p.month >= cutoff);
}

function deltaFromPrevious(
  latest: InflationLatest | null | undefined,
  rows: readonly InflationRow[] | undefined,
  field: "yearly" | "monthly",
): number | null {
  const curr = toFiniteNumber(field === "yearly" ? latest?.yearly_inflation : latest?.monthly_inflation);
  const prev = toFiniteNumber(field === "yearly" ? rows?.[1]?.YearlyInflation : rows?.[1]?.MonthlyInflation);
  if (curr === null || prev === null) return null;
  return Math.round((curr - prev) * 100) / 100;
}

export function parseMacroOverview(parts: {
  policyRate?: PolicyRateOut | null;
  tcmbRates?: TcmbRatesOut | null;
  tcmbCalendar?: TcmbCalendarOut | null;
  inflation?: InflationOut | null;
  markets?: MarketsOut | null;
  fxBulletin?: FxBulletinOut | null;
  indicators?: IndicatorsOut | null;
  todayIso?: string;
}): ParsedMacroOverview {
  const rows = parts.tcmbRates?.data ?? [];
  const rateOf = (type: string, side: "borrowing" | "lending"): number | null => {
    const val = rows.find((r) => r.type === type)?.[side];
    return toFiniteNumber(val);
  };

  const policy = rateOf("policy", "lending") ?? toFiniteNumber(parts.policyRate?.policy_rate?.value);
  const changes = parts.policyRate?.changes ?? [];
  const recentChanges = [...changes].reverse().filter((c) => c.change_bp !== null).slice(0, 8);
  const pubOrder = ["mpc_summary", "inflation_report", "financial_stability_report"] as const;
  const upcomingPublications = pubOrder
    .map((type) => parts.tcmbCalendar?.next?.[type])
    .filter((ev): ev is TcmbEvent => Boolean(ev))
    .sort((a, b) => a.date.localeCompare(b.date));

  const cpiSeries = buildInflationSeries(parts.inflation?.tufe_history);
  const ppiSeries = buildInflationSeries(parts.inflation?.ufe_history);
  const cpiYearly = toFiniteNumber(parts.inflation?.latest?.yearly_inflation);
  const todayIso = parts.todayIso ?? new Date().toISOString().slice(0, 10);
  const policyInflationSeries = buildPolicyInflationSeries(changes, cpiSeries, todayIso);
  const latestRealRate =
    policy !== null && cpiYearly !== null ? Math.round((policy - cpiYearly) * 100) / 100 : null;

  const asOf =
    parts.markets?.as_of ??
    parts.policyRate?.as_of ??
    parts.inflation?.as_of ??
    parts.indicators?.as_of ??
    null;

  return {
    asOf,
    corridor: {
      policy,
      policyDate: parts.policyRate?.policy_rate?.date ?? parts.policyRate?.last_change?.date ?? null,
      overnightBorrowing: rateOf("overnight", "borrowing"),
      overnightLending: rateOf("overnight", "lending"),
      lateLiquidityLending: rateOf("late_liquidity", "lending"),
      lastChange: parts.policyRate?.last_change ?? null,
      recentChanges,
      nextMpc: parts.tcmbCalendar?.next?.mpc_decision ?? null,
      lastMpc: parts.tcmbCalendar?.last?.mpc_decision ?? null,
      upcomingPublications,
    },
    inflation: {
      cpiYearly,
      cpiYearlyDelta: deltaFromPrevious(parts.inflation?.latest, parts.inflation?.tufe_history, "yearly"),
      cpiMonthly: toFiniteNumber(parts.inflation?.latest?.monthly_inflation),
      cpiMonthlyDelta: deltaFromPrevious(parts.inflation?.latest, parts.inflation?.tufe_history, "monthly"),
      cpiDate: parts.inflation?.latest?.date ?? parts.inflation?.latest?.year_month ?? null,
      ppiYearly: toFiniteNumber(parts.inflation?.ufe_latest?.yearly_inflation),
      ppiYearlyDelta: deltaFromPrevious(parts.inflation?.ufe_latest, parts.inflation?.ufe_history, "yearly"),
      ppiMonthly: toFiniteNumber(parts.inflation?.ufe_latest?.monthly_inflation),
      ppiDate: parts.inflation?.ufe_latest?.date ?? parts.inflation?.ufe_latest?.year_month ?? null,
      cpiSeries,
      ppiSeries,
    },
    policyInflationSeries,
    latestRealRate,
    markets: parts.markets?.instruments ?? [],
    marketsAsOf: parts.markets?.as_of ?? null,
    fxBulletinDate: parts.fxBulletin?.date ?? null,
    fxBulletinRates: parts.fxBulletin?.rates ?? [],
    indicators: parts.indicators?.indicators ?? [],
    indicatorsAsOf: parts.indicators?.as_of ?? null,
  };
}

/** Resolves a deep-link `?piyasa=` key (e.g. `usdtry`, `USD`, `gram_altin`, `tufe`) against available instruments. */
export function resolveRequestedMarketKey(
  requested: string | undefined,
  instruments: readonly MarketQuote[],
): string {
  if (instruments.length === 0) return requested?.trim().toLowerCase() || "usdtry";
  const norm = requested?.trim().toLowerCase() ?? "";
  if (norm) {
    const exact = instruments.find((q) => q.key.toLowerCase() === norm);
    if (exact) return exact.key;
    const bySymbol = instruments.find((q) => q.symbol?.toLowerCase() === norm);
    if (bySymbol) return bySymbol.key;
    const aliasMap: Record<string, string> = {
      usd: "usdtry",
      eur: "eurtry",
      altin: "gram_altin",
      gold: "xauusd",
      brent: "brent",
      dxy: "dxy",
    };
    const mapped = aliasMap[norm];
    if (mapped && instruments.some((q) => q.key === mapped)) return mapped;
  }
  return instruments.find((q) => q.key === "usdtry")?.key ?? instruments[0].key;
}

export function parseMacroMarketHistory(resp: unknown): MarketHistoryOut | null {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) return null;
  const raw = resp as Partial<MarketHistoryOut>;
  if (typeof raw.key !== "string" || !Array.isArray(raw.points)) return null;
  const points = raw.points
    .filter((p) => p && typeof p.date === "string" && Number.isFinite(p.close))
    .map((p) => ({ date: p.date, close: p.close }));
  return {
    key: raw.key,
    name: raw.name ?? raw.key,
    unit: raw.unit ?? "TRY",
    group: raw.group ?? "fx",
    period: raw.period ?? "1y",
    interval: raw.interval ?? "1d",
    source: raw.source ?? "",
    points,
    reference_close: toFiniteNumber(raw.reference_close),
    reference_date: raw.reference_date ?? null,
    change: toFiniteNumber(raw.change),
    change_percent: toFiniteNumber(raw.change_percent),
    high: toFiniteNumber(raw.high),
    low: toFiniteNumber(raw.low),
  };
}

export function parseEconomicCalendar(resp: unknown): {
  available: boolean;
  rows: EconomicCalendarEvent[];
  asOf: string | null;
} {
  if (!resp || typeof resp !== "object" || Array.isArray(resp)) {
    return { available: false, rows: [], asOf: null };
  }
  const root = resp as Record<string, unknown>;
  const rawRows = Array.isArray(root.events)
    ? root.events
    : Array.isArray(root.data)
      ? root.data
      : [];

  const text = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, " ").trim();
    return s || null;
  };

  const rows: EconomicCalendarEvent[] = [];
  rawRows.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const r = item as Record<string, unknown>;
    const date = text(r.Date)?.slice(0, 10);
    const eventName = text(r.Event);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !eventName) return;
    const titleTr = text(r.title_tr);
    const titleEn = text(r.title_en);
    const title = titleTr ?? text(r.title) ?? titleEn ?? eventName;
    const rawTime = text(r.Time);
    const time = rawTime && /^\d{1,2}:\d{2}$/.test(rawTime) ? rawTime.padStart(5, "0") : null;
    const impRaw = String(r.Importance ?? "low");
    const importance: "high" | "mid" | "low" =
      impRaw === "high" || impRaw === "mid" || impRaw === "low" ? impRaw : "low";
    const countryName = text(r.Country) ?? "";
    const countryCode = (text(r.country_code) ?? countryName).toUpperCase();
    rows.push({
      id: text(r.id) ?? `${countryCode}-${date}-${time ?? "all"}-${index}`,
      date,
      time,
      countryCode,
      countryName,
      importance,
      title,
      period: text(r.period_label),
      actual: text(r.Actual),
      forecast: text(r.Forecast),
      previous: text(r.Previous),
      keyEvent: r.key_event === true,
    });
  });

  return {
    available: root.available !== false,
    rows,
    asOf: text(root.as_of),
  };
}

export const MACRO_INDICATOR_GROUPS: readonly { id: MacroIndicator["group"]; label: string }[] = [
  { id: "growth", label: "Büyüme" },
  { id: "labor", label: "İstihdam" },
  { id: "external", label: "Dış denge & rezervler" },
  { id: "fiscal", label: "Maliye" },
  { id: "prices", label: "Fiyatlar" },
  { id: "monetary", label: "Para & küresel" },
];
