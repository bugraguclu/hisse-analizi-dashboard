/**
 * Persistent local market summary & BIST-session-aware offline freshness model
 * (combining TusAnkiM's durable local storage + Yemek Takibi's snapshot cache,
 * tailored to Borsa İstanbul trading hours rather than a midnight rule).
 *
 * Pure module with no React / Next imports so Node `--test` runs directly on it.
 */

import type { Company, EventOut, IndexQuote, SnapshotOut, SnapshotQuote } from "../../types/index.ts";
import type { MarketQuote } from "../../components/makro/types.ts";
import { getMarketStatus, istanbulClock, isWeekday, sessionQuoteTime } from "../market-hours.ts";
import { clearIdbOfflineSnapshot, writeIdbOfflineSnapshot } from "./idb.ts";
import { createBrowserStorage, type StorageAdapter } from "./storage.ts";

export const OFFLINE_SUMMARY_VERSION = 1 as const;
export const OFFLINE_SUMMARY_STORAGE_KEY = "hisse.offline.summary.v1";
export const OFFLINE_SUMMARY_EVENT = "hisse-offline-summary-changed";
const IDB_SNAPSHOT_KEY = "latest-market-summary";

/** ~15 min BIST delayed feed + 5 min tolerance during an open trading session. */
export const BIST_DELAY_MINUTES = 15;
const OPEN_SESSION_STALE_MS = 20 * 60_000;
const MAX_CACHED_QUOTES = 160;
const MAX_CACHED_EVENTS = 15;
const MAX_CACHED_COMPANIES = 250;
const MAX_CACHED_MOVERS = 10;

export interface CachedStockQuote {
  ticker: string;
  quote: SnapshotQuote;
  savedAt: number;
  source?: string;
}

export interface CachedCompanyItem {
  ticker: string;
  display_name: string;
}

export interface CachedMover {
  ticker: string;
  name: string;
  price: number | null;
  change: number;
}

export interface CachedBreadth {
  scope: "bist100" | "all";
  up: number;
  down: number;
  flat: number;
  gainers: CachedMover[];
  losers: CachedMover[];
}

export interface OfflineMarketSummary {
  version: typeof OFFLINE_SUMMARY_VERSION;
  updatedAt: number;
  indices?: {
    quotes: IndexQuote[];
    savedAt: number;
    quoteAt: number | null;
    source?: string;
  };
  watchlistQuotes: Record<string, CachedStockQuote>;
  companies?: {
    items: CachedCompanyItem[];
    savedAt: number;
  };
  latestEvents?: {
    items: EventOut[];
    savedAt: number;
  };
  macroMarkets?: {
    instruments: MarketQuote[];
    asOf?: string | null;
    savedAt: number;
  };
  breadth?: {
    data: CachedBreadth;
    savedAt: number;
  };
}

export type OfflineFreshnessState = "live" | "cached-offline" | "cached-stale" | "empty-offline";

export interface OfflineFreshnessInfo {
  state: OfflineFreshnessState;
  isOnline: boolean;
  hasData: boolean;
  savedAt: number | null;
  /** Latest BIST session quote timestamp (clamped to 18:10 on after-close/weekends). */
  quoteAt: number | null;
  /** True when the cached snapshot still represents the latest BIST session (e.g. Fri close viewed on Sun). */
  sameSession: boolean;
  /** True when BIST is currently trading and the local copy is older than the delayed-feed window. */
  staleDuringSession: boolean;
  marketPhase: ReturnType<typeof getMarketStatus>["phase"];
  delayMinutes: number;
  ageMs: number | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isCachedMover(value: unknown): value is CachedMover {
  return isPlainRecord(value) && typeof value.ticker === "string" && typeof value.name === "string"
    && nullableNumber(value.price) && typeof value.change === "number" && Number.isFinite(value.change);
}

function createEmptySummary(nowMs: number): OfflineMarketSummary {
  return {
    version: OFFLINE_SUMMARY_VERSION,
    updatedAt: nowMs,
    watchlistQuotes: {},
  };
}

export function hasOfflineSummaryData(summary: OfflineMarketSummary | null): boolean {
  if (!summary) return false;
  return (
    (summary.indices?.quotes.length ?? 0) > 0 ||
    Object.keys(summary.watchlistQuotes).length > 0 ||
    (summary.latestEvents?.items.length ?? 0) > 0 ||
    (summary.macroMarkets?.instruments.length ?? 0) > 0 ||
    summary.breadth !== undefined
  );
}

export function parseOfflineSummary(raw: string | null): OfflineMarketSummary | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainRecord(parsed) || parsed.version !== OFFLINE_SUMMARY_VERSION) return null;
  if (typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt)) return null;

  const watchlistQuotes: Record<string, CachedStockQuote> = {};
  if (isPlainRecord(parsed.watchlistQuotes)) {
    for (const [ticker, entry] of Object.entries(parsed.watchlistQuotes)) {
      if (!isPlainRecord(entry) || !isPlainRecord(entry.quote)) continue;
      if (!nullableNumber(entry.quote.last_price) || !nullableNumber(entry.quote.change_percent)) continue;
      if (typeof entry.savedAt !== "number" || !Number.isFinite(entry.savedAt)) continue;
      watchlistQuotes[ticker] = {
        ticker,
        quote: entry.quote as SnapshotQuote,
        savedAt: entry.savedAt,
        ...(typeof entry.source === "string" ? { source: entry.source } : {}),
      };
    }
  }

  const summary: OfflineMarketSummary = {
    version: OFFLINE_SUMMARY_VERSION,
    updatedAt: parsed.updatedAt,
    watchlistQuotes,
  };

  if (isPlainRecord(parsed.indices) && Array.isArray(parsed.indices.quotes) && typeof parsed.indices.savedAt === "number") {
    summary.indices = {
      quotes: parsed.indices.quotes.filter((quote): quote is IndexQuote =>
        isPlainRecord(quote) && typeof quote.symbol === "string" && nullableNumber(quote.last) && nullableNumber(quote.change_percent)),
      savedAt: parsed.indices.savedAt,
      quoteAt: typeof parsed.indices.quoteAt === "number" && Number.isFinite(parsed.indices.quoteAt) ? parsed.indices.quoteAt : null,
      ...(typeof parsed.indices.source === "string" ? { source: parsed.indices.source } : {}),
    };
  }

  if (isPlainRecord(parsed.companies) && Array.isArray(parsed.companies.items) && typeof parsed.companies.savedAt === "number") {
    summary.companies = {
      items: parsed.companies.items
        .filter((c): c is CachedCompanyItem => isPlainRecord(c) && typeof c.ticker === "string" && typeof c.display_name === "string")
        .slice(0, MAX_CACHED_COMPANIES),
      savedAt: parsed.companies.savedAt,
    };
  }

  if (isPlainRecord(parsed.latestEvents) && Array.isArray(parsed.latestEvents.items) && typeof parsed.latestEvents.savedAt === "number") {
    summary.latestEvents = {
      items: parsed.latestEvents.items.filter((event): event is EventOut =>
        isPlainRecord(event) && typeof event.id === "string").slice(0, MAX_CACHED_EVENTS),
      savedAt: parsed.latestEvents.savedAt,
    };
  }

  if (isPlainRecord(parsed.macroMarkets) && Array.isArray(parsed.macroMarkets.instruments) && typeof parsed.macroMarkets.savedAt === "number") {
    summary.macroMarkets = {
      instruments: parsed.macroMarkets.instruments.filter((quote): quote is MarketQuote =>
        isPlainRecord(quote) && typeof quote.key === "string"),
      asOf: typeof parsed.macroMarkets.asOf === "string" ? parsed.macroMarkets.asOf : null,
      savedAt: parsed.macroMarkets.savedAt,
    };
  }

  if (isPlainRecord(parsed.breadth) && isPlainRecord(parsed.breadth.data) && typeof parsed.breadth.savedAt === "number") {
    const data = parsed.breadth.data;
    if ((data.scope === "bist100" || data.scope === "all")
        && [data.up, data.down, data.flat].every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0)
        && Array.isArray(data.gainers) && Array.isArray(data.losers)) {
      summary.breadth = {
        data: {
          scope: data.scope,
          up: data.up as number, down: data.down as number, flat: data.flat as number,
          gainers: data.gainers.filter(isCachedMover).slice(0, MAX_CACHED_MOVERS),
          losers: data.losers.filter(isCachedMover).slice(0, MAX_CACHED_MOVERS),
        },
        savedAt: parsed.breadth.savedAt,
      };
    }
  }

  return summary;
}

/**
 * Returns the Istanbul trading day (YYYY-MM-DD) of the most recent BIST session
 * that has opened or closed by `ms`. On Saturday/Sunday or weekday pre-open
 * (before 10:00), this steps back to the previous weekday's session!
 */
export function latestExpectedBistSessionDateKey(ms: number): string {
  const MINUTE_MS = 60_000;
  let cursor = ms;
  let clock = istanbulClock(cursor);

  // Before 10:00 on a weekday, the latest settled BIST session is still the prior weekday.
  if (isWeekday(clock) && clock.minutes < 10 * 60) {
    cursor -= (clock.minutes + 1) * MINUTE_MS;
    clock = istanbulClock(cursor);
  }
  for (let guard = 0; !isWeekday(clock) && guard < 4; guard += 1) {
    cursor -= (clock.minutes + 1) * MINUTE_MS;
    clock = istanbulClock(cursor);
  }
  return clock.dateKey;
}

/**
 * Evaluates freshness of the cached offline summary using BIST session rules
 * instead of a naive midnight cutoff.
 *
 * Example: Friday 18:10 closing prices viewed offline on Sunday are still the
 * latest BIST session (`sameSession: true`, `staleDuringSession: false`),
 * whereas Friday's prices viewed at 11:30 Monday during an open session are
 * marked stale (`sameSession: false`, `staleDuringSession: true`).
 */
export function evaluateOfflineFreshness(
  summary: OfflineMarketSummary | null,
  nowMs: number,
  isOnline: boolean,
): OfflineFreshnessInfo {
  const hasData = hasOfflineSummaryData(summary);
  const rawQuoteAt = summary?.indices?.quoteAt ?? null;
  const quoteAt = rawQuoteAt !== null ? sessionQuoteTime(rawQuoteAt) : null;
  const savedAt = summary?.updatedAt ?? null;

  const market = getMarketStatus(nowMs, quoteAt);

  if (!hasData || savedAt === null) {
    return {
      state: isOnline ? "live" : "empty-offline",
      isOnline,
      hasData: false,
      savedAt: null,
      quoteAt: null,
      sameSession: false,
      staleDuringSession: false,
      marketPhase: market.phase,
      delayMinutes: BIST_DELAY_MINUTES,
      ageMs: null,
    };
  }

  const ageMs = Math.max(0, nowMs - savedAt);
  const referenceInstant = quoteAt ?? savedAt;
  const snapshotSessionKey = latestExpectedBistSessionDateKey(referenceInstant);
  const currentSessionKey = latestExpectedBistSessionDateKey(nowMs);
  const sameSession = snapshotSessionKey === currentSessionKey;

  const staleDuringSession = market.isOpen && (!sameSession || ageMs > OPEN_SESSION_STALE_MS);

  let state: OfflineFreshnessState;
  if (!isOnline) {
    state = staleDuringSession ? "cached-stale" : "cached-offline";
  } else {
    state = "live";
  }

  return {
    state,
    isOnline,
    hasData: true,
    savedAt,
    quoteAt,
    sameSession,
    staleDuringSession,
    marketPhase: market.phase,
    delayMinutes: BIST_DELAY_MINUTES,
    ageMs,
  };
}

function notifyOfflineChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_SUMMARY_EVENT));
}

// IndexedDB writes are fire-and-forget. Run them one after another so a "clear" can never be
// overtaken by a mirror write that started earlier (which would resurrect the cleared cache
// on the next startup).
let idbQueue: Promise<unknown> = Promise.resolve();
function queueIdb(task: () => Promise<unknown>): void {
  idbQueue = idbQueue.then(task, task).catch(() => undefined);
}

function writeSummary(storage: StorageAdapter, summary: OfflineMarketSummary, mirrorToIdb: boolean): void {
  try {
    storage.setItem(OFFLINE_SUMMARY_STORAGE_KEY, JSON.stringify(summary));
  } catch {
    // If localStorage is full, trim older watchlist quotes and try once more.
    try {
      const trimmed: OfflineMarketSummary = {
        ...summary,
        watchlistQuotes: pruneQuotes(summary.watchlistQuotes, 60),
      };
      storage.setItem(OFFLINE_SUMMARY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Storage blocked (private mode / quota).
    }
  }
  if (mirrorToIdb) {
    queueIdb(() => writeIdbOfflineSnapshot(IDB_SNAPSHOT_KEY, summary));
  }
  notifyOfflineChange();
}

function pruneQuotes(quotes: Record<string, CachedStockQuote>, limit = MAX_CACHED_QUOTES): Record<string, CachedStockQuote> {
  const entries = Object.entries(quotes);
  if (entries.length <= limit) return quotes;
  entries.sort((a, b) => b[1].savedAt - a[1].savedAt);
  return Object.fromEntries(entries.slice(0, limit));
}

export function readOfflineSummary(storage?: StorageAdapter | null): OfflineMarketSummary | null {
  const s = storage === undefined ? createBrowserStorage() : storage;
  if (!s) return null;
  return parseOfflineSummary(s.getItem(OFFLINE_SUMMARY_STORAGE_KEY));
}

export function clearOfflineSummary(storage?: StorageAdapter | null): void {
  const s = storage === undefined ? createBrowserStorage() : storage;
  if (s) s.removeItem(OFFLINE_SUMMARY_STORAGE_KEY);
  if (storage === undefined) {
    queueIdb(() => clearIdbOfflineSnapshot(IDB_SNAPSHOT_KEY));
  }
  notifyOfflineChange();
}

export interface OfflinePatch {
  indices?: { quotes: IndexQuote[]; source?: string };
  snapshot?: SnapshotOut;
  companies?: Company[];
  latestEvents?: EventOut[];
  macroMarkets?: { instruments: MarketQuote[]; as_of?: string | null };
  breadth?: CachedBreadth;
}

const TAPE_MACRO_KEYS = new Set(["usdtry", "eurtry", "gram_gold", "xauusd", "brent", "tr02y", "tr10y"]);

/**
 * Merges freshly fetched API data into the persistent local offline summary.
 * Only updates the slices present in `patch`, preserving other cached slices
 * and per-ticker watchlist quotes across different lists.
 */
export function mergeOfflineSummary(
  patch: OfflinePatch,
  options: { storage?: StorageAdapter; nowMs?: number; mirrorToIdb?: boolean } = {},
): OfflineMarketSummary | null {
  const storage = options.storage ?? createBrowserStorage();
  if (!storage) return null;
  const nowMs = options.nowMs ?? Date.now();
  const current = readOfflineSummary(storage) ?? createEmptySummary(nowMs);
  let changed = false;

  const next: OfflineMarketSummary = {
    ...current,
    watchlistQuotes: { ...current.watchlistQuotes },
  };

  if (patch.indices && patch.indices.quotes.length > 0) {
    const headline = patch.indices.quotes.find((q) => q.symbol === "XU100") ?? patch.indices.quotes[0];
    const ts = headline?.timestamp;
    const quoteAt = typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
    next.indices = {
      quotes: patch.indices.quotes,
      savedAt: nowMs,
      quoteAt,
      ...(patch.indices.source ? { source: patch.indices.source } : {}),
    };
    changed = true;
  }

  if (patch.snapshot && patch.snapshot.snapshot) {
    let added = 0;
    for (const [ticker, quote] of Object.entries(patch.snapshot.snapshot)) {
      if (!quote || typeof ticker !== "string" || !ticker) continue;
      next.watchlistQuotes[ticker] = {
        ticker,
        quote,
        savedAt: nowMs,
        ...(patch.snapshot.source ? { source: patch.snapshot.source } : {}),
      };
      added += 1;
    }
    if (added > 0) {
      next.watchlistQuotes = pruneQuotes(next.watchlistQuotes, MAX_CACHED_QUOTES);
      changed = true;
    }
  }

  if (patch.companies && patch.companies.length > 0) {
    next.companies = {
      items: patch.companies
        .slice(0, MAX_CACHED_COMPANIES)
        .map((c) => ({ ticker: c.ticker, display_name: c.display_name })),
      savedAt: nowMs,
    };
    changed = true;
  }

  if (patch.latestEvents) {
    next.latestEvents = {
      items: patch.latestEvents.slice(0, MAX_CACHED_EVENTS),
      savedAt: nowMs,
    };
    changed = true;
  }

  if (patch.macroMarkets && patch.macroMarkets.instruments.length > 0) {
    const filtered = patch.macroMarkets.instruments.filter((item) => TAPE_MACRO_KEYS.has(item.key));
    if (filtered.length > 0) {
      next.macroMarkets = {
        instruments: filtered,
        asOf: patch.macroMarkets.as_of ?? null,
        savedAt: nowMs,
      };
      changed = true;
    }
  }

  if (patch.breadth) {
    next.breadth = {
      data: {
        ...patch.breadth,
        gainers: patch.breadth.gainers.slice(0, MAX_CACHED_MOVERS),
        losers: patch.breadth.losers.slice(0, MAX_CACHED_MOVERS),
      },
      savedAt: nowMs,
    };
    changed = true;
  }

  if (!changed) return current;

  next.updatedAt = nowMs;
  writeSummary(storage, next, options.mirrorToIdb ?? (options.storage === undefined));
  return next;
}

/** Build a `SnapshotOut` compatible view for a watchlist's tickers from the offline cache. */
export function buildOfflineWatchlistSnapshot(
  summary: OfflineMarketSummary | null,
  tickers: readonly string[],
): { snapshot: SnapshotOut; oldestSavedAt: number; newestSavedAt: number; coveredCount: number } | null {
  if (!summary || tickers.length === 0) return null;
  const snapshot: Record<string, SnapshotQuote | undefined> = {};
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;
  let coveredCount = 0;

  for (const ticker of tickers) {
    const cached = summary.watchlistQuotes[ticker];
    if (!cached) continue;
    snapshot[ticker] = cached.quote;
    coveredCount += 1;
    if (cached.savedAt < oldest) oldest = cached.savedAt;
    if (cached.savedAt > newest) newest = cached.savedAt;
  }

  if (coveredCount === 0) return null;
  return {
    snapshot: {
      symbols: [...tickers],
      snapshot,
      source: "offline-cache",
    },
    oldestSavedAt: oldest,
    newestSavedAt: newest,
    coveredCount,
  };
}
