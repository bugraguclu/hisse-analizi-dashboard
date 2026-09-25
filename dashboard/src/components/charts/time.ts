import type { UTCTimestamp } from "lightweight-charts";
import { getIntlLocale, MARKET_TIME_ZONE } from "@/lib/format";
import type { IntervalKind } from "./types";

/**
 * lightweight-charts draws its time axis in UTC. Bars are converted to the Borsa
 * İstanbul wall clock encoded as a UTC timestamp ("fake UTC"), so axis ticks,
 * day boundaries and the crosshair label show Istanbul time for every viewer.
 * Chart-side formatters therefore format with `timeZone: "UTC"`.
 */

/** Istanbul has been UTC+3 all year since 2016-09-07. */
const FIXED_OFFSET_SINCE = Date.UTC(2016, 8, 6, 21);
const FIXED_OFFSET_MS = 3 * 3_600_000;

let partsFormatter: Intl.DateTimeFormat | undefined;

function istanbulWallClockMs(ms: number): number {
  if (ms >= FIXED_OFFSET_SINCE) return ms + FIXED_OFFSET_MS;
  // Older bars (5y/max history) span the EET/EEST years: ask Intl for the offset.
  partsFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = partsFormatter.formatToParts(ms);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** Chart x value of a bar: Istanbul wall clock as UTC seconds. */
export function toChartTime(ms: number): UTCTimestamp {
  return Math.round(istanbulWallClockMs(ms) / 1000) as UTCTimestamp;
}

export type WallTimeStyle =
  | "time" // 14:30
  | "day" // 22
  | "month" // Eyl
  | "year" // 2026
  | "dayMonth" // 22 Eyl
  | "dayMonthTime" // 22 Eyl 14:30
  | "date" // 22 Eyl 2026
  | "weekdayDate" // Sal 22 Eyl 2026
  | "monthYear"; // Eyl 2026

const WALL_STYLES: Record<WallTimeStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { day: "numeric" },
  month: { month: "short" },
  year: { year: "numeric" },
  dayMonth: { day: "numeric", month: "short" },
  dayMonthTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  date: { day: "numeric", month: "short", year: "numeric" },
  weekdayDate: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  monthYear: { month: "short", year: "numeric" },
};

const wallFormatCache = new Map<string, Intl.DateTimeFormat>();

/** Format a chart time (wall-clock UTC seconds) in the UI locale. */
export function formatWallTime(time: number, style: WallTimeStyle): string {
  const locale = getIntlLocale();
  const key = `${locale}|${style}`;
  let formatter = wallFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...WALL_STYLES[style], timeZone: "UTC" });
    wallFormatCache.set(key, formatter);
  }
  return formatter.format(time * 1000);
}

/** Format a real instant (epoch ms) on the Istanbul wall clock. */
export function formatBarTime(ms: number, style: WallTimeStyle): string {
  return formatWallTime(toChartTime(ms), style);
}

/** Legend / crosshair / table label of one bar. */
export function barLabelStyle(interval: IntervalKind): WallTimeStyle {
  if (interval === "intraday") return "dayMonthTime";
  if (interval === "monthly") return "monthYear";
  if (interval === "weekly") return "date";
  return "weekdayDate";
}

/**
 * Axis tick labels. `type` is lightweight-charts' TickMarkType
 * (0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds); numeric because the
 * library is loaded lazily.
 */
export function tickLabel(time: number, type: number, interval: IntervalKind): string {
  // Intraday: any day-or-coarser boundary (incl. the first bar, which the library weighs as a year/month) is a date.
  if (interval === "intraday") return type <= 2 ? formatWallTime(time, "dayMonth") : formatWallTime(time, "time");
  switch (type) {
    case 0:
      return formatWallTime(time, "year");
    case 1:
      return formatWallTime(time, "month");
    case 2:
      return formatWallTime(time, "day");
    default:
      return formatWallTime(time, "time");
  }
}

/** Istanbul wall-clock minutes since midnight of a chart time. */
export function wallMinutes(time: number): number {
  return Math.floor((time % 86_400) / 60);
}

/** Continuous BIST session end (18:00) on the wall clock. */
export const SESSION_END_MINUTES = 18 * 60;
