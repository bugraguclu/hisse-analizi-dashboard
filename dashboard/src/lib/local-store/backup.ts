/**
 * Personal workspace backup, preflight validation, preview, atomic restore and
 * pre-restore rollback copies (adapted from TusAnkiM's lib/backup.ts).
 *
 * Safety guarantees:
 * 1. Corrupted or unsupported files are rejected in preflight without touching
 *    any existing setting in storage.
 * 2. Every restore first captures a pre-restore rollback copy of the current
 *    workspace (retaining the latest 3) so the user can always revert.
 * 3. Writes are applied atomically with automatic rollback if storage throws
 *    mid-restore (e.g. quota exceeded).
 */

import type { Locale } from "../i18n.ts";
import {
  createIndexedDbArchiveStore,
  type BackupArchiveStore,
  type RestorePointMeta,
  type RestorePointRecord,
} from "./idb.ts";
import {
  CALENDAR_COUNTRIES_STORAGE_KEY,
  CHART_PREF_KEYS,
  COST_STORAGE_PREFIX,
  DRAWINGS_STORAGE_PREFIX,
  LOCAL_STORE_META_KEY,
  LOCALE_STORAGE_KEY,
  MARKET_STRIP_PAUSED_STORAGE_KEY,
  MAX_BACKUP_BYTES,
  THEME_STORAGE_KEY,
  WATCHLISTS_STORAGE_KEY,
  WORKSPACE_BACKUP_FORMAT,
  WORKSPACE_LIMITS,
  WORKSPACE_SCHEMA_VERSION,
  isAllowedLayoutKey,
  isKnownChartPrefKey,
  isValidCost,
  layoutPageLabel,
  normalizeSymbol,
  readWorkspaceData,
  sanitizeCalendarCountries,
  sanitizeChartPrefsPartial,
  sanitizeDrawingList,
  sanitizeLocaleValue,
  sanitizeStoredLayout,
  sanitizeThemeValue,
  sanitizeWatchlists,
  type LocalStoreMeta,
  type StoredWorkspaceLayout,
  type ThemePreference,
  type WorkspaceData,
  type WorkspacePreferences,
  type WorkspaceSnapshot,
} from "./schema.ts";
import {
  createBrowserStorage,
  emitWorkspaceStorageChange,
  serializeLocalStoreWork,
  type StorageAdapter,
} from "./storage.ts";

export const KEEP_PRE_RESTORE = 3;
export const KEEP_MANUAL_RESTORE_POINTS = 8;

const PRE_RESTORE_PREFIX = "prerestore-";
const MANUAL_PREFIX = "manual-";

export type BackupValidationErrorCode =
  | "empty"
  | "too-large"
  | "invalid-json"
  | "not-an-object"
  | "unknown-format"
  | "invalid-version"
  | "newer-version"
  | "invalid-data"
  | "invalid-watchlists"
  | "invalid-layouts"
  | "invalid-chart-prefs"
  | "invalid-drawings"
  | "invalid-costs"
  | "invalid-preferences";

export interface BackupCounts {
  watchlists: number;
  tickers: number;
  layouts: number;
  chartPrefs: number;
  drawingSymbols: number;
  drawings: number;
  costs: number;
  preferences: number;
}

export interface BackupPreview {
  exportedAt: string | null;
  version: number;
  counts: BackupCounts;
  watchlistNames: string[];
  layoutPages: string[];
  hasChanges: boolean;
  warnings: string[];
}

export type BackupValidationResult =
  | { valid: true; snapshot: WorkspaceSnapshot; preview: BackupPreview }
  | { valid: false; reason: BackupValidationErrorCode };

export interface WorkspaceBackupDeps {
  storage?: StorageAdapter;
  archive?: BackupArchiveStore;
  now?: () => Date;
  onApplyLocale?: (locale: Locale) => void;
  onApplyTheme?: (theme: ThemePreference) => void;
  appVersion?: string;
}

export interface ExportBackupResult {
  snapshot: WorkspaceSnapshot;
  json: string;
  fileName: string;
  preview: BackupPreview;
}

export interface ImportBackupResult {
  ok: boolean;
  preRestoreId: string | null;
  preview: BackupPreview;
  error?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildBackupFileName(now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return `hisse-analizi-yedek-${date}-${time}.json`;
}

export function summarizeWorkspaceData(data: WorkspaceData, exportedAt: string | null = null, version = WORKSPACE_SCHEMA_VERSION, warnings: string[] = []): BackupPreview {
  const tickerCount = data.watchlists.reduce((sum, list) => sum + list.tickers.length, 0);
  const drawingEntries = Object.values(data.drawings);
  const drawingCount = drawingEntries.reduce((sum, list) => sum + list.length, 0);
  const prefCount = [
    data.preferences.calendarCountries !== undefined,
    data.preferences.marketStripPaused !== undefined,
    data.preferences.locale !== undefined,
    data.preferences.theme !== undefined,
  ].filter(Boolean).length;

  const counts: BackupCounts = {
    watchlists: data.watchlists.length,
    tickers: tickerCount,
    layouts: Object.keys(data.layouts).length,
    chartPrefs: Object.keys(data.chartPrefs).length,
    drawingSymbols: drawingEntries.length,
    drawings: drawingCount,
    costs: Object.keys(data.costs).length,
    preferences: prefCount,
  };

  const hasChanges =
    counts.watchlists > 0 ||
    counts.layouts > 0 ||
    counts.chartPrefs > 0 ||
    counts.drawings > 0 ||
    counts.costs > 0 ||
    counts.preferences > 0;

  return {
    exportedAt,
    version,
    counts,
    watchlistNames: data.watchlists.map((w) => w.name || w.id),
    layoutPages: Object.keys(data.layouts).map(layoutPageLabel).sort(),
    hasChanges,
    warnings,
  };
}

export function exportWorkspaceBackup(
  storage: StorageAdapter,
  options: { now?: Date; appVersion?: string } = {},
): ExportBackupResult {
  const now = options.now ?? new Date();
  const data = readWorkspaceData(storage);
  const exportedAt = now.toISOString();
  const snapshot: WorkspaceSnapshot = {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_SCHEMA_VERSION,
    exportedAt,
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    data,
  };
  const json = JSON.stringify(snapshot, null, 2);
  return {
    snapshot,
    json,
    fileName: buildBackupFileName(now),
    preview: summarizeWorkspaceData(data, exportedAt, WORKSPACE_SCHEMA_VERSION),
  };
}

/**
 * Strictly parse and validate a backup JSON string without mutating any state.
 */
export function validateWorkspaceBackup(rawContents: string): BackupValidationResult {
  if (!rawContents || !rawContents.trim()) return { valid: false, reason: "empty" };
  if (rawContents.length > MAX_BACKUP_BYTES) return { valid: false, reason: "too-large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContents);
  } catch {
    return { valid: false, reason: "invalid-json" };
  }

  if (!isPlainRecord(parsed)) return { valid: false, reason: "not-an-object" };
  if (parsed.format !== WORKSPACE_BACKUP_FORMAT) return { valid: false, reason: "unknown-format" };

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { valid: false, reason: "invalid-version" };
  }
  if (version > WORKSPACE_SCHEMA_VERSION) {
    return { valid: false, reason: "newer-version" };
  }

  const rawData = parsed.data;
  if (!isPlainRecord(rawData)) return { valid: false, reason: "invalid-data" };

  const warnings: string[] = [];

  // 1. Watchlists
  let watchlists: WorkspaceData["watchlists"] = [];
  if (rawData.watchlists !== undefined) {
    const clean = sanitizeWatchlists(rawData.watchlists);
    if (!clean) return { valid: false, reason: "invalid-watchlists" };
    if (clean.dropped > 0) warnings.push(`watchlists:${clean.dropped}`);
    watchlists = clean.items;
  }

  // 2. Layouts
  const layouts: Record<string, StoredWorkspaceLayout> = {};
  if (rawData.layouts !== undefined) {
    if (!isPlainRecord(rawData.layouts)) return { valid: false, reason: "invalid-layouts" };
    for (const [key, value] of Object.entries(rawData.layouts)) {
      if (!isAllowedLayoutKey(key)) {
        warnings.push(`layout-key:${key}`);
        continue;
      }
      const clean = sanitizeStoredLayout(value);
      if (!clean) return { valid: false, reason: "invalid-layouts" };
      if (clean.dropped > 0) warnings.push(`layout-items:${key}:${clean.dropped}`);
      layouts[key] = clean.layout;
    }
  }

  // 3. Chart preferences
  const chartPrefs: WorkspaceData["chartPrefs"] = {};
  if (rawData.chartPrefs !== undefined) {
    if (!isPlainRecord(rawData.chartPrefs)) return { valid: false, reason: "invalid-chart-prefs" };
    for (const [key, value] of Object.entries(rawData.chartPrefs)) {
      if (!isKnownChartPrefKey(key)) {
        warnings.push(`chart-key:${key}`);
        continue;
      }
      const clean = sanitizeChartPrefsPartial(value);
      if (!clean) return { valid: false, reason: "invalid-chart-prefs" };
      chartPrefs[key] = clean;
    }
  }

  // 4. Drawings
  const drawings: WorkspaceData["drawings"] = {};
  if (rawData.drawings !== undefined) {
    if (!isPlainRecord(rawData.drawings)) return { valid: false, reason: "invalid-drawings" };
    for (const [rawSym, value] of Object.entries(rawData.drawings)) {
      if (Object.keys(drawings).length >= WORKSPACE_LIMITS.MAX_DRAWING_SYMBOLS) {
        warnings.push("drawings:limit");
        break;
      }
      const symbol = normalizeSymbol(rawSym);
      if (!symbol) return { valid: false, reason: "invalid-drawings" };
      const clean = sanitizeDrawingList(value);
      if (!clean) return { valid: false, reason: "invalid-drawings" };
      if (clean.dropped > 0) warnings.push(`drawings:${symbol}:${clean.dropped}`);
      if (clean.items.length > 0) drawings[symbol] = clean.items;
    }
  }

  // 5. Costs
  const costs: WorkspaceData["costs"] = {};
  if (rawData.costs !== undefined) {
    if (!isPlainRecord(rawData.costs)) return { valid: false, reason: "invalid-costs" };
    for (const [rawSym, value] of Object.entries(rawData.costs)) {
      if (Object.keys(costs).length >= WORKSPACE_LIMITS.MAX_COST_SYMBOLS) {
        warnings.push("costs:limit");
        break;
      }
      const symbol = normalizeSymbol(rawSym);
      if (!symbol || !isValidCost(value)) return { valid: false, reason: "invalid-costs" };
      costs[symbol] = value;
    }
  }

  // 6. Preferences
  const preferences: WorkspacePreferences = {};
  if (rawData.preferences !== undefined) {
    if (!isPlainRecord(rawData.preferences)) return { valid: false, reason: "invalid-preferences" };
    const prefs = rawData.preferences;
    if (prefs.calendarCountries !== undefined) {
      const clean = sanitizeCalendarCountries(prefs.calendarCountries);
      if (!clean) return { valid: false, reason: "invalid-preferences" };
      preferences.calendarCountries = clean;
    }
    if (prefs.marketStripPaused !== undefined) {
      if (typeof prefs.marketStripPaused !== "boolean") return { valid: false, reason: "invalid-preferences" };
      preferences.marketStripPaused = prefs.marketStripPaused;
    }
    if (prefs.locale !== undefined) {
      const clean = sanitizeLocaleValue(prefs.locale);
      if (!clean) return { valid: false, reason: "invalid-preferences" };
      preferences.locale = clean;
    }
    if (prefs.theme !== undefined) {
      const clean = sanitizeThemeValue(prefs.theme);
      if (!clean) return { valid: false, reason: "invalid-preferences" };
      preferences.theme = clean;
    }
  }

  const exportedAt =
    typeof parsed.exportedAt === "string" && !Number.isNaN(Date.parse(parsed.exportedAt))
      ? parsed.exportedAt
      : null;

  const data: WorkspaceData = { watchlists, layouts, chartPrefs, drawings, costs, preferences };
  const snapshot: WorkspaceSnapshot = {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_SCHEMA_VERSION,
    exportedAt: exportedAt ?? new Date().toISOString(),
    ...(typeof parsed.appVersion === "string" ? { appVersion: parsed.appVersion } : {}),
    data,
  };

  return {
    valid: true,
    snapshot,
    preview: summarizeWorkspaceData(data, exportedAt, WORKSPACE_SCHEMA_VERSION, warnings),
  };
}

function isPersonalStorageKey(key: string): boolean {
  return (
    key === WATCHLISTS_STORAGE_KEY ||
    isAllowedLayoutKey(key) ||
    isKnownChartPrefKey(key) ||
    key.startsWith(DRAWINGS_STORAGE_PREFIX) ||
    key.startsWith(COST_STORAGE_PREFIX) ||
    key === CALENDAR_COUNTRIES_STORAGE_KEY ||
    key === MARKET_STRIP_PAUSED_STORAGE_KEY ||
    key === LOCALE_STORAGE_KEY ||
    key === THEME_STORAGE_KEY
  );
}

/** Captures raw key/value pairs for every personal storage key so rollback is exact. */
function captureRawPersonalEntries(storage: StorageAdapter): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of storage.keys()) {
    if (!isPersonalStorageKey(key)) continue;
    const val = storage.getItem(key);
    if (val !== null) map.set(key, val);
  }
  return map;
}

function restoreRawPersonalEntries(storage: StorageAdapter, entries: Map<string, string>): void {
  for (const key of storage.keys()) {
    if (isPersonalStorageKey(key) && !entries.has(key)) {
      storage.removeItem(key);
    }
  }
  for (const [key, value] of entries) {
    storage.setItem(key, value);
  }
}

/**
 * Applies a validated `WorkspaceData` payload onto `storage`.
 * Replaces personal workspace keys while leaving unrelated keys (such as the
 * offline market cache or legal-notice dismissal) completely untouched.
 */
function writeWorkspaceData(
  storage: StorageAdapter,
  data: WorkspaceData,
  now: Date,
  callbacks: { onApplyLocale?: (locale: Locale) => void; onApplyTheme?: (theme: ThemePreference) => void },
): void {
  // Remove previous personal keys that are not present in the imported snapshot.
  for (const key of storage.keys()) {
    if (isPersonalStorageKey(key)) {
      // Preserve locale/theme if the backup did not include them.
      if (key === LOCALE_STORAGE_KEY && data.preferences.locale === undefined) continue;
      if (key === THEME_STORAGE_KEY && data.preferences.theme === undefined) continue;
      storage.removeItem(key);
    }
  }

  // 1. Watchlists (exact format expected by hooks/use-watchlists.ts)
  if (data.watchlists.length > 0) {
    const payload = data.watchlists.map((list) => ({
      id: list.id,
      name: list.name,
      items: list.tickers.map((ticker) => ({ ticker })),
    }));
    storage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(payload));
  }

  // 2. Layouts
  for (const [key, layout] of Object.entries(data.layouts)) {
    storage.setItem(key, JSON.stringify(layout));
  }

  // 3. Chart prefs
  for (const key of CHART_PREF_KEYS) {
    const prefs = data.chartPrefs[key];
    if (prefs) storage.setItem(key, JSON.stringify(prefs));
  }

  // 4. Drawings
  for (const [symbol, items] of Object.entries(data.drawings)) {
    if (items.length > 0) {
      storage.setItem(`${DRAWINGS_STORAGE_PREFIX}${symbol}`, JSON.stringify({ v: 1, items }));
    }
  }

  // 5. Average costs
  for (const [symbol, cost] of Object.entries(data.costs)) {
    storage.setItem(`${COST_STORAGE_PREFIX}${symbol}`, String(cost));
  }

  // 6. Preferences
  if (data.preferences.calendarCountries) {
    storage.setItem(CALENDAR_COUNTRIES_STORAGE_KEY, JSON.stringify(data.preferences.calendarCountries));
  }
  if (data.preferences.marketStripPaused !== undefined) {
    storage.setItem(MARKET_STRIP_PAUSED_STORAGE_KEY, data.preferences.marketStripPaused ? "1" : "0");
  }
  if (data.preferences.locale) {
    storage.setItem(LOCALE_STORAGE_KEY, data.preferences.locale);
    callbacks.onApplyLocale?.(data.preferences.locale);
  }
  if (data.preferences.theme) {
    storage.setItem(THEME_STORAGE_KEY, data.preferences.theme);
    callbacks.onApplyTheme?.(data.preferences.theme);
  }

  // Stamp schema metadata
  const iso = now.toISOString();
  const meta: LocalStoreMeta = {
    version: WORKSPACE_SCHEMA_VERSION,
    migratedAt: iso,
    updatedAt: iso,
  };
  storage.setItem(LOCAL_STORE_META_KEY, JSON.stringify(meta));
}

function resolveDeps(deps: WorkspaceBackupDeps) {
  const storage = deps.storage ?? createBrowserStorage();
  const archive = deps.archive ?? createIndexedDbArchiveStore();
  const now = deps.now ?? (() => new Date());
  return { storage, archive, now, onApplyLocale: deps.onApplyLocale, onApplyTheme: deps.onApplyTheme, appVersion: deps.appVersion };
}

async function pruneArchive(archive: BackupArchiveStore): Promise<void> {
  const all = await archive.list();
  const preRestores = all.filter((entry) => entry.kind === "prerestore");
  const manuals = all.filter((entry) => entry.kind === "manual");

  const toDelete = [
    ...preRestores.slice(KEEP_PRE_RESTORE),
    ...manuals.slice(KEEP_MANUAL_RESTORE_POINTS),
  ];

  await Promise.all(toDelete.map((entry) => archive.remove(entry.id).catch(() => undefined)));
}

function makeArchiveRecord(
  kind: "prerestore" | "manual",
  exported: ExportBackupResult,
  now: Date,
  customName?: string,
): RestorePointRecord {
  const ts = now.getTime();
  const suffix = Math.random().toString(36).slice(2, 6);
  const id = `${kind === "prerestore" ? PRE_RESTORE_PREFIX : MANUAL_PREFIX}${ts}-${suffix}`;
  return {
    id,
    kind,
    name: customName?.trim() || exported.fileName,
    createdAt: ts,
    size: exported.json.length,
    watchlistCount: exported.preview.counts.watchlists,
    layoutCount: exported.preview.counts.layouts,
    drawingCount: exported.preview.counts.drawings,
    contents: exported.json,
  };
}

/**
 * Validate and import a workspace backup JSON string.
 * - Rejects invalid/corrupted content without mutating storage.
 * - Saves a pre-restore rollback snapshot of the current workspace first.
 * - Automatically rolls back if writing any key throws mid-restore.
 */
export async function importWorkspaceBackup(
  rawContents: string,
  deps: WorkspaceBackupDeps = {},
): Promise<ImportBackupResult> {
  const validation = validateWorkspaceBackup(rawContents);
  if (!validation.valid) {
    throw new BackupValidationError(validation.reason);
  }

  const d = resolveDeps(deps);
  if (!d.storage) {
    throw new Error("storage-unavailable");
  }
  const storage = d.storage;

  return serializeLocalStoreWork(async () => {
    const now = d.now();
    const rawBefore = captureRawPersonalEntries(storage);
    const currentExport = exportWorkspaceBackup(storage, { now, appVersion: d.appVersion });
    const preRestoreRecord = makeArchiveRecord("prerestore", currentExport, now);
    await d.archive.write(preRestoreRecord);

    try {
      writeWorkspaceData(storage, validation.snapshot.data, now, {
        onApplyLocale: d.onApplyLocale,
        onApplyTheme: d.onApplyTheme,
      });
    } catch (error) {
      // Compensating rollback: leave the user's previous workspace intact.
      try {
        restoreRawPersonalEntries(storage, rawBefore);
      } catch {
        // Best-effort rollback when storage is locked/full.
      }
      return {
        ok: false,
        preRestoreId: preRestoreRecord.id,
        preview: validation.preview,
        error: error instanceof Error ? error.message : "write-failed",
      };
    }

    await pruneArchive(d.archive);
    emitWorkspaceStorageChange();

    return {
      ok: true,
      preRestoreId: preRestoreRecord.id,
      preview: validation.preview,
    };
  });
}

export class BackupValidationError extends Error {
  readonly reason: BackupValidationErrorCode;

  constructor(reason: BackupValidationErrorCode) {
    super(`Invalid workspace backup: ${reason}`);
    this.name = "BackupValidationError";
    this.reason = reason;
  }
}

/** Save a local restore point (in IndexedDB archive) without downloading a file. */
export async function createLocalRestorePoint(
  deps: WorkspaceBackupDeps & { name?: string } = {},
): Promise<RestorePointMeta> {
  const d = resolveDeps(deps);
  if (!d.storage) throw new Error("storage-unavailable");
  const storage = d.storage;

  return serializeLocalStoreWork(async () => {
    const now = d.now();
    const exported = exportWorkspaceBackup(storage, { now, appVersion: d.appVersion });
    const record = makeArchiveRecord("manual", exported, now, deps.name);
    await d.archive.write(record);
    await pruneArchive(d.archive);
    return {
      id: record.id,
      kind: record.kind,
      name: record.name,
      createdAt: record.createdAt,
      size: record.size,
      watchlistCount: record.watchlistCount,
      layoutCount: record.layoutCount,
      drawingCount: record.drawingCount,
    };
  });
}

/** Restore any stored local restore point or pre-restore rollback copy. */
export async function restoreFromArchive(
  id: string,
  deps: WorkspaceBackupDeps = {},
): Promise<ImportBackupResult> {
  const d = resolveDeps(deps);
  const record = await d.archive.read(id);
  if (!record) throw new Error("restore-point-not-found");
  return importWorkspaceBackup(record.contents, deps);
}

export async function listRestorePoints(archive: BackupArchiveStore = createIndexedDbArchiveStore()): Promise<RestorePointMeta[]> {
  return archive.list();
}

export async function readRestorePoint(id: string, archive: BackupArchiveStore = createIndexedDbArchiveStore()): Promise<RestorePointRecord | null> {
  return archive.read(id);
}

export async function deleteRestorePoint(id: string, archive: BackupArchiveStore = createIndexedDbArchiveStore()): Promise<void> {
  await serializeLocalStoreWork(() => archive.remove(id));
}
