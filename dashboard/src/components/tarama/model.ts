/**
 * Stock screener model — pure functions, no React.
 *
 * The page downloads the whole universe once (GET /market/screener/universe,
 * ~630 rows) and every filter, sort and page is computed here in the browser,
 * so the value shown in a column is always the value that was filtered on.
 * The complete state lives in the URL (shareable, back/forward friendly).
 */
import type { ScreenerUniverseRow } from "@/types";

export type Row = ScreenerUniverseRow;

// ---------------------------------------------------------------------------
// Fields and range filters
// ---------------------------------------------------------------------------

export type NumericField =
  | "close" | "change_pct" | "turnover" | "avg_turnover" | "market_cap"
  | "pe" | "pb" | "ev_ebitda" | "dividend_yield" | "roe" | "net_margin"
  | "rsi" | "sma50_dist" | "sma200_dist" | "tech_rating" | "rel_volume" | "high_52w_dist" | "low_52w_dist"
  | "perf_1w" | "perf_1m" | "perf_3m" | "perf_ytd" | "perf_1y"
  | "target_price" | "upside" | "foreign_ratio";

export type FilterGroup = "valuation" | "profitability" | "scale" | "technical" | "performance" | "analyst";
export const FILTER_GROUPS: readonly FilterGroup[] = ["valuation", "profitability", "scale", "technical", "performance", "analyst"];

/** How a bound is typed and shown: multiple (F/K 8,5), percent, ₺ billions/millions, times (2x), index (RSI). */
export type RangeUnit = "multiple" | "pct" | "bn" | "mn" | "x" | "index";

export interface RangeFilterDef {
  /** URL parameter stem: `${key}_min` / `${key}_max`. */
  key: string;
  field: NumericField;
  group: FilterGroup;
  unit: RangeUnit;
  /** Row value = typed value × scale (market cap is typed in ₺ billions). */
  scale: number;
}

export const RANGE_FILTERS = [
  { key: "pe", field: "pe", group: "valuation", unit: "multiple", scale: 1 },
  { key: "pb", field: "pb", group: "valuation", unit: "multiple", scale: 1 },
  { key: "evebitda", field: "ev_ebitda", group: "valuation", unit: "multiple", scale: 1 },
  { key: "dy", field: "dividend_yield", group: "valuation", unit: "pct", scale: 1 },
  { key: "roe", field: "roe", group: "profitability", unit: "pct", scale: 1 },
  { key: "nm", field: "net_margin", group: "profitability", unit: "pct", scale: 1 },
  { key: "mcap", field: "market_cap", group: "scale", unit: "bn", scale: 1e9 },
  { key: "vol", field: "avg_turnover", group: "scale", unit: "mn", scale: 1e6 },
  { key: "rsi", field: "rsi", group: "technical", unit: "index", scale: 1 },
  { key: "sma50", field: "sma50_dist", group: "technical", unit: "pct", scale: 1 },
  { key: "sma200", field: "sma200_dist", group: "technical", unit: "pct", scale: 1 },
  { key: "hi52", field: "high_52w_dist", group: "technical", unit: "pct", scale: 1 },
  { key: "lo52", field: "low_52w_dist", group: "technical", unit: "pct", scale: 1 },
  { key: "rvol", field: "rel_volume", group: "technical", unit: "x", scale: 1 },
  { key: "chg", field: "change_pct", group: "performance", unit: "pct", scale: 1 },
  { key: "p1w", field: "perf_1w", group: "performance", unit: "pct", scale: 1 },
  { key: "p1m", field: "perf_1m", group: "performance", unit: "pct", scale: 1 },
  { key: "p3m", field: "perf_3m", group: "performance", unit: "pct", scale: 1 },
  { key: "pytd", field: "perf_ytd", group: "performance", unit: "pct", scale: 1 },
  { key: "p1y", field: "perf_1y", group: "performance", unit: "pct", scale: 1 },
  { key: "upside", field: "upside", group: "analyst", unit: "pct", scale: 1 },
  { key: "foreign", field: "foreign_ratio", group: "analyst", unit: "pct", scale: 1 },
] as const satisfies readonly RangeFilterDef[];

export type RangeKey = (typeof RANGE_FILTERS)[number]["key"];
export const RANGE_BY_KEY: ReadonlyMap<RangeKey, RangeFilterDef> = new Map(RANGE_FILTERS.map((def) => [def.key, def]));

export interface Bounds {
  min?: number;
  max?: number;
}
export type Ranges = Partial<Record<RangeKey, Bounds>>;

export type CrossFilter = "" | "golden" | "death";
export type RecFilter = "" | "AL" | "TUT" | "SAT";
export const CROSS_VALUES: readonly Exclude<CrossFilter, "">[] = ["golden", "death"];
export const REC_VALUES: readonly Exclude<RecFilter, "">[] = ["AL", "TUT", "SAT"];

// ---------------------------------------------------------------------------
// Views, columns, sorting
// ---------------------------------------------------------------------------

export type ViewKey = "overview" | "fundamentals" | "technical" | "performance" | "analyst";
export const VIEWS: readonly ViewKey[] = ["overview", "fundamentals", "technical", "performance", "analyst"];

export type ColumnKey = NumericField | "symbol" | "sector" | "recommendation" | "signals";
export type SortKey = Exclude<ColumnKey, "signals">;
export type SortDir = "asc" | "desc";

/** Columns after the always-visible stock column. */
export const VIEW_COLUMNS: Record<ViewKey, readonly ColumnKey[]> = {
  overview: ["sector", "close", "change_pct", "turnover", "market_cap", "pe", "pb", "dividend_yield"],
  fundamentals: ["close", "change_pct", "market_cap", "pe", "pb", "ev_ebitda", "dividend_yield", "roe", "net_margin"],
  technical: ["close", "change_pct", "rsi", "sma50_dist", "sma200_dist", "high_52w_dist", "low_52w_dist", "rel_volume", "tech_rating", "signals"],
  performance: ["close", "change_pct", "perf_1w", "perf_1m", "perf_3m", "perf_ytd", "perf_1y", "avg_turnover"],
  analyst: ["close", "change_pct", "recommendation", "target_price", "upside", "foreign_ratio", "market_cap"],
};

const SORT_KEYS: ReadonlySet<string> = new Set<SortKey>([
  "symbol", "sector", "recommendation",
  "close", "change_pct", "turnover", "avg_turnover", "market_cap", "pe", "pb", "ev_ebitda", "dividend_yield", "roe",
  "net_margin", "rsi", "sma50_dist", "sma200_dist", "tech_rating", "rel_volume", "high_52w_dist", "low_52w_dist",
  "perf_1w", "perf_1m", "perf_3m", "perf_ytd", "perf_1y", "target_price", "upside", "foreign_ratio",
]);

/** First click on a header: names/cheapness ascending, everything else largest first. */
const ASCENDING_FIRST: ReadonlySet<SortKey> = new Set<SortKey>(["symbol", "sector", "pe", "pb", "ev_ebitda", "low_52w_dist"]);

export function defaultDir(key: SortKey): SortDir {
  return ASCENDING_FIRST.has(key) ? "asc" : "desc";
}

export function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.has(value);
}

// ---------------------------------------------------------------------------
// State (mirrors the URL)
// ---------------------------------------------------------------------------

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface ScreenerState {
  q: string;
  /** Index code ("" = every stock). */
  index: string;
  /** TradingView sector key ("" = every sector). */
  sector: string;
  /** Quick screens (TARAMALAR), kept apart from the typed criteria so each panel clears only itself. */
  presets: PresetId[];
  /** Typed criteria (KRİTERLER). */
  cross: CrossFilter;
  rec: RecFilter;
  ranges: Ranges;
  view: ViewKey;
  sort: SortKey;
  dir: SortDir;
  /** 1-based. */
  page: number;
  size: PageSize;
}

export const DEFAULT_STATE: ScreenerState = {
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
  page: 1,
  size: 50,
};

export const MAX_QUERY_LENGTH = 40;
const INDEX_CODE_RE = /^[A-Z0-9]{3,8}$/;
const MAX_SECTOR_LENGTH = 60;

/**
 * Lenient decimal parser for typed bounds: accepts "1,5", "1.5", "-3", "%4",
 * "1.234,5" / "1,234.5" (thousands separators) and the Unicode minus sign.
 */
export function parseDecimal(raw: string): number | null {
  let text = raw.trim().replace(/\s+/g, "").replace(/%/g, "").replace(/\u2212/g, "-");
  if (!text) return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // The separator that comes last is the decimal one.
    text = comma > dot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (comma >= 0) {
    text = text.replace(",", ".");
  }
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function readBound(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = parseDecimal(raw);
  return value === null ? undefined : value;
}

function cleanBounds(bounds: Bounds): Bounds | undefined {
  const out: Bounds = {};
  if (bounds.min !== undefined && Number.isFinite(bounds.min)) out.min = bounds.min;
  if (bounds.max !== undefined && Number.isFinite(bounds.max)) out.max = bounds.max;
  return out.min === undefined && out.max === undefined ? undefined : out;
}

function setRange(ranges: Ranges, key: RangeKey, bounds: Bounds | undefined): Ranges {
  const next: Ranges = { ...ranges };
  const clean = bounds ? cleanBounds(bounds) : undefined;
  if (clean) next[key] = clean;
  else delete next[key];
  return next;
}

// Old /tarama links (İş Yatırım templates, the separate signal scanner and
// million-TL market-cap bounds) keep working: they are translated once and the
// URL is rewritten in the new format.
type LegacyPatch = Partial<Pick<ScreenerState, "cross" | "rec">> & { ranges?: Ranges };

const LEGACY_TEMPLATES: Record<string, LegacyPatch> = {
  small_cap: { ranges: { mcap: { max: 20 } } },
  mid_cap: { ranges: { mcap: { min: 20, max: 100 } } },
  large_cap: { ranges: { mcap: { min: 100 } } },
  high_dividend: { ranges: { dy: { min: 4 } } },
  high_upside: { ranges: { upside: { min: 25 } } },
  low_upside: { ranges: { upside: { max: 0 } } },
  high_volume: { ranges: { vol: { min: 100 } } },
  low_volume: { ranges: { vol: { max: 5 } } },
  buy_recommendation: { rec: "AL" },
  sell_recommendation: { rec: "SAT" },
  high_net_margin: { ranges: { nm: { min: 20 } } },
  high_return: { ranges: { p1w: { min: 0 } } },
  low_pe: { ranges: { pe: { max: 10 } } },
  high_roe: { ranges: { roe: { min: 25 } } },
  high_foreign_ownership: { ranges: { foreign: { min: 30 } } },
};

const LEGACY_CONDITIONS: Record<string, LegacyPatch> = {
  rsi_oversold: { ranges: { rsi: { max: 30 } } },
  rsi_overbought: { ranges: { rsi: { min: 70 } } },
  golden_cross: { cross: "golden" },
  death_cross: { cross: "death" },
};

/** Legacy bound parameters → [new range key, factor]. `market_cap` was in million TL. */
const LEGACY_RANGES: Record<string, [RangeKey, number]> = {
  market_cap: ["mcap", 1e-3],
  dividend_yield: ["dy", 1],
  upside_potential: ["upside", 1],
  net_margin: ["nm", 1],
};

const LEGACY_PARAMS = ["template", "condition", ...Object.keys(LEGACY_RANGES).flatMap((k) => [`${k}_min`, `${k}_max`])];

/** True when the URL still uses the pre-2026-09 parameter names. */
export function hasLegacyParams(params: URLSearchParams): boolean {
  return LEGACY_PARAMS.some((name) => params.has(name)) || params.get("sort") === "volume";
}

/** Own-property lookup, so "constructor"/"__proto__" in a URL never resolve to Object.prototype. */
function ownEntry<T>(record: Record<string, T>, key: string | null): T | undefined {
  return key !== null && Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function applyPatch(state: ScreenerState, patch: LegacyPatch | undefined): ScreenerState {
  if (!patch) return state;
  let ranges = state.ranges;
  for (const [key, bounds] of Object.entries(patch.ranges ?? {}) as [RangeKey, Bounds][]) {
    ranges = setRange(ranges, key, bounds);
  }
  return { ...state, ranges, cross: patch.cross ?? state.cross, rec: patch.rec ?? state.rec };
}

export function parseState(params: URLSearchParams): ScreenerState {
  const state: ScreenerState = { ...DEFAULT_STATE, presets: [], ranges: {} };

  state.q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const index = (params.get("idx") ?? "").trim().toUpperCase();
  state.index = INDEX_CODE_RE.test(index) ? index : "";
  state.sector = (params.get("sector") ?? "").trim().slice(0, MAX_SECTOR_LENGTH);

  // Unknown ids are dropped; of two screens on the same field the first listed stays.
  for (const id of (params.get("screen") ?? "").split(",")) {
    const preset = PRESET_BY_ID.get(id.trim() as PresetId);
    if (preset && !state.presets.some((other) => other === preset.id || presetsConflict(PRESET_BY_ID.get(other), preset))) {
      state.presets.push(preset.id);
    }
  }
  state.presets = sortPresets(state.presets);

  const cross = params.get("cross");
  state.cross = cross === "golden" || cross === "death" ? cross : "";
  const rec = (params.get("rec") ?? "").toUpperCase();
  state.rec = rec === "AL" || rec === "TUT" || rec === "SAT" ? rec : "";

  for (const def of RANGE_FILTERS) {
    const bounds = cleanBounds({ min: readBound(params, `${def.key}_min`), max: readBound(params, `${def.key}_max`) });
    if (bounds) state.ranges[def.key] = bounds;
  }

  // Legacy links.
  for (const [legacy, [key, factor]] of Object.entries(LEGACY_RANGES)) {
    const min = readBound(params, `${legacy}_min`);
    const max = readBound(params, `${legacy}_max`);
    if (min !== undefined || max !== undefined) {
      state.ranges = setRange(state.ranges, key, {
        min: min === undefined ? undefined : min * factor,
        max: max === undefined ? undefined : max * factor,
      });
    }
  }
  Object.assign(state, applyPatch(state, ownEntry(LEGACY_TEMPLATES, params.get("template"))));
  Object.assign(state, applyPatch(state, ownEntry(LEGACY_CONDITIONS, params.get("condition"))));

  const view = params.get("view");
  state.view = VIEWS.includes(view as ViewKey) ? (view as ViewKey) : DEFAULT_STATE.view;

  const rawSort = params.get("sort") === "volume" ? "turnover" : (params.get("sort") ?? "");
  state.sort = isSortKey(rawSort) ? rawSort : DEFAULT_STATE.sort;
  const dir = params.get("dir");
  state.dir = dir === "asc" || dir === "desc" ? dir : isSortKey(rawSort) ? defaultDir(state.sort) : DEFAULT_STATE.dir;

  const page = Number(params.get("page"));
  state.page = Number.isInteger(page) && page >= 1 ? page : 1;
  const size = Number(params.get("size"));
  state.size = (PAGE_SIZES as readonly number[]).includes(size) ? (size as PageSize) : DEFAULT_STATE.size;

  return state;
}

function formatParamNumber(value: number): string {
  // Plain decimal notation (no exponent); trims float noise such as 0.30000000000000004.
  return String(Number(value.toPrecision(12)));
}

/** Canonical query string (only non-default values, fixed order). */
export function serializeState(state: ScreenerState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim().slice(0, MAX_QUERY_LENGTH));
  if (state.index) params.set("idx", state.index);
  if (state.sector) params.set("sector", state.sector);
  if (state.presets.length > 0) params.set("screen", sortPresets(state.presets).join(","));
  for (const def of RANGE_FILTERS) {
    const bounds = state.ranges[def.key];
    if (bounds?.min !== undefined) params.set(`${def.key}_min`, formatParamNumber(bounds.min));
    if (bounds?.max !== undefined) params.set(`${def.key}_max`, formatParamNumber(bounds.max));
  }
  if (state.cross) params.set("cross", state.cross);
  if (state.rec) params.set("rec", state.rec);
  if (state.view !== DEFAULT_STATE.view) params.set("view", state.view);
  if (state.sort !== DEFAULT_STATE.sort || state.dir !== DEFAULT_STATE.dir) {
    params.set("sort", state.sort);
    params.set("dir", state.dir);
  }
  if (state.page > 1) params.set("page", String(state.page));
  if (state.size !== DEFAULT_STATE.size) params.set("size", String(state.size));
  return params.toString();
}

// ---------------------------------------------------------------------------
// Filters (active chips, clearing)
// ---------------------------------------------------------------------------

export type ActiveFilter =
  | { kind: "q"; value: string }
  | { kind: "index"; value: string }
  | { kind: "sector"; value: string }
  | { kind: "preset"; id: PresetId }
  | { kind: "cross"; value: Exclude<CrossFilter, ""> }
  | { kind: "rec"; value: Exclude<RecFilter, ""> }
  | { kind: "range"; key: RangeKey; bounds: Bounds };

export function activeFilters(state: ScreenerState): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (state.q.trim()) out.push({ kind: "q", value: state.q.trim() });
  if (state.index) out.push({ kind: "index", value: state.index });
  if (state.sector) out.push({ kind: "sector", value: state.sector });
  for (const id of state.presets) out.push({ kind: "preset", id });
  for (const def of RANGE_FILTERS) {
    const bounds = state.ranges[def.key];
    if (bounds) out.push({ kind: "range", key: def.key, bounds });
  }
  if (state.cross) out.push({ kind: "cross", value: state.cross });
  if (state.rec) out.push({ kind: "rec", value: state.rec });
  return out;
}

/** Filter changes always return to the first page. */
export function withFilters(state: ScreenerState, patch: Partial<ScreenerState>): ScreenerState {
  return { ...state, ...patch, page: 1 };
}

export function updateRange(state: ScreenerState, key: RangeKey, bounds: Bounds | undefined): ScreenerState {
  return withFilters(state, { ranges: setRange(state.ranges, key, bounds) });
}

/** Removes every filter; the view, sort order and page size stay. */
export function clearFilters(state: ScreenerState): ScreenerState {
  return withFilters(state, { q: "", index: "", sector: "", presets: [], cross: "", rec: "", ranges: {} });
}

export function hasFilters(state: ScreenerState): boolean {
  return activeFilters(state).length > 0;
}

// ---------------------------------------------------------------------------
// Quick screens
// ---------------------------------------------------------------------------

export type PresetId =
  | "low_pe" | "low_pb" | "low_ev_ebitda" | "high_dividend"
  | "profitable" | "high_roe" | "high_net_margin"
  | "large_cap" | "mid_cap" | "small_cap" | "liquid"
  | "uptrend" | "golden_cross" | "death_cross" | "near_high" | "near_low" | "rsi_oversold" | "rsi_overbought" | "volume_spike"
  | "day_gainers" | "day_losers" | "week_gainers"
  | "buy_rec" | "sell_rec" | "high_upside" | "high_foreign";

export interface PresetDef {
  id: PresetId;
  group: FilterGroup;
  ranges?: Ranges;
  cross?: Exclude<CrossFilter, "">;
  rec?: Exclude<RecFilter, "">;
  /** Net profit over the last 12 months — the stocks whose P/E is defined. */
  profitable?: true;
  /** Column view and order that make the result readable right away. */
  view?: ViewKey;
  sort?: readonly [SortKey, SortDir];
}

// Thresholds shared with the signal badges in the technical view.
export const RSI_OVERSOLD = 30;
export const RSI_OVERBOUGHT = 70;
export const NEAR_52W_PCT = 5;
export const VOLUME_SPIKE = 2;

/**
 * Menu order. Screens on the same field replace each other (see presetsConflict),
 * so such alternatives sit next to each other in one group, and two sets of
 * alternatives in a group are kept apart by a screen that combines with both.
 */
export const PRESETS: readonly PresetDef[] = [
  { id: "low_pe", group: "valuation", ranges: { pe: { max: 10 } }, view: "fundamentals", sort: ["pe", "asc"] },
  { id: "low_pb", group: "valuation", ranges: { pb: { max: 1 } }, view: "fundamentals", sort: ["pb", "asc"] },
  { id: "low_ev_ebitda", group: "valuation", ranges: { evebitda: { max: 6 } }, view: "fundamentals", sort: ["ev_ebitda", "asc"] },
  { id: "high_dividend", group: "valuation", ranges: { dy: { min: 4 } }, view: "fundamentals", sort: ["dividend_yield", "desc"] },
  { id: "profitable", group: "profitability", profitable: true, view: "fundamentals" },
  { id: "high_roe", group: "profitability", ranges: { roe: { min: 25 } }, view: "fundamentals", sort: ["roe", "desc"] },
  { id: "high_net_margin", group: "profitability", ranges: { nm: { min: 20 } }, view: "fundamentals", sort: ["net_margin", "desc"] },
  { id: "large_cap", group: "scale", ranges: { mcap: { min: 100 } }, sort: ["market_cap", "desc"] },
  { id: "mid_cap", group: "scale", ranges: { mcap: { min: 20, max: 100 } }, sort: ["market_cap", "desc"] },
  { id: "small_cap", group: "scale", ranges: { mcap: { max: 20 } }, sort: ["market_cap", "desc"] },
  { id: "liquid", group: "scale", ranges: { vol: { min: 100 } }, view: "performance", sort: ["avg_turnover", "desc"] },
  { id: "uptrend", group: "technical", ranges: { sma50: { min: 0 }, sma200: { min: 0 } }, view: "technical", sort: ["sma200_dist", "desc"] },
  { id: "golden_cross", group: "technical", cross: "golden", view: "technical" },
  { id: "death_cross", group: "technical", cross: "death", view: "technical" },
  { id: "near_high", group: "technical", ranges: { hi52: { min: -NEAR_52W_PCT } }, view: "technical", sort: ["high_52w_dist", "desc"] },
  { id: "near_low", group: "technical", ranges: { lo52: { max: NEAR_52W_PCT } }, view: "technical", sort: ["low_52w_dist", "asc"] },
  { id: "rsi_oversold", group: "technical", ranges: { rsi: { max: RSI_OVERSOLD } }, view: "technical", sort: ["rsi", "asc"] },
  { id: "rsi_overbought", group: "technical", ranges: { rsi: { min: RSI_OVERBOUGHT } }, view: "technical", sort: ["rsi", "desc"] },
  { id: "volume_spike", group: "technical", ranges: { rvol: { min: VOLUME_SPIKE } }, view: "technical", sort: ["rel_volume", "desc"] },
  { id: "day_gainers", group: "performance", ranges: { chg: { min: 5 } }, view: "performance", sort: ["change_pct", "desc"] },
  { id: "day_losers", group: "performance", ranges: { chg: { max: -5 } }, view: "performance", sort: ["change_pct", "asc"] },
  { id: "week_gainers", group: "performance", ranges: { p1w: { min: 10 } }, view: "performance", sort: ["perf_1w", "desc"] },
  { id: "buy_rec", group: "analyst", rec: "AL", view: "analyst", sort: ["upside", "desc"] },
  { id: "sell_rec", group: "analyst", rec: "SAT", view: "analyst", sort: ["upside", "asc"] },
  { id: "high_upside", group: "analyst", ranges: { upside: { min: 25 } }, view: "analyst", sort: ["upside", "desc"] },
  { id: "high_foreign", group: "analyst", ranges: { foreign: { min: 30 } }, view: "analyst", sort: ["foreign_ratio", "desc"] },
];

const PRESET_BY_ID: ReadonlyMap<PresetId, PresetDef> = new Map(PRESETS.map((preset) => [preset.id, preset]));

/** Keeps the screens in PRESETS order, so the URL does not depend on the click order. */
function sortPresets(ids: readonly PresetId[]): PresetId[] {
  return PRESETS.filter((preset) => ids.includes(preset.id)).map((preset) => preset.id);
}

/** Two screens constraining the same field cannot be on together ("Büyük ölçek" vs "Küçük ölçek"). */
function presetsConflict(a: PresetDef | undefined, b: PresetDef): boolean {
  if (!a || a.id === b.id) return false;
  if (a.cross && b.cross) return true;
  if (a.rec && b.rec) return true;
  return Object.keys(a.ranges ?? {}).some((key) => key in (b.ranges ?? {}));
}

/** Screens that replace another one when picked — the menu draws them with a round mark. */
export const EXCLUSIVE_PRESETS: ReadonlySet<PresetId> = new Set(
  PRESETS.filter((preset) => PRESETS.some((other) => presetsConflict(other, preset))).map((preset) => preset.id),
);

export function isPresetActive(state: ScreenerState, preset: PresetDef): boolean {
  return state.presets.includes(preset.id);
}

/**
 * Toggling a quick screen adds it to the others (so screens combine, e.g.
 * "Düşük F/K" + "Yüksek temettü"); a screen touching the same field replaces
 * the other ("Büyük ölçek" → "Küçük ölçek"). Screens never write into the typed
 * criteria: both apply together, and each panel's Clear leaves the other alone.
 */
export function togglePreset(state: ScreenerState, preset: PresetDef): ScreenerState {
  if (isPresetActive(state, preset)) {
    return withFilters(state, { presets: state.presets.filter((id) => id !== preset.id) });
  }
  return withFilters(state, {
    presets: sortPresets([...state.presets.filter((id) => !presetsConflict(PRESET_BY_ID.get(id), preset)), preset.id]),
    view: preset.view ?? state.view,
    sort: preset.sort?.[0] ?? state.sort,
    dir: preset.sort?.[1] ?? state.dir,
  });
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

/** Case- and accent-insensitive Turkish folding: "Şişecam" → "sisecam", "İŞ" → "is". */
export function foldText(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

export function matchesQuery(row: Row, foldedQuery: string): boolean {
  if (!foldedQuery) return true;
  return foldText(row.symbol).includes(foldedQuery) || (row.name ? foldText(row.name).includes(foldedQuery) : false);
}

export function filterRows(rows: readonly Row[], state: ScreenerState): Row[] {
  const query = foldText(state.q.trim());
  // Quick screens and typed criteria both apply: on the same field the tighter bound wins.
  const presets = state.presets.flatMap((id) => PRESET_BY_ID.get(id) ?? []);
  const rangeSets = [state.ranges, ...presets.map((preset) => preset.ranges ?? {})];
  const ranges = rangeSets.flatMap((set) =>
    RANGE_FILTERS.flatMap((def) => {
      const bounds = set[def.key];
      return bounds ? [{ field: def.field, min: bounds.min, max: bounds.max, scale: def.scale }] : [];
    }),
  );
  const crosses = [state.cross, ...presets.map((preset) => preset.cross ?? "")].filter(Boolean);
  const recs = [state.rec, ...presets.map((preset) => preset.rec ?? "")].filter(Boolean);
  const profitable = presets.some((preset) => preset.profitable);
  return rows.filter((row) => {
    if (state.index && !row.indices?.includes(state.index)) return false;
    if (state.sector && row.sector !== state.sector) return false;
    if (crosses.some((cross) => row.cross !== cross)) return false;
    if (recs.some((rec) => row.recommendation !== rec)) return false;
    // A P/E exists only for a trailing net profit; no P/E and no loss flag means no data, not a profit.
    if (profitable && !(row.pe !== undefined && row.pe > 0)) return false;
    for (const range of ranges) {
      const value = row[range.field];
      // A stock without the value cannot satisfy a bound (e.g. no P/E for loss makers).
      if (value === undefined || !Number.isFinite(value)) return false;
      if (range.min !== undefined && value < range.min * range.scale) return false;
      if (range.max !== undefined && value > range.max * range.scale) return false;
    }
    return matchesQuery(row, query);
  });
}

const REC_RANK: Record<string, number> = { AL: 3, TUT: 2, SAT: 1 };

export function sortValue(row: Row, key: SortKey, sectorName: (key: string) => string): number | string | undefined {
  switch (key) {
    case "symbol":
      return row.symbol;
    case "sector":
      return row.sector ? sectorName(row.sector) : undefined;
    case "recommendation":
      return row.recommendation ? REC_RANK[row.recommendation] : undefined;
    default:
      return row[key];
  }
}

/** Stable sort; rows without the value always go last, ties fall back to market cap and ticker. */
export function sortRows(rows: readonly Row[], key: SortKey, dir: SortDir, sectorName: (key: string) => string = (k) => k): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  const decorated = rows.map((row) => ({ row, value: sortValue(row, key, sectorName) }));
  decorated.sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    const aMissing = av === undefined || (typeof av === "number" && !Number.isFinite(av));
    const bMissing = bv === undefined || (typeof bv === "number" && !Number.isFinite(bv));
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (!aMissing && !bMissing && av !== bv) {
      const cmp = typeof av === "string" || typeof bv === "string"
        ? String(av).localeCompare(String(bv), "tr")
        : (av as number) - (bv as number);
      if (cmp !== 0) return cmp * sign;
    }
    const capDiff = (b.row.market_cap ?? -1) - (a.row.market_cap ?? -1);
    if (capDiff !== 0) return capDiff;
    return a.row.symbol.localeCompare(b.row.symbol, "tr");
  });
  return decorated.map((item) => item.row);
}

export interface PageSlice<T> {
  rows: T[];
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
}

/** Clamps a page that outlived its result set (filters changed, old link). */
export function paginate<T>(rows: readonly T[], page: number, size: number): PageSlice<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return { rows: slice, page: current, pageCount, from: total === 0 ? 0 : start + 1, to: start + slice.length, total };
}

/** Page numbers with gaps: [1, "gap", 5, 6, 7, "gap", 13]; a gap never hides a single page. */
export function pageList(current: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    if (i > 0 && p - previous === 2) out.push(previous + 1);
    else if (i > 0 && p - previous > 2) out.push("gap");
    out.push(p);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Derived display data
// ---------------------------------------------------------------------------

/** Moves smaller than this (percent) round to 0,00 and count as unchanged. */
const FLAT_EPSILON = 0.005;

export function breadth(rows: readonly Row[]): { up: number; down: number; flat: number } {
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const row of rows) {
    const change = row.change_pct;
    if (change === undefined || !Number.isFinite(change)) continue;
    if (Math.abs(change) < FLAT_EPSILON) flat += 1;
    else if (change > 0) up += 1;
    else down += 1;
  }
  return { up, down, flat };
}

export type TechRating = "strongBuy" | "buy" | "neutral" | "sell" | "strongSell";

/** TradingView's own buckets for Recommend.All. */
export function techRating(value: number | undefined): TechRating | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  if (value > 0.5) return "strongBuy";
  if (value > 0.1) return "buy";
  if (value >= -0.1) return "neutral";
  if (value >= -0.5) return "sell";
  return "strongSell";
}

export type RowSignal = "oversold" | "overbought" | "golden" | "death" | "nearHigh" | "nearLow" | "volumeSpike";

/** Badges for the technical view — same thresholds as the quick screens. */
export function rowSignals(row: Row): RowSignal[] {
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

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export interface CsvColumn {
  header: string;
  value: (row: Row) => string | number | undefined;
}

/**
 * Spreadsheet-friendly CSV: Turkish/French Excel expects ";" between fields and
 * "," as the decimal mark, English Excel "," and ".". Starts with a UTF-8 BOM so
 * Excel reads Turkish characters correctly.
 */
export function toCsv(rows: readonly Row[], columns: readonly CsvColumn[], decimalComma: boolean): string {
  const separator = decimalComma ? ";" : ",";
  const cell = (value: string | number | undefined): string => {
    if (value === undefined) return "";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      const text = String(Number(value.toPrecision(12)));
      return decimalComma ? text.replace(".", ",") : text;
    }
    // Text starting with = + - @ would run as a formula in Excel (CSV injection).
    const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /["\n\r;,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((c) => cell(c.header)).join(separator)];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(separator));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
