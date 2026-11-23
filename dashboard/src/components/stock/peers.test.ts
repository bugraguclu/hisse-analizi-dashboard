import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { setFormatLocale } from "../../lib/format.ts";
import { formatPeerValue, industryName, parseCompanyPeers, reasonText, visibleReasons } from "./peers.ts";

/** Trimmed GET /fundamentals/THYAO/peers response (shape of src/services/peer_service.py). */
function payload() {
  return {
    ticker: "THYAO",
    available: true,
    min_peers: 3,
    weights: { industry: 30, market_cap: 20, revenue: 15, ebitda_margin: 10, debt_to_equity: 8, revenue_growth_yoy: 7, net_margin: 5, roe: 5, bogus: 50 },
    reason_min_similarity: 0.6,
    scope: "sector",
    fallback: true,
    sector: { key: "ulastirma-ve-depolama", name: "ULAŞTIRMA VE DEPOLAMA", count: 12 },
    industry: { key: "Airlines", name: "Havayolları", count: 2 },
    company: { symbol: "THYAO", name: "Türk Hava Yolları", values: { market_cap: 400e9, ebitda_margin: 20, pe: Number.NaN } },
    unavailable: ["revenue", "nope"],
    candidates: 11,
    peers: [
      {
        symbol: "PGSUS",
        name: "Pegasus",
        score: 71.4,
        coverage: 1,
        reasons: [
          { type: "same_industry", industry: { key: "Airlines", name: "Havayolları" } },
          { type: "same_sector", sector: "ulastirma-ve-depolama", fallback: true },
          { type: "similar_size", metric: "market_cap", value: 400e9, peer_value: 480e9, similarity: 0.92, ratio: 1.2 },
          { type: "close_metric", metric: "ebitda_margin", value: 20, peer_value: 22, similarity: 0.87, difference: 2 },
          // Incomplete reasons are dropped, never shown with a made-up value.
          { type: "close_metric", metric: "roe", value: 18, peer_value: null, similarity: 0.9, difference: 0 },
          { type: "mystery" },
        ],
        components: { industry: 1 },
        missing: [],
        values: { market_cap: 480e9, ebitda_margin: 22, roe: "x" },
      },
      {
        symbol: "CLEBI",
        score: 40,
        coverage: 0.5,
        reasons: [{ type: "same_sector", sector: "ulastirma-ve-depolama", fallback: true }],
        values: {},
        loss: true,
      },
      { symbol: "", score: 10 },
      { symbol: "NOSCORE" },
    ],
  };
}

afterEach(() => setFormatLocale("tr"));

describe("parseCompanyPeers", () => {
  test("keeps the pool, the weights and complete reasons only", () => {
    const peers = parseCompanyPeers(payload());
    assert.ok(peers);
    assert.equal(peers.scope, "sector");
    assert.equal(peers.fallback, true);
    assert.deepEqual(peers.industry, { key: "Airlines", name: "Havayolları", size: 2 });
    assert.deepEqual(peers.sector, { key: "ulastirma-ve-depolama", kapName: "ULAŞTIRMA VE DEPOLAMA", size: 12 });
    assert.deepEqual(peers.company.values, { market_cap: 400e9, ebitda_margin: 20 });
    assert.deepEqual(peers.weights.map((w) => w.metric), [
      "industry", "market_cap", "revenue", "ebitda_margin", "debt_to_equity", "revenue_growth_yoy", "net_margin", "roe",
    ]);
    assert.deepEqual(peers.unavailable, ["revenue"]);
    assert.deepEqual(peers.peers.map((p) => p.symbol), ["PGSUS", "CLEBI"]);
    const [pgsus, clebi] = peers.peers;
    assert.deepEqual(pgsus.reasons.map((r) => r.type), ["same_industry", "same_sector", "similar_size", "close_metric"]);
    assert.deepEqual(pgsus.values, { market_cap: 480e9, ebitda_margin: 22 });
    assert.equal(clebi.loss, true);
    assert.equal(clebi.name, null);
  });

  test("null without a KAP sector or a usable payload", () => {
    assert.equal(parseCompanyPeers({ ...payload(), available: false }), null);
    assert.equal(parseCompanyPeers({ ...payload(), company: null }), null);
    assert.equal(parseCompanyPeers(null), null);
    assert.equal(parseCompanyPeers([]), null);
  });

  test("an unknown scope reads as none", () => {
    assert.equal(parseCompanyPeers({ ...payload(), scope: "galaxy" })?.scope, null);
  });
});

describe("reason text", () => {
  test("Turkish sentences with both companies' values", () => {
    const peers = parseCompanyPeers(payload());
    assert.ok(peers);
    const texts = visibleReasons(peers.peers[0]).map((r) => reasonText(r, "tr"));
    // The shared sub-sector makes the sector reason redundant.
    assert.deepEqual(texts, ["aynı alt sektör (Havayolları)", "piyasa değeri benzer (1,2x)", "FAVÖK marjı yakın (%22,0 / %20,0)"]);
    assert.deepEqual(visibleReasons(peers.peers[1]).map((r) => reasonText(r, "tr")), ["aynı sektör (Ulaştırma ve Depolama)"]);
  });

  test("English and French", () => {
    const peers = parseCompanyPeers(payload());
    assert.ok(peers);
    setFormatLocale("en");
    assert.deepEqual(visibleReasons(peers.peers[0]).map((r) => reasonText(r, "en")), [
      "same sub-sector (Airlines)", "similar market cap (1.2x)", "EBITDA margin close (22.0% vs 20.0%)",
    ]);
    setFormatLocale("fr");
    assert.equal(reasonText(peers.peers[1].reasons[0], "fr"), "même secteur (Transport et entreposage)");
    assert.equal(industryName({ key: "Airlines", name: "Havayolları" }, "fr"), "Airlines");
  });

  test("an unlisted sector falls back to KAP's name, not its key", () => {
    const item = { type: "same_sector", sector: "yeni-sektor", fallback: true } as const;
    assert.equal(reasonText(item, "tr", { "yeni-sektor": "YENİ SEKTÖR VE DİĞERLERİ" }), "aynı sektör (Yeni Sektör ve Diğerleri)");
    assert.equal(reasonText(item, "tr"), "aynı sektör (yeni-sektor)");
  });

  test("values use the stock pages' formats", () => {
    assert.equal(formatPeerValue("debt_to_equity", 1.5), "1,50x");
    assert.equal(formatPeerValue("revenue_growth_yoy", 12.34), "+%12,3");
    // Intl puts a no-break space before the unit.
    assert.equal(formatPeerValue("market_cap", 401.2e9).replace(/\s/gu, " "), "401,2 Mr");
  });
});
