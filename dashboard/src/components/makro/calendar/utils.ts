import type { Locale } from "@/lib/i18n";
import { EMPTY_VALUE } from "@/lib/format";
import {
  agencyLabel,
  calendarText,
  countryFlag,
  countryLabel,
  countrySearchNames,
  IMPORTANCE_LABELS,
  KEY_EVENT_SEARCH,
  TAG_LABELS,
  tagSearchText,
} from "./i18n";
import {
  CALENDAR_TAGS,
  type CalendarData,
  type CalendarFilters,
  type CalendarRow,
  type CalendarTag,
  type Importance,
  type RangePreset,
  type SortDir,
  type SortKey,
} from "./types";

const INTL: Record<Locale, string> = { tr: "tr-TR", en: "en-US", fr: "fr-FR" };
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Text matching — mirrors `fold` in src/adapters/economic_calendar.py
// ---------------------------------------------------------------------------

/** Case/diacritics-insensitive form: "İşsizlik" → "issizlik", "ÜFE" → "ufe". */
export function fold(text: string): string {
  return text
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function foldChar(ch: string): string {
  if (/\s/.test(ch)) return " ";
  return fold(ch).charAt(0) || ch;
}

/** Search input → folded terms; "quoted phrases" stay together. */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    const term = fold(match[1] ?? match[2] ?? "");
    if (term) terms.push(term);
  }
  return terms;
}

/** Splits `text` into plain/matched segments for highlighting (Turkish-insensitive). */
export function highlightSegments(text: string, terms: string[]): Array<{ text: string; match: boolean }> {
  const chars = [...text];
  if (terms.length === 0 || chars.length === 0) return [{ text, match: false }];
  const folded = chars.map(foldChar).join("");
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const term of terms) {
    if (!term) continue;
    let from = folded.indexOf(term);
    while (from !== -1) {
      for (let i = from; i < from + term.length && i < marked.length; i++) marked[i] = true;
      from = folded.indexOf(term, from + Math.max(1, term.length));
    }
  }
  const segments: Array<{ text: string; match: boolean }> = [];
  chars.forEach((ch, i) => {
    const last = segments[segments.length - 1];
    if (last && last.match === marked[i]) last.text += ch;
    else segments.push({ text: ch, match: marked[i] });
  });
  return segments;
}

// ---------------------------------------------------------------------------
// Payload normalization (defensive: the page must survive contract drift)
// ---------------------------------------------------------------------------

const IMPORTANCE_SET = new Set<string>(["low", "mid", "high"]);
const TAG_SET = new Set<string>(CALENDAR_TAGS);
const SCALES = new Set<string>(["K", "M", "B", "T"]);
const PERIOD_SUFFIX = /\s*\(([^()]*)\)\s*$/;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s : null;
}

/** Only http(s) links from the payload become hrefs. */
function webUrl(value: unknown): string | null {
  const url = text(value);
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function normalizeRow(item: unknown, index: number): CalendarRow | null {
  if (!item || typeof item !== "object") return null;
  const r = item as Record<string, unknown>;
  const date = text(r.Date)?.slice(0, 10);
  const event = text(r.Event);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !event) return null;

  const rawTime = text(r.Time);
  const time = rawTime && /^\d{1,2}:\d{2}$/.test(rawTime) ? rawTime.padStart(5, "0") : null;
  const parsed = Date.parse(text(r.datetime) ?? "");
  // Istanbul is UTC+3 all year (no DST since 2016).
  const ts = Number.isFinite(parsed) ? parsed : Date.parse(`${date}T${time ?? "00:00"}:00+03:00`);

  let title = text(r.title);
  let period = text(r.period_label);
  if (!title) {
    const suffix = event.match(PERIOD_SUFFIX);
    title = suffix ? event.slice(0, suffix.index).trim() || event : event;
    period = suffix && suffix[1].trim() !== "-" ? suffix[1].trim() || null : null;
  }

  const countryName = text(r.Country) ?? "";
  const countryCode = (text(r.country_code) ?? countryName).toUpperCase();
  const tags = Array.isArray(r.tags) ? r.tags.map(String).filter((tag): tag is CalendarTag => TAG_SET.has(tag)) : [];
  const importance = IMPORTANCE_SET.has(String(r.Importance)) ? (String(r.Importance) as Importance) : "low";
  const keyEvent = r.key_event === true;
  // TradingView rows carry both names; doviz.com rows (fallback) only the Turkish one, as `title`.
  const titleEn = text(r.title_en);
  const titleTr = text(r.title_tr) ?? (titleEn ? null : title);
  const scale = text(r.scale)?.toUpperCase() ?? null;
  const reference = text(r.reference_date)?.slice(0, 10) ?? null;

  return {
    id: text(r.id) ?? `${countryCode}-${date}-${time ?? "allday"}-${index}`,
    date,
    time,
    ts,
    allDay: r.all_day === true || !time,
    countryCode,
    countryName,
    importance,
    title: titleTr ?? titleEn ?? title,
    titleEn,
    titleTr,
    period,
    referenceDate: reference && /^\d{4}-\d{2}-\d{2}$/.test(reference) ? reference : null,
    unit: text(r.unit),
    scale: scale && SCALES.has(scale) ? (scale as CalendarRow["scale"]) : null,
    sourceName: text(r.source_name),
    sourceUrl: webUrl(r.source_url),
    provider: r.provider === "doviz" || !titleEn ? "doviz" : "tradingview",
    actual: text(r.Actual),
    forecast: text(r.Forecast),
    previous: text(r.Previous),
    actualValue: typeof r.actual_value === "number" ? r.actual_value : null,
    forecastValue: typeof r.forecast_value === "number" ? r.forecast_value : null,
    previousValue: typeof r.previous_value === "number" ? r.previous_value : null,
    tags: tags.length > 0 ? tags : ["other"],
    keyEvent,
    titleKey: fold(titleEn ?? title),
    search: fold(
      [
        titleTr ?? "",
        titleEn ?? "",
        title,
        period ?? "",
        ...countrySearchNames(countryCode, countryName),
        ...tags.map(tagSearchText),
        keyEvent ? KEY_EVENT_SEARCH : "",
      ].join(" "),
    ),
  };
}

/**
 * Rows with `title` in the UI language: the Turkish name for tr (English while none is
 * known), the English name otherwise (Turkish for doviz.com fallback rows).
 */
export function localizeRows(rows: CalendarRow[], locale: Locale): CalendarRow[] {
  return rows.map((row) => {
    const title = locale === "tr" ? (row.titleTr ?? row.titleEn ?? row.title) : (row.titleEn ?? row.titleTr ?? row.title);
    return title === row.title ? row : { ...row, title };
  });
}

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthOf(name: string): number | null {
  const index = MONTH_ABBR.indexOf(name.slice(0, 3).toLowerCase());
  return index >= 0 && /^[a-z]{3,4}$/i.test(name) ? index + 1 : null;
}

/** TradingView's period ("Aug", "Sep/04", "Q3") in the UI language; doviz.com's Turkish labels stay as they are. */
export function formatPeriod(row: Pick<CalendarRow, "period" | "referenceDate" | "date">, locale: Locale): string | null {
  const period = row.period;
  if (!period) return null;
  const quarter = period.match(/^Q([1-4])$/);
  if (quarter) return { tr: `${quarter[1]}. Çeyrek`, en: `Q${quarter[1]}`, fr: `T${quarter[1]}` }[locale];
  const year = (row.referenceDate ?? row.date).slice(0, 4);
  const week = period.match(/^([A-Za-z]{3,4})\/(\d{1,2})$/);
  const month = monthOf(week ? week[1] : period);
  if (month === null) return period;
  const day = `${year}-${String(month).padStart(2, "0")}-${week ? week[2].padStart(2, "0") : "01"}`;
  return formatDay(day, locale, week ? { day: "numeric", month: "short" } : { month: "short" });
}

function countries(value: unknown): Array<{ code: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ code: String(c.code ?? "").toUpperCase(), name: String(c.name ?? "") }))
    .filter((c) => /^[A-Z]{2}$/.test(c.code));
}

export function normalizeCalendar(payload: unknown): CalendarData {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const rows = (Array.isArray(obj.calendar) ? obj.calendar : [])
    .map(normalizeRow)
    .filter((row): row is CalendarRow => row !== null);
  const days = rows.map((row) => row.date).sort();
  const win = obj.window && typeof obj.window === "object" ? (obj.window as Record<string, unknown>) : null;
  const start = text(win?.start);
  const end = text(win?.end);
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
  return {
    rows,
    available: obj.available === true || rows.length > 0,
    source: text(obj.source),
    supportedCountries: countries(obj.supported_countries),
    countries: countries(obj.countries).map((c) => c.code),
    failedCountries: strings(obj.failed_countries),
    window: start && end ? { start, end } : days.length > 0 ? { start: days[0], end: days[days.length - 1] } : null,
    asOf: text(obj.as_of),
    providers: strings(obj.providers),
    unavailableMonths: strings(obj.unavailable_months).filter((month) => /^\d{4}-\d{2}$/.test(month)),
  };
}

// ---------------------------------------------------------------------------
// Calendar days ("YYYY-MM-DD" in Istanbul) — arithmetic in UTC, no DST drift
// ---------------------------------------------------------------------------

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

export function startOfWeek(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** First day of the month `n` months after `day`'s month. */
export function addMonths(day: string, n: number): string {
  const [year, month] = day.split("-").map(Number);
  const index = year * 12 + (month - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function endOfMonth(day: string): string {
  return addDays(addMonths(day, 1), -1);
}

/** Longest window one request may load (src/adapters/economic_calendar.py MAX_WINDOW_DAYS). */
export const MAX_WINDOW_DAYS = 124;
/** Earliest day the date fields offer (TradingView keeps years of history). */
export const EARLIEST_DAY = "2018-01-01";

export function eachDay(from: string, to: string, cap = MAX_WINDOW_DAYS): string[] {
  const days: string[] = [];
  for (let day = from; day <= to && days.length < cap; day = addDays(day, 1)) days.push(day);
  return days;
}

const dayFormatCache = new Map<string, Intl.DateTimeFormat>();

/** Formats an Istanbul calendar day without any time-zone shift. */
export function formatDay(day: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dayFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(INTL[locale], { ...options, timeZone: "UTC" });
    dayFormatCache.set(key, formatter);
  }
  return formatter.format(new Date(toUtc(day)));
}

export function formatRangeLabel(from: string, to: string, locale: Locale): string {
  if (from === to) return formatDay(from, locale, { weekday: "short", day: "numeric", month: "short" });
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = formatDay(from, locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const end = formatDay(to, locale, { day: "numeric", month: "short", year: "numeric" });
  return `${start} – ${end}`;
}

export interface DayRange {
  from: string;
  to: string;
}

/** Resolves the active preset to concrete days; `null` = no date filter (unknown clock / no window). */
export function resolveRange(
  filters: Pick<CalendarFilters, "range" | "from" | "to">,
  today: string | null,
  window: DayRange | { start: string; end: string } | null,
): DayRange | null {
  const win = window ? ("start" in window ? { from: window.start, to: window.end } : window) : null;
  if (filters.range === "all") return win;
  if (filters.range === "custom") {
    const from = filters.from ?? win?.from ?? null;
    const to = filters.to ?? win?.to ?? null;
    if (!from || !to) return win;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (!today) return null;
  return presetRange(filters.range, today);
}

export function presetRange(preset: Exclude<RangePreset, "all" | "custom">, today: string): DayRange {
  const monday = startOfWeek(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: addDays(today, 1), to: addDays(today, 1) };
    case "thisWeek":
      return { from: monday, to: addDays(monday, 6) };
    case "nextWeek":
      return { from: addDays(monday, 7), to: addDays(monday, 13) };
    case "lastWeek":
      return { from: addDays(monday, -7), to: addDays(monday, -1) };
    case "thisMonth":
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case "nextMonth":
      return { from: addMonths(today, 1), to: endOfMonth(addMonths(today, 1)) };
    case "lastMonth":
      return { from: addMonths(today, -1), to: endOfMonth(addMonths(today, -1)) };
  }
}

export function rangesOverlap(a: DayRange, b: DayRange): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** What the backend loads by default: the first day of last month → the last day of next month. */
export function defaultWindow(today: string): DayRange {
  return { from: addMonths(today, -1), to: endOfMonth(addMonths(today, 1)) };
}

/**
 * The window to request for `range`: `null` (the backend default) while the range fits in
 * it, else the whole months around the range — at most MAX_WINDOW_DAYS, a longer range is cut.
 */
export function fetchWindowFor(range: DayRange | null, today: string | null): DayRange | null {
  if (!range || !today) return null;
  const base = defaultWindow(today);
  if (range.from >= base.from && range.to <= base.to) return null;
  const from = startOfMonth(range.from);
  const to = endOfMonth(range.to);
  return daysBetween(from, to) + 1 > MAX_WINDOW_DAYS ? { from, to: addDays(from, MAX_WINDOW_DAYS - 1) } : { from, to };
}

const DATED_PRESETS: Array<Exclude<RangePreset, "all" | "custom">> = [
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "lastWeek",
  "thisMonth",
  "nextMonth",
  "lastMonth",
];

/**
 * The date filters for a concrete range: the preset it matches (so shifting "this
 * week" lands on "next week"), "all" for exactly the source's window, else custom.
 */
export function rangeFilters(
  next: DayRange,
  today: string | null,
  window: DayRange | null,
): Pick<CalendarFilters, "range" | "from" | "to"> {
  const preset = today
    ? DATED_PRESETS.find((item) => {
        const candidate = presetRange(item, today);
        return candidate.from === next.from && candidate.to === next.to;
      })
    : undefined;
  if (preset) return { range: preset, from: null, to: null };
  if (window && next.from === window.from && next.to === window.to) return { range: "all", from: null, to: null };
  return { range: "custom", from: next.from, to: next.to };
}

/**
 * The period right before (-1) or after (1) `range`: whole months step by months (so "this
 * month" lands on "next month"), anything else by its number of days.
 */
export function shiftRange(range: DayRange, direction: 1 | -1): DayRange {
  if (range.from === startOfMonth(range.from) && range.to === endOfMonth(range.to)) {
    const [fromYear, fromMonth] = range.from.split("-").map(Number);
    const [toYear, toMonth] = range.to.split("-").map(Number);
    const months = (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
    const from = addMonths(range.from, direction * months);
    return { from, to: endOfMonth(addMonths(from, months - 1)) };
  }
  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, direction * length), to: addDays(range.to, direction * length) };
}

// ---------------------------------------------------------------------------
// Filtering with facet counts (one pass)
// ---------------------------------------------------------------------------

export interface Facets {
  importance: Record<Importance, number>;
  tags: Record<CalendarTag, number>;
  countries: Record<string, number>;
  /** Per-day counts ignoring the date filter (drives the day strip). */
  days: Map<string, { count: number; high: number }>;
  status: { upcoming: number; released: number };
}

export interface FilterContext {
  range: DayRange | null;
  now: number;
  today: string | null;
}

export function isUpcoming(row: CalendarRow, now: number, today: string | null): boolean {
  if (row.allDay) return today ? row.date >= today : row.ts > now;
  return row.ts > now;
}

export function filterRows(
  rows: CalendarRow[],
  filters: CalendarFilters,
  ctx: FilterContext,
): { visible: CalendarRow[]; facets: Facets } {
  const terms = searchTerms(filters.q);
  const importance = new Set(filters.importance);
  const tags = new Set(filters.tags);
  const selectedCountries = new Set(filters.countries);
  const clockKnown = ctx.now > 0;

  const facets: Facets = {
    importance: { high: 0, mid: 0, low: 0 },
    tags: Object.fromEntries(CALENDAR_TAGS.map((tag) => [tag, 0])) as Record<CalendarTag, number>,
    countries: {},
    days: new Map(),
    status: { upcoming: 0, released: 0 },
  };
  const visible: CalendarRow[] = [];

  for (const row of rows) {
    const upcoming = clockKnown && isUpcoming(row, ctx.now, ctx.today);
    const ok = {
      country: selectedCountries.size === 0 || selectedCountries.has(row.countryCode),
      text: terms.every((term) => row.search.includes(term)),
      event: !filters.event || row.titleKey === filters.event,
      importance: importance.size === 0 || importance.has(row.importance),
      tags: tags.size === 0 || row.tags.some((tag) => tags.has(tag)),
      status: !clockKnown || filters.status === "all" || (filters.status === "upcoming") === upcoming,
      date: !ctx.range || (row.date >= ctx.range.from && row.date <= ctx.range.to),
    };
    const failing = (Object.keys(ok) as Array<keyof typeof ok>).filter((key) => !ok[key]);
    const passesExcept = (key: keyof typeof ok) => failing.length === 0 || (failing.length === 1 && failing[0] === key);

    if (failing.length === 0) visible.push(row);
    if (passesExcept("importance")) facets.importance[row.importance] += 1;
    if (passesExcept("tags")) for (const tag of row.tags) facets.tags[tag] += 1;
    if (passesExcept("country")) facets.countries[row.countryCode] = (facets.countries[row.countryCode] ?? 0) + 1;
    if (passesExcept("status") && clockKnown) facets.status[upcoming ? "upcoming" : "released"] += 1;
    if (passesExcept("date")) {
      const day = facets.days.get(row.date) ?? { count: 0, high: 0 };
      day.count += 1;
      if (row.importance === "high") day.high += 1;
      facets.days.set(row.date, day);
    }
  }
  return { visible, facets };
}

// ---------------------------------------------------------------------------
// Sorting / grouping
// ---------------------------------------------------------------------------

const IMPORTANCE_RANK: Record<Importance, number> = { high: 3, mid: 2, low: 1 };

export const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  time: "asc",
  importance: "desc",
  country: "asc",
  event: "asc",
};

export function sortRows(rows: CalendarRow[], sort: SortKey, dir: SortDir, locale: Locale): CalendarRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const collator = new Intl.Collator(INTL[locale], { sensitivity: "base", numeric: true });
  const byTime = (a: CalendarRow, b: CalendarRow) => a.ts - b.ts || Number(b.allDay) - Number(a.allDay);
  const byImportance = (a: CalendarRow, b: CalendarRow) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
  const compare: Record<SortKey, (a: CalendarRow, b: CalendarRow) => number> = {
    time: (a, b) => factor * byTime(a, b) || byImportance(b, a) || collator.compare(a.title, b.title),
    importance: (a, b) => factor * byImportance(a, b) || byTime(a, b),
    country: (a, b) =>
      factor * collator.compare(countryLabel(a.countryCode, locale, a.countryName), countryLabel(b.countryCode, locale, b.countryName)) ||
      byTime(a, b),
    event: (a, b) => factor * collator.compare(a.title, b.title) || byTime(a, b),
  };
  return [...rows].sort(compare[sort]);
}

export interface DayGroup {
  date: string;
  rows: CalendarRow[];
  /** Index of the group's first row in the flat list. */
  start: number;
}

export function groupByDay(rows: CalendarRow[]): DayGroup[] {
  const groups: DayGroup[] = [];
  rows.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) last.rows.push(row);
    else groups.push({ date: row.date, rows: [row], start: index });
  });
  return groups;
}

/**
 * Releases still to come, soonest first, from every loaded list (the viewed window and
 * the default one, which reaches as far ahead as the source schedules), without repeats.
 */
export function scheduledReleases(lists: readonly CalendarRow[][], now: number, today: string | null): CalendarRow[] {
  if (now <= 0) return [];
  const seen = new Set<string>();
  const scheduled: CalendarRow[] = [];
  for (const rows of lists) {
    for (const row of rows) {
      if (seen.has(row.id) || !isUpcoming(row, now, today)) continue;
      seen.add(row.id);
      scheduled.push(row);
    }
  }
  return scheduled.sort((a, b) => a.ts - b.ts);
}

/**
 * The next release of the same indicator in the same country after `row` — for a past
 * release, the first one still to come. Null when the source has not scheduled it yet.
 */
export function nextReleaseOf(row: CalendarRow, scheduled: readonly CalendarRow[]): CalendarRow | null {
  return (
    scheduled.find((other) => other.ts > row.ts && other.titleKey === row.titleKey && other.countryCode === row.countryCode) ?? null
  );
}

// ---------------------------------------------------------------------------
// Values (the source writes Turkish notation: "%1,84", "-5,24", "%-0,3")
// ---------------------------------------------------------------------------

export interface ParsedValue {
  value: number;
  decimals: number;
  percent: boolean;
  suffix: string;
}

const VALUE_RE = /^([+-]?)(%?)([+-]?)(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(%|[KMBT])?$/i;

export function parseValue(raw: string | null): ParsedValue | null {
  if (!raw) return null;
  const match = raw.replace(/\s+/g, "").match(VALUE_RE);
  if (!match) return null;
  const [, sign1, lead, sign2, digits, tail] = match;
  const negative = (sign1 === "-") !== (sign2 === "-");
  const [whole, fraction = ""] = digits.replace(/\./g, "").split(",");
  const value = Number(`${whole}.${fraction || "0"}`);
  if (!Number.isFinite(value)) return null;
  return {
    value: negative ? -value : value,
    decimals: fraction.length,
    percent: lead === "%" || tail === "%",
    suffix: tail && tail !== "%" ? tail.toUpperCase() : "",
  };
}

function formatNumberIn(value: number, decimals: number, locale: Locale, signed = false): string {
  return new Intl.NumberFormat(INTL[locale], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value);
}

// Magnitudes as each language abbreviates them ("B" would read as "bin" = thousand in Turkish).
const SCALE_WORDS: Record<Locale, Record<string, string>> = {
  tr: { K: " bin", M: " mn", B: " mr", T: " tn" },
  en: { K: "K", M: "M", B: "B", T: "T" },
  fr: { K: " k", M: " M", B: " Md", T: " Bn" },
};
// TradingView sends most currencies as symbols ($, €, £, ¥, C$, A$) and a few as codes.
const CURRENCY_SYMBOLS: Record<string, string> = { TRY: "₺", INR: "₹", BRL: "R$", RUB: "₽", KRW: "₩" };

function withUnit(number: string, parsed: Pick<ParsedValue, "percent" | "suffix">, locale: Locale, unit?: string | null): string {
  if (parsed.percent || unit === "%") return locale === "tr" ? `%${number}` : locale === "fr" ? `${number} %` : `${number}%`;
  if (unit === "cf") return `${number} ${parsed.suffix}cf`; // natural-gas storage, "76 Bcf"
  const scale = parsed.suffix ? (SCALE_WORDS[locale][parsed.suffix] ?? parsed.suffix) : "";
  const currency = unit ? (CURRENCY_SYMBOLS[unit] ?? unit) : "";
  if (!currency) return `${number}${scale}`;
  // English puts a currency symbol first ("-$5.24B"); Turkish and French after the amount.
  if (locale === "en" && !/^[A-Z]{3}$/.test(currency)) {
    const sign = /^[+\-−]/.test(number) ? number[0] : "";
    return `${sign}${currency}${number.slice(sign.length)}${scale}`;
  }
  return `${number}${scale} ${currency}`;
}

/**
 * Source value in the UI language: "%1,84" → "1.84%" (en); "-5,24B" in dollars → "-5,24 mr $"
 * (tr), "-$5.24B" (en). doviz.com's plain Turkish notation stays as printed, and so does text
 * that is not a number.
 */
export function formatValue(raw: string | null, locale: Locale, unit?: string | null): string {
  if (!raw) return EMPTY_VALUE;
  const parsed = parseValue(raw);
  if (!parsed) return raw;
  if (locale === "tr" && !parsed.suffix && (!unit || unit === "%")) return raw;
  return withUnit(formatNumberIn(parsed.value, parsed.decimals, locale), parsed, locale, unit);
}

export interface ValueChange {
  delta: number;
  label: string;
}

function difference(value: string | null, base: string | null, unit: string | null, locale: Locale): ValueChange | null {
  const a = parseValue(value);
  const b = parseValue(base);
  if (!a || !b || a.percent !== b.percent || a.suffix !== b.suffix) return null;
  const decimals = Math.max(a.decimals, b.decimals);
  const delta = Number((a.value - b.value).toFixed(decimals));
  const number = formatNumberIn(delta, decimals, locale, true);
  const label =
    a.percent || unit === "%" ? `${number}${{ tr: " puan", en: " pp", fr: " pt" }[locale]}` : withUnit(number, a, locale, unit);
  return { delta, label };
}

/** Actual vs previous release, in the same unit; `null` when not comparable. */
export function changeVsPrevious(row: CalendarRow, locale: Locale): ValueChange | null {
  return difference(row.actual, row.previous, row.unit, locale);
}

/** Actual vs the forecast (the surprise); `null` before the release or without a forecast. */
export function changeVsForecast(row: CalendarRow, locale: Locale): ValueChange | null {
  return difference(row.actual, row.forecast, row.unit, locale);
}

/** "1 sa 20 dk" / "1 h 20 min" — minute precision. */
export function formatDuration(ms: number, locale: Locale): string {
  const minutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const [du, hu, mu] = { tr: ["g", "sa", "dk"], en: ["d", "h", "min"], fr: ["j", "h", "min"] }[locale];
  if (d > 0) return h > 0 ? `${d} ${du} ${h} ${hu}` : `${d} ${du}`;
  if (h > 0) return m > 0 ? `${h} ${hu} ${m} ${mu}` : `${h} ${hu}`;
  return `${m} ${mu}`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function csvCell(value: string, separator: string): string {
  // Neutralize spreadsheet formulas; negative numbers ("-5,24") stay numbers.
  const safe = /^[=+@\t\r]/.test(value) || /^-[^\d]/.test(value) ? `'${value}` : value;
  return /["\n\r]/.test(safe) || safe.includes(separator) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: CalendarRow[], locale: Locale): string {
  const separator = locale === "en" ? "," : ";";
  const t = (key: Parameters<typeof calendarText>[1]) => calendarText(locale, key);
  const header = [t("colDate"), t("colTime"), t("colCountry"), t("importance"), t("colEvent"), t("period"),
    t("colActual"), t("colForecast"), t("colPrevious"), t("tags")];
  const value = (raw: string | null, unit: string | null) => (raw ? formatValue(raw, locale, unit) : "");
  const lines = rows.map((row) => [
    row.date,
    row.time ?? t("allDay"),
    countryLabel(row.countryCode, locale, row.countryName),
    IMPORTANCE_LABELS[row.importance][locale],
    row.title,
    formatPeriod(row, locale) ?? "",
    value(row.actual, row.unit),
    value(row.forecast, row.unit),
    value(row.previous, row.unit),
    row.tags.map((tag) => TAG_LABELS[tag].short[locale]).join(" / "),
  ]);
  return `\uFEFF${[header, ...lines].map((cells) => cells.map((cell) => csvCell(cell, separator)).join(separator)).join("\r\n")}\r\n`;
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding at 75 octets (UTF-8 aware). */
function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function toIcs(rows: CalendarRow[], locale: Locale, now: number): string {
  const t = (key: Parameters<typeof calendarText>[1]) => calendarText(locale, key);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hisse Analizi//Ekonomik Takvim//TR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const row of rows) {
    const country = countryLabel(row.countryCode, locale, row.countryName);
    const period = formatPeriod(row, locale);
    const summary = `${countryFlag(row.countryCode)} ${country}: ${row.title}${period ? ` (${period})` : ""}`.trim();
    const description = [
      `${t("importance")}: ${IMPORTANCE_LABELS[row.importance][locale]}`,
      row.previous ? `${t("colPrevious")}: ${formatValue(row.previous, locale, row.unit)}` : "",
      row.forecast ? `${t("colForecast")}: ${formatValue(row.forecast, locale, row.unit)}` : "",
      `${t("tags")}: ${row.tags.map((tag) => TAG_LABELS[tag].long[locale]).join(", ")}`,
      row.sourceName ? agencyLabel(row.countryCode, row.sourceName, locale) : "",
      row.provider === "doviz" ? "doviz.com" : "TradingView",
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:${row.id}@hisse-analizi`, `DTSTAMP:${icsUtc(now)}`);
    if (row.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${row.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${addDays(row.date, 1).replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART:${icsUtc(row.ts)}`, `DTEND:${icsUtc(row.ts + 15 * 60_000)}`);
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(description)}`);
    if (!row.allDay) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", `DESCRIPTION:${icsEscape(summary)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
