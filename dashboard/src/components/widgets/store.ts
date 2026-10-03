"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_TICKER } from "@/components/layout/nav";
import { isWidgetType } from "./catalog";
import { DEFAULT_LAYOUTS, type BuiltInPage } from "./defaults";
import { newId, normalizeTicker, sanitizeLayout, withFreshIds, type Layout } from "./model";

/**
 * Layouts persisted in localStorage (per browser), synced across tabs, with a
 * session-only fallback when storage rejects writes (private mode, quota) —
 * the same contract as the watchlists.
 *
 *   hisse.layouts.v1  { [builtInPage]: Layout }   customised site pages
 *   hisse.pages.v1    [{ id, name, ticker, layout }]   the visitor's own pages
 */

const LAYOUTS_KEY = "hisse.layouts.v1";
const PAGES_KEY = "hisse.pages.v1";
export const MAX_PAGES = 12;
const MAX_NAME_LENGTH = 60;

interface LocalStore<T> {
  get: () => T;
  getServer: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

function createLocalStore<T>(key: string, parse: (raw: unknown) => T, empty: T): LocalStore<T> {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached = empty;
  let memory: { value: T } | null = null;

  const readRaw = () => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  return {
    get() {
      if (memory) return memory.value;
      const raw = readRaw();
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        let parsed: unknown = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        cached = parse(parsed);
      }
      return cached;
    },
    getServer: () => empty,
    set(value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        memory = null;
      } catch {
        memory = { value };
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key || event.key === null) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Customised site pages
// ---------------------------------------------------------------------------

type Overrides = Partial<Record<BuiltInPage, Layout>>;

const EMPTY_OVERRIDES: Overrides = Object.freeze({});

function parseOverrides(raw: unknown): Overrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_OVERRIDES;
  const overrides: Overrides = {};
  for (const page of Object.keys(DEFAULT_LAYOUTS) as BuiltInPage[]) {
    const layout = sanitizeLayout((raw as Record<string, unknown>)[page], isWidgetType);
    if (layout) overrides[page] = layout;
  }
  return overrides;
}

const overridesStore = createLocalStore(LAYOUTS_KEY, parseOverrides, EMPTY_OVERRIDES);

export interface StoredLayout {
  layout: Layout;
  defaultLayout: Layout;
  customized: boolean;
  /** null restores the default. */
  save: (layout: Layout | null) => void;
}

/** A site page's layout: the visitor's version when they customised it, else the default. */
export function useStoredLayout(page: BuiltInPage): StoredLayout {
  const overrides = useSyncExternalStore(overridesStore.subscribe, overridesStore.get, overridesStore.getServer);
  const save = useCallback(
    (layout: Layout | null) => {
      const next: Overrides = { ...overridesStore.get() };
      if (layout) next[page] = layout;
      else delete next[page];
      overridesStore.set(next);
    },
    [page],
  );
  const override = overrides[page];
  return { layout: override ?? DEFAULT_LAYOUTS[page], defaultLayout: DEFAULT_LAYOUTS[page], customized: !!override, save };
}

// ---------------------------------------------------------------------------
// The visitor's own pages
// ---------------------------------------------------------------------------

export interface CustomPage {
  id: string;
  name: string;
  /** Stock the page's stock widgets follow (each may override it). */
  ticker: string;
  layout: Layout;
}

const EMPTY_PAGES: readonly CustomPage[] = Object.freeze([]);
const EMPTY_LAYOUT: Layout = Object.freeze({ rows: [] }) as Layout;

function parsePages(raw: unknown): readonly CustomPage[] {
  if (!Array.isArray(raw)) return EMPTY_PAGES;
  const pages: CustomPage[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (pages.length >= MAX_PAGES) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, name, ticker, layout } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    pages.push({
      id,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, MAX_NAME_LENGTH) : id,
      ticker: normalizeTicker(ticker) ?? DEFAULT_TICKER,
      layout: sanitizeLayout(layout, isWidgetType) ?? EMPTY_LAYOUT,
    });
  }
  return pages.length > 0 ? pages : EMPTY_PAGES;
}

const pagesStore = createLocalStore(PAGES_KEY, parsePages, EMPTY_PAGES);

function updatePages(mutate: (pages: readonly CustomPage[]) => readonly CustomPage[]) {
  const current = pagesStore.get();
  const next = mutate(current);
  if (next !== current) pagesStore.set(next);
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

export const pageActions = {
  /** New page from a layout (copied with fresh ids); null when the page limit is reached. */
  create(name: string, ticker: string, layout: Layout): string | null {
    if (pagesStore.get().length >= MAX_PAGES) return null;
    const id = newId("p");
    const page: CustomPage = { id, name: cleanName(name) || id, ticker: normalizeTicker(ticker) ?? DEFAULT_TICKER, layout: withFreshIds(layout) };
    updatePages((pages) => [...pages, page]);
    return id;
  },
  rename(id: string, name: string) {
    const label = cleanName(name);
    if (!label) return;
    updatePages((pages) => pages.map((page) => (page.id === id ? { ...page, name: label } : page)));
  },
  duplicate(id: string, name: string): string | null {
    const source = pagesStore.get().find((page) => page.id === id);
    return source ? pageActions.create(name, source.ticker, source.layout) : null;
  },
  remove(id: string) {
    updatePages((pages) => pages.filter((page) => page.id !== id));
  },
  /** Puts a removed page back where it was (undo). */
  restore(page: CustomPage, index: number) {
    updatePages((pages) => (pages.some((p) => p.id === page.id) ? pages : [...pages.slice(0, index), page, ...pages.slice(index)]));
  },
  setLayout(id: string, layout: Layout) {
    updatePages((pages) => pages.map((page) => (page.id === id ? { ...page, layout } : page)));
  },
  setTicker(id: string, ticker: string) {
    const symbol = normalizeTicker(ticker);
    if (!symbol) return;
    updatePages((pages) => pages.map((page) => (page.id === id ? { ...page, ticker: symbol } : page)));
  },
};

export function useCustomPages(): readonly CustomPage[] {
  return useSyncExternalStore(pagesStore.subscribe, pagesStore.get, pagesStore.getServer);
}

const noopSubscribe = () => () => {};

/** False during server rendering and hydration, true after: browser-only state is known. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
