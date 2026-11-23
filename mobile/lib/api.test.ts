import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mobileApi, MobileApiError } from "./api.ts";

const originalFetch = globalThis.fetch;
const originalBase = process.env.EXPO_PUBLIC_API_URL;
const requests: URL[] = [];
let responses: Record<string, unknown>;

beforeEach(() => {
  requests.length = 0;
  responses = {};
  process.env.EXPO_PUBLIC_API_URL = "https://example.test/api";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    init?.signal?.throwIfAborted();
    const data = responses[url.pathname];
    return data === undefined ? new Response(null, { status: 404 }) : Response.json(data);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = originalBase;
});

test("market screen consumes the backend index quote fields", async () => {
  responses["/api/market/indices"] = { indices: ["XU100"], quotes: [{ symbol: "XU100", last: 10000, change_percent: -0.5 }] };
  assert.deepEqual(await mobileApi.marketOverview(), { indices: [{ code: "XU100", name: "XU100", price: 10000, change_pct: -0.5 }] });
});

test("stock screen combines snapshot, company name and financial ratios", async () => {
  responses["/api/market/snapshot"] = { symbols: ["THYAO"], snapshot: { THYAO: { last_price: 310, change_percent: 1.2 } } };
  responses["/api/companies/THYAO"] = { display_name: "Türk Hava Yolları" };
  responses["/api/financials/ratios"] = [{ pe_ratio: 5.5, pb_ratio: 0.8 }];
  assert.deepEqual(await mobileApi.stockSummary("THYAO"), { ticker: "THYAO", name: "Türk Hava Yolları", close: 310, change_pct: 1.2, pe: 5.5, pb: 0.8 });
  assert.equal(requests.find((url) => url.pathname.endsWith("snapshot"))?.searchParams.get("symbols"), "THYAO");
});

test("missing company fundamentals do not hide an available stock quote", async () => {
  responses["/api/market/snapshot"] = { snapshot: { THYAO: { last_price: 310, change_percent: 1.2 } } };
  const summary = await mobileApi.stockSummary("THYAO");
  assert.equal(summary.close, 310);
  assert.equal(summary.pe, null);
});

test("events screen consumes the backend array and preserves filters", async () => {
  responses["/api/events"] = [{ id: "event-1", ticker: "THYAO", title: "Finansal rapor", severity: "WATCH" }];
  const data = await mobileApi.events({ ticker: "THYAO", severity: "watch" });
  assert.equal(data.items[0].id, "event-1");
  assert.equal(data.items[0].title, "Finansal rapor");
  assert.equal(requests[0].searchParams.get("severity"), "watch");
});

test("HTTP failures are surfaced and an already cancelled request stays cancelled", async () => {
  await assert.rejects(mobileApi.marketOverview(), (error: unknown) => error instanceof MobileApiError && error.status === 404);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(mobileApi.marketOverview(controller.signal), { name: "AbortError" });
});
