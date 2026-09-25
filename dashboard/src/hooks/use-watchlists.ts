"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * Watchlists persisted in localStorage (per browser), synced across tabs.
 * Storage format stays compatible with the original dashboard:
 *   [{ id, name, items: [{ ticker }] }]
 */

export interface Watchlist {
  id: string;
  /** Empty for the built-in default list (rendered as the localized "Favorites"). */
  name: string;
  tickers: string[];
}

export const DEFAULT_WATCHLIST_ID = "favorites";
const STORAGE_KEY = "watchlists";
/** Same rule as the backend's normalize_symbol: one invalid symbol makes /market/snapshot reject the whole list. */
const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const MAX_LISTS = 12;
const MAX_TICKERS = 40;
const MAX_NAME_LENGTH = 40;

const DEFAULT_WATCHLISTS: readonly Watchlist[] = Object.freeze([
  { id: DEFAULT_WATCHLIST_ID, name: "", tickers: ["THYAO", "GARAN", "SISE", "ASELS", "EREGL"] },
]);

export function normalizeTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return TICKER_RE.test(ticker) ? ticker : null;
}

/** Validate untrusted storage content; returns null when nothing usable remains. */
function sanitize(raw: unknown): Watchlist[] | null {
  if (!Array.isArray(raw)) return null;
  const lists: Watchlist[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (lists.length >= MAX_LISTS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, items, tickers } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    const source = Array.isArray(items) ? items : Array.isArray(tickers) ? tickers : [];
    const clean: string[] = [];
    for (const item of source) {
      const ticker = normalizeTicker(
        typeof item === "string" ? item : item && typeof item === "object" ? (item as { ticker?: unknown }).ticker : null,
      );
      if (ticker && !clean.includes(ticker)) clean.push(ticker);
      if (clean.length >= MAX_TICKERS) break;
    }
    seen.add(id);
    const label = typeof name === "string" ? name.trim().slice(0, MAX_NAME_LENGTH) : "";
    // The original default list stored a hard-coded Turkish name; keep it localizable.
    lists.push({ id, name: id === DEFAULT_WATCHLIST_ID && label === "Favoriler" ? "" : label, tickers: clean });
  }
  return lists.length > 0 ? lists : null;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedLists: readonly Watchlist[] = DEFAULT_WATCHLISTS;
/** Session-only copy used when localStorage rejects writes (private mode, quota). */
let memoryLists: readonly Watchlist[] | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled (private mode, policy)
  }
}

function getSnapshot(): readonly Watchlist[] {
  if (memoryLists) return memoryLists;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    cachedLists = sanitize(parsed) ?? DEFAULT_WATCHLISTS;
  }
  return cachedLists;
}

function getServerSnapshot(): readonly Watchlist[] {
  return DEFAULT_WATCHLISTS;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function write(lists: readonly Watchlist[]) {
  const payload = lists.map((list) => ({ id: list.id, name: list.name, items: list.tickers.map((ticker) => ({ ticker })) }));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    memoryLists = null;
  } catch {
    // Storage unavailable: keep the change for this session only.
    memoryLists = lists;
  }
  listeners.forEach((listener) => listener());
}

function update(mutator: (lists: readonly Watchlist[]) => readonly Watchlist[]) {
  const next = mutator(getSnapshot());
  if (next !== getSnapshot()) write(next);
}

export interface WatchlistActions {
  createList: (name: string) => string | null;
  deleteList: (id: string) => void;
  addTicker: (listId: string, ticker: string) => "added" | "duplicate" | "invalid" | "full";
  removeTicker: (listId: string, ticker: string) => void;
}

const actions: WatchlistActions = {
  createList(name) {
    const label = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!label || getSnapshot().length >= MAX_LISTS) return null;
    const id = `list-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    update((lists) => [...lists, { id, name: label, tickers: [] }]);
    return id;
  },
  deleteList(id) {
    update((lists) => (lists.length <= 1 ? lists : lists.filter((list) => list.id !== id)));
  },
  addTicker(listId, value) {
    const ticker = normalizeTicker(value);
    if (!ticker) return "invalid";
    const list = getSnapshot().find((l) => l.id === listId);
    if (!list) return "invalid";
    if (list.tickers.includes(ticker)) return "duplicate";
    if (list.tickers.length >= MAX_TICKERS) return "full";
    update((lists) => lists.map((l) => (l.id === listId ? { ...l, tickers: [...l.tickers, ticker] } : l)));
    return "added";
  },
  removeTicker(listId, ticker) {
    update((lists) =>
      lists.map((l) => (l.id === listId ? { ...l, tickers: l.tickers.filter((t) => t !== ticker) } : l)),
    );
  },
};

export function useWatchlists(): { lists: readonly Watchlist[] } & WatchlistActions {
  const lists = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => ({ lists, ...actions }), [lists]);
}
