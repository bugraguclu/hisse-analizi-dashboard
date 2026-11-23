import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { eventFacets, eventsPage, findRecorded, searchDemoStocks, snapshotFor, type DemoManifest } from "./demo-fetch.ts";
import { demoFileName, demoRequestKey } from "./demo-key.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../demo/data");

const event = (id: string, fields: Record<string, unknown>) => ({
  id,
  event_type: "KAP_DISCLOSURE",
  source_code: "kap",
  severity: "INFO",
  created_at: "2026-11-20T10:00:00Z",
  ...fields,
});

const EVENTS = [
  event("a", { ticker: "THYAO", tickers: ["THYAO"], category_code: "DIVIDEND", severity: "HIGH", published_at: "2026-11-23T10:00:00Z", title: "Kâr payı dağıtımı" }),
  event("b", { ticker: "GARAN", tickers: ["GARAN", "THYAO"], category_code: "LEGAL", severity: "WATCH", published_at: "2026-11-22T10:00:00Z", title: "Dava" }),
  event("c", { ticker: "ASELS", tickers: ["ASELS"], category_code: "DIVIDEND", severity: "INFO", published_at: "2026-11-21T10:00:00Z", company_name: "Aselsan" }),
];

describe("demoRequestKey", () => {
  it("ignores parameter order and comma encoding", () => {
    assert.equal(demoRequestKey("get", "/macro/calendar?countries=TR,US"), demoRequestKey("GET", "/macro/calendar?countries=TR%2CUS"));
    assert.equal(demoRequestKey("GET", "/x?b=2&a=1"), "GET /x?a=1&b=2");
  });

  it("gives readable, URL-safe file names", () => {
    assert.equal(demoFileName("GET /market/ticker/THYAO/history?period=1y&warmup=250"), "market_ticker_THYAO_history__period_1y_warmup_250");
    assert.match(demoFileName("GET /macro/calendar?countries=TR%2CUS"), /^[A-Za-z0-9._-]+$/);
  });
});

describe("demo events", () => {
  it("filters by ticker (any of the disclosure's companies), pages and counts", () => {
    const { items, total } = eventsPage(EVENTS, new URLSearchParams("ticker=THYAO&limit=1"));
    assert.equal(total, 2);
    assert.deepEqual(items.map((item) => item.id), ["a"]);
    const next = eventsPage(EVENTS, new URLSearchParams("ticker=THYAO&limit=1&offset=1"));
    assert.deepEqual(next.items.map((item) => item.id), ["b"]);
  });

  it("filters by category, severity and search, and sorts", () => {
    assert.deepEqual(eventsPage(EVENTS, new URLSearchParams("category=dividend&sort=oldest")).items.map((e) => e.id), ["c", "a"]);
    assert.deepEqual(eventsPage(EVENTS, new URLSearchParams("severity=WATCH,HIGH&sort=severity")).items.map((e) => e.id), ["a", "b"]);
    assert.deepEqual(eventsPage(EVENTS, new URLSearchParams("search=aselsan")).items.map((e) => e.id), ["c"]);
    assert.deepEqual(eventsPage(EVENTS, new URLSearchParams("since=2026-11-22T00:00:00Z")).items.map((e) => e.id), ["a", "b"]);
  });

  it("counts each facet without its own filter", () => {
    const facets = eventFacets(EVENTS, new URLSearchParams("category=DIVIDEND&ticker_facet=THYAO,ASELS,EREGL"));
    assert.equal(facets.total, 2);
    assert.deepEqual(facets.categories, { DIVIDEND: 2, LEGAL: 1 });
    assert.deepEqual(facets.severities, { HIGH: 1, INFO: 1 });
    assert.deepEqual(facets.tickers, { THYAO: 1, ASELS: 1, EREGL: 0 });
  });
});

describe("demo quotes and search", () => {
  it("answers any symbols from the recording, then from the screener universe", () => {
    const result = snapshotFor(["THYAO", "AKBNK", "NOPE"], { THYAO: { last_price: 1 } }, [{ symbol: "AKBNK", name: "Akbank", close: 110, change_pct: 10 }], "2026-11-23T14:40:00Z");
    assert.deepEqual(result.symbols, ["THYAO", "AKBNK", "NOPE"]);
    assert.deepEqual(result.snapshot.THYAO, { last_price: 1 });
    const akbnk = result.snapshot.AKBNK as { last_price: number; previous_close: number; change: number };
    assert.equal(akbnk.last_price, 110);
    assert.ok(Math.abs(akbnk.previous_close - 100) < 1e-9);
    assert.ok(Math.abs(akbnk.change - 10) < 1e-9);
    assert.equal(result.snapshot.NOPE, undefined);
  });

  it("searches only the demo's stocks", () => {
    const companies = [{ symbol: "THYAO", name: "Türk Hava Yolları" }, { symbol: "AKBNK", name: "Akbank" }];
    assert.deepEqual(searchDemoStocks("hava", ["THYAO"], companies).results.map((r) => r.symbol), ["THYAO"]);
    assert.deepEqual(searchDemoStocks("akb", ["THYAO"], companies).results, []);
  });
});

describe("recorded responses", () => {
  const manifest: DemoManifest = {
    version: 1,
    capturedAt: "2026-11-23T14:40:00Z",
    tickers: ["THYAO"],
    responses: {
      "GET /macro/calendar?countries=TR%2CUS": { file: "cal.json", status: 200 },
      "GET /market/ticker/THYAO/history?period=1y&warmup=250": { file: "h.json", status: 200 },
    },
  };

  it("falls back to another recording of the same path unless the parameters pick the data range", () => {
    assert.equal(findRecorded(manifest, demoRequestKey("GET", "/macro/calendar?countries=TR,US"))?.file, "cal.json");
    assert.equal(findRecorded(manifest, demoRequestKey("GET", "/macro/calendar?countries=TR&start=2026-12-01"))?.file, "cal.json");
    assert.equal(findRecorded(manifest, demoRequestKey("GET", "/market/ticker/THYAO/history?period=5y&warmup=250")), null);
    assert.equal(findRecorded(manifest, demoRequestKey("GET", "/market/ticker/GARAN/history?period=1y&warmup=250")), null);
  });

  it("the committed capture is consistent: every manifest entry has its file", () => {
    const committed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8")) as DemoManifest;
    assert.equal(committed.version, 1);
    assert.ok(committed.tickers.length > 0);
    assert.ok(!Number.isNaN(Date.parse(committed.capturedAt)));
    for (const [key, entry] of Object.entries(committed.responses)) {
      assert.ok(fs.existsSync(path.join(DATA_DIR, entry.file)), `${key} → ${entry.file}`);
      assert.equal(demoRequestKey("GET", key.slice(4)), key, `${key} is canonical`);
    }
    assert.ok(fs.existsSync(path.join(DATA_DIR, "events.json")));
  });
});
