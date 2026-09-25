"use client";

import { useId } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FilterChoiceList, FilterMenu, FilterPanelSection, type FilterOption } from "@/components/ui/filter-bar";
import { useLocale } from "@/lib/locale-context";
import { RANGE_LABELS, STATUS_LABELS, useCalendarText } from "./i18n";
import type { CalendarFilters, RangePreset, StatusFilter } from "./types";
import {
  defaultWindow,
  EARLIEST_DAY,
  formatRangeLabel,
  presetRange,
  rangeFilters,
  rangesOverlap,
  shiftRange,
  type DayRange,
  type Facets,
} from "./utils";

const PRESETS: RangePreset[] = [
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
const STATUSES: StatusFilter[] = ["all", "upcoming", "released"];

const shiftButton =
  "flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-35 pointer-coarse:h-9 pointer-coarse:w-9";

// 16 px below md: iOS zooms the page into any smaller field it focuses (as the query bar).
const dateInput =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 font-mono text-base tabular-nums text-foreground outline-none transition-colors hover:border-foreground/30 focus:border-ring md:text-xs [color-scheme:light] dark:[color-scheme:dark]";

/**
 * TARİH in the filter bar: the presets, then the range itself (from / to fields,
 * ‹ › step one period back or forward) and the release status — upcoming vs.
 * released is a question about time too. Picks apply at once; "Özel aralık"
 * keeps the panel open for its fields. A range outside the loaded window loads its
 * months (EconomicCalendar), so the fields reach back to EARLIEST_DAY; "Tümü" is the
 * default window (last month → next month).
 */
export function DateMenu({
  preset,
  range,
  today,
  window,
  status,
  statusCounts,
  clockKnown,
  onRangeChange,
  onStatusChange,
}: {
  preset: RangePreset;
  /** The preset resolved to days; null = no date filter (unknown clock / no window). */
  range: DayRange | null;
  today: string | null;
  window: DayRange | null;
  status: StatusFilter;
  statusCounts: Facets["status"];
  clockKnown: boolean;
  onRangeChange: (next: Pick<CalendarFilters, "range" | "from" | "to">) => void;
  onStatusChange: (next: StatusFilter) => void;
}) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const rangeId = useId();
  const fromId = useId();
  const toId = useId();

  // "Tümü" and the reachable days: the default window, from EARLIEST_DAY up to its end.
  const home = today ? defaultWindow(today) : window;
  const bounds = home ? { from: EARLIEST_DAY, to: home.to } : null;

  const selectRange = (next: DayRange) => onRangeChange(rangeFilters(next, today, home));
  const canShift = (direction: 1 | -1) => Boolean(range && bounds && rangesOverlap(shiftRange(range, direction), bounds));
  const shift = (direction: 1 | -1) => {
    if (range) selectRange(shiftRange(range, direction));
  };

  const pickPreset = (next: RangePreset) => {
    // A custom range starts from the days on screen.
    if (next === "custom") onRangeChange({ range: next, from: range?.from ?? null, to: range?.to ?? null });
    else onRangeChange({ range: next, from: null, to: null });
  };

  // Each preset's days as its tooltip; a preset out of reach is dimmed.
  const presetOptions: FilterOption<RangePreset>[] = PRESETS.map((item) => {
    if (item === "custom") return { value: item, label: RANGE_LABELS[item][locale] };
    const candidate = item === "all" ? home : today ? presetRange(item, today) : null;
    const outside = Boolean(candidate && bounds && !rangesOverlap(candidate, bounds));
    return {
      value: item,
      label: RANGE_LABELS[item][locale],
      title: outside ? tt("outOfWindow") : candidate ? formatRangeLabel(candidate.from, candidate.to, locale) : undefined,
      disabled: outside || !candidate,
    };
  });

  // "Upcoming" is relative to now: until the clock is known there is nothing to count or split.
  const statusOptions: FilterOption<StatusFilter>[] = STATUSES.map((item) => ({
    value: item,
    label: STATUS_LABELS[item][locale],
    count: clockKnown ? (item === "all" ? statusCounts.upcoming + statusCounts.released : statusCounts[item]) : null,
    disabled: !clockKnown && item !== "all",
    // The way back is never dimmed, even when the other two find nothing.
    alwaysEnabled: item === "all",
  }));

  const rangeText =
    preset !== "custom"
      ? RANGE_LABELS[preset][locale]
      : range
        ? formatRangeLabel(range.from, range.to, locale)
        : RANGE_LABELS.custom[locale];
  // Status lives in this panel, so its summary names it too — nothing picked goes unseen.
  const summary = status === "all" ? rangeText : `${rangeText} · ${STATUS_LABELS[status][locale]}`;

  // Taller than a plain list: the range fields and the status list sit under the presets.
  return (
    <FilterMenu label={tt("date")} value={summary} icon="date" panelClassName="max-h-[min(34rem,75vh)] sm:max-h-[min(34rem,80vh)]">
      <FilterChoiceList
        label={tt("date")}
        value={preset}
        options={presetOptions}
        onChange={pickPreset}
        keepOpen={(item) => item === "custom"}
      />
      <FilterPanelSection
        label={tt("dateRange")}
        labelId={rangeId}
        actions={
          <>
            <button type="button" onClick={() => shift(-1)} disabled={!canShift(-1)} aria-label={tt("prevRange")} title={tt("prevRange")} className={shiftButton}>
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => shift(1)} disabled={!canShift(1)} aria-label={tt("nextRange")} title={tt("nextRange")} className={shiftButton}>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        }
      >
        <div role="group" aria-labelledby={rangeId}>
          {/* One field per row: a date input needs ~125px, half of the panel does not have it. */}
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
            <label htmlFor={fromId} className="text-xs text-muted-foreground">
              {tt("from")}
            </label>
            <input
              id={fromId}
              type="date"
              value={range?.from ?? ""}
              min={bounds?.from}
              max={bounds?.to}
              onChange={(event) => {
                const from = event.target.value;
                if (from) selectRange({ from, to: range && range.to >= from ? range.to : from });
              }}
              className={dateInput}
            />
            <label htmlFor={toId} className="text-xs text-muted-foreground">
              {tt("to")}
            </label>
            <input
              id={toId}
              type="date"
              value={range?.to ?? ""}
              min={range?.from ?? bounds?.from}
              max={bounds?.to}
              onChange={(event) => {
                const to = event.target.value;
                if (to) selectRange({ from: range && range.from <= to ? range.from : to, to });
              }}
              className={dateInput}
            />
          </div>
        </div>
      </FilterPanelSection>
      <div className="border-t border-border">
        <FilterChoiceList label={tt("status")} showLabel value={status} options={statusOptions} onChange={onStatusChange} />
      </div>
    </FilterMenu>
  );
}
