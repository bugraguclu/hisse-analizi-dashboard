"use client";

import { useCallback, useSyncExternalStore } from "react";
import { INDICATORS, sanitizeParams } from "./indicator-catalog";
import type { ChartType, IndicatorConfig, IndicatorKind, OverlayKey, PaneKey, PriceScaleKind } from "./types";

/** What a viewer set up on a chart; remembered per chart kind in localStorage. */
export interface ChartPrefs {
  type: ChartType;
  volume: boolean;
  indicators: IndicatorConfig[];
  scale: PriceScaleKind;
  /** Dividends, financial reports and key disclosures on the time axis. */
  events: boolean;
  /** High/low labels of the visible range. */
  extremes: boolean;
  /** Faint symbol name behind the series. */
  watermark: boolean;
  grid: boolean;
  /** Drawing tools snap to open/high/low/close. */
  magnet: boolean;
  drawingsHidden: boolean;
}

export const CHART_TYPES: readonly ChartType[] = ["area", "line", "baseline", "candles", "hollow", "heikin", "bars"];
const SCALES: readonly PriceScaleKind[] = ["normal", "log", "percent"];
/** More would crowd the legend and stack panes past any useful height. */
export const MAX_INDICATORS = 12;

const LEGACY_OVERLAYS: Record<OverlayKey, Omit<IndicatorConfig, "id">> = {
  ma20: { kind: "sma", params: { length: 20 }, color: 0 },
  ma50: { kind: "sma", params: { length: 50 }, color: 1 },
  ma200: { kind: "sma", params: { length: 200 }, color: 2 },
  bb: { kind: "bb", params: { length: 20, mult: 2 }, color: 3 },
};
const LEGACY_PANES: Record<PaneKey, Omit<IndicatorConfig, "id">> = {
  rsi: { kind: "rsi", params: { length: 14 }, color: 0 },
  macd: { kind: "macd", params: { fast: 12, slow: 26, signal: 9 }, color: 0 },
  stoch: { kind: "stoch", params: { k: 14, smoothK: 3, d: 3 }, color: 0 },
};

/** Short random suffix: instance ids only have to be unique within one chart. */
export function newIndicatorId(kind: IndicatorKind): string {
  return `${kind}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Stable ids for built-in presets (defaults, legacy migration) keep server and client renders equal. */
export function presetIndicator(kind: IndicatorKind, params: Record<string, number>, color: number): IndicatorConfig {
  const values = Object.values(params).join("-");
  return { id: values ? `${kind}-${values}` : kind, kind, params: sanitizeParams(kind, params), color };
}

function isKind(value: unknown): value is IndicatorKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INDICATORS, value);
}

function sanitizeIndicators(raw: unknown): IndicatorConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IndicatorConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Partial<IndicatorConfig>;
    if (!isKind(entry.kind)) continue;
    let id = typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 40 ? entry.id : newIndicatorId(entry.kind);
    if (seen.has(id)) id = newIndicatorId(entry.kind);
    seen.add(id);
    const color = typeof entry.color === "number" && Number.isInteger(entry.color) && entry.color >= 0 && entry.color <= 4 ? entry.color : 0;
    out.push({ id, kind: entry.kind, params: sanitizeParams(entry.kind, entry.params), color, ...(entry.hidden === true ? { hidden: true } : {}) });
    if (out.length >= MAX_INDICATORS) break;
  }
  return out;
}

/** Prefs v1 stored fixed overlay/pane toggles (`overlays: ["ma20"]`, `panes: ["rsi"]`). */
function migrateLegacy(parsed: Record<string, unknown>): IndicatorConfig[] | null {
  const overlays = Array.isArray(parsed.overlays) ? parsed.overlays : null;
  const panes = Array.isArray(parsed.panes) ? parsed.panes : null;
  if (!overlays && !panes) return null;
  const out: IndicatorConfig[] = [];
  for (const key of Object.keys(LEGACY_OVERLAYS) as OverlayKey[]) {
    if (overlays?.includes(key)) {
      const preset = LEGACY_OVERLAYS[key];
      out.push(presetIndicator(preset.kind, preset.params, preset.color));
    }
  }
  for (const key of Object.keys(LEGACY_PANES) as PaneKey[]) {
    if (panes?.includes(key)) {
      const preset = LEGACY_PANES[key];
      out.push(presetIndicator(preset.kind, preset.params, preset.color));
    }
  }
  return out;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizePrefs(raw: string | null, defaults: ChartPrefs): ChartPrefs {
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return defaults;
    const indicators = Array.isArray(parsed.indicators) ? sanitizeIndicators(parsed.indicators) : (migrateLegacy(parsed) ?? defaults.indicators);
    return {
      type: CHART_TYPES.includes(parsed.type as ChartType) ? (parsed.type as ChartType) : defaults.type,
      volume: bool(parsed.volume, defaults.volume),
      indicators,
      scale: SCALES.includes(parsed.scale as PriceScaleKind) ? (parsed.scale as PriceScaleKind) : defaults.scale,
      events: bool(parsed.events, defaults.events),
      extremes: bool(parsed.extremes, defaults.extremes),
      watermark: bool(parsed.watermark, defaults.watermark),
      grid: bool(parsed.grid, defaults.grid),
      magnet: bool(parsed.magnet, defaults.magnet),
      drawingsHidden: bool(parsed.drawingsHidden, defaults.drawingsHidden),
    };
  } catch {
    return defaults;
  }
}

const listeners = new Set<() => void>();
const snapshotCache = new Map<string, { raw: string | null; value: ChartPrefs }>();
/** Fallback when storage is blocked (private mode): the choice lasts for this page view. */
const memory = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** "hisse.chart.overview.v2" → "hisse.chart.overview.v1": the key prefs v1 lived under. */
function legacyKey(key: string): string | null {
  const match = /^(.*)\.v(\d+)$/.exec(key);
  if (!match) return null;
  const version = Number(match[2]);
  return version > 1 ? `${match[1]}.v${version - 1}` : null;
}

function readRaw(key: string): string | null {
  const stored = storageGet(key) ?? memory.get(key) ?? null;
  if (stored !== null) return stored;
  // First visit on this version: carry the viewer's v1 choices over.
  const legacy = legacyKey(key);
  return legacy ? storageGet(legacy) : null;
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
    const value = sanitizePrefs(raw, defaults);
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
