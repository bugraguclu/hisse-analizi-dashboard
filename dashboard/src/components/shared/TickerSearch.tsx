"use client";

import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { tickerHref } from "@/components/layout/nav";
import { buildTickerIndex, mostTraded, searchTickers, type TickerOption } from "./search/ticker-index";
import { useDismissOnLeave } from "./search/use-dismiss";
import { useListNav } from "./search/use-list-nav";
import { useShortcutLabel } from "./search/use-search-hotkey";

const SERVER_MIN_LENGTH = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

export interface TickerSearchHandle {
  /** Focuses the field and opens its list; false when the field is not on screen. */
  activate: () => boolean;
}

/**
 * Stock search, built on the belif site search's mechanics:
 *
 * - Matches locally against the BIST universe (fetched once, on first focus), so
 *   results follow every keystroke; the upstream symbol search is only a fallback
 *   for when the list is unavailable or has nothing.
 * - Tab / Shift+Tab and the arrows walk the rows while focus stays in the field
 *   (see useListNav); Enter takes the marked row, or the first one.
 * - Opening the empty field (click, ⌘K, ↓) lists the most traded stocks.
 *
 * `inline` is a field with a dropdown: Escape closes the list, then clears; the ✕
 * clears. `overlay` is the body of the small-screen search sheet: the list is
 * always there, Tab never leaves it, and the ✕ and Escape close the sheet.
 */
export function TickerSearch({
  ref,
  onSelect,
  onClose,
  variant = "inline",
  autoFocus = false,
  shortcutHint = false,
  className,
}: {
  ref?: Ref<TickerSearchHandle>;
  /** Custom selection handler; defaults to navigating (see tickerHref). */
  onSelect?: (ticker: string) => void;
  /** Overlay variant: closes the sheet (✕, Escape, a pick). */
  onClose?: () => void;
  variant?: "inline" | "overlay";
  autoFocus?: boolean;
  /** Show the ⌘K badge — for the field the site-wide shortcut focuses. */
  shortcutHint?: boolean;
  className?: string;
}) {
  const overlay = variant === "overlay";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [indexWanted, setIndexWanted] = useState(overlay || autoFocus);
  const [debounced, setDebounced] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const headingId = `${baseId}-heading`;
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();
  const shortcut = useShortcutLabel();

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
  const popular = useMemo(() => mostTraded(popularQ.data?.results), [popularQ.data]);

  const local = useMemo(() => (index && hasQuery ? searchTickers(index, trimmed, MAX_RESULTS) : []), [index, hasQuery, trimmed]);

  const needServer = trimmed.length >= SERVER_MIN_LENGTH && local.length === 0 && (indexFailed || indexReady);
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

  const serverOptions = useMemo<TickerOption[]>(() => {
    const names = new Map((index ?? []).map((entry) => [entry.ticker, entry.name]));
    const seen = new Set<string>();
    const list: TickerOption[] = [];
    for (const r of serverQ.data?.results ?? []) {
      const ticker = (r.symbol || r.ticker || "").toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      list.push({ ticker, name: names.get(ticker) ?? r.name ?? r.description ?? "" });
      if (list.length >= MAX_RESULTS) break;
    }
    return list;
  }, [serverQ.data, index]);

  let settled: boolean;
  if (!hasQuery || local.length > 0) settled = true;
  else if (needServer) settled = serverCurrent && !serverQ.isFetching;
  else settled = indexReady || indexFailed;
  const pending = hasQuery && !settled;

  const results = local.length > 0 ? local : serverCurrent ? serverOptions : [];
  const rows: TickerOption[] = hasQuery ? results : popular;
  const showRows = panelOpen && rows.length > 0;
  const showStatus = panelOpen && hasQuery && rows.length === 0;

  const nav = useListNav({
    count: showRows ? rows.length : 0,
    listKey: `${trimmed}|${rows.map((row) => row.ticker).join(",")}`,
    idPrefix: baseId,
    // The sheet was opened on purpose, so Tab stays in it. The inline field hands
    // Tab back to the page until something is typed: tabbing past the header must
    // not get stuck in the most-traded list.
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

  function choose(ticker: string) {
    // Tickers are ASCII: a Turkish-locale uppercase would turn "sise" into "SİSE".
    const symbol = ticker.trim().toUpperCase();
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
          choose(rows[nav.active].ticker);
        } else if (!hasQuery) {
          // Nothing marked and nothing typed: nothing to take.
        } else if (settled) {
          if (rows.length > 0) choose(rows[0].ticker);
        } else {
          // Typed a full ticker faster than the list answered — go straight to it.
          const candidate = trimmed.toUpperCase();
          if (TICKER_RE.test(candidate)) choose(candidate);
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
    else if (indexFailed && (!needServer || serverQ.isError)) status = t("search.unavailable");
    else status = t("search.noResultsFor", { q: trimmed });
  }
  const live = showRows && hasQuery ? t("search.resultCount", { count: rows.length }) : status;

  const listLabelProps = hasQuery ? { "aria-label": t("search.label") } : { "aria-labelledby": headingId };

  return (
    <div ref={containerRef} className={cn("relative", className)} onBlur={overlay ? undefined : handleBlur}>
      <div className="relative">
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
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showRows}
          aria-controls={listboxId}
          aria-activedescendant={nav.active >= 0 ? nav.optionId(nav.active) : undefined}
          aria-keyshortcuts={shortcutHint ? "Meta+K Control+K" : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={40}
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
          <Loader2
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
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

      <span className="sr-only" aria-live="polite">
        {live}
      </span>

      {(showRows || showStatus) && (
        <div
          className={cn(
            "overflow-hidden border border-border bg-popover text-popover-foreground",
            overlay
              ? "mt-2 rounded-md"
              : "absolute right-0 top-full z-50 mt-1 w-full min-w-72 rounded-lg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]",
          )}
        >
          {showRows ? (
            <>
              {!hasQuery && (
                <div id={headingId} className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("search.mostTraded")}
                </div>
              )}
              <ul
                id={listboxId}
                role="listbox"
                {...listLabelProps}
                className={cn("overflow-y-auto overflow-x-hidden overscroll-contain py-1", overlay ? "max-h-[55vh]" : "max-h-80")}
              >
                {rows.map((option, i) => (
                  <li
                    key={option.ticker}
                    id={nav.optionId(i)}
                    role="option"
                    aria-selected={i === nav.active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => i !== nav.active && nav.setActive(i)}
                    onClick={() => choose(option.ticker)}
                    className={cn(
                      "flex cursor-pointer items-baseline gap-3 px-3 py-3 text-sm md:py-2",
                      i === nav.active && "bg-accent",
                    )}
                  >
                    <span className="w-14 shrink-0 font-mono text-xs font-semibold text-foreground">{option.ticker}</span>
                    <span className="truncate text-xs text-muted-foreground">{option.name}</span>
                  </li>
                ))}
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
