"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ChartType, OverlayKey, PaneKey } from "./types";

/** What a viewer toggled on a chart; remembered per chart kind in localStorage. */
export interface ChartPrefs {
  type: ChartType;
  volume: boolean;
  overlays: OverlayKey[];
  panes: PaneKey[];
}

const CHART_TYPES: readonly ChartType[] = ["area", "line", "candles"];
const OVERLAYS: readonly OverlayKey[] = ["ma20", "ma50", "ma200", "bb"];
const PANES: readonly PaneKey[] = ["rsi", "macd", "stoch"];

const listeners = new Set<() => void>();
const snapshotCache = new Map<string, { raw: string | null; value: ChartPrefs }>();
/** Fallback when storage is blocked (private mode): the choice lasts for this page view. */
const memory = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored;
  } catch {
    // Storage unavailable — fall through to the in-memory copy.
  }
  return memory.get(key) ?? null;
}

function sanitize(raw: string | null, defaults: ChartPrefs): ChartPrefs {
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<ChartPrefs>;
    return {
      type: CHART_TYPES.includes(parsed.type as ChartType) ? (parsed.type as ChartType) : defaults.type,
      volume: typeof parsed.volume === "boolean" ? parsed.volume : defaults.volume,
      overlays: Array.isArray(parsed.overlays) ? OVERLAYS.filter((key) => parsed.overlays?.includes(key)) : defaults.overlays,
      panes: Array.isArray(parsed.panes) ? PANES.filter((key) => parsed.panes?.includes(key)) : defaults.panes,
    };
  } catch {
    return defaults;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Chart preferences backed by localStorage (per-viewer convenience only). Server
 * render and hydration use `defaults`; stored values apply right after mount.
 * `defaults` must be a stable (module-level) object.
 */
export function useChartPrefs(storageKey: string, defaults: ChartPrefs): [ChartPrefs, (next: ChartPrefs) => void] {
  const getSnapshot = useCallback(() => {
    const raw = readRaw(storageKey);
    const cached = snapshotCache.get(storageKey);
    if (cached && cached.raw === raw) return cached.value;
    const value = sanitize(raw, defaults);
    snapshotCache.set(storageKey, { raw, value });
    return value;
  }, [storageKey, defaults]);
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => defaults);
  const setPrefs = useCallback(
    (next: ChartPrefs) => {
      const raw = JSON.stringify(next);
      memory.set(storageKey, raw);
      try {
        window.localStorage.setItem(storageKey, raw);
      } catch {
        // Private mode / blocked storage: the in-memory copy is used instead.
      }
      listeners.forEach((listener) => listener());
    },
    [storageKey],
  );
  return [prefs, setPrefs];
}
