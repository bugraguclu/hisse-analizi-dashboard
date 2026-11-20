import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTicker, readExternalAppUrl, routeForAction } from "./externalLinking.ts";

describe("externalLinking", () => {
  it("routes widget, pairing and Siri links into Expo", () => {
    const pairing = readExternalAppUrl("hisseanalizi://pair?server=https%3A%2F%2Fexample.test&code=ABCD-2345");
    assert.ok(pairing && "action" in pairing);
    assert.deepEqual(routeForAction(pairing.action), { pathname: "/companion", params: { server: "https://example.test", code: "ABCD2345" }, isTabRoot: false, ensureHomeUnderneath: false });
    for (const link of ["hisseanalizi://market", "hisseanalizi://dashboard/home", "hisseanalizi://watchlist/favorites", "hisseanalizi://event/dividend-1"]) {
      const result = readExternalAppUrl(link);
      assert.ok(result && "action" in result, link);
    }
    const list = readExternalAppUrl("hisseanalizi://watchlist/web-favorites");
    assert.ok(list && "action" in list);
    assert.equal(routeForAction(list.action).pathname, "/companion");
  });
  it("rejects malformed pairing destinations and codes before navigation", () => {
    for (const query of ["server=http%3A%2F%2Fexample.test&code=ABCD2345", "server=https%3A%2F%2Fuser%3Apass%40example.test&code=ABCD2345", "code=ABCD%26evil"]) {
      const result = readExternalAppUrl(`hisseanalizi://pair?${query}`);
      assert.ok(result && "rejected" in result, query);
    }
  });
  it("accepts stock links from the documented production host", () => {
    const result = readExternalAppUrl("https://hisse-analizi.duckdns.org/hisse/THYAO");
    assert.ok(result && "action" in result);
    assert.equal(result.action.kind, "stock");
  });
  it("normalizes BIST tickers using ASCII uppercasing", () => {
    assert.equal(normalizeTicker("sise"), "SISE");
    assert.equal(normalizeTicker("thyao"), "THYAO");
    assert.equal(normalizeTicker("bad-ticker!"), null);
  });

  it("parses custom-scheme stock, screener, events, and macro URLs", () => {
    const stock = readExternalAppUrl("hisseanalizi://analiz/garan?source=notification");
    assert.ok(stock && "action" in stock);
    assert.deepEqual(stock.action, {
      kind: "stock",
      ticker: "GARAN",
      section: "analiz",
      fromNotification: true,
    });
    assert.equal(routeForAction(stock.action).ensureHomeUnderneath, true);

    const tarama = readExternalAppUrl("hisseanalizi://tarama?preset=low_pe&index=XU100");
    assert.ok(tarama && "action" in tarama);
    assert.deepEqual(tarama.action, {
      kind: "tarama",
      preset: "low_pe",
      sector: undefined,
      index: "XU100",
      q: undefined,
    });

    const makro = readExternalAppUrl("hisseanalizi://makro?piyasa=usdtry");
    assert.ok(makro && "action" in makro);
    assert.deepEqual(routeForAction(makro.action), {
      pathname: "/makro",
      params: { piyasa: "usdtry" },
      isTabRoot: false,
      ensureHomeUnderneath: false,
    });
  });

  it("parses Universal Links on allowed hosts and ignores unrelated third-party URLs", () => {
    const universal = readExternalAppUrl("https://hisseanalizi.com/hisse/THYAO");
    assert.ok(universal && "action" in universal);
    assert.equal(universal.action.kind, "stock");
    if (universal.action.kind === "stock") {
      assert.equal(universal.action.ticker, "THYAO");
      assert.equal(universal.action.section, "hisse");
    }

    assert.equal(readExternalAppUrl("https://example.com/hisse/THYAO"), null);
  });

  it("rejects malformed, oversized, invalid-ticker, and unknown app URLs with structured reasons", () => {
    const badTicker = readExternalAppUrl("hisseanalizi://hisse/$$$");
    assert.ok(badTicker && "rejected" in badTicker);
    assert.equal(badTicker.rejected.reason, "invalidTicker");

    const unknown = readExternalAppUrl("hisseanalizi://bilinmeyen/yol");
    assert.ok(unknown && "rejected" in unknown);
    assert.equal(unknown.rejected.reason, "unknownRoute");

    const tooLong = readExternalAppUrl(`hisseanalizi://search?q=${"a".repeat(5000)}`);
    assert.ok(tooLong && "rejected" in tooLong);
    assert.equal(tooLong.rejected.reason, "tooLong");

    const control = readExternalAppUrl("hisseanalizi://hisse/THYAO\u0000");
    assert.ok(control && "rejected" in control);
    assert.equal(control.rejected.reason, "invalidUrl");
  });
});
