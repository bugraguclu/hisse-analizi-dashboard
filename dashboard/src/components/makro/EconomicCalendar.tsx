"use client";

import { Suspense, useCallback, useMemo, useState, type JSX, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarPlus, Crosshair, Download, Info, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { formatMarketDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { istanbulClock } from "@/lib/market-hours";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { MACRO_QUERY_ROOT } from "@/components/makro/queries";
import { PanelEmpty, PanelError, Shimmer } from "@/components/makro/ui";
import { CalendarTable, PAGE_SIZE } from "./calendar/CalendarTable";
import { DayStrip } from "./calendar/DayStrip";
import { CalendarFilterBar } from "./calendar/FilterControls";
import { isNarrowed, toggleIn, useCalendarFilters } from "./calendar/hooks";
import { countryFlag, countryLabel, useCalendarText } from "./calendar/i18n";
import { QueryBar } from "./calendar/QueryBar";
import type { CalendarRow, CalendarTag, SortKey } from "./calendar/types";
import {
  DEFAULT_SORT_DIR,
  downloadFile,
  fetchWindowFor,
  filterRows,
  formatDay,
  formatDuration,
  formatRangeLabel,
  isUpcoming,
  localizeRows,
  normalizeCalendar,
  resolveRange,
  scheduledReleases,
  searchTerms,
  sortRows,
  toCsv,
  toIcs,
} from "./calendar/utils";

/** @deprecated Legacy row shape (the calendar now fetches and normalizes its own data). */
export interface CalendarItem {
  Event?: unknown;
  Date?: unknown;
  Time?: unknown;
  Country?: unknown;
  Importance?: unknown;
  Actual?: unknown;
  Forecast?: unknown;
  Previous?: unknown;
}

/** @deprecated Accepted for compatibility and ignored — render `<EconomicCalendar />`. */
export interface EconomicCalendarProps {
  items?: CalendarItem[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  noDataLabel?: string;
}

const EMPTY_ROWS: CalendarRow[] = [];
const ICS_LIMIT = 200;

/**
 * Economic calendar (TradingView via GET /macro/calendar; Turkish names from
 * doviz.com): last month → next month with actual / forecast / previous values,
 * a search field on the belif site search's mechanics, a belif-style filter bar
 * (date + status; importance, country + topic; sort — with live counts), day
 * strip, sortable table grouped by day, expandable rows with the next release,
 * CSV / .ics export. A date range outside that window loads its own months. Every
 * filter lives in the URL (`cal_*`), so views are shareable. Section heading
 * comes from the page.
 */
export const EconomicCalendar: (props: EconomicCalendarProps) => JSX.Element = function EconomicCalendar() {
  // Not overflow-hidden: the filter bar's panels hang out of it and a short card (no
  // matches, one day) would cut them off.
  return (
    <div className="card-surface min-w-0">
      <Suspense fallback={<CalendarSkeleton />}>
        <CalendarBody />
      </Suspense>
    </div>
  );
};

function CalendarSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true">
      <Shimmer className="h-9 w-full" />
      <Shimmer className="h-11 w-full" />
      <div className="flex gap-1">
        {Array.from({ length: 12 }, (_, i) => (
          <Shimmer key={i} className="h-14 w-12 shrink-0" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <Shimmer key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CalendarBody() {
  const { locale, t } = useLocale();
  const tt = useCalendarText();
  const { filters, update, reset } = useCalendarFilters();
  const clock = useNow();
  const now = clock ?? 0;
  const today = clock !== null ? istanbulClock(clock).dateKey : null;

  const countriesKey = useMemo(() => [...filters.countries].sort().join(","), [filters.countries]);
  // The backend loads last month → next month; a range outside it asks for its own months.
  const requested = useMemo(
    () => fetchWindowFor(resolveRange({ range: filters.range, from: filters.from, to: filters.to }, today, null), today),
    [filters.range, filters.from, filters.to, today],
  );
  const query = useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "calendar", "board", countriesKey, requested ? `${requested.from}_${requested.to}` : "default"],
    queryFn: async ({ signal }) =>
      normalizeCalendar(
        await api.economicCalendar({ countries: countriesKey.split(","), start: requested?.from, end: requested?.to }, signal),
      ),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  // Viewing another window (a past month), the default one still supplies what is
  // scheduled next: it reaches as far ahead as the source publishes. Same key as the
  // default view, so it is usually already cached.
  const homeQuery = useQuery({
    queryKey: [...MACRO_QUERY_ROOT, "calendar", "board", countriesKey, "default"],
    queryFn: async ({ signal }) => normalizeCalendar(await api.economicCalendar({ countries: countriesKey.split(",") }, signal)),
    staleTime: 5 * 60_000,
    enabled: requested !== null,
  });
  const data = query.data;
  const allRows = data?.rows ?? EMPTY_ROWS;
  const homeData = requested !== null ? homeQuery.data : undefined;
  const homeRows = homeData?.rows ?? EMPTY_ROWS;

  const selectedSet = useMemo(() => new Set(filters.countries), [filters.countries]);
  // Placeholder data (previous country set) may still hold a just-removed country.
  const rows = useMemo(
    () => localizeRows(allRows.filter((row) => selectedSet.has(row.countryCode)), locale),
    [allRows, selectedSet, locale],
  );
  const homeLocalized = useMemo(
    () => localizeRows(homeRows.filter((row) => selectedSet.has(row.countryCode)), locale),
    [homeRows, selectedSet, locale],
  );
  const scheduled = useMemo(() => scheduledReleases([rows, homeLocalized], now, today), [rows, homeLocalized, now, today]);
  // The source schedules about a month ahead: the last day it has published so far.
  const lastPublished = useMemo(() => allRows.reduce((last, row) => (row.date > last ? row.date : last), ""), [allRows]);
  const sourceWindow = data?.window ?? null;
  const dataWindow = useMemo(
    () => (sourceWindow ? { from: sourceWindow.start, to: sourceWindow.end } : null),
    [sourceWindow],
  );
  const { range: preset, from, to } = filters;
  const range = useMemo(() => resolveRange({ range: preset, from, to }, today, dataWindow), [preset, from, to, today, dataWindow]);
  const { visible, facets } = useMemo(() => filterRows(rows, filters, { range, now, today }), [rows, filters, range, now, today]);
  const sorted = useMemo(() => sortRows(visible, filters.sort, filters.dir, locale), [visible, filters.sort, filters.dir, locale]);
  const terms = useMemo(() => searchTerms(filters.q), [filters.q]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  // A new result set starts from the first page again (adjusted during render, no effect).
  const listKey = [countriesKey, filters.q, filters.event, filters.importance.join(), filters.tags.join(), filters.status, range?.from, range?.to, filters.sort, filters.dir].join("|");
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (listKey !== prevListKey) {
    setPrevListKey(listKey);
    setLimit(PAGE_SIZE);
  }

  const next = useMemo(() => {
    if (!now) return { key: null, decision: null };
    const upcoming = rows.filter((row) => !row.allDay && row.ts > now).sort((a, b) => a.ts - b.ts);
    return {
      key: upcoming.find((row) => row.importance === "high") ?? null,
      decision: upcoming.find((row) => row.keyEvent) ?? null,
    };
  }, [rows, now]);

  const onScrolled = useCallback(() => setScrollTarget(null), []);

  const focusRow = (row: CalendarRow) => {
    const index = sorted.findIndex((item) => item.id === row.id);
    if (index === -1) {
      // Hidden by the current filters: show that day with everything else cleared.
      update({ q: "", event: null, tags: [], status: "all", importance: [], range: "custom", from: row.date, to: row.date, sort: "time", dir: "asc" });
    } else if (index >= limit) {
      setLimit(index + PAGE_SIZE);
    }
    setExpandedId(row.id);
    setScrollTarget(row.id);
  };

  const goToday = () => {
    const coversToday = Boolean(range && today && range.from <= today && today <= range.to);
    if (!coversToday || filters.sort !== "time") update({ ...(coversToday ? {} : { range: "thisWeek" as const }), sort: "time", dir: "asc" });
    else setLimit(Math.max(limit, sorted.length));
    setScrollTarget("now");
  };

  const onSort = (key: SortKey) =>
    update((current) =>
      current.sort === key
        ? { dir: current.dir === "asc" ? "desc" : "asc" }
        : { sort: key, dir: DEFAULT_SORT_DIR[key] },
    );

  const toggleTag = (tag: CalendarTag) => update((current) => ({ tags: toggleIn(current.tags, tag) }));
  const pickEvent = (key: string) => update({ event: key, q: "", range: "all" });

  const upcomingVisible = useMemo(
    () => (now ? sorted.filter((row) => isUpcoming(row, now, today)).slice(0, ICS_LIMIT) : []),
    [sorted, now, today],
  );
  const fileStem = `ekonomik-takvim_${range ? `${range.from}_${range.to}` : "tum"}`;

  if (query.isPending) return <CalendarSkeleton />;
  if (query.isError && !data) return <PanelError error={query.error} onRetry={() => void query.refetch()} />;
  if (!data) return null;

  const failed = data.failedCountries.filter((code) => selectedSet.has(code));
  const loadingCountries = query.isPlaceholderData ? filters.countries.filter((code) => !data.countries.includes(code)) : [];
  const eventTitle = filters.event ? rows.find((row) => row.titleKey === filters.event)?.title ?? filters.event : null;
  const narrowed = isNarrowed(filters);
  const monthName = (month: string) => formatDay(`${month}-01`, locale, { month: "long", year: "numeric" });
  const showHorizon = Boolean(range && today && lastPublished && lastPublished >= today && range.to > lastPublished);
  const sourceLabel = data.providers.includes("tradingview")
    ? tt("sourceTradingView")
    : data.source?.startsWith("doviz.com")
      ? tt("sourceDoviz")
      : data.source;

  // A window the user asked for keeps the filter bar even when empty, or there would be no way back.
  if (!data.available && loadingCountries.length === 0 && !requested) {
    return failed.length > 0 ? (
      <PanelError error={new Error(tt("sourceDown"))} onRetry={() => void query.refetch()} />
    ) : (
      <PanelEmpty message={tt("noCalendar")} />
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-stretch gap-x-5 gap-y-2">
          {next.key && <NextRelease label={tt("nextKey")} row={next.key} now={now} onSelect={() => focusRow(next.key!)} />}
          {next.decision && next.decision.id !== next.key?.id && (
            <NextRelease label={tt("nextDecision")} row={next.decision} now={now} onSelect={() => focusRow(next.decision!)} />
          )}
          {!next.key && !next.decision && (
            <p className="text-[13px] font-semibold text-foreground">{tt("resultCount", { n: rows.length })}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ToolbarButton
            onClick={() => void query.refetch()}
            label={query.isFetching ? tt("updating") : tt("refresh")}
            icon={<RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} aria-hidden="true" />}
            iconOnly
          />
          <ToolbarButton
            onClick={() => downloadFile(`${fileStem}.csv`, toCsv(sorted, locale), "text/csv;charset=utf-8")}
            disabled={sorted.length === 0}
            label={tt("exportCsv")}
            icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            CSV
          </ToolbarButton>
          <ToolbarButton
            onClick={() => downloadFile(`${fileStem}.ics`, toIcs(upcomingVisible, locale, now), "text/calendar;charset=utf-8")}
            disabled={upcomingVisible.length === 0}
            label={tt("exportIcs")}
            icon={<CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            .ics
          </ToolbarButton>
        </div>
      </header>

      <div className="px-4 py-3">
        <QueryBar
          value={filters.q}
          onCommit={(q) => update({ q })}
          rows={rows}
          scheduled={scheduled}
          now={now}
          today={today}
          countries={data.supportedCountries}
          selectedCountries={filters.countries}
          onPickEvent={pickEvent}
          onAddCountry={(code) =>
            update((current) => (current.countries.includes(code) ? {} : { countries: [...current.countries, code] }))
          }
        />
      </div>

      {/* Its hairlines span the card; the content is inset like every other row. */}
      <CalendarFilterBar
        className="px-4"
        filters={filters}
        update={update}
        facets={facets}
        range={range}
        today={today}
        window={dataWindow}
        clockKnown={now > 0}
        countries={data.supportedCountries}
        loadingCountries={loadingCountries}
        total={sorted.length}
      />
      <DayStrip
        className="border-b border-border px-4 py-2"
        range={range}
        today={today}
        window={dataWindow}
        dayCounts={facets.days}
        onChange={update}
      />

      {(failed.length > 0 || data.unavailableMonths.length > 0) && (
        <p role="status" className="flex flex-wrap items-center gap-2 border-b border-border bg-warn/10 px-4 py-2 text-[11px] text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {[
            data.unavailableMonths.length > 0 ? tt("monthsUnavailable", { months: data.unavailableMonths.map(monthName).join(", ") }) : "",
            failed.length > 0 ? tt("partialFailure", { countries: failed.map((code) => countryLabel(code, locale)).join(", ") }) : "",
          ]
            .filter(Boolean)
            .join(" ")}
          <button type="button" onClick={() => void query.refetch()} className="ml-auto underline underline-offset-2">
            {t("common.retry")}
          </button>
        </p>
      )}
      {data.providers.includes("doviz") && (
        <p role="status" className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {tt("fallbackNote")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-[11px]">
        <span className="font-medium text-foreground" aria-live="polite">
          {sorted.length === rows.length ? tt("resultCount", { n: sorted.length }) : tt("resultOf", { n: sorted.length, total: rows.length })}
        </span>
        {range && <span className="text-muted-foreground">{formatRangeLabel(range.from, range.to, locale)}</span>}
        {range && dataWindow && !query.isPlaceholderData && (range.from < dataWindow.from || range.to > dataWindow.to) ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
            {tt("rangeBeyondWindow", { range: formatRangeLabel(dataWindow.from, dataWindow.to, locale) })}
          </span>
        ) : (
          showHorizon && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
              {tt("horizonNote", { date: formatDay(lastPublished, locale, { day: "numeric", month: "long" }) })}
            </span>
          )
        )}
        {/* An exact event (picked from a suggestion or a row) is in no menu: it is named here, as text. */}
        {eventTitle && (
          <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
            <span className="min-w-0 truncate text-foreground">{tt("eventFilter", { name: eventTitle })}</span>
            <button
              type="button"
              onClick={() => update({ event: null })}
              aria-label={tt("removeFilter", { name: eventTitle })}
              className="shrink-0 rounded-sm font-medium text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {tt("remove")}
            </button>
          </span>
        )}
        <button
          type="button"
          onClick={goToday}
          disabled={!today}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <Crosshair className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {tt("goToday")}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <p className="text-[13px] text-muted-foreground">{tt("noMatch")}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {narrowed && (
              <button type="button" onClick={reset} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
                {tt("clearFilters")}
              </button>
            )}
            {filters.range !== "all" && (
              <button type="button" onClick={() => update({ range: "all" })} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
                {tt("searchAllDates")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <CalendarTable
          rows={sorted}
          scheduled={scheduled}
          onJump={focusRow}
          sort={filters.sort}
          dir={filters.dir}
          onSort={onSort}
          terms={terms}
          now={now}
          today={today}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
          selectedTags={filters.tags}
          onToggleTag={toggleTag}
          onOnlyEvent={pickEvent}
          limit={limit}
          onShowMore={() => setLimit((current) => current + PAGE_SIZE)}
          scrollTarget={scrollTarget}
          onScrolled={onScrolled}
        />
      )}

      <footer className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {[
          sourceLabel,
          dataWindow ? tt("windowNote", { range: formatRangeLabel(dataWindow.from, dataWindow.to, locale) }) : null,
          data.asOf ? tt("updatedAt", { time: formatMarketDate(data.asOf, "time") }) : null,
          tt("sourceNote"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </footer>
    </>
  );
}

function NextRelease({ label, row, now, onSelect }: { label: string; row: CalendarRow; now: number; onSelect: () => void }) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="truncate text-[13px] font-semibold text-foreground group-hover:underline group-hover:underline-offset-2">
          <span aria-hidden="true">{countryFlag(row.countryCode)} </span>
          {row.title}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatMarketDate(row.ts, "dayMonthTime")} · {tt("inTime", { x: formatDuration(row.ts - now, locale) })}
        </span>
      </span>
    </button>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  label,
  icon,
  iconOnly = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
  iconOnly?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={iconOnly ? label : undefined}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      {!iconOnly && children}
      {!iconOnly && <span className="sr-only">{label}</span>}
    </button>
  );
}
