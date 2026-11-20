import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IncomingUrlQueue, incomingUrlNavigation, type IncomingUrlSource } from "./incomingUrl.ts";

describe("IncomingUrlQueue", () => {
  it("queues launch and warm URLs until startup attaches a handler and deduplicates launch URL", async () => {
    let listener: ((event: { url: string }) => void) | null = null;
    let resolveInitial!: (url: string | null) => void;
    const source: IncomingUrlSource = {
      getInitialURL: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      addEventListener: (_type, cb) => {
        listener = cb;
        return { remove: () => undefined };
      },
    };

    const queue = new IncomingUrlQueue();
    queue.start(source);

    // Same launch URL arrives via event before getInitialURL settles, plus a second URL.
    listener?.({ url: "hisseanalizi://hisse/THYAO" });
    listener?.({ url: "hisseanalizi://events?ticker=GARAN" });
    resolveInitial("hisseanalizi://hisse/THYAO");
    await Promise.resolve();

    const handled: string[] = [];
    const detach = queue.attach((url) => handled.push(url));
    assert.deepEqual(handled, [
      "hisseanalizi://hisse/THYAO",
      "hisseanalizi://events?ticker=GARAN",
    ]);

    listener?.({ url: "hisseanalizi://makro?piyasa=usdtry" });
    assert.deepEqual(handled, [
      "hisseanalizi://hisse/THYAO",
      "hisseanalizi://events?ticker=GARAN",
      "hisseanalizi://makro?piyasa=usdtry",
    ]);
    detach();
  });

  it("prepends initial launch URL ahead of subsequent URLs when not already seen", async () => {
    let listener: ((event: { url: string }) => void) | null = null;
    let resolveInitial!: (url: string | null) => void;
    const source: IncomingUrlSource = {
      getInitialURL: () =>
        new Promise((resolve) => {
          resolveInitial = resolve;
        }),
      addEventListener: (_type, cb) => {
        listener = cb;
        return { remove: () => undefined };
      },
    };

    const queue = new IncomingUrlQueue();
    queue.start(source);
    listener?.({ url: "hisseanalizi://tarama?preset=low_pe" });
    resolveInitial("hisseanalizi://hisse/ASELS");
    await Promise.resolve();

    const handled: string[] = [];
    queue.attach((url) => handled.push(url));
    assert.deepEqual(handled, [
      "hisseanalizi://hisse/ASELS",
      "hisseanalizi://tarama?preset=low_pe",
    ]);
  });
});

describe("incomingUrlNavigation", () => {
  it("replaces when already on a stock screen, pushes from tabs, and dismisses to tab roots", () => {
    const pushStock = incomingUrlNavigation("hisseanalizi://hisse/THYAO", "/(tabs)/markets");
    assert.ok(pushStock && pushStock.method === "push");
    assert.equal(pushStock.route.pathname, "/stock/THYAO");

    const replaceStock = incomingUrlNavigation("hisseanalizi://teknik/GARAN", "/stock/THYAO");
    assert.ok(replaceStock && replaceStock.method === "replace");
    assert.equal(replaceStock.route.pathname, "/stock/GARAN");
    assert.equal(replaceStock.route.params.section, "teknik");

    const tabDismiss = incomingUrlNavigation("https://hisseanalizi.com/events?ticker=THYAO", "/stock/THYAO");
    assert.ok(tabDismiss && tabDismiss.method === "dismissTo");
    assert.equal(tabDismiss.route.pathname, "/(tabs)/events");

    const rejected = incomingUrlNavigation("hisseanalizi://hisse/!!!", "/(tabs)/markets");
    assert.ok(rejected && rejected.method === "reject");
  });
});
