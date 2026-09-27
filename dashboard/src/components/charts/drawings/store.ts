"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MAX_DRAWINGS, sanitizeDrawings } from "./model";
import type { Drawing } from "./types";

/**
 * Drawings per symbol in localStorage (a per-viewer convenience, like the
 * chart prefs). Every chart instance of a symbol — the card and its
 * full-screen twin — reads the same entry and re-renders on every write;
 * other tabs follow through the `storage` event.
 */

const KEY_PREFIX = "hisse.chart.drawings.v1:";
const STORE_VERSION = 1;

/** Shared empty snapshot: server render, hydration and "no drawings" keep one reference. */
const EMPTY = Object.freeze([]) as unknown as Drawing[];

const listeners = new Set<() => void>();
const snapshotCache = new Map<string, { raw: string | null; value: Drawing[] }>();
/**
 * Writes the browser refused (private mode, quota): they win over storage until
 * a later write succeeds or another tab changes the entry. `null` = removed.
 */
const memory = new Map<string, string | null>();

function storageKey(symbol: string): string {
  return KEY_PREFIX + symbol.trim().toUpperCase();
}

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, raw: string | null) {
  try {
    if (raw === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, raw);
    memory.delete(key);
  } catch {
    memory.set(key, raw);
  }
}

function parse(raw: string | null): Drawing[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== STORE_VERSION) return EMPTY;
    const items = sanitizeDrawings((parsed as { items?: unknown }).items);
    return items.length > 0 ? items : EMPTY;
  } catch {
    return EMPTY;
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // key === null: another tab cleared the whole storage.
    if (event.key !== null && !event.key.startsWith(KEY_PREFIX)) return;
    if (event.key === null) memory.clear();
    else memory.delete(event.key);
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => EMPTY;

/**
 * The drawings of `symbol` and a setter. Reads are sanitized (malformed items
 * dropped, newest `MAX_DRAWINGS` kept) and referentially stable until the
 * stored value changes; server render and hydration see no drawings.
 */
export function useDrawings(symbol: string): [Drawing[], (next: Drawing[]) => void] {
  const key = storageKey(symbol);
  const getSnapshot = useCallback(() => {
    const raw = readRaw(key);
    const cached = snapshotCache.get(key);
    if (cached && cached.raw === raw) return cached.value;
    const value = parse(raw);
    snapshotCache.set(key, { raw, value });
    return value;
  }, [key]);
  const drawings = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const setDrawings = useCallback(
    (next: Drawing[]) => {
      const items = next.length > MAX_DRAWINGS ? next.slice(next.length - MAX_DRAWINGS) : next;
      writeRaw(key, items.length > 0 ? JSON.stringify({ v: STORE_VERSION, items }) : null);
      notify();
    },
    [key],
  );
  return [drawings, setDrawings];
}

let idCounter = 0;

/** Short unique id for a new drawing (time + counter + random; unique within a symbol's list). */
export function newDrawingId(): string {
  idCounter = (idCounter + 1) % 1296;
  const random = Math.floor(Math.random() * 1296);
  return `d${Date.now().toString(36)}${idCounter.toString(36).padStart(2, "0")}${random.toString(36).padStart(2, "0")}`;
}
