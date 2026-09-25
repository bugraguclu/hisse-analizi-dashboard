"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { useDismissOnLeave } from "@/components/shared/search/use-dismiss";
import { useListNav } from "@/components/shared/search/use-list-nav";
import { formatMarketDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { countryFlag, countryLabel, countrySearchNames, POPULAR_SEARCHES, useCalendarText } from "./i18n";
import { Highlight } from "./parts";
import type { CalendarCountry, CalendarRow, Importance } from "./types";
import { fold, formatDay, isUpcoming, searchTerms } from "./utils";

type Option =
  | { kind: "popular"; id: string; query: string; next: CalendarRow | null }
  | { kind: "event"; id: string; key: string; title: string; countries: string[]; next: CalendarRow | null; last: CalendarRow | null }
  | { kind: "country"; id: string; code: string; name: string };

/** belif's result count (Search.astro, sss.astro). */
const MAX_RESULTS = 8;
const COMMIT_DELAY_MS = 250;
const WEIGHT: Record<Importance, number> = { high: 3, mid: 2, low: 1 };

const matches = (row: CalendarRow, terms: string[]) => terms.every((term) => row.search.includes(term));
// The name alone, without the topic keywords of the haystack ("PMI" is a keyword of every survey).
const named = (row: CalendarRow, terms: string[]) => {
  const name = fold(`${row.title} ${row.titleEn ?? ""}`);
  return terms.every((term) => name.includes(term));
};

/**
 * The calendar's search field, on the belif site search's mechanics (Search.astro,
 * sss.astro; shared hooks in components/shared/search):
 *
 * - Typing filters the table as you go and lists up to 8 matching events, each named
 *   with its countries and its next (else last) release. A pick shows that event only.
 * - The list opens for typed text, or on purpose: a click or ↓ on the empty field shows
 *   the popular searches. Focus arriving by Tab opens nothing, so tabbing past the
 *   field never gets caught — and every list that is open is walked by Tab / Shift+Tab
 *   and the arrows while focus stays in the field (the row is marked, not focused).
 * - Enter takes the marked row, else applies the text; Escape closes the list, then
 *   clears the text; ✕ clears and closes. Nothing found echoes the query, and offers
 *   the countries it names that are not loaded yet.
 */
export function QueryBar({
  value,
  onCommit,
  rows,
  scheduled,
  now,
  today,
  countries,
  selectedCountries,
  onPickEvent,
  onAddCountry,
}: {
  value: string;
  onCommit: (query: string) => void;
  /** The loaded rows in the UI language. */
  rows: CalendarRow[];
  /** Releases still to come, soonest first (they may reach past the loaded window). */
  scheduled: CalendarRow[];
  now: number;
  today: string | null;
  countries: CalendarCountry[];
  selectedCountries: string[];
  onPickEvent: (key: string) => void;
  onAddCountry: (code: string) => void;
}) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const baseId = useId();
  const listboxId = `${baseId}-list`;
  const headingId = `${baseId}-heading`;
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  // The empty field's list was asked for (click, ↓) rather than met on the way past.
  const [purpose, setPurpose] = useState(false);

  // Follow external changes (filter reset, a row's "only this event"); adjusted
  // during render, React's pattern for syncing state to a changed prop.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  const query = draft.trim();
  const terms = useMemo(() => searchTerms(draft), [draft]);

  const options = useMemo<Option[]>(() => {
    if (!query) {
      return POPULAR_SEARCHES[locale].flatMap((text, index): Option[] => {
        const popularTerms = searchTerms(text);
        if (!rows.some((row) => matches(row, popularTerms))) return [];
        const next =
          scheduled.find((row) => named(row, popularTerms)) ?? scheduled.find((row) => matches(row, popularTerms)) ?? null;
        return [{ kind: "popular", id: `popular-${index}`, query: text, next }];
      });
    }

    const folded = fold(query);
    type Entry = { title: string; countries: Set<string>; count: number; rank: number; key: boolean; weight: number; last: CalendarRow | null };
    const events = new Map<string, Entry>();
    for (const row of rows) {
      if (!matches(row, terms)) continue;
      let entry = events.get(row.titleKey);
      if (!entry) {
        // Ranked by the name on screen (Turkish for tr); the key stays the language-neutral one.
        const shown = fold(row.title);
        const rank = shown.startsWith(folded) ? 0 : ` ${shown}`.includes(` ${terms[0]}`) ? 1 : 2;
        entry = { title: row.title, countries: new Set(), count: 0, rank, key: false, weight: 0, last: null };
        events.set(row.titleKey, entry);
      }
      entry.count += 1;
      entry.countries.add(row.countryCode);
      entry.key ||= row.keyEvent;
      entry.weight = Math.max(entry.weight, WEIGHT[row.importance]);
      if (now > 0 && !isUpcoming(row, now, today) && (!entry.last || row.ts > entry.last.ts)) entry.last = row;
    }
    // A name that starts with a typed word matches well; among those, rate decisions and
    // high-importance releases come first ("faiz" → TCMB Faiz Kararı before Faiz Projeksiyonu).
    const eventOptions = [...events.entries()]
      .sort(
        ([, a], [, b]) =>
          Number(a.rank > 1) - Number(b.rank > 1) ||
          Number(b.key) - Number(a.key) ||
          b.weight - a.weight ||
          a.rank - b.rank ||
          b.count - a.count ||
          a.title.localeCompare(b.title, locale),
      )
      .slice(0, MAX_RESULTS)
      .map(([key, entry]): Option => ({
        kind: "event",
        id: `event-${key}`,
        key,
        title: entry.title,
        countries: [...entry.countries],
        next: scheduled.find((row) => row.titleKey === key) ?? null,
        last: entry.last,
      }));
    if (eventOptions.length > 0) return eventOptions;

    // Nothing found: a country the query names may simply not be loaded yet.
    return countries
      .filter(
        (country) =>
          !selectedCountries.includes(country.code) &&
          countrySearchNames(country.code, country.name).some((name) => {
            const words = fold(name);
            return words.startsWith(folded) || words.split(" ").some((word) => word.startsWith(folded));
          }),
      )
      .slice(0, 3)
      .map((country): Option => ({
        kind: "country",
        id: `country-${country.code}`,
        code: country.code,
        name: countryLabel(country.code, locale, country.name),
      }));
  }, [query, terms, rows, scheduled, now, today, countries, selectedCountries, locale]);

  const panel = open && (query !== "" || (purpose && options.length > 0));
  // Every open list was asked for (typed text, a click, ↓), so Tab walks it — belif's
  // model. To leave the field from the keyboard, Escape closes the list first.
  const nav = useListNav({
    count: panel ? options.length : 0,
    listKey: `${query}|${options.map((option) => option.id).join(",")}`,
    idPrefix: baseId,
    tabWalks: true,
  });
  const active = nav.active;
  const closeList = () => {
    setOpen(false);
    setPurpose(false);
  };
  const handleBlur = useDismissOnLeave({ open: panel, boxRef, inputRef, onDismiss: closeList });

  function scheduleCommit(next: string) {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onCommit(next.trim()), COMMIT_DELAY_MS);
  }

  function commitNow(next: string) {
    clearTimeout(commitTimer.current);
    onCommit(next.trim());
  }

  function choose(option: Option, byPointer: boolean) {
    closeList();
    switch (option.kind) {
      case "popular":
        setDraft(option.query);
        commitNow(option.query);
        break;
      case "event":
        setDraft("");
        commitNow("");
        onPickEvent(option.key);
        break;
      case "country":
        // The text stays: once the country loads, it finds that country's events.
        commitNow(draft);
        onAddCountry(option.code);
        break;
    }
    // A tap hands the screen back to the table (on a phone the keyboard goes down);
    // a keyboard pick keeps the caret here for the next search.
    if (byPointer) inputRef.current?.blur();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (nav.onKeyDown(event)) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        // A list closed with Escape comes back on an arrow.
        if (!panel) {
          event.preventDefault();
          setOpen(true);
          setPurpose(true);
        }
        break;
      case "Enter":
        if (event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (active >= 0 && options[active]) choose(options[active], false);
        else {
          commitNow(draft);
          closeList();
        }
        break;
      case "Escape":
        if (panel) {
          event.preventDefault();
          closeList();
        } else if (draft) {
          event.preventDefault();
          setDraft("");
          commitNow("");
        }
        break;
      case "Tab":
        closeList();
        break;
    }
  }

  const when = (row: CalendarRow) =>
    row.allDay ? formatDay(row.date, locale, { day: "numeric", month: "short" }) : formatMarketDate(row.ts, "dayMonthTime");

  function subtitle(option: Option): string | null {
    switch (option.kind) {
      case "popular":
        return option.next
          ? `${tt("nextShort", { date: when(option.next) })} · ${countryFlag(option.next.countryCode)} ${option.next.title}`
          : null;
      case "event": {
        const [first] = option.countries;
        const where =
          option.countries.length === 1
            ? `${countryFlag(first)} ${countryLabel(first, locale)}`
            : `${option.countries.slice(0, 4).map(countryFlag).join(" ")}${option.countries.length > 4 ? ` +${option.countries.length - 4}` : ""}`;
        // Several countries: the flag says whose release comes next.
        const whose = (row: CalendarRow) => (option.countries.length > 1 ? `${countryFlag(row.countryCode)} ` : "");
        const release = option.next
          ? tt("nextShort", { date: `${whose(option.next)}${when(option.next)}` })
          : option.last
            ? tt("lastShort", { date: `${whose(option.last)}${when(option.last)}` })
            : null;
        return release ? `${where} · ${release}` : where;
      }
      case "country":
        return tt("addCountry");
    }
  }

  const hasList = panel && options.length > 0;
  const live = panel && query ? (options.length > 0 ? tt("suggestionCount", { n: options.length }) : tt("noResults", { q: query })) : "";

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1" onBlur={handleBlur}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={tt("searchPlaceholder")}
        aria-label={tt("searchLabel")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={hasList}
        aria-controls={hasList ? listboxId : undefined}
        aria-activedescendant={hasList && active >= 0 ? nav.optionId(active) : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
          scheduleCommit(event.target.value);
        }}
        // Focus alone opens only a list for text already typed (belif /sss).
        onFocus={() => {
          if (query) setOpen(true);
        }}
        // A click is on purpose: it opens the empty field's list too, and brings a closed
        // list back on a field that already has focus (no focus event fires then).
        onClick={() => {
          setOpen(true);
          setPurpose(true);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          // 16 px below md: iOS zooms the page into any smaller field it focuses.
          "h-9 w-full min-w-0 rounded-md border border-input bg-card pl-9 pr-9 text-base text-foreground outline-none transition-colors md:text-[13px]",
          // Same focus signal as the stock search: the border, no ring on a click.
          "placeholder:text-muted-foreground focus:border-ring",
        )}
      />
      {draft && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDraft("");
            commitNow("");
            closeList();
            inputRef.current?.focus();
          }}
          aria-label={tt("clearSearch")}
          title={tt("clearSearch")}
          className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      <span className="sr-only" aria-live="polite">
        {live}
      </span>

      {panel && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]">
          {!query && (
            <div id={headingId} className="px-3 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {tt("groupPopular")}
            </div>
          )}
          {/* Echoes the query back, so it is clear what was searched for. */}
          {query && options.every((option) => option.kind === "country") && (
            <p className={cn("px-3 text-xs text-muted-foreground", options.length > 0 ? "pb-1 pt-2.5" : "py-3")}>
              {tt("noResults", { q: query })}
            </p>
          )}
          {options.length > 0 && (
            <ul
              id={listboxId}
              role="listbox"
              {...(query ? { "aria-label": tt("searchLabel") } : { "aria-labelledby": headingId })}
              className="max-h-[min(380px,55vh)] overflow-y-auto overflow-x-hidden overscroll-contain p-1"
            >
              {options.map((option, index) => {
                const sub = subtitle(option);
                return (
                  <li
                    key={option.id}
                    id={nav.optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (index !== active) nav.setActive(index);
                    }}
                    onClick={() => choose(option, true)}
                    className={cn("cursor-pointer rounded-md px-2.5 py-2", index === active && "bg-accent")}
                  >
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {option.kind === "country" && <span aria-hidden="true">{countryFlag(option.code)} </span>}
                      <Highlight text={option.kind === "popular" ? option.query : option.kind === "event" ? option.title : option.name} terms={query ? terms : []} />
                    </span>
                    {sub && <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{sub}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
