/**
 * Borsa İstanbul session helpers. Everything is computed on the
 * Europe/Istanbul wall clock, independent of the viewer's time zone.
 *
 * Equity market: continuous trading 10:00–18:00 (closing auction until
 * ~18:10), Monday–Friday. Public holidays and half days are not in a
 * calendar here; pass the latest quote timestamp to getMarketStatus() and a
 * feed that has not ticked today (or went quiet) reads as "no trading".
 */

import { MARKET_TIME_ZONE, parseDate } from "./format";

export const SESSION_OPEN_MINUTES = 10 * 60;
export const SESSION_CLOSE_MINUTES = 18 * 60;
/** End of the closing auction: a trading day's prices are final from here. */
export const SESSION_FINAL_MINUTES = SESSION_CLOSE_MINUTES + 10;

/** Quotes are ~15 min delayed; this much silence during a session means no trading (holiday/half day). */
const QUOTE_SILENCE_MS = 90 * 60_000;
/** Grace period after the open before a quote from a previous day counts as "no trading". */
const OPEN_GRACE_MINUTES = 45;

export interface IstanbulClock {
  /** Calendar day in Istanbul, "YYYY-MM-DD". */
  dateKey: string;
  year: number;
  /** 1–12 */
  month: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  /** Minutes since Istanbul midnight. */
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let clockFormatter: Intl.DateTimeFormat | undefined;

function toMs(value: Date | number): number {
  return typeof value === "number" ? value : value.getTime();
}

export function istanbulClock(at: Date | number = Date.now()): IstanbulClock {
  clockFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = clockFormatter.formatToParts(new Date(toMs(at)));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour")) % 24; // some engines emit "24" at midnight
  const year = Number(part("year"));
  const month = Number(part("month"));
  return {
    dateKey: `${part("year")}-${part("month")}-${part("day")}`,
    year,
    month,
    weekday: WEEKDAYS[part("weekday")] ?? 0,
    minutes: hour * 60 + Number(part("minute")),
  };
}

export function isWeekday(clock: IstanbulClock): boolean {
  return clock.weekday >= 1 && clock.weekday <= 5;
}

export type MarketPhase = "open" | "preOpen" | "afterClose" | "weekend" | "noTrading";

export interface MarketStatus {
  isOpen: boolean;
  phase: MarketPhase;
}

/**
 * Session status at `now`. `lastQuoteAt` (the index quote's timestamp) turns
 * weekday holidays and early closes into "noTrading" instead of "open".
 */
export function getMarketStatus(now: Date | number = Date.now(), lastQuoteAt?: Date | number | null): MarketStatus {
  const clock = istanbulClock(now);
  if (!isWeekday(clock)) return { isOpen: false, phase: "weekend" };
  if (clock.minutes < SESSION_OPEN_MINUTES) return { isOpen: false, phase: "preOpen" };
  if (clock.minutes >= SESSION_CLOSE_MINUTES) return { isOpen: false, phase: "afterClose" };
  if (lastQuoteAt !== null && lastQuoteAt !== undefined) {
    const quoteMs = toMs(lastQuoteAt);
    const pastGrace = clock.minutes >= SESSION_OPEN_MINUTES + OPEN_GRACE_MINUTES;
    if (pastGrace && istanbulClock(quoteMs).dateKey !== clock.dateKey) return { isOpen: false, phase: "noTrading" };
    if (pastGrace && toMs(now) - quoteMs > QUOTE_SILENCE_MS) return { isOpen: false, phase: "noTrading" };
  }
  return { isOpen: true, phase: "open" };
}

export function isMarketOpen(now: Date | number = Date.now()): boolean {
  return getMarketStatus(now).isOpen;
}

/**
 * Quotes keep changing after the 18:00 close: the closing auction prints at
 * ~18:10 and the feed runs ~15 min behind, so live data settles around 18:30.
 */
export const LIVE_DATA_END_MINUTES = SESSION_CLOSE_MINUTES + 30;

/** Weekday window (10:00–18:30 Istanbul) in which live quotes can still change — the polling window. */
export function isLiveDataWindow(now: Date | number = Date.now()): boolean {
  const clock = istanbulClock(now);
  return isWeekday(clock) && clock.minutes >= SESSION_OPEN_MINUTES && clock.minutes < LIVE_DATA_END_MINUTES;
}

const MINUTE_MS = 60_000;

/**
 * Time to show next to a quote ("18:10 itibarıyla"). The delayed feed keeps advancing its
 * update time after the session (and over the weekend) although prices stopped at the
 * closing auction, so a later stamp shows as the last session's 18:10. Weekday holidays are
 * not in a calendar here and pass through unchanged.
 */
export function sessionQuoteTime(value: string | number | Date | null | undefined): number | null {
  let ms = parseDate(value)?.getTime() ?? null;
  if (ms === null) return null;
  let clock = istanbulClock(ms);
  // Saturday/Sunday stamps belong to Friday's session: step back to the previous day's 23:59.
  for (let guard = 0; !isWeekday(clock) && guard < 3; guard += 1) {
    ms -= (clock.minutes + 1) * MINUTE_MS;
    clock = istanbulClock(ms);
  }
  return clock.minutes > SESSION_FINAL_MINUTES ? ms - (clock.minutes - SESSION_FINAL_MINUTES) * MINUTE_MS : ms;
}

const HOUR_MS = 3_600_000;

/**
 * Hours between two instants that fall on Istanbul weekdays — weekends do not
 * count, so Friday evening → Monday morning is only a few "business hours".
 * Capped at `cap` hours to bound the work for very old timestamps.
 */
export function weekdayHoursBetween(from: Date | number, to: Date | number, cap = 24 * 30): number {
  const start = toMs(from);
  const end = toMs(to);
  if (!(end > start)) return 0;
  let hours = 0;
  for (let t = start; t < end && hours < cap; t += HOUR_MS) {
    if (isWeekday(istanbulClock(t))) hours += Math.min(1, (end - t) / HOUR_MS);
  }
  return hours;
}

/** True when a feed last updated more than `maxWeekdayHours` business hours ago (or never). */
export function isFeedStale(
  lastUpdate: Date | number | null | undefined,
  now: Date | number = Date.now(),
  maxWeekdayHours = 24,
): boolean {
  if (lastUpdate === null || lastUpdate === undefined || Number.isNaN(toMs(lastUpdate))) return true;
  return weekdayHoursBetween(lastUpdate, now, maxWeekdayHours + 1) > maxWeekdayHours;
}

const POLLER_STALE_MIN_MS = 15 * 60_000;

/**
 * Background pollers run around the clock, so their health is judged on wall-clock
 * time: stale once three polling intervals (at least 15 minutes) pass without a
 * successful cycle — a stopped worker shows up within minutes, not a day later.
 */
export function isPollerStale(
  lastSuccess: Date | number | null | undefined,
  intervalSeconds: number | null | undefined,
  now: Date | number = Date.now(),
): boolean {
  if (lastSuccess === null || lastSuccess === undefined || Number.isNaN(toMs(lastSuccess))) return true;
  const interval = intervalSeconds && intervalSeconds > 0 ? intervalSeconds * 1000 : 0;
  return toMs(now) - toMs(lastSuccess) > Math.max(3 * interval, POLLER_STALE_MIN_MS);
}
