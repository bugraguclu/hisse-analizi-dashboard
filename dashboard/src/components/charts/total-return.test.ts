import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { totalReturn } from "./total-return.ts";
import type { ChartSeries } from "./types.ts";

const at = (iso: string) => Date.parse(`${iso}T09:00:00+03:00`);

function series(closes: Array<[string, number]>, windowStart: number): ChartSeries {
  return {
    symbol: "TEST",
    period: "1y",
    interval: "daily",
    intervalMinutes: null,
    bars: closes.map(([iso, close]) => ({ time: at(iso), open: close, high: close, low: close, close, volume: null })),
    windowStart,
    referenceClose: closes[windowStart - 1]?.[1] ?? null,
    info: null,
    currency: "TRY",
    fxRate: null,
  };
}

const bars: Array<[string, number]> = [
  ["2026-06-01", 100],
  ["2026-06-02", 100],
  ["2026-06-03", 95],
  ["2026-06-04", 96],
];

describe("totalReturn", () => {
  test("no dividend in the window: nothing to draw", () => {
    const result = totalReturn(series(bars, 1), [{ time: Date.parse("2026-01-10T00:00:00+03:00"), perShare: 5 }]);
    assert.ok(result);
    assert.equal(result.count, 0);
    assert.ok(result.values.every((value) => value === null));
  });

  test("reinvests on the ex-date: the line steps up by 1 + D / previous close", () => {
    // Ex-date 06-03 (midnight): the 06-03 bar already trades without the 5 TL dividend.
    const result = totalReturn(series(bars, 1), [{ time: Date.parse("2026-06-03T00:00:00+03:00"), perShare: 5 }]);
    assert.ok(result);
    assert.equal(result.count, 1);
    const factor = 1 + 5 / 100;
    assert.deepEqual(result.values.slice(0, 2), [100, 100]);
    assert.ok(Math.abs((result.values[2] ?? 0) - 95 * factor) < 1e-9);
    assert.ok(Math.abs((result.values[3] ?? 0) - 96 * factor) < 1e-9);
    assert.ok(Math.abs((result.percent ?? 0) - (96 * factor - 100)) < 1e-9);
  });

  test("ignores dividends after the last bar (announced, not paid yet)", () => {
    const result = totalReturn(series(bars, 1), [{ time: Date.parse("2026-07-01T00:00:00+03:00"), perShare: 5 }]);
    assert.ok(result);
    assert.equal(result.count, 0);
  });
});
