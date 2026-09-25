"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/locale-context";
import { useCalendarText } from "./i18n";
import type { CalendarFilters } from "./types";
import { defaultWindow, eachDay, formatDay, rangeFilters, weekdayOf, type DayRange } from "./utils";

/**
 * Every day of the loaded window with its event count as a small histogram (the
 * counts ignore the date filter, so the strip shows where the events are). Click =
 * that day, Shift+click extends the range; arrows / Home / End move between days
 * (roving tabindex), Shift+Enter extends from the keyboard. A month's first day is
 * labelled with the month, after a hairline, so a three-month strip stays readable.
 */
export function DayStrip({
  range,
  today,
  window,
  dayCounts,
  onChange,
  className,
}: {
  range: DayRange | null;
  today: string | null;
  window: DayRange | null;
  dayCounts: Map<string, { count: number; high: number }>;
  onChange: (next: Pick<CalendarFilters, "range" | "from" | "to">) => void;
  /** Classes of the row around the strip (it renders nothing without a window). */
  className?: string;
}) {
  const { locale } = useLocale();
  const tt = useCalendarText();
  const stripRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => (window ? eachDay(window.from, window.to) : []), [window]);
  const maxCount = useMemo(() => Math.max(1, ...days.map((day) => dayCounts.get(day)?.count ?? 0)), [days, dayCounts]);
  const [focusDay, setFocusDay] = useState<string | null>(null);

  const pickDay = (day: string, extend: boolean) => {
    const next = extend && range ? (day < range.from ? { from: day, to: range.from } : { from: range.from, to: day }) : { from: day, to: day };
    onChange(rangeFilters(next, today, today ? defaultWindow(today) : window));
  };

  // Keep the first selected day in view when the range changes (horizontal scroll only, never the page).
  const firstSelected = range?.from ?? null;
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !firstSelected) return;
    const target = strip.querySelector<HTMLElement>(`[data-day="${firstSelected}"]`) ?? strip.querySelector<HTMLElement>("[data-day]");
    if (!target) return;
    strip.scrollTo({ left: Math.max(0, target.offsetLeft - strip.clientWidth / 2 + target.clientWidth / 2), behavior: "smooth" });
  }, [firstSelected, days.length]);

  if (days.length === 0) return null;

  const rovingDay =
    (focusDay && days.includes(focusDay) ? focusDay : null) ??
    (range ? days.find((day) => day >= range.from) : undefined) ??
    today ??
    days[0];

  const onStripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>("[data-day]")?.dataset.day ?? rovingDay;
    const index = days.indexOf(from ?? "");
    if (index < 0) return;
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: days.length - 1 - index };
    const step = moves[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = days[Math.min(days.length - 1, Math.max(0, index + step))];
    setFocusDay(next);
    stripRef.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={stripRef}
        role="group"
        aria-label={`${tt("days")} — ${tt("dayHint")}`}
        title={tt("dayHint")}
        onKeyDown={onStripKey}
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 pt-0.5 mask-fade-x scrollbar-none"
      >
        {days.map((day, index) => {
          const stats = dayCounts.get(day);
          const count = stats?.count ?? 0;
          const high = stats?.high ?? 0;
          const selected = Boolean(range && day >= range.from && day <= range.to);
          const isToday = day === today;
          const weekend = [0, 6].includes(weekdayOf(day));
          const monthStart = day.endsWith("-01");
          const label = [
            formatDay(day, locale, { weekday: "long", day: "numeric", month: "long" }),
            tt("dayEvents", { n: count }),
            high > 0 ? tt("dayHigh", { n: high }) : "",
          ].filter(Boolean).join(" · ");
          return (
            <Fragment key={day}>
              {monthStart && index > 0 && <span aria-hidden="true" className="mx-0.5 w-px shrink-0 self-stretch bg-border" />}
              <button
                type="button"
                data-day={day}
                tabIndex={day === rovingDay ? 0 : -1}
                aria-pressed={selected}
                aria-label={label}
                aria-current={isToday ? "date" : undefined}
                onFocus={() => setFocusDay(day)}
                onClick={(event) => pickDay(day, event.shiftKey)}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && event.shiftKey) {
                    event.preventDefault();
                    pickDay(day, true);
                  }
                }}
                className={cn(
                  "relative flex w-12 shrink-0 flex-col items-center rounded-md border px-1 pb-1.5 pt-1 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  selected
                    ? "border-border bg-muted text-foreground"
                    : cn(
                        "text-muted-foreground hover:border-border hover:text-foreground",
                        isToday ? "border-dashed border-foreground/40" : "border-transparent",
                        weekend && "opacity-60",
                      ),
                )}
              >
                {high > 0 && <span className="absolute inset-x-2.5 top-0 h-0.5 rounded-full bg-destructive" aria-hidden="true" />}
                <span className={cn("text-[9px] font-medium uppercase tracking-wide", monthStart && !isToday && "text-foreground")}>
                  {isToday ? tt("today") : formatDay(day, locale, monthStart ? { month: "short" } : { weekday: "short" })}
                </span>
                <span className={cn("font-mono text-sm font-semibold tabular-nums", (selected || isToday) && "text-foreground")}>
                  {formatDay(day, locale, { day: "numeric" })}
                </span>
                <span className="mt-1 h-1 w-8 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cn("block h-full rounded-full", selected ? "bg-foreground/60" : "bg-muted-foreground/40")}
                    style={{ width: count > 0 ? `${Math.max(12, (count / maxCount) * 100)}%` : "0%" }}
                  />
                </span>
                <span className="mt-0.5 font-mono text-[9px] tabular-nums" aria-hidden="true">
                  {count > 0 ? count : "·"}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
