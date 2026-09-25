"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Search, X } from "lucide-react";
import { useDismissOnLeave } from "@/components/shared/search/use-dismiss";
import { useListNav } from "@/components/shared/search/use-list-nav";
import { cn } from "@/lib/utils";
import type { Company } from "@/types";
import { useEventsI18n } from "./i18n";
import { matchCompanies, MIN_QUERY_LENGTH, type CompanyMatch } from "./model";

const COMMIT_DELAY_MS = 400;

function normalizeQuery(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= MIN_QUERY_LENGTH ? trimmed : "";
}

/**
 * Free-text search with tracked-company suggestions (WAI-ARIA combobox).
 * Typing commits `q` after a short pause; picking a suggestion adds the
 * ticker as a filter instead and clears the text.
 */
export function EventsSearchBox({
  q,
  tickers,
  companies,
  onCommitQuery,
  onPickTicker,
  inputRef,
  className,
}: {
  /** Committed query from the URL. */
  q: string;
  tickers: readonly string[];
  companies: readonly Company[] | undefined;
  onCommitQuery: (q: string) => void;
  onPickTicker: (ticker: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const { t } = useEventsI18n();
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const hintId = `${baseId}-hint`;
  const containerRef = useRef<HTMLDivElement>(null);

  const [text, setText] = useState(q);
  // Last query this box committed (or accepted from the URL): URL changes that
  // differ from it come from elsewhere (back/forward, a removed filter) and win.
  // Resync only when the URL itself changes: a commit reaches `q` one transition
  // later (router.replace), and comparing `q` with `ownQuery` in between read our
  // own commit as an outside change — the text blanked for a moment and the list
  // closed, 400 ms after every pause in typing.
  const [ownQuery, setOwnQuery] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    if (q !== ownQuery) setText(q);
    setOwnQuery(q);
  }
  const [open, setOpen] = useState(false);

  const commitRef = useRef(onCommitQuery);
  useEffect(() => {
    commitRef.current = onCommitQuery;
  }, [onCommitQuery]);

  // Debounced commit; re-running on every keystroke (or URL sync) cancels the pending one.
  useEffect(() => {
    const next = normalizeQuery(text);
    if (next === ownQuery) return;
    const timer = setTimeout(() => {
      setOwnQuery(next);
      commitRef.current(next);
    }, COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, ownQuery]);

  const trimmed = text.trim();
  const searchable = trimmed.length >= MIN_QUERY_LENGTH;
  const matches = useMemo(() => matchCompanies(companies, trimmed), [companies, trimmed]);
  const expanded = open && searchable;
  const selected = useMemo(() => new Set(tickers), [tickers]);
  // Tab walks the suggestions like the arrows (the site search's model): the list
  // only opens for typed text, so tabbing past an empty box is never caught.
  const nav = useListNav({
    count: expanded ? matches.length : 0,
    listKey: `${trimmed}|${matches.map((match) => match.ticker).join(",")}`,
    idPrefix: baseId,
    tabWalks: true,
  });
  const activeIndex = nav.active;
  const handleBlur = useDismissOnLeave({ open: expanded, boxRef: containerRef, inputRef, onDismiss: () => setOpen(false) });

  function commitNow() {
    const next = normalizeQuery(text);
    setOpen(false);
    if (next === ownQuery) return;
    setOwnQuery(next);
    onCommitQuery(next);
  }

  function choose(match: CompanyMatch) {
    setText("");
    setOwnQuery("");
    setOpen(false);
    onPickTicker(match.ticker);
  }

  function clear() {
    setText("");
    setOpen(false);
    if (ownQuery !== "") {
      setOwnQuery("");
      onCommitQuery("");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (nav.onKeyDown(event)) return;
    switch (event.key) {
      case "ArrowDown":
        if (!searchable || open) return;
        event.preventDefault();
        setOpen(true);
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && matches[activeIndex]) choose(matches[activeIndex]);
        else commitNow();
        break;
      case "Escape":
        event.preventDefault();
        if (expanded) {
          setOpen(false);
        } else if (text) {
          clear();
        } else {
          event.currentTarget.blur();
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const liveMessage = expanded
    ? matches.length > 0
      ? t("search.suggestionCount", { count: matches.length })
      : t("search.noCompany")
    : "";

  return (
    <div ref={containerRef} className={cn("relative", className)} onBlur={handleBlur}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={t("search.label")}
        aria-expanded={expanded && matches.length > 0}
        aria-controls={expanded && matches.length > 0 ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? nav.optionId(activeIndex) : undefined}
        aria-describedby={hintId}
        aria-keyshortcuts="/"
        value={text}
        placeholder={t("search.placeholder")}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={120}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(event.target.value.trim().length >= MIN_QUERY_LENGTH);
        }}
        onFocus={() => {
          if (searchable) setOpen(true);
        }}
        // A tap on the field that is already focused fires no focus event; bring a closed list back.
        onClick={() => {
          if (searchable) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-input bg-card pl-8 pr-9 text-base text-foreground transition-colors sm:text-sm",
          "placeholder:text-muted-foreground hover:border-foreground/25",
          // Same focus signal as the stock search: the border, no ring on a click.
          "focus:border-ring focus:outline-none",
        )}
      />
      <span id={hintId} className="sr-only">
        {t("search.shortcut")}
      </span>
      {text ? (
        <button
          type="button"
          onClick={() => {
            clear();
            inputRef.current?.focus();
          }}
          aria-label={t("search.clear")}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          title={t("search.shortcut")}
          className="pointer-events-none absolute right-2 top-1/2 hidden h-[18px] -translate-y-1/2 items-center rounded-sm border border-border px-1.5 font-mono text-[10px] text-muted-foreground sm:flex"
        >
          /
        </kbd>
      )}

      <span className="sr-only" aria-live="polite">
        {liveMessage}
      </span>

      {expanded ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]">
          {matches.length > 0 ? (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={t("search.suggestions")}
              className="max-h-80 overflow-y-auto overflow-x-hidden overscroll-contain py-1"
            >
              {matches.map((match, index) => {
                const inFilter = selected.has(match.ticker);
                return (
                  <li
                    key={match.ticker}
                    id={nav.optionId(index)}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(match)}
                    onMouseMove={() => {
                      if (index !== activeIndex) nav.setActive(index);
                    }}
                    className={cn("flex cursor-pointer items-baseline gap-3 px-3 py-2", index === activeIndex && "bg-accent")}
                  >
                    <span className="w-14 shrink-0 font-mono text-xs font-semibold text-foreground">{match.ticker}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{match.name}</span>
                    {inFilter ? <span className="shrink-0 text-[11px] text-muted-foreground">{t("search.inFilter")}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-2.5 text-[13px] text-muted-foreground">{t("search.noCompany")}</p>
          )}
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {activeIndex >= 0 ? t("search.keysHint") : t("search.textHint", { q: trimmed })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
