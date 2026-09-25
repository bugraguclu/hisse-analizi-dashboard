"use client";

import {
  FilterBar,
  FilterChoiceList,
  FilterGroupsMenu,
  FilterMenu,
  summarizePicks,
  useFilterBarText,
  type FilterGroupSpec,
  type FilterOption,
} from "@/components/ui/filter-bar";
import { useLocale } from "@/lib/locale-context";
import { DateMenu } from "./DateNavigator";
import { DEFAULT_COUNTRIES, DEFAULT_IMPORTANCE, sameSet, type FiltersUpdate } from "./hooks";
import { countryFlag, countryLabel, IMPORTANCE_LABELS, SORT_LABELS, TAG_LABELS, useCalendarText } from "./i18n";
import { ImportanceMarker } from "./parts";
import {
  CALENDAR_TAGS,
  IMPORTANCE_LEVELS,
  type CalendarCountry,
  type CalendarFilters,
  type CalendarTag,
  type Importance,
  type SortDir,
  type SortKey,
} from "./types";
import { DEFAULT_SORT_DIR, type DayRange, type Facets } from "./utils";

const SORT_KEYS: SortKey[] = ["time", "importance", "country", "event"];

/**
 * The calendar's filter bar (components/ui/filter-bar.tsx, the belif.tr catalogue
 * bar): TARİH (presets, range, status), FİLTRELE (importance, country, topic) and
 * SIRALA menus. Every pick applies at once and lands in the URL (`cal_*`); what is
 * picked shows in the menus' summaries, nowhere else.
 */
export function CalendarFilterBar({
  filters,
  update,
  facets,
  range,
  today,
  window,
  clockKnown,
  countries,
  loadingCountries,
  total,
  className,
}: {
  filters: CalendarFilters;
  update: (patch: FiltersUpdate) => void;
  facets: Facets;
  /** The date filter resolved to days; null = none. */
  range: DayRange | null;
  today: string | null;
  window: DayRange | null;
  clockKnown: boolean;
  /** Countries the source publishes. */
  countries: CalendarCountry[];
  /** Picked countries whose data is still being fetched. */
  loadingCountries: string[];
  /** Events the current filters show (the FİLTRELE panel's button). */
  total: number;
  className?: string;
}) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const text = useFilterBarText();

  // No level ticked, or all three, filters nothing.
  const importanceGroup: FilterGroupSpec<Importance> = {
    id: "importance",
    label: tt("importance"),
    options: IMPORTANCE_LEVELS.map((level) => ({
      value: level,
      label: IMPORTANCE_LABELS[level][locale],
      count: facets.importance[level],
      marker: <ImportanceMarker level={level} />,
    })),
    selected: filters.importance,
    onChange: (importance) => update({ importance }),
  };

  // A country picked by a link but missing from the source's list still gets a row, or it could not be unticked.
  const sourceNames = new Map(countries.map((country) => [country.code, country.name]));
  const countryCodes = [...sourceNames.keys(), ...filters.countries.filter((code) => !sourceNames.has(code))];
  const countryName = (code: string) => countryLabel(code, locale, sourceNames.get(code));
  const lastCountry = filters.countries.length === 1 ? filters.countries[0] : null;
  const countryGroup: FilterGroupSpec<string> = {
    id: "country",
    label: tt("filterCountry"),
    options: countryCodes.map((code) => {
      const picked = filters.countries.includes(code);
      return {
        value: code,
        label: countryName(code),
        marker: (
          <span aria-hidden="true" className="w-4 shrink-0 text-center text-[13px] leading-none">
            {countryFlag(code)}
          </span>
        ),
        // Only fetched countries have counts; ticking another one fetches it, so it is never dimmed.
        count: picked ? (facets.countries[code] ?? 0) : null,
        loading: loadingCountries.includes(code),
        alwaysEnabled: true,
        title: code === lastCountry ? tt("lastCountry") : undefined,
      };
    }),
    selected: filters.countries,
    onChange: (countries) => update({ countries }),
    selectAll: true,
    // The data is fetched per country: the last picked one stays (locked in the panel).
    minSelected: 1,
  };

  // Every topic stays listed; the bar dims the ones the other filters leave empty.
  const topicGroup: FilterGroupSpec<CalendarTag> = {
    id: "topic",
    label: tt("filterTopic"),
    options: CALENDAR_TAGS.map((tag) => ({ value: tag, label: TAG_LABELS[tag].long[locale], count: facets.tags[tag] })),
    selected: filters.tags,
    onChange: (tags) => update({ tags }),
    selectAll: true,
  };

  // Defaults (high + mid, TR + US) are not picks the summary names; "Temizle" returns to them.
  const defaultCountries = sameSet(filters.countries, DEFAULT_COUNTRIES);
  const defaultImportance = sameSet(filters.importance, DEFAULT_IMPORTANCE);
  const importanceNarrows = filters.importance.length > 0 && filters.importance.length < IMPORTANCE_LEVELS.length;
  const filterSummary = summarizePicks(
    [
      ...(importanceNarrows && !defaultImportance ? filters.importance.map((level) => IMPORTANCE_LABELS[level][locale]) : []),
      ...(defaultCountries ? [] : filters.countries.map(countryName)),
      ...filters.tags.map((tag) => TAG_LABELS[tag].long[locale]),
    ],
    text,
  );

  const sortOptions: FilterOption<SortKey>[] = SORT_KEYS.map((key) => ({ value: key, label: SORT_LABELS[key][locale] }));
  const dirOptions: FilterOption<SortDir>[] = [
    { value: "asc", label: tt("ascending") },
    { value: "desc", label: tt("descending") },
  ];
  const sortSummary = `${SORT_LABELS[filters.sort][locale]} · ${tt(filters.dir === "asc" ? "ascending" : "descending")}`;

  return (
    <FilterBar label={tt("filtersLabel")} className={className}>
      <DateMenu
        preset={filters.range}
        range={range}
        today={today}
        window={window}
        status={filters.status}
        statusCounts={facets.status}
        clockKnown={clockKnown}
        onRangeChange={update}
        onStatusChange={(status) => update({ status })}
      />

      <FilterGroupsMenu
        label={text.filter}
        value={filterSummary}
        groups={[importanceGroup, countryGroup, topicGroup]}
        onClear={() => update({ importance: DEFAULT_IMPORTANCE, countries: DEFAULT_COUNTRIES, tags: [] })}
        clearDisabled={defaultImportance && defaultCountries && filters.tags.length === 0}
        applyLabel={tt("showEvents", { n: total })}
        empty={total === 0}
      />

      <FilterMenu label={text.sort} value={sortSummary} icon="sort">
        {/* A new order starts in its natural direction (time and names ascending, importance descending). */}
        <FilterChoiceList label={tt("sort")} showLabel value={filters.sort} options={sortOptions} onChange={(sort) => update({ sort, dir: DEFAULT_SORT_DIR[sort] })} />
        <div className="mt-1 border-t border-border">
          <FilterChoiceList label={tt("direction")} showLabel value={filters.dir} options={dirOptions} onChange={(dir) => update({ dir })} />
        </div>
      </FilterMenu>
    </FilterBar>
  );
}
