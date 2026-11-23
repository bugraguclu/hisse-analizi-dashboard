import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTickerIndex } from "./ticker-index.ts";
import { GUIDE_ENTRIES, getQuickAccessItems, searchUnified } from "./catalog.ts";

const SAMPLE_STOCKS = buildTickerIndex({
  count: 5,
  companies: [
    { symbol: "THYAO", name: "TÜRK HAVA YOLLARI A.O.", criteria_8: 420_000 },
    { symbol: "GARAN", name: "TÜRKİYE GARANTİ BANKASI A.Ş.", criteria_8: 510_000 },
    { symbol: "SISE", name: "TÜRKİYE ŞİŞE VE CAM FABRİKALARI A.Ş.", criteria_8: 150_000 },
    { symbol: "EREGL", name: "EREĞLİ DEMİR VE ÇELİK FABRİKALARI T.A.Ş.", criteria_8: 180_000 },
    { symbol: "RSIT", name: "ÖRNEK RSI TEKNOLOJİ A.Ş.", criteria_8: 5_000 },
  ],
});

describe("unified search catalog", () => {
  it("always ranks an exact ticker match first", () => {
    const results = searchUnified({ query: "THYAO", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.equal(results[0]?.kind, "stock");
    assert.equal(results[0]?.ticker, "THYAO");
    assert.equal(results[0]?.href, "/hisse/THYAO");
  });

  it("finds RSI indicator, RSI screens and RSI concept alongside ticker prefix matches", () => {
    const results = searchUnified({ query: "RSI", locale: "tr", stocks: SAMPLE_STOCKS, activeTicker: "GARAN" });
    const kinds = new Set(results.map((r) => r.kind));
    assert.ok(kinds.has("tool"), "expected RSI technical tool");
    assert.ok(kinds.has("screen"), "expected RSI screener preset");
    assert.ok(kinds.has("concept"), "expected RSI concept guide");
    const techTool = results.find((r) => r.id === "tool:indicator-rsi");
    assert.equal(techTool?.href, "/teknik/GARAN");
    const rsiConcept = results.find((r) => r.id === "concept:rsi");
    assert.equal(rsiConcept?.href, "/atlas/rsi");
  });

  it("finds inflation, policy rate and dividend screen with Turkish folding", () => {
    const inflation = searchUnified({ query: "enflasyon", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.ok(inflation.some((r) => r.id === "tool:macro-inflation" && r.href === "/makro#enflasyon"));
    assert.ok(inflation.some((r) => r.id === "concept:enflasyon" && r.href === "/rehber?konu=enflasyon"));

    const rate = searchUnified({ query: "politika faizi", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.ok(rate.some((r) => r.id === "tool:macro-policy-rate" && r.href === "/makro#para-politikasi"));

    const dividend = searchUnified({ query: "temettü taraması", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.equal(dividend[0]?.id, "screen:high_dividend");
    assert.ok(dividend[0]?.href.includes("screen=high_dividend"));
  });

  it("finds F/K explanation and workspace/help entries", () => {
    const fk = searchUnified({ query: "F/K açıklaması", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.equal(fk[0]?.id, "concept:fk");
    assert.equal(fk[0]?.href, "/atlas/fk-orani");

    const layout = searchUnified({ query: "yeni sayfa", locale: "tr", stocks: SAMPLE_STOCKS });
    assert.ok(layout.some((r) => r.id === "concept:kisayollar" || r.id === "tool:markets"));
  });

  it("supports English and French queries and exposes canonical target metadata", () => {
    const enResults = searchUnified({ query: "dividend", locale: "en", stocks: SAMPLE_STOCKS });
    const screen = enResults.find((r) => r.id === "screen:high_dividend");
    assert.ok(screen);
    assert.equal(screen.title, "Dividend Screen");
    assert.equal(screen.target.route, "/tarama");

    const quickFr = getQuickAccessItems("fr");
    assert.ok(quickFr.length >= 3);
    assert.ok(GUIDE_ENTRIES.every((entry) => entry.title.tr && entry.title.en && entry.title.fr));
  });
});
