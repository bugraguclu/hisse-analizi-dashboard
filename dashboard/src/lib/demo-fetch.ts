/**
 * The static demo's stand-in for the backend (see lib/demo.ts): lib/api.ts
 * hands every request here instead of calling fetch() when IS_DEMO is set.
 *
 * - Recorded responses (demo/data, scripts/capture-demo-data.mjs) are looked
 *   up by their canonical request (lib/demo-key.ts).
 * - KAP disclosures are filtered, sorted, paged and counted from the recorded
 *   pool, so the /events filters and the per-stock lists keep working.
 * - Quotes for any set of symbols come from the recorded snapshot, or from the
 *   screener universe for stocks the demo has no page for.
 * - Symbol search only knows the demo's stocks; writes are refused.
 *
 * Anything else answers 404 `demo_unavailable`, which the panels show as an
 * ordinary "could not load" state. The pure helpers are exported for tests.
 */
import { demoRequestKey } from "./demo-key.ts";

export interface DemoManifest {
  version: number;
  capturedAt: string;
  tickers: string[];
  responses: Record<string, { file: string; status: number; headers?: Record<string, string> }>;
}

interface DemoEvent {
  id: string;
  ticker?: string | null;
  tickers?: string[];
  category?: string | null;
  category_code?: string | null;
  severity: string;
  source_code: string;
  event_type: string;
  title?: string | null;
  summary?: string | null;
  company_name?: string | null;
  published_at?: string | null;
  created_at: string;
  [field: string]: unknown;
}

export const DEMO_UNAVAILABLE = "Bu veri demoda yok: demo yalnızca kaydedilmiş yanıtları gösterir.";
export const DEMO_READ_ONLY = "Demo salt okunur: bu işlem canlı sitede kullanılabilir.";

const SEVERITY_RANK: Record<string, number> = { HIGH: 0, WATCH: 1, INFO: 2 };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });
}

/** 404 `demo_unavailable`; the request is logged so a missing recording is easy to spot and add to the capture. */
function unavailable(path: string): Response {
  console.info(`[demo] no recorded response for GET ${path}`);
  return json({ detail: DEMO_UNAVAILABLE, code: "demo_unavailable" }, 404);
}

const listParam = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

function eventTime(event: DemoEvent): number {
  return Date.parse(event.published_at ?? event.created_at) || 0;
}

function eventTickers(event: DemoEvent): string[] {
  return event.tickers && event.tickers.length > 0 ? event.tickers : event.ticker ? [event.ticker] : [];
}

const fold = (text: string) => text.toLocaleLowerCase("tr-TR");

type EventFilter = "ticker" | "category" | "severity" | "other";

/** GET /events filters (routers.event_filters); `skip` leaves one out, as the facets do. */
export function filterEvents(events: readonly DemoEvent[], params: URLSearchParams, skip?: EventFilter): DemoEvent[] {
  const tickers = skip === "ticker" ? [] : listParam(params.get("ticker"));
  const categories = skip === "category" ? [] : listParam(params.get("category"));
  const severities = skip === "severity" ? [] : listParam(params.get("severity"));
  const source = params.get("source_code")?.trim();
  const eventType = params.get("event_type")?.trim();
  const since = Date.parse(params.get("since") ?? "");
  const until = Date.parse(params.get("until") ?? "");
  const search = fold(params.get("search")?.trim() ?? "");
  return events.filter((event) => {
    if (tickers.length > 0 && !eventTickers(event).some((ticker) => tickers.includes(ticker))) return false;
    if (categories.length > 0) {
      const codes = [event.category_code, event.category].filter(Boolean).map((code) => String(code).toUpperCase());
      if (!codes.some((code) => categories.includes(code))) return false;
    }
    if (severities.length > 0 && !severities.includes(event.severity)) return false;
    if (source && event.source_code !== source) return false;
    if (eventType && event.event_type !== eventType) return false;
    const at = eventTime(event);
    if (Number.isFinite(since) && at < since) return false;
    if (Number.isFinite(until) && at > until) return false;
    if (search.length >= 2) {
      const text = fold([event.title, event.summary, event.company_name].filter(Boolean).join(" "));
      const tickerHit = eventTickers(event).some((ticker) => fold(ticker).startsWith(search));
      if (!tickerHit && !text.includes(search)) return false;
    }
    return true;
  });
}

export function sortEvents(events: DemoEvent[], sort: string | null): DemoEvent[] {
  const newest = (a: DemoEvent, b: DemoEvent) => eventTime(b) - eventTime(a);
  switch (sort) {
    case "oldest":
      return events.sort((a, b) => eventTime(a) - eventTime(b));
    case "severity":
      return events.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || newest(a, b));
    case "ticker":
      return events.sort((a, b) => (eventTickers(a)[0] ?? "~").localeCompare(eventTickers(b)[0] ?? "~") || newest(a, b));
    default:
      return events.sort(newest);
  }
}

/** GET /events: one page and X-Total-Count. */
export function eventsPage(events: readonly DemoEvent[], params: URLSearchParams): { items: DemoEvent[]; total: number } {
  const matches = sortEvents(filterEvents(events, params), params.get("sort"));
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  return { items: matches.slice(offset, offset + limit), total: matches.length };
}

/** GET /events/facets: each facet ignores its own filter, `total` applies all of them. */
export function eventFacets(events: readonly DemoEvent[], params: URLSearchParams) {
  const count = (list: DemoEvent[], keyOf: (event: DemoEvent) => Array<string | null | undefined>) => {
    const counts: Record<string, number> = {};
    for (const event of list) {
      for (const key of keyOf(event)) if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const wanted = listParam(params.get("ticker_facet"));
  const tickerCounts = count(filterEvents(events, params, "ticker"), eventTickers);
  return {
    total: filterEvents(events, params).length,
    categories: count(filterEvents(events, params, "category"), (event) => [event.category_code ?? event.category]),
    severities: count(filterEvents(events, params, "severity"), (event) => [event.severity]),
    ...(wanted.length > 0 ? { tickers: Object.fromEntries(wanted.map((ticker) => [ticker, tickerCounts[ticker] ?? 0])) } : {}),
  };
}

interface UniverseRow {
  symbol: string;
  name?: string | null;
  close?: number | null;
  change_pct?: number | null;
  market_cap?: number | null;
}

/** GET /market/snapshot for any symbols: recorded quotes first, then a quote derived from the screener universe. */
export function snapshotFor(
  symbols: readonly string[],
  recorded: Record<string, unknown>,
  universe: readonly UniverseRow[],
  asOf: string,
): { symbols: string[]; snapshot: Record<string, unknown> } {
  const rows = new Map(universe.map((row) => [row.symbol.toUpperCase(), row]));
  const snapshot: Record<string, unknown> = {};
  for (const symbol of symbols) {
    if (recorded[symbol]) {
      snapshot[symbol] = recorded[symbol];
      continue;
    }
    const row = rows.get(symbol);
    if (!row || typeof row.close !== "number") continue;
    const pct = typeof row.change_pct === "number" ? row.change_pct : null;
    const previous = pct === null ? null : row.close / (1 + pct / 100);
    snapshot[symbol] = {
      currency: "TRY",
      exchange: "BIST",
      timezone: "Europe/Istanbul",
      name: row.name ?? symbol,
      last_price: row.close,
      previous_close: previous,
      change: previous === null ? null : row.close - previous,
      change_percent: pct,
      market_cap: row.market_cap ?? null,
      updated_at: asOf,
      session_state: "closed",
    };
  }
  return { symbols: [...symbols], snapshot };
}

/** GET /market/search: the demo's stocks only (a found stock outside it would lead to a page the demo lacks). */
export function searchDemoStocks(query: string, tickers: readonly string[], companies: ReadonlyArray<{ symbol: string; name?: string | null }>) {
  const q = fold(query.trim());
  const names = new Map(companies.map((company) => [company.symbol.toUpperCase(), company.name ?? ""]));
  const results = q
    ? tickers
        .filter((ticker) => fold(ticker).startsWith(q) || fold(names.get(ticker) ?? "").includes(q))
        .map((ticker) => ({ symbol: ticker, ticker, name: names.get(ticker) ?? ticker, exchange: "BIST", type: "stock", country: "TR" }))
    : [];
  return { query, source: "demo", results };
}

// --- runtime -------------------------------------------------------------------------------

let manifestPromise: Promise<DemoManifest> | null = null;
const filePromises = new Map<string, Promise<unknown>>();

function dataUrl(basePath: string, file: string): string {
  return `${basePath}/demo-data/${file}`;
}

async function loadJson(basePath: string, file: string): Promise<unknown> {
  let pending = filePromises.get(file);
  if (!pending) {
    pending = fetch(dataUrl(basePath, file), { cache: "force-cache" }).then((res) => {
      if (!res.ok) throw new Error(`demo data ${file}: HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    });
    // A failed load (offline) may be retried later.
    pending.catch(() => filePromises.delete(file));
    filePromises.set(file, pending);
  }
  return pending;
}

function loadManifest(basePath: string): Promise<DemoManifest> {
  if (!manifestPromise) {
    manifestPromise = loadJson(basePath, "manifest.json") as Promise<DemoManifest>;
    manifestPromise.catch(() => {
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

async function recorded(basePath: string, manifest: DemoManifest, path: string): Promise<unknown> {
  const entry = manifest.responses[demoRequestKey("GET", path)];
  return entry ? loadJson(basePath, entry.file) : null;
}

/**
 * A recorded response for `key`; failing that, one recorded for the same path with other
 * parameters (an economic calendar for another window, KAP news for another span), except
 * where the parameters pick the data range: a 1-year chart is not a stand-in for a 5-year one.
 */
export function findRecorded(manifest: DemoManifest, key: string): DemoManifest["responses"][string] | null {
  const exact = manifest.responses[key];
  if (exact) return exact;
  const [method, target] = key.split(" ");
  const [pathname, query = ""] = target.split("?");
  if (/(^|&)(period|currency|quarterly)=/.test(query)) return null;
  const prefix = `${method} ${pathname}`;
  const match = Object.keys(manifest.responses).find((candidate) => candidate === prefix || candidate.startsWith(`${prefix}?`));
  return match ? manifest.responses[match] : null;
}

export async function demoFetch(basePath: string, path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") return json({ detail: DEMO_READ_ONLY, code: "demo_read_only" }, 503);

  const manifest = await loadManifest(basePath);
  const url = new URL(path, "http://demo.invalid");
  const { pathname, searchParams } = url;

  // /events/latest is recorded as is; /events/{id}/content (fetched from KAP on demand) is not in the demo.
  const eventDetail = pathname !== "/events/latest" && /^\/events\/[^/]+$/.test(pathname);
  if (pathname === "/events" || pathname === "/events/facets" || eventDetail) {
    const events = (await loadJson(basePath, "events.json")) as DemoEvent[];
    if (pathname === "/events") {
      const { items, total } = eventsPage(events, searchParams);
      return json(items, 200, { "X-Total-Count": String(total) });
    }
    if (pathname === "/events/facets") return json(eventFacets(events, searchParams));
    const id = decodeURIComponent(pathname.slice("/events/".length));
    const event = events.find((item) => item.id === id);
    return event ? json({ ...event, body_text: null, metadata_json: null, raw_event_id: event.id }) : unavailable(path);
  }

  if (pathname === "/market/snapshot") {
    const symbols = listParam(searchParams.get("symbols"));
    const snapshotKey = Object.keys(manifest.responses).find((key) => key.startsWith("GET /market/snapshot?"));
    const snapshot = snapshotKey ? ((await loadJson(basePath, manifest.responses[snapshotKey].file)) as { snapshot?: Record<string, unknown> }) : null;
    const universe = (await recorded(basePath, manifest, "/market/screener/universe")) as { rows?: UniverseRow[] } | null;
    return json(snapshotFor(symbols, snapshot?.snapshot ?? {}, universe?.rows ?? [], manifest.capturedAt));
  }

  if (pathname === "/market/search") {
    const companies = (await recorded(basePath, manifest, "/market/companies/all")) as { companies?: Array<{ symbol: string; name?: string | null }> } | null;
    return json(searchDemoStocks(searchParams.get("q") ?? "", manifest.tickers, companies?.companies ?? []));
  }

  const entry = findRecorded(manifest, demoRequestKey("GET", path));
  if (!entry) return unavailable(path);
  try {
    return json(await loadJson(basePath, entry.file), entry.status, entry.headers);
  } catch {
    return unavailable(path);
  }
}
