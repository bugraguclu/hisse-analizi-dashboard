/**
 * Mobile BIST stock screener engine — pure TypeScript, zero React dependency.
 * Mirrors web `dashboard/src/components/tarama/model.ts` criteria, KAP sector
 * medians, and sorting rules so mobile and web produce identical stock lists.
 */

import type { ScreenerUniverseRow } from "../../dashboard/src/types/index.ts";

export type ScreenerStockRow = ScreenerUniverseRow;

export type NumericField =
  | "close" | "change_pct" | "turnover" | "avg_turnover" | "market_cap"
  | "pe" | "pb" | "ev_ebitda" | "dividend_yield" | "roe" | "net_margin"
  | "rsi" | "sma50_dist" | "sma200_dist" | "tech_rating" | "rel_volume"
  | "high_52w_dist" | "low_52w_dist"
  | "perf_1w" | "perf_1m" | "perf_3m" | "perf_ytd" | "perf_1y"
  | "target_price" | "upside" | "foreign_ratio";

export type FilterGroup =
  | "valuation"
  | "profitability"
  | "scale"
  | "technical"
  | "performance"
  | "analyst";

export const FILTER_GROUPS: readonly { id: FilterGroup; label: string }[] = [
  { id: "valuation", label: "Değerleme" },
  { id: "profitability", label: "Kârlılık" },
  { id: "scale", label: "Ölçek ve likidite" },
  { id: "technical", label: "Teknik" },
  { id: "performance", label: "Performans" },
  { id: "analyst", label: "Analist" },
];

export type RangeKey =
  | "pe" | "pb" | "evebitda" | "dy"
  | "roe" | "nm"
  | "mcap" | "vol"
  | "rsi" | "sma50" | "sma200" | "hi52" | "lo52" | "rvol"
  | "chg" | "p1w" | "p1m" | "p3m" | "pytd" | "p1y"
  | "upside" | "foreign";

export interface RangeFilterDef {
  key: RangeKey;
  field: NumericField;
  label: string;
  shortLabel: string;
  unit: "multiple" | "pct" | "bn" | "mn" | "x" | "index";
  scale: number;
}

export const RANGE_FILTERS: readonly RangeFilterDef[] = [
  { key: "pe", field: "pe", label: "F/K", shortLabel: "F/K", unit: "multiple", scale: 1 },
  { key: "pb", field: "pb", label: "PD/DD", shortLabel: "PD/DD", unit: "multiple", scale: 1 },
  { key: "evebitda", field: "ev_ebitda", label: "FD/FAVÖK", shortLabel: "FD/FAVÖK", unit: "multiple", scale: 1 },
  { key: "dy", field: "dividend_yield", label: "Temettü verimi (%)", shortLabel: "Temettü", unit: "pct", scale: 1 },
  { key: "roe", field: "roe", label: "ROE (%)", shortLabel: "ROE", unit: "pct", scale: 1 },
  { key: "nm", field: "net_margin", label: "Net kâr marjı (%)", shortLabel: "Net marj", unit: "pct", scale: 1 },
  { key: "mcap", field: "market_cap", label: "Piyasa değeri (Mr ₺)", shortLabel: "Piyasa değ.", unit: "bn", scale: 1e9 },
  { key: "vol", field: "avg_turnover", label: "Ort. hacim (Mn ₺)", shortLabel: "Ort. hacim", unit: "mn", scale: 1e6 },
  { key: "rsi", field: "rsi", label: "RSI (14)", shortLabel: "RSI", unit: "index", scale: 1 },
  { key: "sma50", field: "sma50_dist", label: "SMA 50 uzaklığı (%)", shortLabel: "SMA 50", unit: "pct", scale: 1 },
  { key: "sma200", field: "sma200_dist", label: "SMA 200 uzaklığı (%)", shortLabel: "SMA 200", unit: "pct", scale: 1 },
  { key: "hi52", field: "high_52w_dist", label: "52H zirve uzaklığı (%)", shortLabel: "52H zirve", unit: "pct", scale: 1 },
  { key: "lo52", field: "low_52w_dist", label: "52H dip uzaklığı (%)", shortLabel: "52H dip", unit: "pct", scale: 1 },
  { key: "rvol", field: "rel_volume", label: "Göreli hacim (x)", shortLabel: "Gör. hacim", unit: "x", scale: 1 },
  { key: "chg", field: "change_pct", label: "Günlük değişim (%)", shortLabel: "Günlük", unit: "pct", scale: 1 },
  { key: "p1w", field: "perf_1w", label: "1 hafta getiri (%)", shortLabel: "1H", unit: "pct", scale: 1 },
  { key: "p1m", field: "perf_1m", label: "1 ay getiri (%)", shortLabel: "1A", unit: "pct", scale: 1 },
  { key: "p3m", field: "perf_3m", label: "3 ay getiri (%)", shortLabel: "3A", unit: "pct", scale: 1 },
  { key: "pytd", field: "perf_ytd", label: "Yılbaşından beri (%)", shortLabel: "YBB", unit: "pct", scale: 1 },
  { key: "p1y", field: "perf_1y", label: "1 yıl getiri (%)", shortLabel: "1Y", unit: "pct", scale: 1 },
  { key: "upside", field: "upside", label: "Hedef potansiyel (%)", shortLabel: "Potansiyel", unit: "pct", scale: 1 },
  { key: "foreign", field: "foreign_ratio", label: "Yabancı payı (%)", shortLabel: "Yabancı", unit: "pct", scale: 1 },
];

export const RANGE_BY_KEY: ReadonlyMap<RangeKey, RangeFilterDef> = new Map(
  RANGE_FILTERS.map((def) => [def.key, def]),
);

/** Typed criteria grouped as in the web filter panel (every range filter is editable). */
export const RANGE_GROUPS: readonly { id: FilterGroup; keys: readonly RangeKey[] }[] = [
  { id: "valuation", keys: ["pe", "pb", "evebitda", "dy"] },
  { id: "profitability", keys: ["roe", "nm"] },
  { id: "scale", keys: ["mcap", "vol"] },
  { id: "technical", keys: ["rsi", "sma50", "sma200", "hi52", "lo52", "rvol"] },
  { id: "performance", keys: ["chg", "p1w", "p1m", "p3m", "pytd", "p1y"] },
  { id: "analyst", keys: ["upside", "foreign"] },
];

export interface Bounds {
  min?: number;
  max?: number;
}

export type Ranges = Partial<Record<RangeKey, Bounds>>;
export type CrossFilter = "" | "golden" | "death";
export type RecFilter = "" | "AL" | "TUT" | "SAT";

/** Every numeric column of the universe can be sorted on, as on the web table. */
export type SortKey = NumericField | "symbol";

export type SortDir = "asc" | "desc";

/** Short column labels (cards, sort menu, VoiceOver). */
export const FIELD_LABELS: Record<NumericField, string> = {
  close: "Fiyat",
  change_pct: "Günlük değişim",
  turnover: "Hacim",
  avg_turnover: "Ort. hacim",
  market_cap: "Piyasa değeri",
  pe: "F/K",
  pb: "PD/DD",
  ev_ebitda: "FD/FAVÖK",
  dividend_yield: "Temettü verimi",
  roe: "ROE",
  net_margin: "Net marj",
  rsi: "RSI (14)",
  sma50_dist: "SMA 50 uzaklığı",
  sma200_dist: "SMA 200 uzaklığı",
  tech_rating: "Teknik puan",
  rel_volume: "Göreli hacim",
  high_52w_dist: "52H zirveye uzaklık",
  low_52w_dist: "52H dibe uzaklık",
  perf_1w: "1 hafta",
  perf_1m: "1 ay",
  perf_3m: "3 ay",
  perf_ytd: "Yılbaşından beri",
  perf_1y: "1 yıl",
  target_price: "Hedef fiyat",
  upside: "Hedef potansiyel",
  foreign_ratio: "Yabancı payı",
};

/** Mirrors web `ASCENDING_FIRST`: names and cheapness ascend, everything else largest first. */
const ASCENDING_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(["symbol", "pe", "pb", "ev_ebitda", "low_52w_dist"]);

export function defaultSortDir(key: SortKey): SortDir {
  return ASCENDING_FIRST.has(key) ? "asc" : "desc";
}

export function sortLabel(key: SortKey): string {
  return key === "symbol" ? "Hisse kodu" : FIELD_LABELS[key];
}

// ---------------------------------------------------------------------------
// Views (the web table's column sets)
// ---------------------------------------------------------------------------

export type ViewKey = "overview" | "fundamentals" | "technical" | "performance" | "analyst";

export const VIEWS: readonly { id: ViewKey; label: string }[] = [
  { id: "overview", label: "Genel" },
  { id: "fundamentals", label: "Temel" },
  { id: "technical", label: "Teknik" },
  { id: "performance", label: "Performans" },
  { id: "analyst", label: "Analist" },
];

/**
 * Metric columns per view, after the always-visible price and daily change.
 * Same sets as web `VIEW_COLUMNS` (sector, recommendation and signals render as badges).
 */
export const VIEW_METRICS: Record<ViewKey, readonly NumericField[]> = {
  overview: ["turnover", "market_cap", "pe", "pb", "dividend_yield"],
  fundamentals: ["market_cap", "pe", "pb", "ev_ebitda", "dividend_yield", "roe", "net_margin"],
  technical: ["rsi", "sma50_dist", "sma200_dist", "high_52w_dist", "low_52w_dist", "rel_volume", "tech_rating"],
  performance: ["perf_1w", "perf_1m", "perf_3m", "perf_ytd", "perf_1y", "avg_turnover"],
  analyst: ["target_price", "upside", "foreign_ratio", "market_cap"],
};

/** Sort fields offered in the sort sheet for a view: its own columns first, then the rest. */
export function sortOptionsForView(view: ViewKey): { primary: SortKey[]; other: SortKey[] } {
  const primary: SortKey[] = ["symbol", "close", "change_pct", ...VIEW_METRICS[view]];
  const all = Object.keys(FIELD_LABELS) as NumericField[];
  return { primary, other: all.filter((field) => !primary.includes(field)) };
}

export type TechRating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

/** TradingView's own buckets for Recommend.All (web `techRating`). */
export function techRating(value: number | undefined): TechRating | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value > 0.5) return "strongBuy";
  if (value > 0.1) return "buy";
  if (value >= -0.1) return "neutral";
  if (value >= -0.5) return "sell";
  return "strongSell";
}

export const TECH_RATING_LABELS: Record<TechRating, string> = {
  strongBuy: "Güçlü al",
  buy: "Al",
  neutral: "Nötr",
  sell: "Sat",
  strongSell: "Güçlü sat",
};

export type PresetId =
  | "low_pe" | "pe_below_sector" | "low_pb" | "pb_below_sector" | "low_ev_ebitda" | "high_dividend"
  | "profitable" | "high_roe" | "roe_above_sector" | "high_net_margin"
  | "large_cap" | "mid_cap" | "small_cap" | "liquid"
  | "uptrend" | "golden_cross" | "death_cross" | "near_high" | "near_low" | "rsi_oversold" | "rsi_overbought" | "volume_spike"
  | "top_gainers" | "top_losers" | "day_gainers" | "day_losers" | "week_gainers"
  | "buy_rec" | "sell_rec" | "high_upside" | "high_foreign";

export interface RelativeRule {
  key: RangeKey;
  op: "below" | "above";
}

export interface PresetDef {
  id: PresetId;
  label: string;
  ruleSummary: string;
  group: FilterGroup;
  featured?: boolean;
  ranges?: Ranges;
  cross?: Exclude<CrossFilter, "">;
  rec?: Exclude<RecFilter, "">;
  profitable?: true;
  relative?: RelativeRule;
  sort?: readonly [SortKey, SortDir];
  highlightMetric?: NumericField;
}

export const RSI_OVERSOLD = 30;
export const RSI_OVERBOUGHT = 70;
export const NEAR_52W_PCT = 5;
export const VOLUME_SPIKE = 2;
const FLAT_EPSILON = 0.005;

export const SCREENER_PRESETS: readonly PresetDef[] = [
  { id: "low_pe", label: "Düşük F/K", ruleSummary: "F/K ≤ 10", group: "valuation", featured: true, ranges: { pe: { max: 10 } }, sort: ["pe", "asc"], highlightMetric: "pe" },
  { id: "pe_below_sector", label: "Sektör altı F/K", ruleSummary: "F/K < KAP sektör medyanı", group: "valuation", relative: { key: "pe", op: "below" }, sort: ["pe", "asc"], highlightMetric: "pe" },
  { id: "low_pb", label: "Düşük PD/DD", ruleSummary: "PD/DD ≤ 1", group: "valuation", featured: true, ranges: { pb: { max: 1 } }, sort: ["pb", "asc"], highlightMetric: "pb" },
  { id: "pb_below_sector", label: "Sektör altı PD/DD", ruleSummary: "PD/DD < KAP sektör medyanı", group: "valuation", relative: { key: "pb", op: "below" }, sort: ["pb", "asc"], highlightMetric: "pb" },
  { id: "low_ev_ebitda", label: "Düşük FD/FAVÖK", ruleSummary: "FD/FAVÖK ≤ 6", group: "valuation", ranges: { evebitda: { max: 6 } }, sort: ["ev_ebitda", "asc"], highlightMetric: "ev_ebitda" },
  { id: "high_dividend", label: "Yüksek temettü", ruleSummary: "Temettü verimi ≥ %4", group: "valuation", featured: true, ranges: { dy: { min: 4 } }, sort: ["dividend_yield", "desc"], highlightMetric: "dividend_yield" },

  { id: "profitable", label: "Kârlı şirketler", ruleSummary: "Son 12 ayda net kâr", group: "profitability", profitable: true, sort: ["market_cap", "desc"], highlightMetric: "pe" },
  { id: "high_roe", label: "Yüksek ROE", ruleSummary: "ROE ≥ %25", group: "profitability", featured: true, ranges: { roe: { min: 25 } }, sort: ["roe", "desc"], highlightMetric: "roe" },
  { id: "roe_above_sector", label: "Sektör üstü ROE", ruleSummary: "ROE > KAP sektör medyanı", group: "profitability", relative: { key: "roe", op: "above" }, sort: ["roe", "desc"], highlightMetric: "roe" },
  { id: "high_net_margin", label: "Yüksek net marj", ruleSummary: "Net kâr marjı ≥ %20", group: "profitability", ranges: { nm: { min: 20 } }, sort: ["net_margin", "desc"], highlightMetric: "net_margin" },

  { id: "large_cap", label: "Büyük ölçek", ruleSummary: "Piyasa değeri ≥ 100 Mr ₺", group: "scale", ranges: { mcap: { min: 100 } }, sort: ["market_cap", "desc"], highlightMetric: "market_cap" },
  { id: "mid_cap", label: "Orta ölçek", ruleSummary: "Piyasa değeri 20–100 Mr ₺", group: "scale", ranges: { mcap: { min: 20, max: 100 } }, sort: ["market_cap", "desc"], highlightMetric: "market_cap" },
  { id: "small_cap", label: "Küçük ölçek", ruleSummary: "Piyasa değeri ≤ 20 Mr ₺", group: "scale", ranges: { mcap: { max: 20 } }, sort: ["market_cap", "desc"], highlightMetric: "market_cap" },
  { id: "liquid", label: "Yüksek likidite", ruleSummary: "Ort. günlük hacim ≥ 100 Mn ₺", group: "scale", ranges: { vol: { min: 100 } }, sort: ["avg_turnover", "desc"], highlightMetric: "avg_turnover" },

  { id: "uptrend", label: "Yükseliş trendi", ruleSummary: "Fiyat SMA 50 ve SMA 200 üstü", group: "technical", featured: true, ranges: { sma50: { min: 0 }, sma200: { min: 0 } }, sort: ["sma200_dist", "desc"], highlightMetric: "sma200_dist" },
  { id: "golden_cross", label: "Golden cross", ruleSummary: "SMA 50, SMA 200'ü yukarı kesti", group: "technical", cross: "golden", sort: ["market_cap", "desc"], highlightMetric: "sma50_dist" },
  { id: "death_cross", label: "Death cross", ruleSummary: "SMA 50, SMA 200'ü aşağı kesti", group: "technical", cross: "death", sort: ["market_cap", "desc"], highlightMetric: "sma50_dist" },
  { id: "near_high", label: "52H zirvesine yakın", ruleSummary: "52H zirveye en çok %5 uzak", group: "technical", ranges: { hi52: { min: -NEAR_52W_PCT } }, sort: ["high_52w_dist", "desc"], highlightMetric: "high_52w_dist" },
  { id: "near_low", label: "52H dibine yakın", ruleSummary: "52H dibe en çok %5 uzak", group: "technical", ranges: { lo52: { max: NEAR_52W_PCT } }, sort: ["low_52w_dist", "asc"], highlightMetric: "low_52w_dist" },
  { id: "rsi_oversold", label: "RSI aşırı satım", ruleSummary: "RSI (14) ≤ 30", group: "technical", featured: true, ranges: { rsi: { max: RSI_OVERSOLD } }, sort: ["rsi", "asc"], highlightMetric: "rsi" },
  { id: "rsi_overbought", label: "RSI aşırı alım", ruleSummary: "RSI (14) ≥ 70", group: "technical", ranges: { rsi: { min: RSI_OVERBOUGHT } }, sort: ["rsi", "desc"], highlightMetric: "rsi" },
  { id: "volume_spike", label: "Hacim artışı", ruleSummary: "Göreli hacim ≥ 2x", group: "technical", ranges: { rvol: { min: VOLUME_SPIKE } }, sort: ["rel_volume", "desc"], highlightMetric: "rel_volume" },

  { id: "top_gainers", label: "En çok yükselenler", ruleSummary: "Günlük değişim > %0", group: "performance", ranges: { chg: { min: FLAT_EPSILON } }, sort: ["change_pct", "desc"], highlightMetric: "change_pct" },
  { id: "top_losers", label: "En çok düşenler", ruleSummary: "Günlük değişim < %0", group: "performance", ranges: { chg: { max: -FLAT_EPSILON } }, sort: ["change_pct", "asc"], highlightMetric: "change_pct" },
  { id: "day_gainers", label: "Günün yükselenleri", ruleSummary: "Günlük değişim ≥ %5", group: "performance", ranges: { chg: { min: 5 } }, sort: ["change_pct", "desc"], highlightMetric: "change_pct" },
  { id: "day_losers", label: "Günün düşenleri", ruleSummary: "Günlük değişim ≤ -%5", group: "performance", ranges: { chg: { max: -5 } }, sort: ["change_pct", "asc"], highlightMetric: "change_pct" },
  { id: "week_gainers", label: "Haftanın yükselenleri", ruleSummary: "1 hafta getiri ≥ %10", group: "performance", ranges: { p1w: { min: 10 } }, sort: ["perf_1w", "desc"], highlightMetric: "perf_1w" },

  { id: "buy_rec", label: "AL önerisi", ruleSummary: "İş Yatırım önerisi: AL", group: "analyst", rec: "AL", sort: ["upside", "desc"], highlightMetric: "upside" },
  { id: "sell_rec", label: "SAT önerisi", ruleSummary: "İş Yatırım önerisi: SAT", group: "analyst", rec: "SAT", sort: ["upside", "asc"], highlightMetric: "upside" },
  { id: "high_upside", label: "Yüksek potansiyel", ruleSummary: "Hedef potansiyel ≥ %25", group: "analyst", ranges: { upside: { min: 25 } }, sort: ["upside", "desc"], highlightMetric: "upside" },
  { id: "high_foreign", label: "Yüksek yabancı payı", ruleSummary: "Yabancı payı ≥ %30", group: "analyst", ranges: { foreign: { min: 30 } }, sort: ["foreign_ratio", "desc"], highlightMetric: "foreign_ratio" },
];

/** View a quick screen opens in (web `PresetDef.view`); scale presets keep the current one. */
export const PRESET_VIEWS: Partial<Record<PresetId, ViewKey>> = {
  low_pe: "fundamentals", pe_below_sector: "fundamentals", low_pb: "fundamentals", pb_below_sector: "fundamentals",
  low_ev_ebitda: "fundamentals", high_dividend: "fundamentals", profitable: "fundamentals", high_roe: "fundamentals",
  roe_above_sector: "fundamentals", high_net_margin: "fundamentals",
  liquid: "performance",
  uptrend: "technical", golden_cross: "technical", death_cross: "technical", near_high: "technical",
  near_low: "technical", rsi_oversold: "technical", rsi_overbought: "technical", volume_spike: "technical",
  top_gainers: "performance", top_losers: "performance", day_gainers: "performance", day_losers: "performance",
  week_gainers: "performance",
  buy_rec: "analyst", sell_rec: "analyst", high_upside: "analyst", high_foreign: "analyst",
};

export type RowSignal = "oversold" | "overbought" | "golden" | "death" | "nearHigh" | "nearLow" | "volumeSpike";

export const ROW_SIGNAL_LABELS: Record<RowSignal, string> = {
  oversold: "Aşırı satım",
  overbought: "Aşırı alım",
  golden: "Golden cross",
  death: "Death cross",
  nearHigh: "52H zirveye yakın",
  nearLow: "52H dibe yakın",
  volumeSpike: "Hacim artışı",
};

/** Technical badges — same thresholds as the quick screens (web `rowSignals`). */
export function rowSignals(row: ScreenerStockRow): RowSignal[] {
  const out: RowSignal[] = [];
  if (row.cross === "golden") out.push("golden");
  if (row.cross === "death") out.push("death");
  if (row.rsi !== undefined && row.rsi <= RSI_OVERSOLD) out.push("oversold");
  if (row.rsi !== undefined && row.rsi >= RSI_OVERBOUGHT) out.push("overbought");
  if (row.high_52w_dist !== undefined && row.high_52w_dist >= -NEAR_52W_PCT) out.push("nearHigh");
  if (row.low_52w_dist !== undefined && row.low_52w_dist <= NEAR_52W_PCT) out.push("nearLow");
  if (row.rel_volume !== undefined && row.rel_volume >= VOLUME_SPIKE) out.push("volumeSpike");
  return out;
}

export const FEATURED_PRESETS: readonly PresetDef[] = SCREENER_PRESETS.filter((p) => p.featured);
export const PRESET_BY_ID: ReadonlyMap<PresetId, PresetDef> = new Map(SCREENER_PRESETS.map((p) => [p.id, p]));

const PRESET_ALIASES: Record<string, PresetId> = {
  buy_recommendation: "buy_rec",
  sell_recommendation: "sell_rec",
  high_foreign_ownership: "high_foreign",
};

export function resolvePresetId(raw: string | undefined): PresetId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (PRESET_BY_ID.has(key as PresetId)) return key as PresetId;
  return PRESET_ALIASES[key] ?? null;
}

export interface ScreenerFilterState {
  q: string;
  index: string;
  sector: string;
  presets: PresetId[];
  cross: CrossFilter;
  rec: RecFilter;
  ranges: Ranges;
  /** Column set shown on each result card (web table view). */
  view: ViewKey;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_SCREENER_STATE: ScreenerFilterState = {
  q: "",
  index: "",
  sector: "",
  presets: [],
  cross: "",
  rec: "",
  ranges: {},
  view: "overview",
  sort: "market_cap",
  dir: "desc",
};

export function presetsConflict(a: PresetDef | undefined, b: PresetDef): boolean {
  if (!a || a.id === b.id) return false;
  if (a.cross && b.cross) return true;
  if (a.rec && b.rec) return true;
  return Object.keys(a.ranges ?? {}).some((key) => key in (b.ranges ?? {}));
}

export function toggleScreenerPreset(state: ScreenerFilterState, presetId: PresetId): ScreenerFilterState {
  const preset = PRESET_BY_ID.get(presetId);
  if (!preset) return state;
  if (state.presets.includes(presetId)) {
    return { ...state, presets: state.presets.filter((id) => id !== presetId) };
  }
  const nextPresets = [
    ...state.presets.filter((id) => !presetsConflict(PRESET_BY_ID.get(id), preset)),
    presetId,
  ];
  return {
    ...state,
    presets: nextPresets,
    view: PRESET_VIEWS[presetId] ?? state.view,
    sort: preset.sort?.[0] ?? state.sort,
    dir: preset.sort?.[1] ?? state.dir,
  };
}

export function clearScreenerFilters(state: ScreenerFilterState): ScreenerFilterState {
  return {
    ...DEFAULT_SCREENER_STATE,
    view: state.view,
    sort: state.sort,
    dir: state.dir,
  };
}

export function countActiveFilters(state: ScreenerFilterState): number {
  let count = state.presets.length;
  if (state.q.trim()) count += 1;
  if (state.index) count += 1;
  if (state.sector) count += 1;
  if (state.cross) count += 1;
  if (state.rec) count += 1;
  for (const bounds of Object.values(state.ranges)) {
    if (bounds && (bounds.min !== undefined || bounds.max !== undefined)) count += 1;
  }
  return count;
}

/** Lenient decimal parser accepting Turkish comma, dot, percent sign, and Unicode minus. */
export function parseDecimalInput(raw: string): number | undefined {
  let text = raw.trim().replace(/\s+/g, "").replace(/%/g, "").replace(/\u2212/g, "-");
  if (!text) return undefined;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function foldText(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

// ---------------------------------------------------------------------------
// Sector medians (matching backend MIN_COMPANIES = 3)
// ---------------------------------------------------------------------------

export const MIN_SECTOR_COMPANIES = 3;
type MedianRule = "all" | "positive" | "nonNegative";

const MEDIAN_RULES: Partial<Record<NumericField, MedianRule>> = {
  pe: "positive",
  pb: "positive",
  ev_ebitda: "positive",
  dividend_yield: "positive",
  roe: "all",
  net_margin: "all",
  foreign_ratio: "nonNegative",
};

function countsToward(rule: MedianRule, value: number): boolean {
  if (rule === "positive") return value > 0;
  if (rule === "nonNegative") return value >= 0;
  return true;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeSectorMedians(rows: readonly ScreenerStockRow[]): Map<string, Partial<Record<NumericField, number>>> {
  const bySector = new Map<string, ScreenerStockRow[]>();
  for (const row of rows) {
    if (!row.kap_sector) continue;
    const list = bySector.get(row.kap_sector);
    if (list) list.push(row);
    else bySector.set(row.kap_sector, [row]);
  }
  const result = new Map<string, Partial<Record<NumericField, number>>>();
  const entries = Object.entries(MEDIAN_RULES) as Array<[NumericField, MedianRule]>;
  for (const [sector, list] of bySector) {
    const medians: Partial<Record<NumericField, number>> = {};
    for (const [field, rule] of entries) {
      const vals: number[] = [];
      for (const row of list) {
        const v = row[field];
        if (v !== undefined && Number.isFinite(v) && countsToward(rule, v)) vals.push(v);
      }
      if (vals.length >= MIN_SECTOR_COMPANIES) {
        const m = median(vals);
        if (m !== null) medians[field] = m;
      }
    }
    result.set(sector, medians);
  }
  return result;
}

export function filterScreenerRows(
  rows: readonly ScreenerStockRow[],
  state: ScreenerFilterState,
): ScreenerStockRow[] {
  const query = foldText(state.q.trim());
  const activePresets = state.presets
    .map((id) => PRESET_BY_ID.get(id))
    .filter((p): p is PresetDef => Boolean(p));

  const rangeSets = [state.ranges, ...activePresets.map((p) => p.ranges ?? {})];
  const ranges = rangeSets.flatMap((set) =>
    RANGE_FILTERS.flatMap((def) => {
      const bounds = set[def.key];
      if (!bounds || (bounds.min === undefined && bounds.max === undefined)) return [];
      return [{ field: def.field, min: bounds.min, max: bounds.max, scale: def.scale }];
    }),
  );

  const crosses = [state.cross, ...activePresets.map((p) => p.cross ?? "")].filter(Boolean);
  const recs = [state.rec, ...activePresets.map((p) => p.rec ?? "")].filter(Boolean);
  const profitable = activePresets.some((p) => p.profitable);
  const relatives = activePresets.flatMap((p) => (p.relative ? [p.relative] : []));
  const sectorMedians = relatives.length > 0 ? computeSectorMedians(rows) : null;

  const foldedSector = state.sector ? foldText(state.sector) : "";
  const upperIndex = state.index ? state.index.trim().toUpperCase() : "";

  return rows.filter((row) => {
    if (upperIndex && !row.indices?.includes(upperIndex)) return false;
    if (foldedSector) {
      const matchesKap = row.kap_sector ? foldText(row.kap_sector) === foldedSector : false;
      const matchesTv = row.sector ? foldText(row.sector) === foldedSector : false;
      if (!matchesKap && !matchesTv) return false;
    }
    if (crosses.some((cross) => row.cross !== cross)) return false;
    if (recs.some((rec) => row.recommendation !== rec)) return false;
    if (profitable && !(row.pe !== undefined && row.pe > 0)) return false;

    for (const range of ranges) {
      const value = row[range.field];
      if (value === undefined || !Number.isFinite(value)) return false;
      if (range.min !== undefined && value < range.min * range.scale) return false;
      if (range.max !== undefined && value > range.max * range.scale) return false;
    }

    if (sectorMedians && relatives.length > 0) {
      for (const rel of relatives) {
        const def = RANGE_BY_KEY.get(rel.key);
        if (!def || !row.kap_sector) return false;
        const val = row[def.field];
        const med = sectorMedians.get(row.kap_sector)?.[def.field];
        if (val === undefined || !Number.isFinite(val) || med === undefined) return false;
        const rule = MEDIAN_RULES[def.field] ?? "all";
        if (!countsToward(rule, val)) return false;
        if (rel.op === "below" ? !(val < med) : !(val > med)) return false;
      }
    }

    if (query) {
      const symHit = foldText(row.symbol).includes(query);
      const nameHit = row.name ? foldText(row.name).includes(query) : false;
      if (!symHit && !nameHit) return false;
    }
    return true;
  });
}

export function sortScreenerRows(
  rows: readonly ScreenerStockRow[],
  sortKey: SortKey,
  dir: SortDir,
): ScreenerStockRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = sortKey === "symbol" ? a.symbol : a[sortKey];
    const bv = sortKey === "symbol" ? b.symbol : b[sortKey];
    const aMissing = av === undefined || (typeof av === "number" && !Number.isFinite(av));
    const bMissing = bv === undefined || (typeof bv === "number" && !Number.isFinite(bv));
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing && !bMissing && av !== bv) {
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv), "tr")
          : (av as number) - (bv as number);
      if (cmp !== 0) return cmp * sign;
    }
    const capDiff = (b.market_cap ?? -1) - (a.market_cap ?? -1);
    if (capDiff !== 0) return capDiff;
    return a.symbol.localeCompare(b.symbol, "tr");
  });
}

export function computeBreadth(rows: readonly ScreenerStockRow[]): { up: number; down: number; flat: number } {
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const row of rows) {
    const ch = row.change_pct;
    if (ch === undefined || !Number.isFinite(ch)) continue;
    if (Math.abs(ch) < FLAT_EPSILON) flat += 1;
    else if (ch > 0) up += 1;
    else down += 1;
  }
  return { up, down, flat };
}
