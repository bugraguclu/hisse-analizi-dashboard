import assert from "node:assert/strict";
import { describe, test } from "node:test";
// The web model is the reference: the phone must list the same stocks in the same order.
import * as web from "../../dashboard/src/components/tarama/model.ts";
import {
  DEFAULT_SCREENER_STATE,
  filterScreenerRows,
  PRESET_VIEWS,
  rowSignals,
  SCREENER_PRESETS,
  sortLabel,
  sortOptionsForView,
  sortScreenerRows,
  techRating,
  toggleScreenerPreset,
  VIEW_METRICS,
  type ScreenerStockRow,
} from "./screener.ts";

/** Deterministic universe with gaps, loss makers, crosses and recommendations. */
function makeUniverse(count = 240): ScreenerStockRow[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const maybe = (value: number, missing = 0.15) => (rand() < missing ? undefined : Math.round(value * 100) / 100);
  const sectors = ["bankalar", "holdingler", "enerji", "gida", "metal"];
  const rows: ScreenerStockRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const loss = rand() < 0.2;
    const row: ScreenerStockRow = {
      symbol: `T${String(i).padStart(3, "0")}`,
      name: `Şirket ${i}`,
      sector: "Finance",
      kap_sector: rand() < 0.95 ? sectors[i % sectors.length] : undefined,
      indices: i % 3 === 0 ? ["XU030", "XU100"] : ["XU100"],
      close: maybe(1 + rand() * 500, 0.02),
      change_pct: maybe(rand() * 20 - 10, 0.05),
      turnover: maybe(rand() * 5e9),
      avg_turnover: maybe(rand() * 5e8),
      market_cap: maybe(rand() * 3e11, 0.05),
      pe: loss ? undefined : maybe(rand() * 40),
      pb: maybe(rand() * 6 - 0.5),
      ev_ebitda: maybe(rand() * 20 - 2),
      dividend_yield: maybe(rand() * 9),
      roe: maybe(rand() * 60 - 10),
      net_margin: maybe(rand() * 40 - 10),
      rsi: maybe(rand() * 100),
      sma50_dist: maybe(rand() * 40 - 20),
      sma200_dist: maybe(rand() * 60 - 30),
      tech_rating: maybe(rand() * 2 - 1),
      rel_volume: maybe(rand() * 4),
      high_52w_dist: maybe(-rand() * 60),
      low_52w_dist: maybe(rand() * 80),
      perf_1w: maybe(rand() * 30 - 15),
      perf_1m: maybe(rand() * 50 - 25),
      perf_3m: maybe(rand() * 80 - 40),
      perf_ytd: maybe(rand() * 120 - 40),
      perf_1y: maybe(rand() * 200 - 60),
      upside: maybe(rand() * 80 - 20, 0.5),
      foreign_ratio: maybe(rand() * 70),
    };
    if (loss) row.loss = true;
    const r = rand();
    if (r < 0.1) row.cross = "golden";
    else if (r < 0.2) row.cross = "death";
    const rec = rand();
    if (rec < 0.3) row.recommendation = "AL";
    else if (rec < 0.4) row.recommendation = "TUT";
    else if (rec < 0.5) row.recommendation = "SAT";
    for (const key of Object.keys(row) as Array<keyof ScreenerStockRow>) {
      if (row[key] === undefined) delete row[key];
    }
    rows.push(row);
  }
  return rows;
}

const universe = makeUniverse();
const symbols = (rows: readonly ScreenerStockRow[]) => rows.map((row) => row.symbol);

describe("screener parity with the web model", () => {
  test("the phone offers every web quick screen", () => {
    assert.deepEqual(
      SCREENER_PRESETS.map((p) => p.id).sort(),
      web.PRESETS.map((p) => p.id).sort(),
    );
  });

  for (const preset of SCREENER_PRESETS) {
    test(`${preset.id}: same stocks, order, sort and view as /tarama`, () => {
      const webPreset = web.PRESETS.find((p) => p.id === preset.id);
      assert.ok(webPreset, "web preset exists");
      const webState = web.togglePreset(web.DEFAULT_STATE, webPreset);
      const mobileState = toggleScreenerPreset(DEFAULT_SCREENER_STATE, preset.id);

      assert.equal(mobileState.sort, webState.sort);
      assert.equal(mobileState.dir, webState.dir);
      assert.equal(mobileState.view, webState.view);
      assert.equal(PRESET_VIEWS[preset.id] ?? "overview", webState.view);

      const webRows = web.sortRows(web.filterRows(universe, webState), webState.sort, webState.dir);
      const mobileRows = sortScreenerRows(filterScreenerRows(universe, mobileState), mobileState.sort, mobileState.dir);
      assert.deepEqual(symbols(mobileRows), symbols(webRows));
    });
  }

  test("combined screens, typed ranges, index and search match too", () => {
    let mobileState = toggleScreenerPreset(DEFAULT_SCREENER_STATE, "high_dividend");
    mobileState = toggleScreenerPreset(mobileState, "uptrend");
    mobileState = { ...mobileState, index: "XU030", q: "şirket 1", ranges: { mcap: { min: 10 }, rsi: { max: 70 } } };
    const pick = (id: string) => web.PRESETS.find((p) => p.id === id)!;
    let webState = web.togglePreset(web.DEFAULT_STATE, pick("high_dividend"));
    webState = web.togglePreset(webState, pick("uptrend"));
    webState = { ...webState, index: "XU030", q: "şirket 1", ranges: { mcap: { min: 10 }, rsi: { max: 70 } } };
    assert.deepEqual(
      symbols(sortScreenerRows(filterScreenerRows(universe, mobileState), "pe", "asc")),
      symbols(web.sortRows(web.filterRows(universe, webState), "pe", "asc")),
    );
  });

  test("every numeric column sorts like the web table, missing values last", () => {
    for (const key of Object.keys(VIEW_METRICS).flatMap((v) => VIEW_METRICS[v as keyof typeof VIEW_METRICS])) {
      for (const dir of ["asc", "desc"] as const) {
        assert.deepEqual(
          symbols(sortScreenerRows(universe, key, dir)),
          symbols(web.sortRows(universe, key, dir)),
          `${key} ${dir}`,
        );
      }
    }
  });

  test("view column sets match the web table (badge columns aside)", () => {
    for (const [view, columns] of Object.entries(web.VIEW_COLUMNS)) {
      const numeric = columns.filter(
        (c) => !["sector", "recommendation", "signals", "close", "change_pct"].includes(c),
      );
      assert.deepEqual([...VIEW_METRICS[view as keyof typeof VIEW_METRICS]], numeric, view);
    }
  });

  test("signals and technical rating use the web thresholds", () => {
    for (const row of universe) {
      assert.deepEqual(rowSignals(row), web.rowSignals(row));
      assert.equal(techRating(row.tech_rating), web.techRating(row.tech_rating));
    }
  });
});

describe("sort menu", () => {
  test("every field a preset sorts on has a readable label", () => {
    for (const preset of SCREENER_PRESETS) {
      const key = preset.sort?.[0];
      if (key) assert.doesNotMatch(sortLabel(key), /_/);
    }
  });

  test("view fields come first and nothing is listed twice", () => {
    const { primary, other } = sortOptionsForView("technical");
    assert.deepEqual(primary.slice(0, 3), ["symbol", "close", "change_pct"]);
    assert.ok(primary.includes("rsi"));
    assert.equal(new Set([...primary, ...other]).size, primary.length + other.length);
  });
});
