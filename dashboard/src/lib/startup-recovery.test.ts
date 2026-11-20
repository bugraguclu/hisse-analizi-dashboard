import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createStartupRecovery,
  isAssetLoadError,
  isStaticAssetUrl,
  RELOAD_INTERVAL_MS,
  STARTUP_RELOAD_KEY,
  STARTUP_WINDOW_MS,
  startupBootstrapScript,
  type AssetRecoveryNotice,
  type BrowserLike,
} from "./startup-recovery.ts";

function createFakeBrowser(opts: {
  onLine?: boolean;
  visibilityState?: string;
  throwStorage?: boolean;
  initialStorage?: Record<string, string>;
} = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const store = new Map<string, string>(Object.entries(opts.initialStorage ?? {}));
  let reloads = 0;

  const browser: BrowserLike = {
    document: {
      visibilityState: opts.visibilityState ?? "visible",
      addEventListener(type, listener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
    },
    navigator: { onLine: opts.onLine ?? true },
    sessionStorage: opts.throwStorage
      ? {
          getItem() {
            throw new Error("SecurityError");
          },
          setItem() {
            throw new Error("SecurityError");
          },
        }
      : {
          getItem: (key) => store.get(key) ?? null,
          setItem: (key, value) => {
            store.set(key, value);
          },
        },
    location: {
      origin: "https://hisseanalizi.com",
      reload() {
        reloads += 1;
      },
    },
  };

  return {
    browser,
    store,
    get reloads() {
      return reloads;
    },
    dispatch(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener();
      }
    },
  };
}

describe("isAssetLoadError", () => {
  test("recognizes Next.js, webpack, Turbopack and browser dynamic import/CSS failures", () => {
    const chunkErr = new Error("Loading chunk 412 failed.");
    chunkErr.name = "ChunkLoadError";
    assert.equal(isAssetLoadError(chunkErr), true);
    assert.equal(isAssetLoadError(new Error("Loading CSS chunk 89 failed.")), true);
    assert.equal(isAssetLoadError(new Error("Failed to fetch dynamically imported module: /_next/static/chunks/foo.js")), true);
    assert.equal(isAssetLoadError(new Error("Importing a module script failed.")), true);
    assert.equal(isAssetLoadError(new Error("Unable to preload CSS for /_next/static/css/app.css")), true);
    assert.equal(isAssetLoadError(new Error("wrapped", { cause: chunkErr })), true);
  });

  test("ignores regular runtime and API errors", () => {
    assert.equal(isAssetLoadError(new Error("API 502: /market/indices")), false);
    assert.equal(isAssetLoadError(new TypeError("Cannot read properties of undefined")), false);
    assert.equal(isAssetLoadError(null), false);
    assert.equal(isAssetLoadError(undefined), false);
  });
});

describe("isStaticAssetUrl", () => {
  test("accepts same-origin Next.js static assets only", () => {
    assert.equal(isStaticAssetUrl("/_next/static/chunks/app-123.js", "https://hisseanalizi.com"), true);
    assert.equal(isStaticAssetUrl("https://hisseanalizi.com/_next/static/css/main.css", "https://hisseanalizi.com"), true);
    assert.equal(isStaticAssetUrl("https://evil.example/_next/static/chunks/x.js", "https://hisseanalizi.com"), false);
    assert.equal(isStaticAssetUrl("/api/market/indices", "https://hisseanalizi.com"), false);
    assert.equal(isStaticAssetUrl("", "https://hisseanalizi.com"), false);
  });
});

describe("createStartupRecovery", () => {
  test("reloads once during untouched startup and stamps sessionStorage", () => {
    let clock = 1_000_000;
    const fake = createFakeBrowser();
    const notices: AssetRecoveryNotice[] = [];
    const ctrl = createStartupRecovery(fake.browser, {
      now: () => clock,
      onManualRecovery: (n) => notices.push(n),
    });

    const res = ctrl.handleError(new Error("Loading chunk 99 failed."));
    assert.deepEqual(res, { outcome: "reloading", reason: "reloaded" });
    assert.equal(fake.reloads, 1);
    assert.equal(fake.store.get(STARTUP_RELOAD_KEY), String(clock));
    assert.equal(notices.length, 0);

    // A second call while reload is in flight does not reload twice.
    clock += 100;
    const res2 = ctrl.handleResourceUrl("/_next/static/css/app.css");
    assert.deepEqual(res2, { outcome: "reloading", reason: "already-reloading" });
    assert.equal(fake.reloads, 1);
  });

  test("prevents reload loops within RELOAD_INTERVAL_MS and falls back to manual notice", () => {
    let clock = 2_000_000;
    const fake = createFakeBrowser({
      initialStorage: { [STARTUP_RELOAD_KEY]: String(clock - 5_000) },
    });
    const notices: AssetRecoveryNotice[] = [];
    const ctrl = createStartupRecovery(fake.browser, {
      now: () => clock,
      onManualRecovery: (n) => notices.push(n),
    });

    const res = ctrl.handleResourceUrl("/_next/static/chunks/page.js");
    assert.deepEqual(res, { outcome: "manual", reason: "cooldown-active" });
    assert.equal(fake.reloads, 0);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].reason, "cooldown-active");

    // Once the cooldown expires on a new boot, automatic recovery is allowed again.
    clock += RELOAD_INTERVAL_MS;
    const ctrl2 = createStartupRecovery(fake.browser, { now: () => clock });
    const res2 = ctrl2.handleResourceUrl("/_next/static/chunks/page.js");
    assert.deepEqual(res2, { outcome: "reloading", reason: "reloaded" });
    assert.equal(fake.reloads, 1);
  });

  test("never auto-reloads after user interaction", () => {
    const fake = createFakeBrowser();
    const notices: AssetRecoveryNotice[] = [];
    const ctrl = createStartupRecovery(fake.browser, {
      now: () => 500_000,
      onManualRecovery: (n) => notices.push(n),
    });

    fake.dispatch("pointerdown");
    assert.equal(ctrl.hasInteracted(), true);

    const res = ctrl.handleError(new Error("Failed to fetch dynamically imported module"));
    assert.deepEqual(res, { outcome: "manual", reason: "interacted" });
    assert.equal(fake.reloads, 0);
    assert.equal(notices.length, 1);
  });

  test("does not auto-reload past STARTUP_WINDOW_MS, when offline, hidden, or without storage", () => {
    let clock = 10_000;
    const late = createFakeBrowser();
    const lateCtrl = createStartupRecovery(late.browser, { now: () => clock });
    clock += STARTUP_WINDOW_MS + 1;
    assert.equal(lateCtrl.handleError(new Error("Loading chunk 1 failed")).reason, "startup-window-elapsed");
    assert.equal(late.reloads, 0);

    const offline = createFakeBrowser({ onLine: false });
    const offlineCtrl = createStartupRecovery(offline.browser, { now: () => 10_000 });
    assert.equal(offlineCtrl.handleError(new Error("Loading chunk 1 failed")).reason, "offline");
    assert.equal(offline.reloads, 0);

    const hidden = createFakeBrowser({ visibilityState: "hidden" });
    const hiddenCtrl = createStartupRecovery(hidden.browser, { now: () => 10_000 });
    assert.equal(hiddenCtrl.handleError(new Error("Loading chunk 1 failed")).reason, "hidden");
    assert.equal(hidden.reloads, 0);

    const noStorage = createFakeBrowser({ throwStorage: true });
    const noStorageCtrl = createStartupRecovery(noStorage.browser, { now: () => 10_000 });
    assert.equal(noStorageCtrl.handleError(new Error("Loading chunk 1 failed")).reason, "storage-unavailable");
    assert.equal(noStorage.reloads, 0);
  });

  test("startupBootstrapScript produces valid JavaScript for all locales", () => {
    for (const locale of ["tr", "en", "fr"] as const) {
      const src = startupBootstrapScript(locale);
      assert.ok(src.includes(STARTUP_RELOAD_KEY));
      // Syntax check using Function constructor (does not execute).
      assert.doesNotThrow(() => new Function(src));
    }
  });
});
