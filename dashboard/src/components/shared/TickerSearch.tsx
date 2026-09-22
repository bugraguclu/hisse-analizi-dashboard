"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { tickerHref } from "@/components/layout/nav";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const MAX_RESULTS = 8;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

interface SearchOption {
  ticker: string;
  name: string;
}

export function TickerSearch({
  onSelect,
  autoFocus = false,
  hotkey = false,
  className,
}: {
  /** Custom selection handler; defaults to navigating (see tickerHref). */
  onSelect?: (ticker: string) => void;
  autoFocus?: boolean;
  /** Focus this field with "/" from anywhere on the page. */
  hotkey?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();

  const trimmed = query.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const searchQ = useQuery({
    queryKey: ["symbol-search", debounced.toLocaleUpperCase("tr-TR")],
    queryFn: ({ signal }) => api.search(debounced, signal),
    enabled: debounced.length >= MIN_QUERY_LENGTH,
    staleTime: STALE_TIME.reference,
    retry: 1,
  });

  // Local company names ("Türk Hava Yolları") read better than the upstream ASCII ones.
  const companiesQ = useQuery({
    queryKey: ["companies"],
    queryFn: () => api.companies(),
    staleTime: STALE_TIME.reference,
    enabled: open,
  });

  const options = useMemo<SearchOption[]>(() => {
    const names = new Map((companiesQ.data ?? []).map((c) => [c.ticker, c.display_name]));
    const seen = new Set<string>();
    const list: SearchOption[] = [];
    for (const r of searchQ.data?.results ?? []) {
      const ticker = (r.symbol || r.ticker || "").toUpperCase();
      if (!ticker || seen.has(ticker)) continue;
      seen.add(ticker);
      list.push({ ticker, name: names.get(ticker) ?? r.name ?? r.description ?? "" });
      if (list.length >= MAX_RESULTS) break;
    }
    return list;
  }, [searchQ.data, companiesQ.data]);

  const settled = debounced === trimmed && !searchQ.isFetching;
  const pending = searchable && !settled;
  const showPanel = open && searchable;
  const showList = showPanel && options.length > 0 && !searchQ.isError;
  const active = activeIndex >= 0 && activeIndex < options.length ? activeIndex : -1;

  // Close when clicking/tapping outside.
  useEffect(() => {
    if (!open) return;
    function handlePointer(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [open]);

  // "/" focuses the search field unless the user is already typing somewhere.
  useEffect(() => {
    if (!hotkey) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [hotkey]);

  function choose(ticker: string) {
    setQuery("");
    setDebounced("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
    if (onSelect) onSelect(ticker.toUpperCase());
    else router.push(tickerHref(pathname, ticker));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        if (options.length > 0) setActiveIndex((i) => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        if (options.length > 0) setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case "Home":
      case "End":
        if (showList) {
          event.preventDefault();
          setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
        }
        break;
      case "Enter": {
        event.preventDefault();
        if (active >= 0) {
          choose(options[active].ticker);
        } else if (settled && options.length > 0) {
          choose(options[0].ticker);
        } else {
          // Typed a full ticker faster than the search answered — go straight to it.
          // Tickers are ASCII: a Turkish-locale uppercase would turn "sise" into "SİSE".
          const candidate = trimmed.toUpperCase();
          if (TICKER_RE.test(candidate)) choose(candidate);
        }
        break;
      }
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  let status: string | null = null;
  if (showPanel && !showList) {
    if (pending) status = t("common.searching");
    else if (searchQ.isError) status = t("search.unavailable");
    else status = t("search.noResults");
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={t("common.search")}
        aria-label={t("search.label")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList && active >= 0 ? `${baseId}-option-${active}` : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={40}
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-border bg-card pl-9 pr-9 text-sm shadow-sm outline-none transition-colors",
          "placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/20",
        )}
      />
      {pending ? (
        <Loader2
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      ) : query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setActiveIndex(-1);
            inputRef.current?.focus();
          }}
          aria-label={t("shell.closeSearch")}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : hotkey ? (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 hidden h-5 -translate-y-1/2 items-center rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground lg:flex"
        >
          /
        </kbd>
      ) : null}

      {showPanel && (
        <div className="absolute top-full z-50 mt-1.5 w-full min-w-64 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/10">
          <ul id={listboxId} role="listbox" aria-label={t("search.label")} hidden={!showList} className="max-h-80 overflow-y-auto py-1">
            {options.map((option, i) => (
              <li
                key={option.ticker}
                id={`${baseId}-option-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option.ticker)}
                onMouseMove={() => i !== active && setActiveIndex(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm",
                  i === active ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">{option.ticker}</span>
                <span className="truncate text-xs text-foreground">{option.name}</span>
              </li>
            ))}
          </ul>
          {showList ? (
            <p className="border-t border-border/30 bg-muted/30 px-3.5 py-1.5 text-[10px] text-muted-foreground" aria-live="polite">
              {t("search.hint", { count: options.length })}
            </p>
          ) : (
            <p role="status" className="px-3.5 py-3 text-xs text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
