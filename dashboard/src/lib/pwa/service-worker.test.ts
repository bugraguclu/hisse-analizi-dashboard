import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { sanitizeSwVersion, serviceWorkerScript } from "./service-worker.ts";
import { basic, fetchLog, FakeCacheStorage, loadWorker, networkDown, ORIGIN, setNetwork } from "./sw-test-harness.ts";

const OFFLINE_HTML =
  '<html><head><link rel="stylesheet" href="/_next/static/css/app-1.css"><script src="/_next/static/chunks/main-a.js" async></script></head>' +
  '<body>offline<script>self.__next_f.push([1,"2:I[123,[\\"static/chunks/page-offline-b.js\\"],\\"default\\"]"])</script></body></html>';
const HOME_HTML = '<html><head><script src="/_next/static/chunks/main-a.js"></script><script src="/_next/static/chunks/home-c.js"></script></head><body>home</body></html>';

function server(pages: Record<string, string> = {}, statusFor: Record<string, number> = {}) {
  return (url: URL) => {
    const key = url.pathname + url.search;
    if (statusFor[key]) return basic("gateway", { status: statusFor[key] });
    if (url.pathname.startsWith("/_next/static/")) return basic(`asset ${url.pathname}`, { contentType: "application/javascript" });
    if (url.pathname === "/offline") return basic(OFFLINE_HTML);
    if (url.pathname === "/") return basic(HOME_HTML);
    if (url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/icons/")) return basic("{}", { contentType: "application/json" });
    if (pages[key] !== undefined) return basic(pages[key]);
    return basic("missing", { status: 404 });
  };
}

async function installed(version = "build-1", storage?: FakeCacheStorage) {
  setNetwork(server({ "/hisse/THYAO": "<html><head></head><body>THYAO</body></html>" }));
  const worker = loadWorker(version, storage);
  await worker.dispatch("install", {});
  await worker.dispatch("activate", {});
  return worker;
}

beforeEach(() => {
  fetchLog.length = 0;
});

describe("service worker script", () => {
  test("version is sanitised before it reaches cache names", () => {
    assert.equal(sanitizeSwVersion('a"b;c/../d'), "abc..d");
    assert.equal(sanitizeSwVersion(""), "dev");
    assert.match(serviceWorkerScript("X1-2_3"), /var VERSION = "X1-2_3";/);
    assert.doesNotMatch(serviceWorkerScript("x"), /__HISSE_SW_VERSION__/);
  });

  test("extracts hashed assets from tags and the RSC payload", () => {
    const { helpers } = loadWorker();
    assert.deepEqual([...helpers.extractAssetUrls(OFFLINE_HTML)], [
      "/_next/static/chunks/main-a.js",
      "/_next/static/chunks/page-offline-b.js",
      "/_next/static/css/app-1.css",
    ]);
  });

  test("classifies requests: API, cross-origin, POST and the worker itself pass through", () => {
    const { helpers } = loadWorker();
    const kind = (url: string, init: { mode?: RequestMode; method?: string } = {}) => {
      const request = new Request(new URL(url, ORIGIN), { method: init.method });
      if (init.mode) Object.defineProperty(request, "mode", { value: init.mode });
      return helpers.requestKind(request);
    };
    assert.equal(kind("/_next/static/chunks/a.js"), "static");
    assert.equal(kind("/hisse/THYAO", { mode: "navigate" }), "navigate");
    assert.equal(kind("/api/me/notes", { mode: "navigate" }), null);
    assert.equal(kind("/api/market/snapshot"), null);
    assert.equal(kind("/sw.js"), null);
    assert.equal(kind("https://other.example/_next/static/a.js"), null);
    assert.equal(kind("/hisse/THYAO", { mode: "navigate", method: "POST" }), null);
    assert.equal(kind("/manifest.webmanifest"), "asset");
    assert.equal(helpers.pageKey(`${ORIGIN}/tarama?idx=XU030&_rsc=abc#x`), "/tarama?idx=XU030");
  });

  test("install precaches the offline page, its chunks and the home page; first install takes over", async () => {
    const worker = await installed();
    const pages = await worker.caches.open(worker.helpers.PAGES_CACHE);
    const statics = await worker.caches.open(worker.helpers.STATIC_CACHE);
    assert.ok(await pages.match("/offline"));
    assert.ok(await pages.match("/"));
    for (const asset of ["/_next/static/chunks/main-a.js", "/_next/static/chunks/page-offline-b.js", "/_next/static/css/app-1.css", "/_next/static/chunks/home-c.js"]) {
      assert.ok(await statics.match(asset), asset);
    }
    assert.equal(worker.state.skipWaiting, 1);
    assert.equal(worker.state.claimed, 1);
  });

  test("install fails when the offline shell cannot be fetched (retried on the next visit)", async () => {
    networkDown();
    const worker = loadWorker();
    await assert.rejects(worker.dispatch("install", {}));
  });

  test("an update waits for the page instead of skipping waiting, and activation drops old caches", async () => {
    const storage = new FakeCacheStorage();
    const first = await installed("build-1", storage);
    await storage.open("unrelated-cache");
    const second = loadWorker("build-2", storage);
    second.state.active = true; // an older worker controls the pages
    await second.dispatch("install", {});
    assert.equal(second.state.skipWaiting, 0);
    await second.dispatch("message", { data: { type: "SKIP_WAITING" } });
    assert.equal(second.state.skipWaiting, 1);
    await second.dispatch("activate", {});
    const names = await storage.keys();
    assert.ok(!names.includes(first.helpers.PAGES_CACHE));
    assert.ok(!names.includes(first.helpers.STATIC_CACHE));
    assert.ok(names.includes(second.helpers.PAGES_CACHE));
    assert.ok(names.includes("unrelated-cache"), "caches of other apps are left alone");
  });

  test("navigations are network first and saved; offline the saved copy answers", async () => {
    const worker = await installed();
    const online = await worker.fetchEvent("/hisse/THYAO", { mode: "navigate" });
    assert.equal(await online?.text(), "<html><head></head><body>THYAO</body></html>");

    setNetwork(server({ "/hisse/THYAO": "<html><head></head><body>THYAO v2</body></html>" }));
    const fresh = await worker.fetchEvent("/hisse/THYAO", { mode: "navigate" });
    assert.match((await fresh?.text()) ?? "", /v2/, "network wins while online");

    networkDown();
    const offline = await worker.fetchEvent("/hisse/THYAO", { mode: "navigate" });
    assert.match((await offline?.text()) ?? "", /THYAO v2/);
  });

  test("an unsaved page offline gets the offline shell under its own URL", async () => {
    const worker = await installed();
    networkDown();
    const response = await worker.fetchEvent('/hisse/GARAN?x="><b>', { mode: "navigate" });
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get("x-hisse-offline"), "1");
    const html = (await response?.text()) ?? "";
    assert.match(html, /^<html><head>[\s\S]*offline/);
  });

  test("a filtered list falls back to the saved page without its query", async () => {
    const worker = await installed();
    setNetwork(server({ "/tarama": "<html><head></head><body>screener</body></html>" }));
    await worker.fetchEvent("/tarama", { mode: "navigate" });
    networkDown();
    const response = await worker.fetchEvent("/tarama?idx=XU030", { mode: "navigate" });
    assert.match((await response?.text()) ?? "", /screener/);
  });

  test("gateway errors serve the saved copy when there is one, otherwise pass through", async () => {
    const worker = await installed();
    await worker.fetchEvent("/hisse/THYAO", { mode: "navigate" });
    setNetwork(server({}, { "/hisse/THYAO": 502, "/hisse/ASELS": 503 }));
    const saved = await worker.fetchEvent("/hisse/THYAO", { mode: "navigate" });
    assert.match((await saved?.text()) ?? "", /THYAO/);
    const passthrough = await worker.fetchEvent("/hisse/ASELS", { mode: "navigate" });
    assert.equal(passthrough?.status, 503);
  });

  test("error pages and API calls are never stored", async () => {
    const worker = await installed();
    await worker.fetchEvent("/hisse/NOPE", { mode: "navigate" });
    const apiResponse = await worker.fetchEvent("/api/me/notes");
    assert.equal(apiResponse, undefined, "the worker does not answer API requests");
    const pages = await worker.caches.open(worker.helpers.PAGES_CACHE);
    assert.equal(await pages.match("/hisse/NOPE"), undefined);
    for (const name of await worker.caches.keys()) {
      const cache = await worker.caches.open(name);
      for (const request of await cache.keys()) assert.ok(!new URL(request.url).pathname.startsWith("/api/"));
    }
  });

  test("hashed static assets are served from cache without a network request", async () => {
    const worker = await installed();
    fetchLog.length = 0;
    networkDown();
    const response = await worker.fetchEvent("/_next/static/chunks/main-a.js");
    assert.equal(await response?.text(), "asset /_next/static/chunks/main-a.js");
    assert.deepEqual(fetchLog, []);
  });

  test("the page cache is bounded and keeps the home and offline pages", async () => {
    const pages: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) pages[`/hisse/T${i}`] = `<html><head></head><body>${i}</body></html>`;
    const worker = await installed();
    setNetwork(server(pages));
    for (let i = 0; i < 60; i += 1) await worker.fetchEvent(`/hisse/T${i}`, { mode: "navigate" });
    const cache = await worker.caches.open(worker.helpers.PAGES_CACHE);
    const keys = (await cache.keys()).map((request) => new URL(request.url).pathname);
    assert.equal(keys.length, 40);
    assert.ok(keys.includes("/offline") && keys.includes("/"));
    assert.ok(keys.includes("/hisse/T59") && !keys.includes("/hisse/T0"), "least recently saved pages go first");
  });
});

describe("service worker push notifications", () => {
  const pushEvent = (payload: unknown) => ({
    data: {
      json: () => (typeof payload === "string" ? JSON.parse(payload) : payload),
      text: () => String(payload),
    },
  });

  test("shows the alert with its tag and keeps the target path", async () => {
    const worker = loadWorker();
    await worker.dispatch("push", pushEvent({ title: "THYAO 300,00 TL üstüne çıktı", body: "Son fiyat", tag: "alert-1", url: "/hisse/THYAO" }));
    const [shown] = worker.state.notifications as Array<{ title: string; options: { tag: string; data: { url: string } } }>;
    assert.equal(shown.title, "THYAO 300,00 TL üstüne çıktı");
    assert.equal(shown.options.tag, "alert-1");
    assert.equal(shown.options.data.url, "/hisse/THYAO");
  });

  test("a malformed or foreign target never leaves the app", async () => {
    const worker = loadWorker();
    assert.equal(worker.helpers.safeAppPath("https://evil.example/x"), "/alarmlar");
    assert.equal(worker.helpers.safeAppPath("//evil.example/x"), "/alarmlar");
    assert.equal(worker.helpers.safeAppPath("/events?ticker=THYAO&event=abc"), "/events?ticker=THYAO&event=abc");
    await worker.dispatch("push", { data: { json: () => { throw new SyntaxError("bad"); }, text: () => "plain text" } });
    const [shown] = worker.state.notifications as Array<{ title: string; options: { body: string } }>;
    assert.equal(shown.title, "Hisse Analizi");
    assert.equal(shown.options.body, "plain text");
  });

  test("clicking opens the alert's page", async () => {
    const worker = loadWorker();
    let closed = false;
    await worker.dispatch("notificationclick", {
      notification: { data: { url: "/events?ticker=THYAO&event=e1" }, close: () => { closed = true; } },
    });
    assert.ok(closed);
    assert.deepEqual(worker.state.opened, [`${ORIGIN}/events?ticker=THYAO&event=e1`]);
  });
});
