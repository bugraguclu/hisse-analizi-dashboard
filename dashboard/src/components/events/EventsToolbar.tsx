"use client";

import { useId, useMemo, type RefObject } from "react";
import { Star } from "lucide-react";
import {
  FilterBar,
  FilterChoiceList,
  FilterGroupsMenu,
  FilterMenu,
  FilterPanelSection,
  summarizePicks,
  useFilterBarText,
  type FilterGroupSpec,
  type FilterOption,
} from "@/components/ui/filter-bar";
import {
  CATEGORY_CODES,
  SEVERITY_LEVELS,
  categoryKeys,
  severityKeys,
  type CategoryKey,
  type SeverityKey,
} from "@/components/shared/SeverityBadge";
import type { Watchlist } from "@/hooks/use-watchlists";
import { formatNumber, getIntlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Company, EventSort } from "@/types";
import { EventsSearchBox } from "./EventsSearchBox";
import { useEventsI18n } from "./i18n";
import {
  formatDayKey,
  isDayKey,
  MAX_TICKERS,
  PAGE_SIZES,
  RANGE_KEYS,
  rangeDays,
  shiftDay,
  SORT_KEYS,
  type EventsUrlState,
  type PageSize,
  type RangeKey,
} from "./model";
import type { FacetCounts } from "./queries";
import { FOCUS_RING, SELECTED_CLASS, SeverityMarker, UNSELECTED_CLASS } from "./ui";
import type { FilterPatch, NavMode } from "./use-events-url";

type OnChange = (patch: FilterPatch, mode?: NavMode) => void;

const RANGE_LABEL = {
  all: "date.all",
  today: "date.today",
  yesterday: "date.yesterday",
  "7d": "date.7d",
  "30d": "date.30d",
  month: "date.month",
  custom: "date.custom",
} as const satisfies Record<RangeKey, string>;

export const SORT_LABEL = {
  newest: "sort.newest",
  oldest: "sort.oldest",
  severity: "sort.severity",
  ticker: "sort.ticker",
} as const satisfies Record<EventSort, string>;

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

// History, as on belif.tr: picking replaces the current entry (Back does not walk
// through every tick), clearing pushes one (a clear is a decision Back can undo).
const PICK: NavMode = "replace";
const CLEAR: NavMode = "push";

// ---------------------------------------------------------------------------
// Date menu
// ---------------------------------------------------------------------------

function CustomRangeFields({ state, today, onChange }: { state: EventsUrlState; today: string | null; onChange: OnChange }) {
  const { t } = useEventsI18n();
  const fromId = useId();
  const toId = useId();

  function setDay(which: "since" | "until", value: string) {
    const day = isDayKey(value) ? value : null;
    if (value && !day) return; // a date input mid-edit
    onChange((current) => {
      let since = which === "since" ? day : current.since;
      let until = which === "until" ? day : current.until;
      if (since && until && since > until) {
        if (which === "since") until = since;
        else since = until;
      }
      return { range: "custom", since, until };
    }, PICK);
  }

  const dateInput = cn(
    "h-9 w-full min-w-0 rounded-md border border-border bg-card px-2 font-mono text-xs text-foreground transition-colors hover:border-foreground/30 [color-scheme:light] dark:[color-scheme:dark]",
    FOCUS_RING,
  );

  return (
    <FilterPanelSection label={t("date.customRange")}>
      {/* One field per row: a date input needs ~125px, half of the panel does not have it. */}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
        <label htmlFor={fromId} className="text-xs text-muted-foreground">
          {t("date.from")}
        </label>
        <input
          id={fromId}
          type="date"
          className={dateInput}
          value={state.since ?? ""}
          min="2000-01-01"
          max={state.until ?? today ?? undefined}
          onChange={(event) => setDay("since", event.target.value)}
        />
        <label htmlFor={toId} className="text-xs text-muted-foreground">
          {t("date.to")}
        </label>
        <input
          id={toId}
          type="date"
          className={dateInput}
          value={state.until ?? ""}
          min={state.since ?? "2000-01-01"}
          max={today ?? undefined}
          onChange={(event) => setDay("until", event.target.value)}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t("date.timezone")}</p>
    </FilterPanelSection>
  );
}

function useDateSummary(state: EventsUrlState, today: string | null): string {
  const { t } = useEventsI18n();
  if (state.range !== "custom") return t(RANGE_LABEL[state.range]);
  const intlLocale = getIntlLocale();
  const currentYear = today ? today.slice(0, 4) : null;
  const day = (key: string) => formatDayKey(key, intlLocale, currentYear, "short");
  if (state.since && state.until) {
    return state.since === state.until ? day(state.since) : t("date.rangeChip", { from: day(state.since), to: day(state.until) });
  }
  if (state.since) return t("date.sinceChip", { from: day(state.since) });
  if (state.until) return t("date.untilChip", { to: day(state.until) });
  return t(RANGE_LABEL.custom);
}

// ---------------------------------------------------------------------------
// Watchlist shortcut
// ---------------------------------------------------------------------------

function WatchlistToggle({ watchlist, tickers, onChange }: { watchlist: Watchlist; tickers: readonly string[]; onChange: OnChange }) {
  const { t } = useEventsI18n();
  const listTickers = watchlist.tickers.slice(0, MAX_TICKERS);
  const active = sameMembers(tickers, listTickers);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChange({ tickers: active ? [] : listTickers }, active ? CLEAR : PICK)}
      title={t("watchlist.hint", { count: listTickers.length })}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
        active ? SELECTED_CLASS : UNSELECTED_CLASS,
        FOCUS_RING,
      )}
    >
      <Star aria-hidden="true" className={cn("h-3.5 w-3.5", active && "fill-current")} />
      <span className="sr-only sm:not-sr-only">{t("watchlist.toggle")}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/**
 * Search row + the belif-style filter bar: TARİH, FİLTRELE (önem, kategori, hisse)
 * and SIRALA menus. Every pick applies at once and lands in the URL.
 */
export function EventsToolbar({
  state,
  today,
  counts,
  total,
  companies,
  watchlist,
  tickerChoices,
  searchInputRef,
  onChange,
}: {
  state: EventsUrlState;
  /** Istanbul day key; null until hydrated. */
  today: string | null;
  counts: FacetCounts | null;
  /** Matching disclosures (for the panel's "show n" button); null while unknown. */
  total: number | null;
  companies: readonly Company[] | undefined;
  watchlist: Watchlist | undefined;
  /** Options of the panel's Hisse group (picked, picked earlier in this visit, watchlist). */
  tickerChoices: readonly string[];
  searchInputRef: RefObject<HTMLInputElement | null>;
  onChange: OnChange;
}) {
  const { t, tp, tShared } = useEventsI18n();
  const text = useFilterBarText();
  const dateSummary = useDateSummary(state, today);

  const companyNames = useMemo(() => new Map((companies ?? []).map((company) => [company.ticker, company.display_name])), [companies]);


  // Each preset's days as a tooltip ("17 Eyl – 23 Eyl"): presets are Istanbul calendar days.
  const intlLocale = getIntlLocale();
  const currentYear = today ? today.slice(0, 4) : null;
  const rangeOptions: FilterOption<RangeKey>[] = RANGE_KEYS.map((key) => {
    const bounds = key === "all" || key === "custom" ? null : rangeDays({ range: key, since: null, until: null }, today);
    const from = bounds?.from ?? null;
    const to = bounds?.to ?? today;
    const title =
      from && to
        ? from === to
          ? formatDayKey(from, intlLocale, currentYear, "short")
          : t("date.rangeChip", { from: formatDayKey(from, intlLocale, currentYear, "short"), to: formatDayKey(to, intlLocale, currentYear, "short") })
        : undefined;
    return { value: key, label: t(RANGE_LABEL[key]), title };
  });

  function selectRange(range: RangeKey) {
    if (range === "custom") {
      // Start the custom range from what is on screen (or the last 7 days).
      const current = rangeDays(state, today);
      const since = current?.from ?? (today ? shiftDay(today, -6) : null);
      const until = current?.to ?? today;
      onChange({ range, since, until }, PICK);
    } else {
      onChange({ range, since: null, until: null }, PICK);
    }
  }

  const severityGroup: FilterGroupSpec<SeverityKey> = {
    id: "severity",
    label: t("severity.label"),
    options: SEVERITY_LEVELS.map((level) => ({
      value: level,
      label: tShared(severityKeys[level]),
      count: counts ? (counts.severities[level] ?? 0) : null,
      marker: <SeverityMarker level={level} />,
    })),
    selected: state.severities,
    onChange: (severities) => onChange({ severities }, PICK),
  };

  const categoryGroup: FilterGroupSpec<CategoryKey> = {
    id: "category",
    label: t("category.label"),
    options: CATEGORY_CODES.map((code) => ({
      value: code,
      label: tShared(categoryKeys[code]),
      count: counts ? (counts.categories[code] ?? 0) : null,
    })),
    selected: state.categories,
    onChange: (categories) => onChange({ categories }, PICK),
    selectAll: true,
  };

  const tickerGroup: FilterGroupSpec<string> = {
    id: "ticker",
    label: t("filters.tickers"),
    options: tickerChoices.map((ticker) => ({
      value: ticker,
      label: ticker,
      mono: true,
      title: companyNames.get(ticker) ?? undefined,
      count: counts?.tickers[ticker] ?? null,
    })),
    selected: state.tickers,
    onChange: (tickers) => onChange({ tickers: tickers.slice(0, MAX_TICKERS) }, PICK),
    selectAll: true,
    note: tickerChoices.length === 0 ? t("filters.tickerHint") : undefined,
  };

  const filterSummary = summarizePicks(
    [
      ...SEVERITY_LEVELS.filter((level) => state.severities.includes(level)).map((level) => tShared(severityKeys[level])),
      ...state.categories.map((code) => tShared(categoryKeys[code])),
      ...state.tickers,
    ],
    text,
  );

  const sortOptions: FilterOption<EventSort>[] = SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABEL[key]) }));
  const sizeOptions: FilterOption<`${PageSize}`>[] = PAGE_SIZES.map((size) => ({ value: `${size}`, label: `${size}` }));

  return (
    <section role="search" aria-label={t("toolbar.label")} className="space-y-3">
      <div className="flex items-center gap-2">
        <EventsSearchBox
          className="min-w-0 flex-1"
          q={state.q}
          tickers={state.tickers}
          companies={companies}
          inputRef={searchInputRef}
          onCommitQuery={(q) => onChange({ q }, "replace")}
          onPickTicker={(ticker) =>
            onChange(
              (current) => ({
                tickers: current.tickers.includes(ticker) ? current.tickers : [...current.tickers, ticker].slice(0, MAX_TICKERS),
                q: "",
              }),
              PICK,
            )
          }
        />
        {watchlist && watchlist.tickers.length > 0 ? <WatchlistToggle watchlist={watchlist} tickers={state.tickers} onChange={onChange} /> : null}
      </div>

      <FilterBar label={t("filters.label")}>
        {/* Taller than a plain list: the custom range adds its fields under the presets. */}
        <FilterMenu label={t("date.label")} value={dateSummary} icon="date" panelClassName="max-h-[min(30rem,70vh)] sm:max-h-[min(30rem,75vh)]">
          <FilterChoiceList
            label={t("date.label")}
            value={state.range}
            options={rangeOptions}
            onChange={selectRange}
            keepOpen={(range) => range === "custom"}
          />
          {state.range === "custom" ? <CustomRangeFields state={state} today={today} onChange={onChange} /> : null}
        </FilterMenu>

        <FilterGroupsMenu
          label={text.filter}
          value={filterSummary}
          groups={[severityGroup, categoryGroup, tickerGroup]}
          onClear={() => onChange({ severities: [], categories: [], tickers: [] }, CLEAR)}
          clearDisabled={state.severities.length === 0 && state.categories.length === 0 && state.tickers.length === 0}
          applyLabel={total !== null ? tp("filters.showResults", total, { count: formatNumber(total, 0) }) : t("filters.showResultsPlain")}
          empty={total === 0}
        />

        <FilterMenu label={text.sort} value={t(SORT_LABEL[state.sort])} icon="sort">
          <FilterChoiceList label={t("sort.label")} showLabel value={state.sort} options={sortOptions} onChange={(sort) => onChange({ sort }, PICK)} />
          <div className="mt-1 border-t border-border">
            <FilterChoiceList
              label={t("size.label")}
              showLabel
              value={`${state.size}`}
              options={sizeOptions}
              onChange={(size) => onChange({ size: Number(size) as PageSize }, PICK)}
            />
          </div>
        </FilterMenu>
      </FilterBar>
    </section>
  );
}
