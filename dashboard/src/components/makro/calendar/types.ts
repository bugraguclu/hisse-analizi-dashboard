/** GET /macro/calendar contract (src/adapters/economic_calendar.py: TradingView, doviz.com as fallback). */

export type Importance = "low" | "mid" | "high";

export const IMPORTANCE_LEVELS: readonly Importance[] = ["high", "mid", "low"];

export const CALENDAR_TAGS = [
  "rates",
  "inflation",
  "labor",
  "growth",
  "surveys",
  "consumer",
  "housing",
  "trade",
  "fiscal",
  "credit",
  "energy",
  "auction",
  "speech",
  "holiday",
  "other",
] as const;

export type CalendarTag = (typeof CALENDAR_TAGS)[number];

export interface CalendarRow {
  id: string;
  /** Istanbul calendar day, "YYYY-MM-DD". */
  date: string;
  /** "HH:MM" (Istanbul) or null for all-day rows. */
  time: string | null;
  /** Epoch ms of the release (all-day rows: Istanbul midnight). */
  ts: number;
  allDay: boolean;
  countryCode: string;
  /** Country as printed by the source (Turkish). */
  countryName: string;
  importance: Importance;
  /** Event name in the UI language (see `localizeRows`): Turkish when known for tr, else English. */
  title: string;
  /** TradingView's (English) name; null for doviz.com fallback rows. */
  titleEn: string | null;
  /** Turkish name (doviz.com's, or translated); null when none is known. */
  titleTr: string | null;
  /** Release period as the source writes it ("Aug", "Sep/04", "Q3" or doviz.com's "Eylül"). */
  period: string | null;
  /** Last day of the period ("YYYY-MM-DD"), when the source gives it. */
  referenceDate: string | null;
  /** "%", a currency ("$", "€", "TRY" …) or "cf"; null when the value has no unit. */
  unit: string | null;
  /** Magnitude of the values: K, M, B (billion) or T. */
  scale: "K" | "M" | "B" | "T" | null;
  /** Agency that publishes the figure ("Turkish Statistical Institute") and its site. */
  sourceName: string | null;
  sourceUrl: string | null;
  provider: "tradingview" | "doviz";
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  actualValue: number | null;
  forecastValue: number | null;
  previousValue: number | null;
  tags: CalendarTag[];
  /** Central-bank rate decision (TCMB PPK, Fed, ECB ...). */
  keyEvent: boolean;
  /** Folded English (else Turkish) name: groups a series across dates, the same in every UI language. */
  titleKey: string;
  /** Folded haystack for free-text search: both names, period, country code and names, topic labels and EN/FR keywords. */
  search: string;
}

export interface CalendarCountry {
  code: string;
  name: string;
}

export interface CalendarData {
  rows: CalendarRow[];
  available: boolean;
  source: string | null;
  supportedCountries: CalendarCountry[];
  /** Countries this payload was fetched for. */
  countries: string[];
  failedCountries: string[];
  window: { start: string; end: string } | null;
  asOf: string | null;
  /** Sources the rows came from ("tradingview", and "doviz" when it stood in for a month). */
  providers: string[];
  /** Months ("YYYY-MM") of the window the source could not deliver. */
  unavailableMonths: string[];
}

export type SortKey = "time" | "importance" | "country" | "event";
export type SortDir = "asc" | "desc";
export type StatusFilter = "all" | "upcoming" | "released";
export type RangePreset =
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "lastWeek"
  | "thisMonth"
  | "nextMonth"
  | "lastMonth"
  | "all"
  | "custom";

export interface CalendarFilters {
  q: string;
  /** Exact event (folded title) picked from a suggestion or a row. */
  event: string | null;
  countries: string[];
  /** Empty = every level. */
  importance: Importance[];
  /** Empty = every tag. */
  tags: CalendarTag[];
  status: StatusFilter;
  range: RangePreset;
  /** Custom range bounds, "YYYY-MM-DD". */
  from: string | null;
  to: string | null;
  sort: SortKey;
  dir: SortDir;
}
