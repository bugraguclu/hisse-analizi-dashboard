import type { AllCompaniesOut, ScreenerRow } from "@/types";
import { foldTr } from "./fold";

/** One searchable BIST company. */
export interface TickerEntry {
  ticker: string;
  name: string;
  /** Market value (million TL); only breaks ties between equal matches. */
  cap: number;
  /** Search keys: lower-case ticker, folded name. */
  t: string;
  n: string;
}

export interface TickerOption {
  ticker: string;
  name: string;
}

/**
 * The whole equity universe is ~630 rows, small enough to filter in the browser
 * on every keystroke — the belif search's model: fetch the index once on first
 * open, then match locally with no debounce and no request per key.
 */
export function buildTickerIndex(data: AllCompaniesOut | undefined): TickerEntry[] {
  const seen = new Set<string>();
  const entries: TickerEntry[] = [];
  for (const row of data?.companies ?? []) {
    // Tickers are ASCII: a Turkish-locale uppercase would turn "sise" into "SİSE".
    const ticker = (row.symbol ?? "").trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const name = (row.name ?? "").trim();
    const cap = typeof row.criteria_8 === "number" && Number.isFinite(row.criteria_8) ? row.criteria_8 : 0;
    entries.push({ ticker, name, cap, t: ticker.toLowerCase(), n: foldTr(name) });
  }
  return entries;
}

function wordStarts(text: string, token: string): boolean {
  return text.startsWith(token) || text.includes(` ${token}`) || text.includes(`(${token}`);
}

/**
 * Best matches first: exact ticker, ticker prefix, name prefix, every word
 * starting a word of the name, then any substring. Every typed word has to
 * match somewhere (belif: `score >= tokens.length`), so "is bank" narrows
 * instead of widening. One character only matches the start of a ticker or a
 * name word — a lone "a" inside every name is noise. Equal matches go to the
 * larger company, the way the belif index lets a product outrank a page.
 *
 * A query with Turkish letters is a name, never a ticker (tickers are ASCII):
 * "koç" must not rank KOCMT above Koç Holding because "koc" starts a ticker.
 */
export function searchTickers(index: readonly TickerEntry[], query: string, limit = 8): TickerOption[] {
  const needle = foldTr(query);
  if (!needle) return [];
  const tokens = needle.split(" ");
  const compact = needle.replace(/\s/g, "");
  const single = compact.length === 1;
  const tickerLike = !/[^\x00-\x7F]/.test(query);
  const scored: Array<{ entry: TickerEntry; score: number }> = [];

  for (const entry of index) {
    let score: number;
    if (tickerLike && entry.t === compact) score = 0;
    else if (tickerLike && entry.t.startsWith(compact)) score = 1;
    else if (entry.n.startsWith(needle)) score = 2;
    else if (tokens.every((token) => entry.t.startsWith(token) || wordStarts(entry.n, token))) score = 3;
    else if (!single && tokens.every((token) => entry.t.includes(token) || entry.n.includes(token))) score = 4;
    else continue;
    scored.push({ entry, score });
  }

  scored.sort((a, b) => a.score - b.score || b.entry.cap - a.entry.cap || a.entry.ticker.localeCompare(b.entry.ticker));
  return scored.slice(0, limit).map(({ entry }) => ({ ticker: entry.ticker, name: entry.name }));
}

function turnoverOf(row: ScreenerRow): number {
  const value = row.turnover;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The empty state: the session's most traded stocks by TL turnover. Ranked on a
 * figure the screener reports rather than a hand-picked list — the reason belif
 * ranks its "popular" row on review counts instead of unconfirmed flags.
 */
export function mostTraded(rows: readonly ScreenerRow[] | undefined, limit = 5): TickerOption[] {
  return (rows ?? [])
    .filter((row) => row.symbol && turnoverOf(row) > 0)
    .sort((a, b) => turnoverOf(b) - turnoverOf(a))
    .slice(0, limit)
    .map((row) => ({ ticker: row.symbol.trim().toUpperCase(), name: (row.name ?? "").trim() }));
}
