import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ChartSeries } from "./types.ts";
import {
  convertSeries,
  cpiFactor,
  effectiveUnit,
  isChartUnit,
  istanbulDayIndex,
  mergeRatePoints,
  parseCpiIndex,
  parseRatePoints,
  rateAt,
  rateFactor,
  realFactor,
  requestCurrency,
  seriesUnit,
  unitAvailable,
} from "./units.ts";

const DAY_MS = 86_400_000;
/** Day index of a calendar date, as `istanbulDayIndex` counts them. */
const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;
/** A daily bar's time: 09:00 Istanbul, as the chart endpoints stamp them. */
const at = (iso: string) => Date.parse(`${iso}T09:00:00+03:00`);

function series(closes: Array<[string, number]>, windowStart: number, referenceClose: number | null = null): ChartSeries {
  return {
    symbol: "TEST",
    period: "1y",
    interval: "daily",
    intervalMinutes: null,
    bars: closes.map(([iso, close]) => ({ time: at(iso), open: close, high: close * 1.1, low: close * 0.9, close, volume: 100 })),
    windowStart,
    referenceClose,
    info: null,
    currency: "TRY",
    fxRate: null,
  };
}

describe("units", () => {
  test("availability: derived units need daily or weekly bars within five years", () => {
    assert.equal(unitAvailable("USD", "1d"), true);
    assert.equal(unitAvailable("EUR", "1d"), false);
    assert.equal(unitAvailable("GOLD", "5d"), false);
    assert.equal(unitAvailable("REAL", "max"), false);
    assert.equal(unitAvailable("EUR", "5y"), true);
    assert.equal(effectiveUnit("GOLD", "1d"), "TRY");
    assert.equal(effectiveUnit("GOLD", "ytd"), "GOLD");
    assert.equal(requestCurrency("USD"), "USD");
    assert.equal(requestCurrency("REAL"), "TRY");
    assert.equal(isChartUnit("EUR"), true);
    assert.equal(isChartUnit("JPY"), false);
  });

  test("seriesUnit prefers the converted unit over the fetched currency", () => {
    assert.equal(seriesUnit({ currency: "TRY" }), "TRY");
    assert.equal(seriesUnit({ currency: "USD" }), "USD");
    assert.equal(seriesUnit({ currency: "TRY", unit: "GOLD" }), "GOLD");
  });

  test("istanbulDayIndex puts an instant on its Istanbul calendar day", () => {
    assert.equal(istanbulDayIndex(at("2026-09-30")), day("2026-09-30"));
    // 22:30 UTC is already the next day in Istanbul.
    assert.equal(istanbulDayIndex(Date.parse("2026-09-30T22:30:00Z")), day("2026-10-01"));
  });

  test("rate points: parsed, sorted, invalid rows skipped; daily points win over weekly ones", () => {
    const points = parseRatePoints({
      points: [
        { date: "2026-09-29", close: 48.1 },
        { date: "2026-09-28", close: 48 },
        { date: "bad", close: 1 },
        { date: "2026-09-27", close: 0 },
        { date: "2026-09-26", close: null },
      ],
    });
    assert.deepEqual(points, [
      { day: day("2026-09-28"), value: 48 },
      { day: day("2026-09-29"), value: 48.1 },
    ]);
    assert.deepEqual(parseRatePoints(null), []);

    const weekly = [
      { day: day("2026-09-14"), value: 47 },
      { day: day("2026-09-21"), value: 47.5 },
      { day: day("2026-09-28"), value: 99 },
    ];
    const merged = mergeRatePoints(points, weekly);
    assert.deepEqual(
      merged.map((point) => point.value),
      [47, 47.5, 48, 48.1],
    );
  });

  test("rateAt: the close at or before the day, none before the first point", () => {
    const points = [
      { day: day("2026-09-21"), value: 47 },
      { day: day("2026-09-28"), value: 48 },
    ];
    assert.equal(rateAt(points, day("2026-09-20")), null);
    assert.equal(rateAt(points, day("2026-09-21")), 47);
    assert.equal(rateAt(points, day("2026-09-24")), 47);
    assert.equal(rateAt(points, day("2026-10-02")), 48);
    assert.equal(rateAt([], day("2026-10-02")), null);
  });

  test("CPI: monthly changes chain into levels; later months are today's lira", () => {
    const cpi = parseCpiIndex({
      tufe_history: [
        { Date: "2026-08-01T00:00:00", MonthlyInflation: 2 },
        { Date: "2026-07-01T00:00:00", MonthlyInflation: 1 },
        { Date: "2026-06-01T00:00:00", MonthlyInflation: null },
      ],
    });
    assert.ok(cpi);
    assert.equal(cpi.first, "2026-07");
    assert.equal(cpi.latest, "2026-08");
    assert.ok(Math.abs((cpi.levels.get("2026-07") ?? 0) - 101) < 1e-9);
    assert.ok(Math.abs((cpi.levels.get("2026-08") ?? 0) - 103.02) < 1e-9);
    assert.equal(cpiFactor(cpi, day("2026-10-01")), 1);
    assert.equal(cpiFactor(cpi, day("2026-08-15")), 1);
    assert.ok(Math.abs((cpiFactor(cpi, day("2026-07-15")) ?? 0) - 1.02) < 1e-9);
    assert.equal(cpiFactor(cpi, day("2026-06-30")), null);
    assert.equal(parseCpiIndex({ tufe_history: [] }), null);
  });

  test("convertSeries: euros divide every price by that day's rate and drop bars older than the rates", () => {
    const lira = series(
      [
        ["2026-09-24", 100],
        ["2026-09-25", 102],
        ["2026-09-28", 110],
        ["2026-09-29", 120],
      ],
      2,
      102,
    );
    const rates = [
      { day: day("2026-09-25"), value: 50 },
      { day: day("2026-09-29"), value: 60 },
    ];
    const euros = convertSeries(lira, "EUR", rateFactor(rates));
    assert.equal(euros.unit, "EUR");
    assert.equal(euros.currency, "TRY");
    // 09-24 is older than the first rate: dropped, so the window starts one bar earlier.
    assert.deepEqual(
      euros.bars.map((bar) => bar.close),
      [102 / 50, 110 / 50, 120 / 60],
    );
    assert.equal(euros.windowStart, 1);
    assert.ok(Math.abs((euros.bars[2].high ?? 0) - (120 * 1.1) / 60) < 1e-9);
    assert.equal(euros.bars[0].volume, 100);
    // The reference close converts at the rate of the bar before the window.
    assert.ok(Math.abs((euros.referenceClose ?? 0) - 102 / 50) < 1e-9);
  });

  test("convertSeries: real lira scales by CPI(latest) / CPI(bar's month)", () => {
    const cpi = parseCpiIndex({
      tufe_history: [
        { Date: "2026-08-01T00:00:00", MonthlyInflation: 10 },
        { Date: "2026-07-01T00:00:00", MonthlyInflation: 0 },
      ],
    });
    assert.ok(cpi);
    const lira = series(
      [
        ["2026-07-15", 100],
        ["2026-08-14", 100],
        ["2026-09-15", 100],
      ],
      0,
    );
    const real = convertSeries(lira, "REAL", realFactor(cpi));
    assert.deepEqual(
      real.bars.map((bar) => Math.round(bar.close * 1000) / 1000),
      [110, 100, 100],
    );
    assert.equal(real.unit, "REAL");
  });
});
