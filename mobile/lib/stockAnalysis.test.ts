import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSnapshotCache, type KeyValueStore } from "./cache.ts";
import { formatCompactMoney, formatPercent, formatSignedPercent } from "./format.ts";
import { buildScorecard, LOSS_MAKING_PE, scoreMetric } from "./scorecard.ts";
import {
  extractMovingAverageRows,
  parseChartHistory,
  parsePivots,
  parseStatement,
  parseTechnicalSignals,
} from "./stockParsers.ts";

// Shapes trimmed from the live API (THYAO, 2026-11-23).
describe("stock parsers against live response shapes", () => {
  test("chart history keeps window and warmup bars apart", () => {
    const parsed = parseChartHistory({
      ticker: "THYAO",
      period: "3mo",
      interval: "1d",
      data: [
        { Date: "2026-08-24T00:00:00+03:00", Open: 304.25, High: 307.5, Low: 300, Close: 300.5, Volume: 57788778 },
        { Date: "2026-11-21T00:00:00+03:00", Open: 330.5, High: 333.5, Low: 320.5, Close: 324, Volume: 31097200 },
      ],
      warmup: [{ Date: "2026-08-21T00:00:00+03:00", Open: 302, High: 304.75, Low: 300.25, Close: 301, Volume: 41126204 }],
      reference_close: 301,
      reference_date: "2026-08-21",
    });
    assert.equal(parsed.bars.length, 2);
    assert.equal(parsed.bars[1].close, 324);
    assert.equal(parsed.warmup.length, 1);
    assert.equal(parsed.referenceClose, 301);
  });

  test("pivots and moving averages", () => {
    assert.deepEqual(
      parsePivots({
        ticker: "THYAO",
        method: "classic",
        session_date: "2026-11-20",
        pivots: { pivot: 327, r1: 331.25, r2: 333.5, r3: 337.75, s1: 324.75, s2: 320.5, s3: 318.25 },
      })?.pivot,
      327,
    );
    const signals = parseTechnicalSignals({
      ticker: "THYAO",
      signals: {
        summary: { recommendation: "BUY", buy: 14, sell: 4, neutral: 8, score: 0.3545 },
        moving_averages: {
          recommendation: "STRONG_BUY",
          buy: 13,
          sell: 1,
          neutral: 1,
          compute: { SMA20: "BUY", EMA20: "BUY" },
          values: { close: 324, SMA20: 297.3975, EMA20: 306.5904 },
        },
      },
    });
    assert.equal(signals?.summary?.level, "buy");
    const rows = extractMovingAverageRows(signals?.movingAverages ?? null, null);
    const sma20 = rows.find((r) => r.period === 20);
    assert.equal(sma20?.sma, 297.3975);
  });

  test("quarterly statements expose single-quarter figures from `discrete`", () => {
    const table = parseStatement({
      data: [{ Item: "Hasılat", "2026/09": 981030000000, "2026/06": 585069000000 }],
      discrete: [{ Item: "Hasılat", "2026/09": 395961000000, "2026/06": 327108000000 }],
      period_info: [{ period: "2026/09", months: 9, period_type: "interim" }],
      value_basis: "cumulative_ytd",
      available: true,
    });
    assert.equal(table?.cumulative, true);
    assert.deepEqual(table?.periods.map((p) => p.key), ["2026/09", "2026/06"]);
    assert.equal(table?.rows[0].values[0], 981030000000);
    assert.equal(table?.discreteRows?.[0].values[0], 395961000000);
  });
});

describe("scorecard (web FinancialHealthScorecard rules)", () => {
  test("thresholds score 1–5 in both directions", () => {
    const higher = { direction: "higher" as const, thresholds: [30, 20, 10, 0] as const };
    assert.deepEqual([35, 25, 15, 5, -1].map((v) => scoreMetric(v, higher)), [5, 4, 3, 2, 1]);
    const lower = { direction: "lower" as const, thresholds: [8, 12, 18, 25] as const, nonPositiveScore: 1 };
    assert.deepEqual([5, 10, 15, 20, 30, -3].map((v) => scoreMetric(v, lower)), [5, 4, 3, 2, 1, 1]);
  });

  test("market P/E wins over computed; a loss maker scores 1 on P/E", () => {
    const card = buildScorecard({
      ratios: { roe: 11.87, net_margin: 9.42, pe_ratio: 3.81, pb_ratio: 0.39, current_ratio: 0.97 },
      marketPe: 3.97,
      marketPb: 0.39,
      technicalLevel: "buy",
    });
    const valuation = card.categories.find((c) => c.id === "valuation")!;
    assert.equal(valuation.metrics[0].value, 3.97);
    assert.equal(valuation.score, 5);
    assert.equal(card.technicalScore, 4);
    // Growth has no inputs: skipped, not counted as zero.
    assert.equal(card.categories.find((c) => c.id === "growth")!.score, null);

    const loss = buildScorecard({ ratios: { net_margin: -4 } });
    const pe = loss.categories.find((c) => c.id === "valuation")!.metrics[0];
    assert.equal(pe.value, LOSS_MAKING_PE);
    assert.equal(pe.score, 1);
  });

  test("no inputs, no grade", () => {
    assert.equal(buildScorecard({ ratios: null }).overall, null);
  });
});

describe("formatting", () => {
  test("missing values are a dash, never zero", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatPercent(value), "—");
      assert.equal(formatSignedPercent(value), "—");
      assert.equal(formatCompactMoney(value, "USD"), "—");
    }
    assert.equal(formatSignedPercent(-1.52), "−%1,52");
    // Turkish puts the sign before "%"; a value that rounds to zero carries no sign.
    assert.equal(formatPercent(-1.88, 1), "−%1,9");
    assert.equal(formatPercent(-0.001, 2), "%0,00");
  });
});

describe("snapshot cache", () => {
  const memoryStore = (): KeyValueStore & { keys: () => string[] } => {
    const map = new Map<string, string>();
    return {
      async getItem(key) {
        return map.get(key) ?? null;
      },
      async setItem(key, value) {
        map.set(key, value);
      },
      async removeItem(key) {
        map.delete(key);
      },
      keys: () => [...map.keys()],
    };
  };

  test("round-trips entries with their save time", async () => {
    const cache = createSnapshotCache(memoryStore());
    await cache.write("a", { x: 1 }, "2026-11-23T10:00:00.000Z");
    assert.deepEqual(await cache.read("a"), { savedAt: "2026-11-23T10:00:00.000Z", data: { x: 1 } });
    assert.equal(await cache.read("missing"), null);
  });

  test("evicts the oldest snapshots beyond the cap", async () => {
    const store = memoryStore();
    const cache = createSnapshotCache(store, 3);
    for (const key of ["a", "b", "c", "d", "e"]) {
      await cache.write(key, key);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(await cache.read("a"), null);
    assert.equal(await cache.read("b"), null);
    assert.equal((await cache.read<string>("e"))?.data, "e");
    assert.equal(store.keys().filter((k) => !k.endsWith("__index")).length, 3);
  });
});
