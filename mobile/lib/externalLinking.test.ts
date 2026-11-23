import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTicker, readExternalAppUrl, routeForAction } from "./externalLinking.ts";

describe("externalLinking", () => {
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

  it("honours ?section= on stock/ links and ignores unknown sections", () => {
    const analysis = readExternalAppUrl("hisseanalizi://stock/THYAO?section=analiz");
    assert.ok(analysis && "action" in analysis && analysis.action.kind === "stock");
    assert.equal(analysis.action.section, "analiz");
    const unknown = readExternalAppUrl("hisseanalizi://stock/THYAO?section=xyz");
    assert.ok(unknown && "action" in unknown && unknown.action.kind === "stock");
    assert.equal(unknown.action.section, "hisse");
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
