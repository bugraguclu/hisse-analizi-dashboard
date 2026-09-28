import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseCompanySector } from "./sector.ts";

/** Trimmed GET /fundamentals/THYAO/sector response (2026-09-27). */
function payload() {
  return {
    ticker: "THYAO",
    method: "median",
    min_companies: 3,
    available: true,
    sector: { key: "ulastirma-ve-depolama", name: "ULAŞTIRMA VE DEPOLAMA", count: 12, market_cap: 639808732178, ratio_period: "2026/06" },
    ratio_period: "2026/06",
    metrics: {
      pe: { median: 9.91, p25: 5.925, p75: 14.25, count: 7, reported: 7, value: 3.57, below: 0, above: 6 },
      dividend_yield: { median: 2.005, p25: 1.365, p75: 3.6175, count: 4, reported: 12, value: 2.37, below: 2, above: 1 },
      current_ratio: { median: 1.235, p25: 1.0175, p75: 2.11, count: 12, reported: 12, value: 0.9, below: 1, above: 10 },
      ev_ebitda: { median: null, p25: null, p75: null, count: 2, reported: 2, value: null },
      bogus_metric: { median: 1, p25: 1, p75: 1, count: 3, reported: 3, value: 1 },
    },
    peers: [
      { symbol: "THYAO", name: "Türk Hava Yolları", market_cap: 401235000000, pe: 3.57, ratio_period: "2026/06" },
      { symbol: "PGSUS", name: "Pegasus", market_cap: 73349998474, pb: 0.65, loss: true, note: "x", roe: Number.NaN },
      { symbol: "", name: "no symbol" },
    ],
    meta: { source: "kap+isyatirim+tradingview" },
  };
}

describe("parseCompanySector", () => {
  test("keeps the sector, its medians and the stock's place", () => {
    const sector = parseCompanySector(payload());
    assert.ok(sector);
    assert.equal(sector.key, "ulastirma-ve-depolama");
    assert.equal(sector.kapName, "ULAŞTIRMA VE DEPOLAMA");
    assert.equal(sector.size, 12);
    assert.equal(sector.minCompanies, 3);
    assert.deepEqual(sector.metrics.pe, { median: 9.91, count: 7, reported: 7, value: 3.57, rank: 7 });
    // 10 companies have a higher current ratio: 11th from the top.
    assert.equal(sector.metrics.current_ratio?.rank, 11);
    assert.deepEqual(sector.metrics.ev_ebitda, { median: null, count: 2, reported: 2, value: null, rank: null });
    assert.equal("bogus_metric" in sector.metrics, false);
  });

  test("keeps only real peers and their finite metrics", () => {
    const sector = parseCompanySector(payload());
    assert.ok(sector);
    assert.deepEqual(sector.peers, [
      { symbol: "THYAO", name: "Türk Hava Yolları", loss: false, values: { market_cap: 401235000000, pe: 3.57 } },
      { symbol: "PGSUS", name: "Pegasus", loss: true, values: { market_cap: 73349998474, pb: 0.65 } },
    ]);
  });

  test("null without a KAP sector or a usable payload", () => {
    assert.equal(parseCompanySector({ ticker: "AVTUR", available: false, sector: null, metrics: {}, peers: [] }), null);
    assert.equal(parseCompanySector({ ...payload(), sector: { key: "" } }), null);
    assert.equal(parseCompanySector(null), null);
    assert.equal(parseCompanySector("nope"), null);
  });
});
