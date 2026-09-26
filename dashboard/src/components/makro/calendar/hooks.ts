"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CALENDAR_TAGS,
  IMPORTANCE_LEVELS,
  type CalendarFilters,
  type Importance,
  type RangePreset,
  type SortKey,
  type StatusFilter,
} from "./types";

// ---------------------------------------------------------------------------
// Filters ⇄ URL (`cal_*` params, so links are shareable) + remembered countries
// ---------------------------------------------------------------------------

export const DEFAULT_COUNTRIES = ["TR", "US"];
export const DEFAULT_IMPORTANCE: Importance[] = ["high", "mid"];

export const DEFAULT_FILTERS: CalendarFilters = {
  q: "",
  event: null,
  countries: DEFAULT_COUNTRIES,
  importance: DEFAULT_IMPORTANCE,
  tags: [],
  status: "all",
  range: "thisWeek",
  from: null,
  to: null,
  sort: "time",
  dir: "asc",
};

const PARAM = {
  q: "cal_q",
  event: "cal_ev",
  countries: "cal_c",
  importance: "cal_imp",
  tags: "cal_tag",
  status: "cal_st",
  range: "cal_r",
  from: "cal_from",
  to: "cal_to",
  sort: "cal_sort",
} as const;

const COUNTRIES_STORAGE_KEY = "hisse.calendar.countries";
const RANGES: readonly RangePreset[] = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "lastWeek",
  "thisMonth",
  "nextMonth",
  "lastMonth",
  "all",
  "custom",
];
const STATUSES: readonly StatusFilter[] = ["all", "upcoming", "released"];
const SORTS: readonly SortKey[] = ["time", "importance", "country", "event"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function list(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function storedCountries(): string[] | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(COUNTRIES_STORAGE_KEY) ?? "null");
    if (!Array.isArray(parsed)) return null;
    const codes = parsed.map(String).filter((code) => /^[A-Z]{2}$/.test(code));
    return codes.length > 0 ? codes.slice(0, 16) : null;
  } catch {
    return null;
  }
}

export function parseFilters(params: URLSearchParams, fallbackCountries: string[] | null): CalendarFilters {
  const countries = [...new Set(list(params, PARAM.countries).map((c) => c.toUpperCase()))].filter((c) =>
    /^[A-Z]{2}$/.test(c),
  );
  const importanceRaw = params.get(PARAM.importance);
  const importance =
    importanceRaw === null
      ? DEFAULT_IMPORTANCE
      : importanceRaw === "all"
        ? []
        : IMPORTANCE_LEVELS.filter((level) => list(params, PARAM.importance).includes(level));
  const from = params.get(PARAM.from);
  const to = params.get(PARAM.to);
  const rangeRaw = params.get(PARAM.range) as RangePreset | null;
  const sortRaw = params.get(PARAM.sort) ?? "";
  const sortKey = sortRaw.replace(/^-/, "") as SortKey;
  const status = params.get(PARAM.status) as StatusFilter | null;

  return {
    q: (params.get(PARAM.q) ?? "").slice(0, 100),
    event: params.get(PARAM.event)?.slice(0, 200) || null,
    countries: countries.length > 0 ? countries.slice(0, 16) : (fallbackCountries ?? DEFAULT_COUNTRIES),
    // As checked: every level ticked stays ticked (it filters nothing, like none).
    importance,
    tags: CALENDAR_TAGS.filter((tag) => list(params, PARAM.tags).includes(tag)),
    status: status && STATUSES.includes(status) ? status : "all",
    range: rangeRaw && RANGES.includes(rangeRaw) ? rangeRaw : from || to ? "custom" : "thisWeek",
    from: from && DAY_RE.test(from) ? from : null,
    to: to && DAY_RE.test(to) ? to : null,
    sort: SORTS.includes(sortKey) ? sortKey : "time",
    dir: SORTS.includes(sortKey) && sortRaw.startsWith("-") ? "desc" : "asc",
  };
}

/** Only non-default values are written, so the plain page URL stays clean. */
function serializeFilters(filters: CalendarFilters): Record<string, string | null> {
  return {
    [PARAM.q]: filters.q.trim() || null,
    [PARAM.event]: filters.event,
    [PARAM.countries]: sameSet(filters.countries, DEFAULT_COUNTRIES) ? null : filters.countries.join(","),
    [PARAM.importance]: sameSet(filters.importance, DEFAULT_IMPORTANCE)
      ? null
      : filters.importance.length === 0
        ? "all"
        : filters.importance.join(","),
    [PARAM.tags]: filters.tags.length > 0 ? filters.tags.join(",") : null,
    [PARAM.status]: filters.status === "all" ? null : filters.status,
    [PARAM.range]: filters.range === "thisWeek" || filters.range === "custom" ? null : filters.range,
    [PARAM.from]: filters.range === "custom" ? filters.from : null,
    [PARAM.to]: filters.range === "custom" ? filters.to : null,
    [PARAM.sort]: filters.sort === "time" && filters.dir === "asc" ? null : `${filters.dir === "desc" ? "-" : ""}${filters.sort}`,
  };
}

export type FiltersUpdate = Partial<CalendarFilters> | ((current: CalendarFilters) => Partial<CalendarFilters>);

export function useCalendarFilters() {
  const searchParams = useSearchParams();
  // Read once: afterwards this state is the source of truth and the URL follows it.
  const [filters, setFilters] = useState<CalendarFilters>(() =>
    parseFilters(new URLSearchParams(searchParams.toString()), typeof window === "undefined" ? null : storedCountries()),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    for (const [key, value] of Object.entries(serializeFilters(filters))) {
      if (url.searchParams.get(key) === value) continue;
      changed = true;
      if (value === null) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    // `null` state lets Next.js keep its router in sync (native history integration).
    if (changed) window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [filters]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COUNTRIES_STORAGE_KEY, JSON.stringify(filters.countries));
    } catch {
      // Storage can be unavailable (private mode); the URL still carries the choice.
    }
  }, [filters.countries]);

  const update = useCallback((patch: FiltersUpdate) => {
    setFilters((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);

  /** Clears what narrows the list; keeps countries (a fetch choice) and the sort order. */
  const reset = useCallback(() => {
    setFilters((current) => ({ ...DEFAULT_FILTERS, countries: current.countries, sort: current.sort, dir: current.dir }));
  }, []);

  return { filters, update, reset };
}

export function isNarrowed(filters: CalendarFilters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.event !== null ||
    !sameSet(filters.importance, DEFAULT_IMPORTANCE) ||
    filters.tags.length > 0 ||
    filters.status !== "all" ||
    filters.range !== "thisWeek"
  );
}

export function toggleIn<T>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? items.filter((x) => x !== item) : [...items, item];
}
