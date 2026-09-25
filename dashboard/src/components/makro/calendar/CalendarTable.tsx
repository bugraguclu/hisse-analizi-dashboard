"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarPlus,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Filter,
  Landmark,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { agencyLabel, countryLabel, SORT_LABELS, TAG_LABELS, useCalendarText, type CalendarText } from "./i18n";
import { Flag, Highlight, IMPORTANCE_RULE, ImportanceText } from "./parts";
import type { CalendarRow, CalendarTag, SortDir, SortKey } from "./types";
import {
  addDays,
  changeVsForecast,
  changeVsPrevious,
  downloadFile,
  formatDay,
  formatDuration,
  formatPeriod,
  formatValue,
  groupByDay,
  isUpcoming,
  nextReleaseOf,
  toIcs,
  type ValueChange,
} from "./utils";

/** Rows rendered per "show more" step — keeps month-wide, all-country views fast. */
export const PAGE_SIZE = 150;
const SOON_MS = 60 * 60_000;

interface TableProps {
  rows: CalendarRow[];
  /** Releases still to come, soonest first (see `scheduledReleases`): the detail's "next release". */
  scheduled: CalendarRow[];
  /** Shows a row (the next release) in the table, expanded. */
  onJump: (row: CalendarRow) => void;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  terms: string[];
  now: number;
  today: string | null;
  expandedId: string | null;
  onToggle: (id: string) => void;
  selectedTags: CalendarTag[];
  onToggleTag: (tag: CalendarTag) => void;
  onOnlyEvent: (titleKey: string) => void;
  limit: number;
  onShowMore: () => void;
  /** Row id (or "now") to bring into view once rendered. */
  scrollTarget: string | null;
  onScrolled: () => void;
}

export function CalendarTable(props: TableProps) {
  const { rows, sort, dir, onSort, now, today, limit, onShowMore, scrollTarget, onScrolled } = props;
  const { locale } = useLocale();
  const tt = useCalendarText();
  const scrollRef = useRef<HTMLDivElement>(null);
  const grouped = sort === "time";
  const shown = useMemo(() => rows.slice(0, limit), [rows, limit]);
  const showForecast = shown.some((row) => row.forecast);
  const columns = showForecast ? 8 : 7;

  const dayTotals = useMemo(() => {
    const totals = new Map<string, { count: number; high: number }>();
    for (const row of rows) {
      const entry = totals.get(row.date) ?? { count: 0, high: 0 };
      entry.count += 1;
      if (row.importance === "high") entry.high += 1;
      totals.set(row.date, entry);
    }
    return totals;
  }, [rows]);

  // "Now" line between the last released and the first upcoming row — only when it falls on today.
  const nowIndex = useMemo(() => {
    if (!grouped || now <= 0 || !today || shown.length === 0) return -1;
    let index = shown.findIndex((row) => (dir === "asc") === isUpcoming(row, now, today));
    if (index === -1) index = shown.length;
    const touchesToday = shown[index]?.date === today || shown[index - 1]?.date === today;
    return touchesToday ? index : -1;
  }, [grouped, now, today, shown, dir]);

  useEffect(() => {
    if (!scrollTarget) return;
    const container = scrollRef.current;
    const selector = scrollTarget === "now" ? "[data-now-marker]" : `[data-row-id="${CSS.escape(scrollTarget)}"]`;
    const target = container?.querySelector<HTMLElement>(selector) ??
      (scrollTarget === "now" && today ? container?.querySelector<HTMLElement>(`[data-day-header="${today}"]`) : null);
    if (container && target) {
      const offset = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, offset - 76), behavior: "smooth" });
      container.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    onScrolled();
  }, [scrollTarget, onScrolled, today, shown]);

  const renderRows = (list: CalendarRow[], startIndex: number) =>
    list.map((row, i) => (
      <Fragment key={row.id}>
        {startIndex + i === nowIndex && <NowMarker columns={columns} now={now} locale={locale} tt={tt} />}
        <CalendarRowView {...props} row={row} grouped={grouped} columns={columns} showForecast={showForecast} />
      </Fragment>
    ));

  const groups = useMemo(() => (grouped ? groupByDay(shown) : []), [grouped, shown]);

  return (
    <div ref={scrollRef} className="relative max-h-[min(72vh,780px)] overflow-auto overscroll-contain scrollbar-thin">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{tt("tableCaption", { n: rows.length })}</caption>
        <thead>
          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:border-b [&>th]:border-border [&>th]:bg-card">
            <SortHeader sortKey="time" label={grouped ? tt("colTime") : tt("colDate")} {...{ sort, dir, onSort, tt, locale }} className="pl-4" />
            <SortHeader sortKey="country" label={tt("colCountry")} {...{ sort, dir, onSort, tt, locale }} />
            <SortHeader sortKey="importance" label={tt("colImportance")} {...{ sort, dir, onSort, tt, locale }} className="hidden sm:table-cell" />
            <SortHeader sortKey="event" label={tt("colEvent")} {...{ sort, dir, onSort, tt, locale }} />
            <th scope="col" className="hidden h-8 px-2 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">{tt("colActual")}</th>
            {showForecast && (
              <th scope="col" className="hidden h-8 px-2 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground md:table-cell">{tt("colForecast")}</th>
            )}
            <th scope="col" className="hidden h-8 px-2 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">{tt("colPrevious")}</th>
            <th scope="col" className="h-8 w-8 pr-3"><span className="sr-only">{tt("colDetails")}</span></th>
          </tr>
        </thead>
        {grouped ? (
          groups.map((group) => {
            const totals = dayTotals.get(group.date) ?? { count: group.rows.length, high: 0 };
            return (
              <tbody key={group.date}>
                <tr>
                  <th
                    colSpan={columns}
                    scope="rowgroup"
                    data-day-header={group.date}
                    className="sticky top-8 z-10 border-b border-border bg-card px-4 py-1.5 text-left font-normal"
                  >
                    <DayHeader date={group.date} today={today} totals={totals} locale={locale} tt={tt} />
                  </th>
                </tr>
                {renderRows(group.rows, group.start)}
                {nowIndex === shown.length && group.start + group.rows.length === shown.length && (
                  <NowMarker columns={columns} now={now} locale={locale} tt={tt} />
                )}
              </tbody>
            );
          })
        ) : (
          <tbody>{renderRows(shown, 0)}</tbody>
        )}
      </table>
      {rows.length > shown.length && (
        <div className="flex justify-center border-t border-border p-3">
          <button
            type="button"
            onClick={onShowMore}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {tt("showMore", { n: rows.length - shown.length })}
          </button>
        </div>
      )}
    </div>
  );
}

function SortHeader({
  sortKey,
  label,
  sort,
  dir,
  onSort,
  tt,
  locale,
  className,
}: {
  sortKey: SortKey;
  label: string;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  tt: CalendarText;
  locale: Locale;
  className?: string;
}) {
  const active = sort === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-8 px-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={tt("sortBy", { col: SORT_LABELS[sortKey][locale] })}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm uppercase transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-40")} aria-hidden="true" />
      </button>
    </th>
  );
}

function DayHeader({
  date,
  today,
  totals,
  locale,
  tt,
}: {
  date: string;
  today: string | null;
  totals: { count: number; high: number };
  locale: Locale;
  tt: CalendarText;
}) {
  const badge = date === today ? tt("today") : today && date === addDays(today, 1) ? tt("tomorrow") : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <span className="font-semibold capitalize text-foreground">
        {formatDay(date, locale, { weekday: "long", day: "numeric", month: "long" })}
      </span>
      {badge && (
        <span
          className={cn(
            "rounded-sm border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
            date === today ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground",
          )}
        >
          {badge}
        </span>
      )}
      <span className="text-muted-foreground">{tt("dayEvents", { n: totals.count })}</span>
      {totals.high > 0 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
          {tt("dayHigh", { n: totals.high })}
        </span>
      )}
    </div>
  );
}

function NowMarker({ columns, now, locale, tt }: { columns: number; now: number; locale: Locale; tt: CalendarText }) {
  const time = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : `${locale}-TR`, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Europe/Istanbul",
  }).format(now);
  return (
    <tr data-now-marker="" aria-hidden="true">
      <td colSpan={columns} className="px-4 py-1">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          {tt("now")} <span className="font-mono tabular-nums">{time}</span>
          <span className="h-px flex-1 bg-foreground/30" />
        </div>
      </td>
    </tr>
  );
}

function ChangeGlyph({ change, tt, className }: { change: ValueChange; tt: CalendarText; className?: string }) {
  const Icon = change.delta > 0 ? ArrowUp : change.delta < 0 ? ArrowDown : Minus;
  // Direction only (neutral ink): whether "up" is good depends on the indicator.
  return (
    <span className={cn("inline-flex items-center text-muted-foreground", className)} title={tt("changeVsPrevious", { value: change.label })}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{tt("changeVsPrevious", { value: change.label })}</span>
    </span>
  );
}

function CalendarRowView({
  row,
  grouped,
  columns,
  showForecast,
  terms,
  now,
  today,
  expandedId,
  onToggle,
  selectedTags,
  onToggleTag,
  scheduled,
  onJump,
  onOnlyEvent,
}: TableProps & { row: CalendarRow; grouped: boolean; columns: number; showForecast: boolean }) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const expanded = expandedId === row.id;
  const upcoming = now > 0 && isUpcoming(row, now, today);
  const untilMs = upcoming && !row.allDay ? row.ts - now : null;
  const soon = untilMs !== null && untilMs <= SOON_MS;
  const change = changeVsPrevious(row, locale);
  const period = formatPeriod(row, locale);
  const detailId = `cal-detail-${row.id}`;
  const visibleTags = row.tags.filter((tag) => tag !== "other").slice(0, 2);

  return (
    <>
      <tr
        data-row-id={row.id}
        onClick={() => onToggle(row.id)}
        className={cn(
          "group cursor-pointer transition-colors [&>td]:border-b [&>td]:border-border hover:bg-muted/40",
          expanded && "bg-muted/40",
        )}
      >
        <td className="relative w-[4.75rem] whitespace-nowrap py-2 pl-4 pr-2 align-top font-mono text-[11px] tabular-nums">
          {IMPORTANCE_RULE[row.importance] && (
            <span aria-hidden="true" className={cn("absolute inset-y-2 left-0 w-0.5", IMPORTANCE_RULE[row.importance])} />
          )}
          {!grouped && (
            <span className="block text-[10px] text-muted-foreground">
              {formatDay(row.date, locale, { day: "numeric", month: "short" })}
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1.5", upcoming ? "text-foreground" : "text-muted-foreground")}>
            {row.allDay ? <span className="font-sans text-[10px]">{tt("allDay")}</span> : row.time}
            {soon && <span className="h-1.5 w-1.5 rounded-full bg-foreground" title={tt("soon")} />}
          </span>
        </td>
        <td className="px-2 py-2 align-top">
          <Flag code={row.countryCode} locale={locale} fallback={row.countryName} />
        </td>
        <td className="hidden px-2 py-2 align-top sm:table-cell">
          <ImportanceText level={row.importance} locale={locale} />
        </td>
        <td className="min-w-[10rem] px-2 py-2 align-top sm:min-w-[13rem]">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(row.id);
              }}
              aria-expanded={expanded}
              aria-controls={expanded ? detailId : undefined}
              className="rounded-sm text-left text-[13px] leading-snug text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Highlight text={row.title} terms={terms} />
            </button>
            {period && <span className="rounded-sm border border-border px-1 py-px text-[10px] text-muted-foreground">{period}</span>}
            {row.keyEvent && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px text-[10px] font-medium text-foreground">
                <Landmark className="h-2.5 w-2.5" aria-hidden="true" />
                {tt("keyEvent")}
              </span>
            )}
            {soon && untilMs !== null && (
              <span className="text-[10px] font-medium text-foreground">{tt("inTime", { x: formatDuration(untilMs, locale) })}</span>
            )}
          </div>
          {visibleTags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {visibleTags.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={active}
                    title={TAG_LABELS[tag].long[locale]}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleTag(tag);
                    }}
                    className={cn(
                      "rounded-sm border px-1.5 py-px text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      active ? "border-border bg-muted text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {TAG_LABELS[tag].short[locale]}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] tabular-nums sm:hidden">
            <ImportanceText level={row.importance} locale={locale} className="font-sans" />
            <span>
              <span className="font-sans text-muted-foreground">{tt("colActual")}: </span>
              <span className="font-semibold text-foreground">{formatValue(row.actual, locale, row.unit)}</span>
            </span>
            {row.forecast && (
              <span className="text-muted-foreground">
                <span className="font-sans">{tt("colForecast")}: </span>
                {formatValue(row.forecast, locale, row.unit)}
              </span>
            )}
            <span className="text-muted-foreground">
              <span className="font-sans">{tt("colPrevious")}: </span>
              {formatValue(row.previous, locale, row.unit)}
            </span>
          </div>
        </td>
        <td className="hidden whitespace-nowrap px-2 py-2 text-right align-top font-mono text-xs tabular-nums sm:table-cell">
          {row.actual ? (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              {formatValue(row.actual, locale, row.unit)}
              {change && <ChangeGlyph change={change} tt={tt} />}
            </span>
          ) : (
            <span className="text-muted-foreground/60">{EMPTY_VALUE}</span>
          )}
        </td>
        {showForecast && (
          <td className="hidden whitespace-nowrap px-2 py-2 text-right align-top font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
            {formatValue(row.forecast, locale, row.unit)}
          </td>
        )}
        <td className="hidden whitespace-nowrap px-2 py-2 text-right align-top font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
          {formatValue(row.previous, locale, row.unit)}
        </td>
        <td className="w-8 py-2 pr-3 align-top">
          <ChevronDown
            className={cn("mt-0.5 h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180 text-foreground")}
            aria-hidden="true"
          />
        </td>
      </tr>
      {expanded && (
        <tr id={detailId}>
          <td colSpan={columns} className="border-b border-border bg-muted/20 p-0">
            <EventDetail
              row={row}
              scheduled={scheduled}
              onJump={onJump}
              now={now}
              upcoming={upcoming}
              change={change}
              selectedTags={selectedTags}
              onToggleTag={onToggleTag}
              onOnlyEvent={onOnlyEvent}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ValueTile({ label, children, emphasis = false }: { label: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-mono text-sm tabular-nums", emphasis ? "font-semibold text-foreground" : "text-foreground/90")}>
        {children}
      </dd>
    </div>
  );
}

function EventDetail({
  row,
  scheduled,
  onJump,
  now,
  upcoming,
  change,
  selectedTags,
  onToggleTag,
  onOnlyEvent,
}: {
  row: CalendarRow;
  scheduled: CalendarRow[];
  onJump: (row: CalendarRow) => void;
  now: number;
  upcoming: boolean;
  change: ValueChange | null;
  selectedTags: CalendarTag[];
  onToggleTag: (tag: CalendarTag) => void;
  onOnlyEvent: (titleKey: string) => void;
}) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const next = useMemo(() => nextReleaseOf(row, scheduled), [row, scheduled]);
  const [copied, setCopied] = useState(false);
  const country = countryLabel(row.countryCode, locale, row.countryName);
  const period = formatPeriod(row, locale);
  const surprise = changeVsForecast(row, locale);
  const value = (raw: string | null) => formatValue(raw, locale, row.unit);
  const when = row.allDay
    ? `${formatDay(row.date, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${tt("allDay")}`
    : `${formatDay(row.date, locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${row.time} (${tt("istanbulTime")})`;
  const relative =
    now > 0 && !row.allDay
      ? row.ts > now
        ? tt("inTime", { x: formatDuration(row.ts - now, locale) })
        : tt("agoTime", { x: formatDuration(now - row.ts, locale) })
      : null;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const lines = [
      `${country} — ${row.title}${period ? ` (${period})` : ""}`,
      when,
      [
        `${tt("colActual")}: ${value(row.actual)}`,
        row.forecast ? `${tt("colForecast")}: ${value(row.forecast)}` : "",
        `${tt("colPrevious")}: ${value(row.previous)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard can be blocked (permissions / insecure context); nothing to recover.
    }
  };

  const addToCalendar = () => {
    const safeTitle = row.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "etkinlik";
    downloadFile(`${row.date}-${row.countryCode}-${safeTitle}.ics`, toIcs([row], locale, now || Date.now()), "text/calendar;charset=utf-8");
  };

  return (
    <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
      <div className="min-w-0 space-y-3">
        <div>
          <p className="text-sm font-semibold leading-snug text-foreground">
            {row.title}
            {period && <span className="font-normal text-muted-foreground"> · {period}</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            <Flag code={row.countryCode} locale={locale} fallback={row.countryName} withName className="text-foreground" />
            <span aria-hidden="true">·</span>
            <span className="capitalize">{when}</span>
            {relative && (
              <>
                <span aria-hidden="true">·</span>
                <span className={upcoming ? "font-medium text-foreground" : undefined}>{relative}</span>
              </>
            )}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <ValueTile label={tt("colActual")} emphasis>
            {row.actual ? value(row.actual) : <span className="font-sans text-xs font-normal text-muted-foreground">{upcoming ? tt("pending") : tt("awaitingValue")}</span>}
          </ValueTile>
          {row.forecast && <ValueTile label={tt("colForecast")}>{value(row.forecast)}</ValueTile>}
          {/* The surprise, direction only: whether "above" is good depends on the indicator. */}
          {surprise && (
            <ValueTile label={tt("vsForecast")}>
              <span className="inline-flex items-center gap-1" title={tt(surprise.delta > 0 ? "aboveForecast" : surprise.delta < 0 ? "belowForecast" : "inLineForecast")}>
                <DeltaIcon delta={surprise.delta} />
                {surprise.delta === 0 ? <span className="font-sans text-xs">{tt("inLineForecast")}</span> : surprise.label}
              </span>
            </ValueTile>
          )}
          <ValueTile label={tt("colPrevious")}>{value(row.previous)}</ValueTile>
          <ValueTile label={tt("change")}>
            {change ? (
              <span className="inline-flex items-center gap-1">
                <DeltaIcon delta={change.delta} />
                {change.label}
              </span>
            ) : (
              EMPTY_VALUE
            )}
          </ValueTile>
          <ValueTile label={tt("importance")}>
            <ImportanceText level={row.importance} locale={locale} className="font-sans text-xs" />
          </ValueTile>
        </dl>

        {next && <NextReleaseLine next={next} now={now} locale={locale} tt={tt} onJump={onJump} />}

        {row.sourceName && (
          <p className="text-[11px] text-muted-foreground">
            {tt("publishedBy")}:{" "}
            {row.sourceUrl ? (
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {agencyLabel(row.countryCode, row.sourceName, locale)}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-foreground">{agencyLabel(row.countryCode, row.sourceName, locale)}</span>
            )}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {row.tags.map((tag) => {
            const active = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleTag(tag)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  active ? "border-border bg-muted text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
                )}
              >
                {TAG_LABELS[tag].long[locale]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap content-start gap-1.5 sm:w-44 sm:flex-col">
        <DetailAction icon={Filter} onClick={() => onOnlyEvent(row.titleKey)}>{tt("onlyThis")}</DetailAction>
        {upcoming && <DetailAction icon={CalendarPlus} onClick={addToCalendar}>{tt("addToCalendar")}</DetailAction>}
        <DetailAction icon={copied ? Check : Copy} onClick={() => void copy()}>{copied ? tt("copied") : tt("copy")}</DetailAction>
      </div>
    </div>
  );
}

function DeltaIcon({ delta }: { delta: number }) {
  if (delta > 0) return <ArrowUp className="h-3 w-3" aria-hidden="true" />;
  if (delta < 0) return <ArrowDown className="h-3 w-3" aria-hidden="true" />;
  return null;
}

function DetailAction({ icon: Icon, onClick, children }: { icon: typeof Filter; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {children}
    </button>
  );
}

/**
 * When this indicator is released next (same name, same country): the day, the time, how
 * long until then, the period it covers and the forecast once the source has one. The
 * date takes the table to that row.
 */
function NextReleaseLine({
  next,
  now,
  locale,
  tt,
  onJump,
}: {
  next: CalendarRow;
  now: number;
  locale: Locale;
  tt: CalendarText;
  onJump: (row: CalendarRow) => void;
}) {
  const day = formatDay(next.date, locale, { weekday: "long", day: "numeric", month: "long" });
  const period = formatPeriod(next, locale);
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>{tt("nextRelease")}:</span>
      <button
        type="button"
        onClick={() => onJump(next)}
        title={tt("showInTable")}
        className="rounded-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {next.allDay ? day : `${day}, ${next.time}`}
      </button>
      {now > 0 && !next.allDay && (
        <span>
          <span aria-hidden="true">· </span>
          {tt("inTime", { x: formatDuration(next.ts - now, locale) })}
        </span>
      )}
      {period && (
        <span>
          <span aria-hidden="true">· </span>
          {tt("period")}: {period}
        </span>
      )}
      {next.forecast && (
        <span>
          <span aria-hidden="true">· </span>
          {tt("colForecast")}: <span className="font-mono tabular-nums text-foreground">{formatValue(next.forecast, locale, next.unit)}</span>
        </span>
      )}
    </p>
  );
}
