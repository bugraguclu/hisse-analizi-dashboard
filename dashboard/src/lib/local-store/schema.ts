/**
 * Versioned schema, validators and lossless localStorage migration for personal
 * workspace data (watchlists, card layouts, chart preferences, drawings,
 * average costs and UI preferences).
 *
 * Pure module with no React / Next imports so Node `--test` runs directly on it.
 */

import type { ChartPrefs } from "../../components/charts/prefs.ts";
import type { Drawing, DrawingKind, DrawingPoint } from "../../components/charts/drawings/types.ts";
import type { ChartType, ChartUnit, IndicatorConfig, IndicatorKind, PriceScaleKind } from "../../components/charts/types.ts";
import type { Locale } from "../i18n.ts";
import type { StorageAdapter } from "./storage.ts";

export const WORKSPACE_BACKUP_FORMAT = "hisse-analizi-workspace" as const;
export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024; // 5 MB safety bound

export const LOCAL_STORE_META_KEY = "hisse.localStore.meta.v1";

export const WATCHLISTS_STORAGE_KEY = "watchlists";
export const HOME_LAYOUT_STORAGE_KEY = "hisse.dashboard.layout";
export const LAYOUT_STORAGE_PREFIX = "hisse.layout.";
export const DRAWINGS_STORAGE_PREFIX = "hisse.chart.drawings.v1:";
export const COST_STORAGE_PREFIX = "hisse.chart.cost.";
export const CALENDAR_COUNTRIES_STORAGE_KEY = "hisse.calendar.countries";
export const MARKET_STRIP_PAUSED_STORAGE_KEY = "hisse.marketStrip.paused";
export const LOCALE_STORAGE_KEY = "locale";
export const THEME_STORAGE_KEY = "theme";

export const CHART_PREF_KEYS = [
  "hisse.chart.index.v2",
  "hisse.chart.overview.v2",
  "hisse.chart.technical.v2",
] as const;

export type ChartPrefKey = (typeof CHART_PREF_KEYS)[number];
export type ThemePreference = "light" | "dark" | "system";

export interface WatchlistRecord {
  id: string;
  name: string;
  tickers: string[];
}

export interface StoredLayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredWorkspaceLayout {
  version: 1;
  items: StoredLayoutItem[];
}

export interface WorkspacePreferences {
  calendarCountries?: string[];
  marketStripPaused?: boolean;
  locale?: Locale;
  theme?: ThemePreference;
}

export interface WorkspaceData {
  watchlists: WatchlistRecord[];
  layouts: Record<string, StoredWorkspaceLayout>;
  chartPrefs: Record<string, Partial<ChartPrefs>>;
  drawings: Record<string, Drawing[]>;
  costs: Record<string, number>;
  preferences: WorkspacePreferences;
}

export interface WorkspaceSnapshot {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: typeof WORKSPACE_SCHEMA_VERSION;
  exportedAt: string;
  appVersion?: string;
  data: WorkspaceData;
}

export interface LocalStoreMeta {
  version: number;
  migratedAt: string;
  updatedAt: string;
}

const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const LAYOUT_KEY_RE = /^(?:hisse\.dashboard\.layout|hisse\.layout\.[a-z0-9][a-z0-9_-]{0,60})$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const MAX_WATCHLISTS = 12;
const MAX_WATCHLIST_TICKERS = 40;
const MAX_WATCHLIST_NAME = 40;
const MAX_LAYOUT_ITEMS = 40;
const MAX_GRID_COLUMNS = 6;
const MAX_GRID_ROWS = 1024;
const MAX_INDICATORS = 12;
const MAX_DRAWINGS_PER_SYMBOL = 200;
const MAX_DRAWING_SYMBOLS = 200;
const MAX_COST_SYMBOLS = 200;
const MAX_CALENDAR_COUNTRIES = 16;

const CHART_TYPES: ReadonlySet<ChartType> = new Set(["area", "line", "baseline", "candles", "hollow", "heikin", "bars"]);
const PRICE_SCALES: ReadonlySet<PriceScaleKind> = new Set(["normal", "log", "percent"]);
const CHART_UNITS: ReadonlySet<ChartUnit> = new Set(["TRY", "USD", "EUR", "GOLD", "REAL"]);
const INDICATOR_KINDS: ReadonlySet<IndicatorKind> = new Set([
  "sma",
  "ema",
  "bb",
  "vwap",
  "psar",
  "supertrend",
  "rsi",
  "macd",
  "stoch",
  "stochrsi",
  "cci",
  "willr",
  "atr",
  "adx",
  "obv",
  "mfi",
  "roc",
]);
const DRAWING_KINDS: ReadonlySet<DrawingKind> = new Set(["trend", "ray", "hline", "vline", "rect", "fib"]);
const LOCALES: ReadonlySet<Locale> = new Set(["tr", "en", "fr"]);
const THEMES: ReadonlySet<ThemePreference> = new Set(["light", "dark", "system"]);
const CHART_PREF_KEY_SET: ReadonlySet<string> = new Set(CHART_PREF_KEYS);

const LEGACY_OVERLAYS: Record<string, Omit<IndicatorConfig, "id">> = {
  ma20: { kind: "sma", params: { length: 20 }, color: 0 },
  ma50: { kind: "sma", params: { length: 50 }, color: 1 },
  ma200: { kind: "sma", params: { length: 200 }, color: 2 },
  bb: { kind: "bb", params: { length: 20, mult: 2 }, color: 3 },
};
const LEGACY_PANES: Record<string, Omit<IndicatorConfig, "id">> = {
  rsi: { kind: "rsi", params: { length: 14 }, color: 0 },
  macd: { kind: "macd", params: { fast: 12, slow: 26, signal: 9 }, color: 0 },
  stoch: { kind: "stoch", params: { k: 14, smoothK: 3, d: 3 }, color: 0 },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return TICKER_RE.test(normalized) ? normalized : null;
}

export function isAllowedLayoutKey(key: string): boolean {
  return LAYOUT_KEY_RE.test(key);
}

export function layoutPageLabel(storageKey: string): string {
  if (storageKey === HOME_LAYOUT_STORAGE_KEY) return "home";
  if (storageKey.startsWith(LAYOUT_STORAGE_PREFIX)) return storageKey.slice(LAYOUT_STORAGE_PREFIX.length);
  return storageKey;
}

export function sanitizeWatchlists(raw: unknown): { items: WatchlistRecord[]; dropped: number } | null {
  if (!Array.isArray(raw)) return null;
  const items: WatchlistRecord[] = [];
  const seenIds = new Set<string>();
  let dropped = 0;

  for (const entry of raw) {
    if (items.length >= MAX_WATCHLISTS) {
      dropped += 1;
      continue;
    }
    if (!isPlainRecord(entry)) {
      dropped += 1;
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim().slice(0, 64) : "";
    if (!id || seenIds.has(id)) {
      dropped += 1;
      continue;
    }
    const source = Array.isArray(entry.tickers)
      ? entry.tickers
      : Array.isArray(entry.items)
        ? entry.items
        : null;
    if (!source) {
      dropped += 1;
      continue;
    }
    const tickers: string[] = [];
    for (const item of source) {
      const candidate =
        typeof item === "string"
          ? item
          : isPlainRecord(item)
            ? item.ticker
            : null;
      const ticker = normalizeSymbol(candidate);
      if (!ticker) {
        dropped += 1;
        continue;
      }
      if (!tickers.includes(ticker)) {
        if (tickers.length < MAX_WATCHLIST_TICKERS) tickers.push(ticker);
        else dropped += 1;
      }
    }
    seenIds.add(id);
    const rawName = typeof entry.name === "string" ? entry.name.trim().slice(0, MAX_WATCHLIST_NAME) : "";
    const name = id === "favorites" && rawName === "Favoriler" ? "" : rawName;
    items.push({ id, name, tickers });
  }

  return { items, dropped };
}

export function sanitizeStoredLayout(raw: unknown): { layout: StoredWorkspaceLayout; dropped: number } | null {
  if (!isPlainRecord(raw) || raw.version !== 1 || !Array.isArray(raw.items)) return null;
  const items: StoredLayoutItem[] = [];
  const seenIds = new Set<string>();
  let dropped = 0;

  for (const entry of raw.items) {
    if (items.length >= MAX_LAYOUT_ITEMS) {
      dropped += 1;
      continue;
    }
    if (!isPlainRecord(entry)) {
      dropped += 1;
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const { x, y, w, h } = entry;
    const validId = id.length > 0 && id.length <= 64 && !seenIds.has(id);
    if (
      !validId ||
      typeof x !== "number" ||
      !Number.isInteger(x) ||
      x < 0 ||
      x >= MAX_GRID_COLUMNS ||
      typeof y !== "number" ||
      !Number.isInteger(y) ||
      y < 0 ||
      y >= MAX_GRID_ROWS ||
      typeof w !== "number" ||
      !Number.isInteger(w) ||
      w < 1 ||
      w > MAX_GRID_COLUMNS ||
      x + w > MAX_GRID_COLUMNS ||
      typeof h !== "number" ||
      !Number.isInteger(h) ||
      h < 1 ||
      h > MAX_GRID_ROWS
    ) {
      dropped += 1;
      continue;
    }
    seenIds.add(id);
    items.push({ id, x, y, w, h });
  }

  if (items.length === 0) return null;
  return { layout: { version: 1, items }, dropped };
}

function sanitizeIndicator(entry: unknown, seen: Set<string>): IndicatorConfig | null {
  if (!isPlainRecord(entry)) return null;
  if (typeof entry.kind !== "string" || !INDICATOR_KINDS.has(entry.kind as IndicatorKind)) return null;
  const kind = entry.kind as IndicatorKind;
  let id =
    typeof entry.id === "string" && entry.id.trim().length > 0 && entry.id.length <= 40
      ? entry.id.trim()
      : `${kind}-${seen.size + 1}`;
  if (seen.has(id)) id = `${kind}-${seen.size + 1}`;
  seen.add(id);

  const color =
    typeof entry.color === "number" && Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 4
      ? entry.color
      : 0;

  const params: Record<string, number> = {};
  if (isPlainRecord(entry.params)) {
    for (const [k, v] of Object.entries(entry.params)) {
      if (k.length > 0 && k.length <= 32 && typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000) {
        params[k] = v;
      }
    }
  }
  return {
    id,
    kind,
    params,
    color,
    ...(entry.hidden === true ? { hidden: true } : {}),
  };
}

function migrateLegacyChartIndicators(raw: Record<string, unknown>): IndicatorConfig[] | undefined {
  const overlays = Array.isArray(raw.overlays) ? raw.overlays : null;
  const panes = Array.isArray(raw.panes) ? raw.panes : null;
  if (!overlays && !panes) return undefined;
  const out: IndicatorConfig[] = [];
  for (const [key, preset] of Object.entries(LEGACY_OVERLAYS)) {
    if (overlays?.includes(key)) {
      const vals = Object.values(preset.params).join("-");
      out.push({ id: vals ? `${preset.kind}-${vals}` : preset.kind, ...preset });
    }
  }
  for (const [key, preset] of Object.entries(LEGACY_PANES)) {
    if (panes?.includes(key)) {
      const vals = Object.values(preset.params).join("-");
      out.push({ id: vals ? `${preset.kind}-${vals}` : preset.kind, ...preset });
    }
  }
  return out;
}

export function sanitizeChartPrefsPartial(raw: unknown): Partial<ChartPrefs> | null {
  if (!isPlainRecord(raw)) return null;
  const out: Partial<ChartPrefs> = {};

  if (typeof raw.type === "string" && CHART_TYPES.has(raw.type as ChartType)) out.type = raw.type as ChartType;
  if (typeof raw.volume === "boolean") out.volume = raw.volume;
  if (typeof raw.scale === "string" && PRICE_SCALES.has(raw.scale as PriceScaleKind)) out.scale = raw.scale as PriceScaleKind;
  if (typeof raw.events === "boolean") out.events = raw.events;
  if (typeof raw.extremes === "boolean") out.extremes = raw.extremes;
  if (typeof raw.targets === "boolean") out.targets = raw.targets;
  if (typeof raw.watermark === "boolean") out.watermark = raw.watermark;
  if (typeof raw.grid === "boolean") out.grid = raw.grid;
  if (typeof raw.magnet === "boolean") out.magnet = raw.magnet;
  if (typeof raw.drawingsHidden === "boolean") out.drawingsHidden = raw.drawingsHidden;

  if (typeof raw.unit === "string" && CHART_UNITS.has(raw.unit as ChartUnit)) {
    out.unit = raw.unit as ChartUnit;
  } else if (raw.currency === "USD") {
    out.unit = "USD";
  } else if (raw.currency === "TRY") {
    out.unit = "TRY";
  }

  if (Array.isArray(raw.indicators)) {
    const seen = new Set<string>();
    const indicators: IndicatorConfig[] = [];
    for (const item of raw.indicators) {
      if (indicators.length >= MAX_INDICATORS) break;
      const clean = sanitizeIndicator(item, seen);
      if (clean) indicators.push(clean);
    }
    out.indicators = indicators;
  } else {
    const migrated = migrateLegacyChartIndicators(raw);
    if (migrated) out.indicators = migrated;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeDrawingPoint(value: unknown): DrawingPoint | null {
  if (!isPlainRecord(value)) return null;
  const { time, price } = value;
  if (typeof time !== "number" || typeof price !== "number") return null;
  if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
  return { time, price };
}

export function sanitizeDrawingList(raw: unknown): { items: Drawing[]; dropped: number } | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const items: Drawing[] = [];
  let dropped = 0;

  for (const value of raw) {
    if (!isPlainRecord(value)) {
      dropped += 1;
      continue;
    }
    const { id, kind, points, color, dashed } = value;
    if (typeof id !== "string" || id.length === 0 || id.length > 64 || seen.has(id)) {
      dropped += 1;
      continue;
    }
    if (typeof kind !== "string" || !DRAWING_KINDS.has(kind as DrawingKind)) {
      dropped += 1;
      continue;
    }
    const expectedPoints = kind === "hline" || kind === "vline" ? 1 : 2;
    if (!Array.isArray(points) || points.length !== expectedPoints) {
      dropped += 1;
      continue;
    }
    if (typeof color !== "number" || !Number.isInteger(color) || color < -1 || color > 4) {
      dropped += 1;
      continue;
    }
    const cleanPoints: DrawingPoint[] = [];
    let pointsValid = true;
    for (const p of points) {
      const clean = sanitizeDrawingPoint(p);
      if (!clean) {
        pointsValid = false;
        break;
      }
      cleanPoints.push(clean);
    }
    if (!pointsValid) {
      dropped += 1;
      continue;
    }
    seen.add(id);
    const drawing: Drawing = { id, kind: kind as DrawingKind, points: cleanPoints, color };
    if (dashed === true) drawing.dashed = true;
    items.push(drawing);
  }

  const trimmed = items.length > MAX_DRAWINGS_PER_SYMBOL ? items.slice(items.length - MAX_DRAWINGS_PER_SYMBOL) : items;
  return { items: trimmed, dropped: dropped + (items.length - trimmed.length) };
}

export function sanitizeCalendarCountries(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const code = item.trim().toUpperCase();
    if (COUNTRY_RE.test(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code);
      if (out.length >= MAX_CALENDAR_COUNTRIES) break;
    }
  }
  return out.length > 0 ? out : null;
}

export function isKnownChartPrefKey(key: string): key is ChartPrefKey {
  return CHART_PREF_KEY_SET.has(key);
}

export function sanitizeLocaleValue(raw: unknown): Locale | undefined {
  return typeof raw === "string" && LOCALES.has(raw as Locale) ? (raw as Locale) : undefined;
}

export function sanitizeThemeValue(raw: unknown): ThemePreference | undefined {
  return typeof raw === "string" && THEMES.has(raw as ThemePreference) ? (raw as ThemePreference) : undefined;
}

export function isValidCost(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 1e9;
}

export const WORKSPACE_LIMITS = {
  MAX_WATCHLISTS,
  MAX_WATCHLIST_TICKERS,
  MAX_WATCHLIST_NAME,
  MAX_DRAWING_SYMBOLS,
  MAX_COST_SYMBOLS,
} as const;

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Reads all valid personal workspace records from storage. Corrupted individual
 * entries are skipped safely without affecting other keys.
 */
export function readWorkspaceData(storage: StorageAdapter): WorkspaceData {
  const keys = storage.keys();

  // 1. Watchlists
  const rawWatchlists = parseJson(storage.getItem(WATCHLISTS_STORAGE_KEY));
  const watchlists = sanitizeWatchlists(rawWatchlists)?.items ?? [];

  // 2. Layouts
  const layouts: Record<string, StoredWorkspaceLayout> = {};
  for (const key of keys) {
    if (!isAllowedLayoutKey(key)) continue;
    const sanitized = sanitizeStoredLayout(parseJson(storage.getItem(key)));
    if (sanitized) layouts[key] = sanitized.layout;
  }

  // 3. Chart preferences (v2, falling back to legacy v1 if v2 absent)
  const chartPrefs: Record<string, Partial<ChartPrefs>> = {};
  for (const key of CHART_PREF_KEYS) {
    const raw = storage.getItem(key) ?? storage.getItem(key.replace(/\.v2$/, ".v1"));
    const sanitized = sanitizeChartPrefsPartial(parseJson(raw));
    if (sanitized) chartPrefs[key] = sanitized;
  }

  // 4. Drawings per symbol
  const drawings: Record<string, Drawing[]> = {};
  for (const key of keys) {
    if (!key.startsWith(DRAWINGS_STORAGE_PREFIX)) continue;
    if (Object.keys(drawings).length >= MAX_DRAWING_SYMBOLS) break;
    const symbol = normalizeSymbol(key.slice(DRAWINGS_STORAGE_PREFIX.length));
    if (!symbol) continue;
    const parsed = parseJson(storage.getItem(key));
    if (!isPlainRecord(parsed) || parsed.v !== 1) continue;
    const sanitized = sanitizeDrawingList(parsed.items);
    if (sanitized && sanitized.items.length > 0) drawings[symbol] = sanitized.items;
  }

  // 5. Average cost lines per symbol
  const costs: Record<string, number> = {};
  for (const key of keys) {
    if (!key.startsWith(COST_STORAGE_PREFIX)) continue;
    if (Object.keys(costs).length >= MAX_COST_SYMBOLS) break;
    const symbol = normalizeSymbol(key.slice(COST_STORAGE_PREFIX.length));
    if (!symbol) continue;
    const num = Number(storage.getItem(key));
    if (isValidCost(num)) costs[symbol] = num;
  }

  // 6. Preferences
  const preferences: WorkspacePreferences = {};
  const countries = sanitizeCalendarCountries(parseJson(storage.getItem(CALENDAR_COUNTRIES_STORAGE_KEY)));
  if (countries) preferences.calendarCountries = countries;
  const pausedRaw = storage.getItem(MARKET_STRIP_PAUSED_STORAGE_KEY);
  if (pausedRaw === "1") preferences.marketStripPaused = true;
  else if (pausedRaw === "0") preferences.marketStripPaused = false;
  const locale = sanitizeLocaleValue(storage.getItem(LOCALE_STORAGE_KEY));
  if (locale) preferences.locale = locale;
  const theme = sanitizeThemeValue(storage.getItem(THEME_STORAGE_KEY));
  if (theme) preferences.theme = theme;

  return { watchlists, layouts, chartPrefs, drawings, costs, preferences };
}

export interface MigrationResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  upgradedChartKeys: string[];
  repairedKeys: string[];
}

/**
 * Lossless migration from unversioned/legacy localStorage keys to schema v1.
 * - Promotes `hisse.chart.*.v1` into `.v2` when `.v2` does not exist.
 * - Drops malformed individual drawing/layout entries without touching valid keys.
 * - Stamps `hisse.localStore.meta.v1`.
 */
export function migrateLocalStorage(storage: StorageAdapter, now: Date = new Date()): MigrationResult {
  const existingMeta = parseJson(storage.getItem(LOCAL_STORE_META_KEY));
  const fromVersion =
    isPlainRecord(existingMeta) && typeof existingMeta.version === "number" && Number.isInteger(existingMeta.version)
      ? existingMeta.version
      : 0;

  if (fromVersion >= WORKSPACE_SCHEMA_VERSION) {
    return {
      migrated: false,
      fromVersion,
      toVersion: WORKSPACE_SCHEMA_VERSION,
      upgradedChartKeys: [],
      repairedKeys: [],
    };
  }

  const upgradedChartKeys: string[] = [];
  const repairedKeys: string[] = [];

  try {
    // 1. Promote legacy chart prefs v1 -> v2 without losing user indicator toggles.
    for (const v2Key of CHART_PREF_KEYS) {
      if (storage.getItem(v2Key) !== null) continue;
      const v1Key = v2Key.replace(/\.v2$/, ".v1");
      const v1Raw = storage.getItem(v1Key);
      if (!v1Raw) continue;
      const sanitized = sanitizeChartPrefsPartial(parseJson(v1Raw));
      if (sanitized) {
        storage.setItem(v2Key, JSON.stringify(sanitized));
        upgradedChartKeys.push(v2Key);
      }
    }

    // 2. Verify watchlists JSON isn't hopelessly broken (only remove if unparseable JSON; keep valid arrays untouched).
    const rawWatchlists = storage.getItem(WATCHLISTS_STORAGE_KEY);
    if (rawWatchlists !== null) {
      const parsed = parseJson(rawWatchlists);
      const sanitized = sanitizeWatchlists(parsed);
      if (!sanitized || sanitized.items.length === 0) {
        storage.removeItem(WATCHLISTS_STORAGE_KEY);
        repairedKeys.push(WATCHLISTS_STORAGE_KEY);
      }
    }

    // 3. Remove corrupt layout entries individually so valid layouts remain intact.
    for (const key of storage.keys()) {
      if (!isAllowedLayoutKey(key)) continue;
      const raw = storage.getItem(key);
      if (raw !== null && sanitizeStoredLayout(parseJson(raw)) === null) {
        storage.removeItem(key);
        repairedKeys.push(key);
      }
    }

    const iso = now.toISOString();
    const meta: LocalStoreMeta = {
      version: WORKSPACE_SCHEMA_VERSION,
      migratedAt: iso,
      updatedAt: iso,
    };
    storage.setItem(LOCAL_STORE_META_KEY, JSON.stringify(meta));
  } catch {
    // Storage may be full or read-only; leave existing data intact.
  }

  return {
    migrated: true,
    fromVersion,
    toVersion: WORKSPACE_SCHEMA_VERSION,
    upgradedChartKeys,
    repairedKeys,
  };
}
