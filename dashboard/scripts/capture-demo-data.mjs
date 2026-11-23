/**
 * Records the API responses the static GitHub Pages demo is served from
 * (see src/lib/demo.ts). Public GET endpoints of the live site only, one
 * request at a time with a pause between them; 429/5xx answers are retried
 * after a back-off, anything still failing is left out (the demo then shows
 * that panel's "not in this demo" state).
 *
 *   npm run demo:capture -- [--origin https://hisse-analizi.duckdns.org] [--out demo/data] [--delay 350]
 *
 * Writes one JSON file per response into --out plus manifest.json, which maps
 * each canonical request (lib/demo-key.ts) to its file and records the
 * capture time and the stocks the demo covers. Old files in --out are removed
 * first, so the folder always holds exactly one capture.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { demoFileName, demoRequestKey } from "../src/lib/demo-key.ts";

const root = path.resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    origin: { type: "string", default: "https://hisse-analizi.duckdns.org" },
    out: { type: "string", default: path.join(root, "demo/data") },
    delay: { type: "string", default: "350" },
  },
});

const API = `${args.origin.replace(/\/$/, "")}/api`;
const OUT = path.resolve(args.out);
const DELAY_MS = Math.max(150, Number(args.delay) || 350);

/** Stocks with full pages in the demo: the brief's five plus the rest of the default watchlist. */
const TICKERS = ["THYAO", "GARAN", "ASELS", "BIMAS", "KCHOL", "SISE", "EREGL"];
/** lib/discovery.ts DISCOVERY_INDICES (the /endeks pages). */
const DISCOVERY_INDEX_CODES = [
  "XU100", "XU030", "XU050", "XBANK", "XUSIN", "XUHIZ", "XUMAL", "XUTEK", "XHOLD", "XGMYO", "XKTUM", "XK030", "XTMTU", "XHARZ",
];
const CHART_PERIODS = ["1d", "5d", "1mo", "3mo", "6mo", "ytd", "1y", "5y", "max"];
/** components/charts CHART_WARMUP_BARS. */
const WARMUP = 250;
const MACRO_KEYS = [
  "usdtry", "eurtry", "gbptry", "basket", "gram_gold", "xauusd", "xagusd", "brent",
  "tr01y", "tr02y", "tr03y", "tr05y", "tr10y", "eurusd", "dxy", "us10y",
];
const MACRO_PERIODS = ["1ay", "3ay", "6ay", "ytd", "1y", "2y", "5y"];
/** Response headers the dashboard reads (pagination, data provenance). */
const KEPT_HEADERS = ["x-total-count", "x-data-source", "x-data-served-from", "x-data-stale", "x-data-as-of", "x-data-delay-seconds"];
/** Economic calendar rows kept around the capture day (the full response is >1 MB). */
const CALENDAR_DAYS_BEFORE = 14;
const CALENDAR_DAYS_AFTER = 45;
const EVENT_PAGES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const responses = {};
const failures = [];
let requestCount = 0;

async function fetchJson(apiPath) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (requestCount++ > 0) await sleep(DELAY_MS);
    let res;
    try {
      res = await fetch(`${API}${apiPath}`, {
        headers: { Accept: "application/json", "User-Agent": "hisse-analizi-demo-capture/1.0" },
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      if (attempt === 3) return { error: String(err) };
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt === 3) return { error: `HTTP ${res.status}` };
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1_000 : 3_000 * (attempt + 1));
      continue;
    }
    const headers = {};
    for (const name of KEPT_HEADERS) {
      const value = res.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    try {
      return { status: res.status, headers, body: await res.json() };
    } catch {
      return { error: `HTTP ${res.status}, not JSON` };
    }
  }
  return { error: "gave up" };
}

/** Records a GET; `transform` may trim the body before it is stored. Returns the body (or null). */
async function capture(apiPath, transform) {
  const key = demoRequestKey("GET", apiPath);
  if (responses[key]) return responses[key].body;
  const result = await fetchJson(apiPath);
  if (result.error || result.status >= 400) {
    failures.push(`${apiPath}: ${result.error ?? `HTTP ${result.status}`}`);
    process.stdout.write("x");
    return null;
  }
  const body = transform ? transform(result.body) : result.body;
  responses[key] = { status: result.status, headers: result.headers, body };
  process.stdout.write(".");
  return body;
}

function trimCalendar(capturedAt) {
  const from = capturedAt - CALENDAR_DAYS_BEFORE * 86_400_000;
  const to = capturedAt + CALENDAR_DAYS_AFTER * 86_400_000;
  return (payload) => {
    if (!payload || !Array.isArray(payload.calendar)) return payload;
    const calendar = payload.calendar.filter((row) => {
      const at = Date.parse(row.datetime ?? row.Date ?? "");
      return Number.isFinite(at) && at >= from && at <= to;
    });
    return { ...payload, calendar, total: calendar.length };
  };
}

async function main() {
  const capturedAt = Date.now();
  console.log(`Capturing from ${API} (${DELAY_MS} ms between requests)`);

  // Shell, home page and shared reference data
  for (const p of ["/health", "/companies", "/sources", "/polling-state", "/events/latest", "/market/indices",
    "/market/screener", "/market/screener/universe", "/market/companies/all"]) {
    await capture(p);
  }
  for (const period of CHART_PERIODS) await capture(`/market/index/XU100?period=${period}&warmup=${WARMUP}`);
  await capture(`/market/index/XU100?period=1d&warmup=${WARMUP}&currency=USD`);
  for (const code of DISCOVERY_INDEX_CODES) await capture(`/market/index/${code}?period=3mo&warmup=${WARMUP}`);

  // KAP disclosures: the newest pages plus each demo stock's own, merged into one pool that
  // lib/demo-fetch.ts filters, sorts and pages like the backend does.
  const pool = new Map();
  const addEvents = (items) => Array.isArray(items) && items.forEach((event) => pool.set(event.id, event));
  for (let page = 0; page < EVENT_PAGES; page++) {
    const result = await fetchJson(`/events?limit=200&offset=${page * 200}`);
    if (result.body) addEvents(result.body);
    else failures.push(`/events page ${page}: ${result.error}`);
  }

  // Macro page
  for (const p of ["/macro/tcmb", "/macro/policy-rate", "/macro/inflation", "/macro/tcmb-calendar", "/macro/fx-bulletin",
    "/macro/markets", "/macro/indicators"]) {
    await capture(p);
  }
  await capture("/macro/calendar?countries=TR%2CUS", trimCalendar(capturedAt));
  for (const key of MACRO_KEYS) await capture(`/macro/markets/${key}/history?period=1y`);
  for (const period of MACRO_PERIODS) await capture(`/macro/markets/usdtry/history?period=${period}`);
  for (const key of ["eurtry", "gram_gold"]) await capture(`/macro/markets/${key}/history?period=5y`);

  // One snapshot of every demo stock; the demo answers any subset of it.
  await capture(`/market/snapshot?symbols=${TICKERS.join(",")}`);

  // Stock pages
  for (const ticker of TICKERS) {
    process.stdout.write(`\n${ticker} `);
    const t = encodeURIComponent(ticker);
    await capture(`/companies/${t}`);
    for (const period of CHART_PERIODS) await capture(`/market/ticker/${t}/history?period=${period}&warmup=${WARMUP}`);
    for (const period of ["3mo", "6mo"]) await capture(`/market/ticker/${t}/history?period=${period}&warmup=${WARMUP}&currency=USD`);
    await capture(`/market/ticker/${t}/history?period=1mo`);
    await capture(`/financials/ratios?ticker=${t}`);
    for (const indicator of ["rsi", "macd", "bollinger", "signals", "signals/all-timeframes", "supertrend", "stochastic",
      "moving-averages", "pivots"]) {
      await capture(`/technical/${t}/${indicator}`);
    }
    for (const item of ["info", "fast-info", "dividends", "holders", "recommendations", "price-targets", "earnings-dates",
      "live-ratios", "sector", "live-news"]) {
      await capture(`/fundamentals/${t}/${item}`);
    }
    for (const statement of ["balance-sheet", "income-statement", "cashflow"]) {
      for (const quarterly of [false, true]) await capture(`/fundamentals/${t}/${statement}?quarterly=${quarterly}`);
    }
    for (const hours of [48, 168, 720]) await capture(`/news/${t}?hours=${hours}`);
    const own = await fetchJson(`/events?ticker=${t}&limit=200`);
    if (own.body) addEvents(own.body);
    else failures.push(`/events?ticker=${ticker}: ${own.error}`);
  }

  const events = [...pool.values()].sort((a, b) => String(b.published_at ?? b.created_at).localeCompare(String(a.published_at ?? a.created_at)));

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const files = {};
  const used = new Set();
  for (const [key, entry] of Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))) {
    let name = demoFileName(key);
    for (let n = 2; used.has(name); n++) name = `${demoFileName(key)}-${n}`;
    used.add(name);
    files[key] = { file: `${name}.json`, status: entry.status, ...(Object.keys(entry.headers).length ? { headers: entry.headers } : {}) };
    await writeFile(path.join(OUT, `${name}.json`), JSON.stringify(entry.body));
  }
  await writeFile(path.join(OUT, "events.json"), JSON.stringify(events));
  const manifest = {
    version: 1,
    capturedAt: new Date(capturedAt).toISOString(),
    origin: args.origin,
    tickers: TICKERS,
    responses: files,
  };
  await writeFile(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);

  const sizes = await readdir(OUT);
  console.log(`\n\n${Object.keys(files).length} responses and ${events.length} KAP disclosures in ${path.relative(process.cwd(), OUT) || OUT} (${sizes.length} files).`);
  if (failures.length) {
    console.log(`Left out (${failures.length}):`);
    for (const failure of failures) console.log(`  ${failure}`);
  }
}

await main();
