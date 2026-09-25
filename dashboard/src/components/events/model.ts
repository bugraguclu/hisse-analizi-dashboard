import { CATEGORY_CODES, SEVERITY_LEVELS, toCategoryKey, toSeverity, type CategoryKey, type SeverityKey } from "@/components/shared/SeverityBadge";
import { MARKET_TIME_ZONE, parseDate } from "@/lib/format";
import type { Company, EventOut, EventSort } from "@/types";

/**
 * Pure model of the /events page: URL state (the single source of truth),
 * Istanbul calendar-day math for the date presets and display helpers for
 * a disclosure row. No React here.
 */

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

export const RANGE_KEYS = ["all", "today", "yesterday", "7d", "30d", "month", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const SORT_KEYS: readonly EventSort[] = ["newest", "oldest", "severity", "ticker"];
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Backend caps: `ticker` takes at most 50 codes, `offset` at most 10 000. */
export const MAX_TICKERS = 50;
export const MAX_OFFSET = 10_000;
/** Backend `search` needs at least 2 characters. */
export const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 120;

const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EventsUrlState {
  /** Free text (title, KAP summary, company name, ticker prefix). */
  q: string;
  tickers: string[];
  categories: CategoryKey[];
  severities: SeverityKey[];
  range: RangeKey;
  /** YYYY-MM-DD Istanbul days, only meaningful with range = custom. */
  since: string | null;
  until: string | null;
  sort: EventSort;
  size: PageSize;
  /** 1-based. */
  page: number;
  /** Open detail drawer. */
  event: string | null;
}

export const DEFAULT_STATE: EventsUrlState = {
  q: "",
  tickers: [],
  categories: [],
  severities: [],
  range: "all",
  since: null,
  until: null,
  sort: "newest",
  size: DEFAULT_PAGE_SIZE,
  page: 1,
  event: null,
};

interface ReadableParams {
  get(name: string): string | null;
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeTicker(value: string): string | null {
  const ticker = value.trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
  return TICKER_RE.test(ticker) ? ticker : null;
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/** Valid calendar day "YYYY-MM-DD" (years before 2000 are typing artefacts of date inputs). */
export function isDayKey(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isEventId(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

/** Parse the query string; unknown/invalid values fall back to defaults (old links keep working). */
export function parseEventsParams(params: ReadableParams): EventsUrlState {
  const q = (params.get("q") ?? params.get("search") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  const tickers = uniq(
    splitList(params.get("ticker"))
      .map(normalizeTicker)
      .filter((ticker): ticker is string => ticker !== null),
  ).slice(0, MAX_TICKERS);

  const categorySet = new Set(
    splitList(params.get("category"))
      .map((value) => toCategoryKey(value))
      .filter((key): key is CategoryKey => key !== null),
  );
  const categories = CATEGORY_CODES.filter((code) => categorySet.has(code));

  const severitySet = new Set(
    splitList(params.get("severity"))
      .map((value) => value.toUpperCase())
      .filter((value): value is SeverityKey => (SEVERITY_LEVELS as readonly string[]).includes(value)),
  );
  const severities = SEVERITY_LEVELS.filter((level) => severitySet.has(level));

  let since = params.get("since");
  let until = params.get("until");
  since = isDayKey(since) ? since : null;
  until = isDayKey(until) ? until : null;
  const rawRange = params.get("range");
  let range: RangeKey = (RANGE_KEYS as readonly string[]).includes(rawRange ?? "") ? (rawRange as RangeKey) : "all";
  // Links from the previous page version carried since/until without a range.
  if (!rawRange && (since || until)) range = "custom";
  if (range !== "custom") {
    since = null;
    until = null;
  } else if (since && until && since > until) {
    [since, until] = [until, since];
  }

  const rawSort = params.get("sort");
  const sort: EventSort = (SORT_KEYS as readonly string[]).includes(rawSort ?? "") ? (rawSort as EventSort) : "newest";

  const rawSize = Number(params.get("size"));
  const size: PageSize = (PAGE_SIZES as readonly number[]).includes(rawSize) ? (rawSize as PageSize) : DEFAULT_PAGE_SIZE;

  const rawPage = Number(params.get("page"));
  const maxPage = Math.floor(MAX_OFFSET / size) + 1;
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, maxPage) : 1;

  const rawEvent = params.get("event")?.trim() ?? "";
  const event = rawEvent ? rawEvent.slice(0, 64) : null;

  return { q, tickers, categories, severities, range, since, until, sort, size, page, event };
}

/** Canonical query string (fixed key order, defaults omitted, commas kept readable). */
export function serializeEventsParams(state: EventsUrlState): string {
  const parts: string[] = [];
  const add = (key: string, value: string) => {
    parts.push(`${key}=${encodeURIComponent(value).replace(/%2C/g, ",")}`);
  };
  if (state.q) add("q", state.q);
  if (state.tickers.length) add("ticker", state.tickers.join(","));
  if (state.categories.length) add("category", state.categories.join(","));
  if (state.severities.length) add("severity", state.severities.join(","));
  if (state.range !== "all") add("range", state.range);
  if (state.range === "custom") {
    if (state.since) add("since", state.since);
    if (state.until) add("until", state.until);
  }
  if (state.sort !== "newest") add("sort", state.sort);
  if (state.size !== DEFAULT_PAGE_SIZE) add("size", String(state.size));
  if (state.page > 1) add("page", String(state.page));
  if (state.event) add("event", state.event);
  return parts.join("&");
}

/** Filters that narrow the result set (sort/size/page are view settings). */
export function activeFilterCount(state: EventsUrlState): number {
  return (
    (state.q ? 1 : 0) +
    state.tickers.length +
    state.categories.length +
    state.severities.length +
    (state.range !== "all" && (state.range !== "custom" || state.since || state.until) ? 1 : 0)
  );
}

/** Filters that live in the collapsible panel (date, importance, category). */
export function panelFilterCount(state: EventsUrlState): number {
  return state.categories.length + state.severities.length + (state.range !== "all" ? 1 : 0);
}

export function hasActiveFilters(state: EventsUrlState): boolean {
  return activeFilterCount(state) > 0;
}

/** Day-grouped feed only makes sense for chronological sorts. */
export function isChronological(sort: EventSort): boolean {
  return sort === "newest" || sort === "oldest";
}

// ---------------------------------------------------------------------------
// Istanbul calendar days
// ---------------------------------------------------------------------------

let dayKeyFormatter: Intl.DateTimeFormat | null = null;

/** "YYYY-MM-DD" of the Istanbul calendar day containing `date`. */
export function istanbulDayKey(date: Date): string {
  dayKeyFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dayKeyFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayKeyToUtc(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Calendar arithmetic on "YYYY-MM-DD" keys (time-zone free). */
export function shiftDay(key: string, days: number): string {
  const date = dayKeyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface DayBounds {
  /** First included day (YYYY-MM-DD). */
  from: string | null;
  /** Last included day (YYYY-MM-DD). */
  to: string | null;
}

/**
 * Inclusive Istanbul-day bounds of a range; null while `today` is unknown
 * (server render / hydration) for the presets that depend on it.
 */
export function rangeDays(state: Pick<EventsUrlState, "range" | "since" | "until">, today: string | null): DayBounds | null {
  switch (state.range) {
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: state.since, to: state.until };
    default:
      break;
  }
  if (!today) return null;
  switch (state.range) {
    case "today":
      return { from: today, to: null };
    case "yesterday": {
      const day = shiftDay(today, -1);
      return { from: day, to: day };
    }
    case "7d":
      return { from: shiftDay(today, -6), to: null };
    case "30d":
      return { from: shiftDay(today, -29), to: null };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: null };
  }
}

/** Naive datetimes — the API reads zone-less values as Europe/Istanbul. */
export function toApiBounds(days: DayBounds): { since?: string; until?: string } {
  return {
    since: days.from ? `${days.from}T00:00:00` : undefined,
    until: days.to ? `${days.to}T23:59:59` : undefined,
  };
}

const dayLabelFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(intlLocale: string, withYear: boolean, style: "long" | "short"): Intl.DateTimeFormat {
  const cacheKey = `${intlLocale}|${withYear}|${style}`;
  let formatter = dayLabelFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      intlLocale,
      style === "long"
        ? { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }
        : { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" },
    );
    dayLabelFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/** "22 Eylül Salı" / "Tuesday, September 22" (+ year when it is not `currentYear`). */
export function formatDayKey(key: string, intlLocale: string, currentYear: string | null, style: "long" | "short" = "long"): string {
  const withYear = currentYear === null || key.slice(0, 4) !== currentYear;
  return dayFormatter(intlLocale, withYear, style).format(dayKeyToUtc(key));
}

// ---------------------------------------------------------------------------
// Text matching (Turkish-aware, case/diacritic-insensitive)
// ---------------------------------------------------------------------------

const FOLD_MAP: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c", â: "a", î: "i", û: "u" };

/** "Türk Hava Yolları" → "turk hava yollari"; "İŞ" → "is". */
export function foldText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ışğüöçâîû]/g, (char) => FOLD_MAP[char] ?? char)
    .replace(/\s+/g, " ")
    .trim();
}

export interface CompanyMatch {
  ticker: string;
  name: string;
}

function wordStarts(text: string, needle: string): boolean {
  return text.startsWith(needle) || text.split(" ").some((word) => word.startsWith(needle));
}

/**
 * Tracked companies matching `query`, best first: exact ticker, ticker prefix,
 * display name, legal name ("TÜRKİYE GARANTİ BANKASI" must not outrank
 * "Türk Hava Yolları" for "türk"), then any substring — at most `limit`.
 */
export function matchCompanies(companies: readonly Company[] | undefined, query: string, limit = 8): CompanyMatch[] {
  const needle = foldText(query);
  if (!companies || needle.length < MIN_QUERY_LENGTH) return [];
  const compact = needle.replace(/\s/g, "");
  const scored: Array<{ match: CompanyMatch; score: number }> = [];
  for (const company of companies) {
    const ticker = company.ticker.toUpperCase();
    const tickerFolded = ticker.toLowerCase();
    const display = foldText(company.display_name || "");
    const legal = foldText(company.legal_name || "");
    let score = -1;
    if (tickerFolded === compact) score = 0;
    else if (tickerFolded.startsWith(compact)) score = 1;
    else if (display.startsWith(needle)) score = 2;
    else if (wordStarts(display, needle)) score = 3;
    else if (wordStarts(legal, needle)) score = 4;
    else if (display.includes(needle) || legal.includes(needle)) score = 5;
    if (score >= 0) scored.push({ match: { ticker, name: company.display_name || company.legal_name || ticker }, score });
  }
  scored.sort((a, b) => a.score - b.score || a.match.ticker.localeCompare(b.match.ticker));
  return scored.slice(0, limit).map((entry) => entry.match);
}

// ---------------------------------------------------------------------------
// Row display helpers
// ---------------------------------------------------------------------------

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
}

/** Headline rule: KAP summary, else the form name. */
export function eventHeadline(event: EventOut): string | null {
  const headline = clean(event.summary) ?? clean(event.title) ?? clean(event.excerpt);
  return headline ? titleCaseAllCaps(headline) : null;
}

/** Form name as a secondary line — only when the headline is the summary. */
export function eventFormName(event: EventOut): string | null {
  const summary = clean(event.summary);
  const title = clean(event.title);
  return summary && title && foldText(summary) !== foldText(title) ? title : null;
}

/** All tracked tickers of a disclosure, the representative `ticker` first. */
export function eventTickers(event: EventOut): string[] {
  const list = Array.isArray(event.tickers) ? event.tickers.filter((ticker) => typeof ticker === "string" && ticker) : [];
  const primary = event.ticker ? event.ticker.toUpperCase() : null;
  const all = uniq([...(primary ? [primary] : []), ...list.map((ticker) => ticker.toUpperCase())]);
  return all;
}

/**
 * Row order: tickers the user filtered on first (why the row matched), then
 * the representative ticker, then the rest.
 */
export function displayTickers(event: EventOut, active: ReadonlySet<string>): string[] {
  const all = eventTickers(event);
  if (active.size === 0) return all;
  return [...all.filter((ticker) => active.has(ticker)), ...all.filter((ticker) => !active.has(ticker))];
}

export function eventCategory(event: EventOut): CategoryKey | null {
  return toCategoryKey(event.category_code) ?? toCategoryKey(event.category);
}

export function eventSeverity(event: EventOut): SeverityKey {
  return toSeverity(event.severity);
}

export function eventDate(event: EventOut): Date | null {
  return parseDate(event.published_at ?? event.created_at);
}

export function eventCompanyName(event: EventOut, companies: ReadonlyMap<string, Company> | null): string | null {
  const ticker = eventTickers(event)[0];
  return clean(event.company_name) ?? (ticker ? clean(companies?.get(ticker)?.display_name) : null);
}

/** Display name of one of the disclosure's tickers. */
export function tickerCompanyName(event: EventOut, ticker: string | undefined, companies: ReadonlyMap<string, Company> | null): string | null {
  if (!ticker) return null;
  if (ticker === eventTickers(event)[0]) return eventCompanyName(event, companies);
  return clean(companies?.get(ticker)?.display_name);
}

function foldCompanyName(value: string): string {
  return foldText(value)
    .replace(/[.,'"()]/g, " ")
    .replace(/\b(a\s?s|t\s?a\s?s|as|tas)\b/g, "")
    .replace(/\s+/g, "");
}

/**
 * The publisher when it is someone other than the disclosure's own companies
 * (Takasbank, Borsa İstanbul, a fund manager …). Null when it cannot be told
 * apart yet (company list still loading).
 */
export function eventForeignPublisher(event: EventOut, companies: ReadonlyMap<string, Company> | null): string | null {
  const publisher = clean(event.publisher);
  if (!publisher) return null;
  const folded = foldCompanyName(publisher);
  const own = eventTickers(event).flatMap((ticker) => {
    const company = companies?.get(ticker);
    return [company?.legal_name, company?.display_name].filter((name): name is string => !!name);
  });
  const companyName = clean(event.company_name);
  if (companyName) own.push(companyName);
  if (own.length === 0 && !companies) return null;
  const isOwn = own.some((name) => {
    const other = foldCompanyName(name);
    return !!other && (other === folded || folded.startsWith(other) || other.startsWith(folded));
  });
  return isOwn ? null : titleCaseAllCaps(publisher);
}

const CAPS_LOWER_WORDS = new Set(["ve", "ile", "veya", "ya", "da", "de", "için"]);
/** Acronyms that Turkish lower-casing would mangle ("BISTECH" → "Bıstech", "USD" → "Usd"). */
const CAPS_ACRONYMS = new Set([
  "BIST", "BISTECH", "VIOP", "VİOP", "SPK", "KAP", "MKK", "TCMB", "BDDK", "EPDK", "TMSF", "GYO", "YO", "ETF", "BYF",
  "UFRS", "TFRS", "TMS", "TTK", "USD", "EUR", "ABD", "AB", "KDV", "ÖTV", "SGK", "OSB", "AŞ",
]);
/** Legal-form abbreviations stay as written: "A.Ş.", "T.A.Ş.", "A.O." */
const CAPS_ABBREVIATION_RE = /^(?:\p{Lu}\.)+\p{Lu}?\.?$/u;

/**
 * KAP titles (and some company-written summaries) come in capitals ("İSTANBUL TAKAS VE
 * SAKLAMA BANKASI A.Ş."); show them in Turkish title case ("İstanbul Takas ve Saklama
 * Bankası A.Ş."). Text that already uses mixed case is returned unchanged.
 */
export function titleCaseAllCaps(name: string): string {
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (!letters || letters !== letters.toLocaleUpperCase("tr-TR")) return name;
  let first = true;
  return name
    .split(/(\s+)/)
    .map((word) => {
      if (!word.trim()) return word;
      const isFirst = first;
      first = false;
      const bare = word.replace(/[^\p{L}\p{N}.]/gu, "");
      // Known acronyms, legal forms, codes with digits and vowel-less words ("PC") stay as written.
      if (CAPS_ACRONYMS.has(bare) || CAPS_ABBREVIATION_RE.test(bare) || /\p{N}/u.test(bare) || !/[AEIİOÖUÜ]/u.test(bare)) return word;
      const lower = word.toLocaleLowerCase("tr-TR");
      if (!isFirst && CAPS_LOWER_WORDS.has(lower)) return lower;
      return lower.replace(/^(\P{L}*)(\p{L})/u, (_, lead: string, letter: string) => lead + letter.toLocaleUpperCase("tr-TR"));
    })
    .join("");
}

/** Newest-first groups of consecutive rows sharing an Istanbul day. */
export interface DayGroup {
  key: string;
  events: EventOut[];
}

export function groupByDay(events: readonly EventOut[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const date = eventDate(event);
    const key = date ? istanbulDayKey(date) : "unknown";
    const last = groups.at(-1);
    if (last && last.key === key) last.events.push(event);
    else groups.push({ key, events: [event] });
  }
  return groups;
}

/** Compact page list: 1 … 4 5 6 … 166 (null = gap). */
export function pageWindow(current: number, total: number): Array<number | null> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page));
  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const result: Array<number | null> = [];
  for (const page of sorted) {
    const previous = result.at(-1);
    if (typeof previous === "number" && page - previous > 1) result.push(page - previous === 2 ? previous + 1 : null);
    result.push(page);
  }
  return result;
}
