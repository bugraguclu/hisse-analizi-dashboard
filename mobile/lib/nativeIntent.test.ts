import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isHandledByAppLayout, redirectSystemPath } from "./nativeIntent.ts";

describe("nativeIntent redirectSystemPath", () => {
  it("claims custom-scheme and Universal Link URLs so Expo Router does not double-navigate", () => {
    assert.equal(isHandledByAppLayout("hisseanalizi://hisse/THYAO"), true);
    assert.equal(isHandledByAppLayout("https://hisseanalizi.com/tarama?preset=low_pe"), true);
    assert.equal(isHandledByAppLayout("/stock/THYAO"), false);
  });

  it("routes cold-launch external URLs to root tabs and swallows warm URLs for IncomingUrlQueue", () => {
    assert.equal(
      redirectSystemPath({ path: "hisseanalizi://hisse/THYAO", initial: true }),
      "/(tabs)/markets",
    );
    assert.equal(
      redirectSystemPath({ path: "hisseanalizi://hisse/THYAO", initial: false }),
      null,
    );
    assert.equal(
      redirectSystemPath({ path: "https://hisseanalizi.com/events", initial: false }),
      null,
    );
    assert.equal(redirectSystemPath({ path: "/stock/THYAO", initial: false }), "/stock/THYAO");
  });
});
