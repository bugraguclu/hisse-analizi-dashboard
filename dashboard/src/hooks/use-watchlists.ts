"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  IdempotentRequestTracker,
  createUndoReceipt,
  evaluateUndo,
  type UndoReceipt,
} from "@/lib/reliable-mutations";

/**
 * Watchlists persisted in localStorage (per browser), synced across tabs.
 * Storage format stays backward-compatible with the original dashboard:
 *   [{ id, name, rev?, items: [{ ticker }] }]
 */

export interface Watchlist {
  id: string;
  /** Empty for the built-in default list (rendered as the localized "Favorites"). */
  name: string;
  tickers: string[];
  /** Monotonic per-list revision used by conflict-checked undo. */
  rev: number;
}

export type WatchlistUndoSnapshot =
  | { readonly kind: "remove_ticker"; readonly listId: string; readonly tickers: readonly string[] }
  | { readonly kind: "delete_list"; readonly index: number; readonly list: Watchlist; readonly remainingIds: readonly string[] };

export type WatchlistUndoReceipt = UndoReceipt<WatchlistUndoSnapshot>;

export type WatchlistUndoOutcome = "undone" | "conflict" | "expired";

export const DEFAULT_WATCHLIST_ID = "favorites";
const LOCAL_OWNER_ID = "local";
const STORAGE_KEY = "watchlists";
/** Same rule as the backend's normalize_symbol: one invalid symbol makes /market/snapshot reject the whole list. */
const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const MAX_LISTS = 12;
const MAX_TICKERS = 40;
const MAX_NAME_LENGTH = 40;

const DEFAULT_WATCHLISTS: readonly Watchlist[] = Object.freeze([
  { id: DEFAULT_WATCHLIST_ID, name: "", tickers: ["THYAO", "GARAN", "SISE", "ASELS", "EREGL"], rev: 1 },
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
    const { id, name, items, tickers, rev } = entry as Record<string, unknown>;
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
    const parsedRev = typeof rev === "number" && Number.isInteger(rev) && rev >= 1 ? rev : 1;
    // The original default list stored a hard-coded Turkish name; keep it localizable.
    lists.push({ id, name: id === DEFAULT_WATCHLIST_ID && label === "Favoriler" ? "" : label, tickers: clean, rev: parsedRev });
  }
  return lists.length > 0 ? lists : null;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedLists: readonly Watchlist[] = DEFAULT_WATCHLISTS;
/** Session-only copy used when localStorage rejects writes (private mode, quota). */
let memoryLists: readonly Watchlist[] | null = null;

const createTracker = new IdempotentRequestTracker<string | null>();
const addTickerTracker = new IdempotentRequestTracker<"added" | "duplicate" | "invalid" | "full">();

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
  const payload = lists.map((list) => ({
    id: list.id,
    name: list.name,
    rev: list.rev,
    items: list.tickers.map((ticker) => ({ ticker })),
  }));
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
  const current = getSnapshot();
  const next = mutator(current);
  if (next !== current) write(next);
}

function collectionRevision(lists: readonly Watchlist[]): number {
  return lists.reduce((sum, list) => sum + list.rev, lists.length * 1000);
}

function nextReceiptId(): string {
  return `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface WatchlistActions {
  createList: (name: string, requestId?: string) => string | null;
  deleteList: (id: string) => WatchlistUndoReceipt | null;
  addTicker: (listId: string, ticker: string, requestId?: string) => "added" | "duplicate" | "invalid" | "full";
  removeTicker: (listId: string, ticker: string) => WatchlistUndoReceipt | null;
  undoChange: (receipt: WatchlistUndoReceipt) => WatchlistUndoOutcome;
}

const actions: WatchlistActions = {
  createList(name, requestId) {
    const label = name.trim().slice(0, MAX_NAME_LENGTH);
    const { result } = createTracker.run(requestId, { action: "createList", label }, () => {
      if (!label || getSnapshot().length >= MAX_LISTS) return null;
      const id = `list-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      update((lists) => [...lists, { id, name: label, tickers: [], rev: 1 }]);
      return id;
    });
    return result;
  },
  deleteList(id) {
    const before = getSnapshot();
    if (before.length <= 1) return null;
    const index = before.findIndex((list) => list.id === id);
    if (index < 0) return null;
    const target = before[index];
    const next = before.filter((list) => list.id !== id);
    write(next);
    return createUndoReceipt<WatchlistUndoSnapshot>({
      id: nextReceiptId(),
      ownerId: LOCAL_OWNER_ID,
      entityId: id,
      beforeRevision: collectionRevision(before),
      afterRevision: collectionRevision(next),
      beforeSnapshot: { kind: "delete_list", index, list: { ...target, tickers: [...target.tickers] }, remainingIds: before.map((l) => l.id) },
      afterSnapshot: { kind: "delete_list", index, list: { ...target, tickers: [...target.tickers] }, remainingIds: next.map((l) => l.id) },
    });
  },
  addTicker(listId, value, requestId) {
    const ticker = normalizeTicker(value);
    const { result } = addTickerTracker.run(requestId, { action: "addTicker", listId, ticker: ticker ?? value }, () => {
      if (!ticker) return "invalid";
      const list = getSnapshot().find((l) => l.id === listId);
      if (!list) return "invalid";
      if (list.tickers.includes(ticker)) return "duplicate";
      if (list.tickers.length >= MAX_TICKERS) return "full";
      update((lists) =>
        lists.map((l) => (l.id === listId ? { ...l, tickers: [...l.tickers, ticker], rev: l.rev + 1 } : l)),
      );
      return "added";
    });
    return result;
  },
  removeTicker(listId, ticker) {
    const beforeLists = getSnapshot();
    const target = beforeLists.find((l) => l.id === listId);
    if (!target || !target.tickers.includes(ticker)) return null;
    const afterTickers = target.tickers.filter((t) => t !== ticker);
    const afterRev = target.rev + 1;
    write(
      beforeLists.map((l) => (l.id === listId ? { ...l, tickers: afterTickers, rev: afterRev } : l)),
    );
    return createUndoReceipt<WatchlistUndoSnapshot>({
      id: nextReceiptId(),
      ownerId: LOCAL_OWNER_ID,
      entityId: listId,
      beforeRevision: target.rev,
      afterRevision: afterRev,
      beforeSnapshot: { kind: "remove_ticker", listId, tickers: [...target.tickers] },
      afterSnapshot: { kind: "remove_ticker", listId, tickers: afterTickers },
    });
  },
  undoChange(receipt) {
    const currentLists = getSnapshot();
    if (receipt.beforeSnapshot.kind === "remove_ticker") {
      const current = currentLists.find((l) => l.id === receipt.entityId) ?? null;
      const decision = evaluateUndo<WatchlistUndoSnapshot>({
        receipt,
        activeOwnerId: LOCAL_OWNER_ID,
        currentRevision: current?.rev ?? null,
        currentSnapshot: current ? { kind: "remove_ticker", listId: current.id, tickers: current.tickers } : null,
      });
      if (!decision.ok) return decision.reason === "expired" ? "expired" : "conflict";
      if (decision.restoreSnapshot.kind !== "remove_ticker") return "conflict";
      const restoredTickers = [...decision.restoreSnapshot.tickers];
      write(
        currentLists.map((l) => (l.id === receipt.entityId ? { ...l, tickers: restoredTickers, rev: l.rev + 1 } : l)),
      );
      return "undone";
    }

    const decision = evaluateUndo<WatchlistUndoSnapshot>({
      receipt,
      activeOwnerId: LOCAL_OWNER_ID,
      currentRevision: collectionRevision(currentLists),
      currentSnapshot: {
        kind: "delete_list",
        index: receipt.afterSnapshot.kind === "delete_list" ? receipt.afterSnapshot.index : 0,
        list: receipt.afterSnapshot.kind === "delete_list" ? receipt.afterSnapshot.list : currentLists[0],
        remainingIds: currentLists.map((l) => l.id),
      },
    });
    if (!decision.ok) return decision.reason === "expired" ? "expired" : "conflict";
    if (decision.restoreSnapshot.kind !== "delete_list") return "conflict";
    const { index, list } = decision.restoreSnapshot;
    if (currentLists.some((entry) => entry.id === list.id) || currentLists.length >= MAX_LISTS) return "conflict";
    const clampedIndex = Math.max(0, Math.min(index, currentLists.length));
    const next = [...currentLists];
    next.splice(clampedIndex, 0, { ...list, tickers: [...list.tickers], rev: list.rev + 1 });
    write(next);
    return "undone";
  },
};

export function useWatchlists(): { lists: readonly Watchlist[] } & WatchlistActions {
  const lists = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => ({ lists, ...actions }), [lists]);
}
