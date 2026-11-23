"use client";

import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Hourglass, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { atlasHref, searchAtlasConcepts } from "@/lib/atlas";
import { searchDiscovery } from "@/lib/discovery";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DEFAULT_TICKER, tickerFromPath, tickerHref } from "@/components/layout/nav";
import { useOptionalShell } from "@/components/layout/shell-context";
import { useAssistantStatus } from "@/components/assistant/client";
import {
  getQuickAccessItems,
  searchUnified,
  stockToUnifiedItem,
  type SearchResultKind,
  type UnifiedSearchItem,
} from "./search/catalog";
import { buildTickerIndex, mostTraded, searchTickers, type TickerOption } from "./search/ticker-index";
import { useDismissOnLeave } from "./search/use-dismiss";
import { useListNav } from "./search/use-list-nav";
import { useShortcutLabel } from "./search/use-search-hotkey";

const SERVER_MIN_LENGTH = 2;
const DEBOUNCE_MS = 250;
const LIVE_ANNOUNCE_DEBOUNCE_MS = 250;
const MAX_RESULTS = 12;
const MAX_STOCK_ONLY_RESULTS = 8;
const MAX_DISCOVERY_RESULTS = 4;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

type SearchKind = SearchResultKind | "index" | "sector" | "assistant";
/** Typed text this long (and not a bare ticker) also offers "Ask the assistant". */
const ASSISTANT_MIN_LENGTH = 4;

interface SearchRow {
  readonly id: string;
  readonly kind: SearchKind;
  readonly code: string;
  readonly title: string;
  readonly subtitle: string;
  readonly href: string;
  readonly ticker?: string;
}

const KIND_LABEL: Record<SearchKind, TranslationKey> = {
  stock: "search.kind.stock",
  tool: "search.kind.tool",
  screen: "search.kind.screen",
  concept: "search.kind.concept",
  index: "search.kind.index",
  sector: "search.kind.sector",
  assistant: "search.kind.assistant",
};

export interface TickerSearchHandle {
  /** Focuses the field and opens its list; false when the field is not on screen. */
  activate: () => boolean;
}

/**
 * Unified local search (stocks, indicators, macro sections, screener presets and
 * concept guides), built on the belif site search + TusAnkiM quick-search model:
 *
 * - Matches locally against the BIST universe and the curated tool/guide catalog
 *   on every keystroke; exact ticker matches always rank first, and upstream symbol
 *   search is only a fallback when no stock matched locally.
 * - When `onSelect` is supplied (or `scope="stocks"`), restricts results to BIST
 *   stocks so pickers like WatchlistCard only receive tickers.
 * - Tab / Shift+Tab and arrows walk rows while focus stays in the input.
 * - Opening the empty field lists the most traded stocks and (in unified mode)
 *   quick-access shortcuts to popular screens and guides.
 */
export function TickerSearch({
  ref,
  onSelect,
  onClose,
  scope,
  variant = "inline",
  autoFocus = false,
  shortcutHint = false,
  className,
}: {
  ref?: Ref<TickerSearchHandle>;
  /** Custom ticker selection handler; implies stock-only search unless `scope` overrides it. */
  onSelect?: (ticker: string) => void;
  /** Overlay variant: closes the sheet (✕, Escape, a pick). */
  onClose?: () => void;
  /** `"all"` searches stocks, tools, screens and guides; `"stocks"` searches tickers only. */
  scope?: "all" | "stocks";
  variant?: "inline" | "overlay";
  autoFocus?: boolean;
  /** Show the ⌘K badge — for the field the site-wide shortcut focuses. */
  shortcutHint?: boolean;
  className?: string;
}) {
  const effectiveScope = scope ?? (onSelect ? "stocks" : "all");
  const unified = effectiveScope === "all";
  const overlay = variant === "overlay";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [indexWanted, setIndexWanted] = useState(overlay || autoFocus);
  const [debounced, setDebounced] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const headingId = `${baseId}-heading`;
  const router = useRouter();
  const pathname = usePathname();
  const { locale, t } = useLocale();
  const shortcut = useShortcutLabel();
  const activeTicker = tickerFromPath(pathname) ?? DEFAULT_TICKER;

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const panelOpen = overlay || open;

  const indexQ = useQuery({
    queryKey: ["market-companies-all"],
    queryFn: ({ signal }) => api.allCompanies(signal),
    select: buildTickerIndex,
    staleTime: STALE_TIME.reference,
    enabled: indexWanted,
  });
  const index = indexQ.data;
  const indexReady = !!index && index.length > 0;
  const indexFailed = indexQ.isError || (indexQ.isSuccess && !indexReady);

  // Same query key as the home page's movers, so it is usually already cached.
  const popularQ = useQuery({
    queryKey: ["screener", "dashboard-default"],
    queryFn: ({ signal }) => api.screener(undefined, signal),
    staleTime: STALE_TIME.market,
    enabled: panelOpen && !hasQuery,
  });
  const popularStocks = useMemo(
    () => mostTraded(popularQ.data?.results, unified ? 4 : 5).map((item) => stockToUnifiedItem(item, pathname)),
    [popularQ.data, pathname, unified],
  );
  const quickAccess = useMemo(
    () => (unified ? getQuickAccessItems(locale, activeTicker) : []),
    [unified, locale, activeTicker],
  );

  const localStocks = useMemo<TickerOption[]>(
    () => (index && hasQuery ? searchTickers(index, trimmed, MAX_STOCK_ONLY_RESULTS) : []),
    [index, hasQuery, trimmed],
  );

  const localUnified = useMemo<UnifiedSearchItem[]>(() => {
    if (!hasQuery) return [];
    if (!unified) return localStocks.map((item) => stockToUnifiedItem(item, pathname));
    return searchUnified({
      query: trimmed,
      locale,
      stocks: index ?? [],
      pathname,
      activeTicker,
      limit: MAX_RESULTS,
    });
  }, [hasQuery, unified, localStocks, pathname, trimmed, locale, index, activeTicker]);

  // Only query upstream symbol search when no local stock matched (even if tools/guides matched,
  // unless the query already has non-ASCII words unlikely to be a ticker).
  const needServer = trimmed.length >= SERVER_MIN_LENGTH && localStocks.length === 0 && (indexFailed || indexReady);
  useEffect(() => {
    if (!needServer) return;
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [needServer, trimmed]);
  const serverCurrent = needServer && debounced === trimmed;

  const serverQ = useQuery({
    queryKey: ["symbol-search", debounced.toLocaleUpperCase("tr-TR")],
    queryFn: ({ signal }) => api.search(debounced, signal),
    enabled: serverCurrent,
    staleTime: STALE_TIME.reference,
    retry: 1,
  });

  const serverItems = useMemo<UnifiedSearchItem[]>(() => {
    const names = new Map((index ?? []).map((entry) => [entry.ticker, entry.name]));
    const seen = new Set<string>();
    const list: UnifiedSearchItem[] = [];
    for (const r of serverQ.data?.results ?? []) {
      const ticker = (r.symbol || r.ticker || "").toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      list.push(stockToUnifiedItem({ ticker, name: names.get(ticker) ?? r.name ?? r.description ?? "" }, pathname));
      if (list.length >= MAX_STOCK_ONLY_RESULTS) break;
    }
    return list;
  }, [serverQ.data, index, pathname]);

  const exploreRows = useMemo<SearchRow[]>(() => {
    if (!unified || !hasQuery) return [];
    const concepts: SearchRow[] = searchAtlasConcepts(trimmed, locale, 3).map((concept) => ({
      id: `atlas:${concept.slug}`,
      kind: "concept",
      code: concept.badge,
      title: concept.title[locale],
      subtitle: concept.cardDesc[locale],
      href: atlasHref(concept.slug),
    }));
    const discovery: SearchRow[] = searchDiscovery(trimmed, locale, 3).map((hit) => ({
      id: hit.id,
      kind: hit.kind,
      code: hit.badge,
      title: hit.label,
      subtitle: hit.subtitle,
      href: hit.href,
    }));
    return [...concepts, ...discovery].slice(0, MAX_DISCOVERY_RESULTS);
  }, [hasQuery, unified, locale, trimmed]);

  let settled: boolean;
  if (!hasQuery || localStocks.length > 0 || exploreRows.length > 0) settled = true;
  else if (needServer) settled = serverCurrent && !serverQ.isFetching;
  else settled = indexReady || indexFailed;
  const pending = hasQuery && !settled && localUnified.length === 0 && exploreRows.length === 0;

  const results = useMemo<SearchRow[]>(() => {
    if (!hasQuery) return [];
    if (!unified) return localUnified.length > 0 ? localUnified : serverCurrent ? serverItems : [];
    const seenIds = new Set<string>();
    const seenConceptCodes = new Set<string>();
    const merged: SearchRow[] = [];
    const append = (item: SearchRow) => {
      if (seenIds.has(item.id)) return;
      if (item.kind === "concept") {
        const key = item.code.trim().toLowerCase();
        if (seenConceptCodes.has(key)) return;
        seenConceptCodes.add(key);
      }
      seenIds.add(item.id);
      merged.push(item);
    };
    for (const item of localUnified) append(item);
    if (serverCurrent) {
      for (const item of serverItems) append(item);
    }
    const primaryCount = merged.length;
    for (const item of exploreRows) append(item);
    // Reserve room for index/sector/Atlas rows: a common word like "enerji" or "banka" matches
    // a dozen company names and would otherwise push the matching sector page out of the list.
    const explore = merged.slice(primaryCount);
    const primary = merged.slice(0, Math.min(primaryCount, Math.max(0, MAX_RESULTS - explore.length)));
    return [...primary, ...explore];
  }, [hasQuery, unified, localUnified, serverCurrent, serverItems, exploreRows]);

  // Free text in the site search can go to the AI assistant (last row, once results settled).
  const shell = useOptionalShell();
  const assistantEnabled = useAssistantStatus().data?.enabled === true;
  const assistantRow: SearchRow | null =
    unified && shell && assistantEnabled && settled && trimmed.length >= ASSISTANT_MIN_LENGTH && !TICKER_RE.test(trimmed.toUpperCase())
      ? {
          id: "assistant:ask",
          kind: "assistant",
          code: "AI",
          title: t("assistant.searchAsk", { q: trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed }),
          subtitle: t("assistant.searchAskHint"),
          href: "",
        }
      : null;
  const rows: SearchRow[] = hasQuery ? (assistantRow ? [...results, assistantRow] : results) : [...popularStocks, ...quickAccess];
  const hasMixedKinds = unified && rows.some((row) => row.kind !== "stock");
  const showRows = panelOpen && rows.length > 0;
  const showStatus = panelOpen && hasQuery && rows.length === 0;

  const nav = useListNav({
    count: showRows ? rows.length : 0,
    listKey: `${trimmed}|${rows.map((row) => row.id).join(",")}`,
    idPrefix: baseId,
    // The sheet was opened on purpose, so Tab stays in it. The inline field hands
    // Tab back to the page until something is typed: tabbing past the header must
    // not get stuck in the default list.
    tabWalks: overlay || hasQuery,
  });

  const handleBlur = useDismissOnLeave({
    open: !overlay && open,
    boxRef: containerRef,
    inputRef,
    onDismiss: () => setOpen(false),
  });

  useImperativeHandle(
    ref,
    () => ({
      activate() {
        const input = inputRef.current;
        if (!input || input.getClientRects().length === 0) return false;
        input.focus();
        input.select();
        setIndexWanted(true);
        setOpen(true);
        return true;
      },
    }),
    [],
  );

  function choose(item: SearchRow) {
    setQuery("");
    setOpen(false);
    if (overlay) onClose?.();
    else inputRef.current?.blur();

    if (item.kind === "assistant") {
      shell?.openAssistant(trimmed);
      return;
    }
    if (item.kind === "stock") {
      // Tickers are ASCII: a Turkish-locale uppercase would turn "sise" into "SİSE".
      const symbol = (item.ticker ?? item.code).trim().toUpperCase();
      if (onSelect) onSelect(symbol);
      else router.push(tickerHref(pathname, symbol));
      return;
    }
    router.push(item.href);
  }

  function chooseTickerFallback(rawTicker: string) {
    // Tickers are ASCII: a Turkish-locale uppercase would turn "sise" into "SİSE".
    const symbol = rawTicker.trim().toUpperCase();
    setQuery("");
    setOpen(false);
    if (overlay) onClose?.();
    else inputRef.current?.blur();
    if (onSelect) onSelect(symbol);
    else router.push(tickerHref(pathname, symbol));
  }

  function openList() {
    setIndexWanted(true);
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (nav.onKeyDown(event)) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!panelOpen) {
          event.preventDefault();
          openList();
        }
        break;
      case "Enter": {
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (nav.active >= 0) {
          choose(rows[nav.active]);
        } else if (!hasQuery) {
          // Nothing marked and nothing typed: nothing to take.
        } else if (rows.length > 0) {
          choose(rows[0]);
        } else if (!settled) {
          // Typed a full ticker faster than the list answered — go straight to it.
          const candidate = trimmed.toUpperCase();
          if (TICKER_RE.test(candidate)) chooseTickerFallback(candidate);
        }
        break;
      }
      case "Escape":
        // The sheet handles Escape itself (it closes from the ✕ too).
        if (overlay) break;
        if (showRows || showStatus) {
          event.preventDefault();
          setOpen(false);
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
        break;
      case "Tab":
        if (!overlay) setOpen(false);
        break;
    }
  }

  function clear() {
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  let status = "";
  if (showStatus) {
    if (pending) status = t("common.searching");
    else if (!unified && indexFailed && (!needServer || serverQ.isError)) status = t("search.unavailable");
    else status = t("search.noResultsFor", { q: trimmed });
  }

  // Announce only settled result counts / empty outcomes, debounced so rapid typing
  // never spams assistive technology (transient loading stays on aria-busy).
  const candidateAnnouncement =
    !panelOpen || !hasQuery || pending
      ? ""
      : showRows
        ? t("search.resultCount", { count: rows.length })
        : status;

  useEffect(() => {
    if (!candidateAnnouncement) {
      const clearTimer = setTimeout(() => setLiveMessage(""), 0);
      return () => clearTimeout(clearTimer);
    }
    const timer = setTimeout(() => setLiveMessage(candidateAnnouncement), LIVE_ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [candidateAnnouncement]);

  const inputLabel = unified ? t("search.allLabel") : t("search.label");
  const inputPlaceholder = unified ? t("search.allPlaceholder") : t("search.placeholder");
  const listLabelProps = hasQuery ? { "aria-label": inputLabel } : { "aria-labelledby": headingId };
  const quickAccessStart = popularStocks.length;

  return (
    <div ref={containerRef} className={cn("relative", className)} onBlur={overlay ? undefined : handleBlur}>
      <div className="relative" data-keyboard-field="">
        <Search
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground",
            overlay ? "left-3.5 h-4 w-4" : "left-2.5 h-3.5 w-3.5",
          )}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            openList();
          }}
          onFocus={() => {
            setIndexWanted(true);
            if (query.trim()) setOpen(true);
          }}
          // A click opens the empty field's list, and a tap on the field that is already
          // focused brings a closed list back: no focus event fires then (belif f6e3bce).
          onClick={openList}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          aria-label={inputLabel}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showRows}
          aria-busy={pending}
          aria-controls={listboxId}
          aria-activedescendant={nav.active >= 0 ? nav.optionId(nav.active) : undefined}
          aria-keyshortcuts={shortcutHint ? "Meta+K Control+K" : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize={unified ? "none" : "characters"}
          spellCheck={false}
          enterKeyHint="search"
          maxLength={60}
          className={cn(
            "w-full min-w-0 rounded-md border border-input bg-card text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground",
            // One focus signal for pointer and keyboard alike: the border takes the focus
            // colour. No ring — a text field matches :focus-visible on a click too.
            "focus:border-ring",
            overlay ? "h-11 pl-10 pr-12" : cn("h-8 pl-8 pr-8 md:text-[13px]", shortcutHint && "lg:pr-14"),
          )}
        />
        {overlay ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("shell.closeSearch")}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : pending ? (
          <Hourglass
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground skeleton-pulse"
          />
        ) : query ? (
          <button
            type="button"
            onClick={clear}
            aria-label={t("search.clear")}
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground after:absolute after:-inset-2.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : shortcutHint && shortcut ? (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 hidden h-[18px] -translate-y-1/2 items-center rounded-sm border border-border px-1.5 font-mono text-[10px] text-muted-foreground lg:flex"
          >
            {shortcut}
          </kbd>
        ) : null}
      </div>

      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </span>

      {(showRows || showStatus) && (
        <div
          className={cn(
            "overflow-hidden border border-border bg-popover text-popover-foreground",
            overlay
              ? "mt-2 rounded-md"
              : "absolute right-0 top-full z-50 mt-1 w-full min-w-80 rounded-lg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]",
          )}
        >
          {showRows ? (
            <>
              {!hasQuery && (
                <div id={headingId} className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {popularStocks.length > 0 ? t("search.mostTraded") : t("search.quickAccess")}
                </div>
              )}
              <ul
                id={listboxId}
                role="listbox"
                data-search-listbox=""
                {...listLabelProps}
                className={cn("overflow-y-auto overflow-x-hidden overscroll-contain py-1", overlay ? "max-h-[55vh]" : "max-h-96")}
              >
                {rows.map((item, i) => {
                  const showQuickDivider = !hasQuery && unified && popularStocks.length > 0 && i === quickAccessStart;
                  const isStock = item.kind === "stock";
                  return (
                    <li
                      key={item.id}
                      id={nav.optionId(i)}
                      role="option"
                      aria-selected={i === nav.active}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseMove={() => i !== nav.active && nav.setActive(i)}
                      onClick={() => choose(item)}
                      className={cn(
                        "cursor-pointer px-3 py-2.5 text-sm md:py-2",
                        showQuickDivider && "mt-1 border-t border-border pt-2.5",
                        i === nav.active && "bg-accent",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "w-16 shrink-0 truncate font-mono text-[11px] font-semibold",
                            isStock ? "text-foreground" : "text-primary",
                          )}
                        >
                          {item.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          {isStock ? (
                            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                          ) : (
                            <>
                              <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span>
                            </>
                          )}
                        </span>
                        {hasMixedKinds && (
                          <span className="shrink-0 rounded-sm border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {t(KIND_LABEL[item.kind])}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">{status}</p>
          )}
        </div>
      )}
    </div>
  );
}
