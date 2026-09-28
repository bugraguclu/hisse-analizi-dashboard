import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sectorHref } from "../../lib/sectors.ts";
import {
  DEFAULT_STATE,
  PRESETS,
  filterRows,
  hasSectorMedian,
  median,
  parseState,
  sectorStats,
  serializeState,
  sortRows,
  togglePreset,
  type PresetId,
  type Row,
  type ScreenerState,
} from "./model.ts";

const BANKS = "bankalar";
const REITS = "gayrimenkul-yatirim-ortakliklari";
const TELECOM = "telekomunikasyon";

/**
 * Four banks, three REITs, two telecoms (too few for a median) and one stock
 * KAP lists without a sector. TradingView's sector key is "Finance" for most.
 */
function universe(): Row[] {
  return [
    { symbol: "AAA", kap_sector: BANKS, sector: "Finance", pe: 4, pb: 0.8, roe: 30, dividend_yield: 5, foreign_ratio: 40, market_cap: 400e9 },
    { symbol: "BBB", kap_sector: BANKS, sector: "Finance", pe: 6, pb: 1.2, roe: 20, dividend_yield: 0, foreign_ratio: 10, market_cap: 300e9 },
    { symbol: "CCC", kap_sector: BANKS, sector: "Finance", pe: 8, pb: 1.5, roe: 10, dividend_yield: 3, foreign_ratio: 0, market_cap: 200e9 },
    // Loss maker with negative equity: no P/E, and its P/B must not count.
    { symbol: "DDD", kap_sector: BANKS, sector: "Finance", loss: true, pb: -0.5, roe: -5, dividend_yield: 4, market_cap: 100e9 },
    { symbol: "GY1", kap_sector: REITS, sector: "Finance", pe: 10, pb: 0.4, roe: 5, close: 12 },
    { symbol: "GY2", kap_sector: REITS, sector: "Finance", pe: 20, pb: 0.6, roe: 8, close: 30 },
    { symbol: "GY3", kap_sector: REITS, sector: "Finance", loss: true, pb: 0.5, roe: 2, close: 9 },
    { symbol: "TL1", kap_sector: TELECOM, sector: "Communications", pe: 5, pb: 1, roe: 12 },
    { symbol: "TL2", kap_sector: TELECOM, sector: "Communications", pe: 15, pb: 3, roe: 18 },
    { symbol: "NOK", sector: "Finance", pe: 1, pb: 0.1, roe: 50 },
  ];
}

const symbols = (rows: readonly Row[]) => rows.map((row) => row.symbol);

function withPresets(...ids: PresetId[]): ScreenerState {
  let state: ScreenerState = { ...DEFAULT_STATE };
  for (const id of ids) {
    const preset = PRESETS.find((candidate) => candidate.id === id);
    assert.ok(preset, id);
    state = togglePreset(state, preset);
  }
  return state;
}

describe("median", () => {
  test("middle value, or the mean of the two middle ones", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([7]), 7);
    assert.equal(median([]), null);
  });

  test("leaves its input alone", () => {
    const values = [3, 1, 2];
    median(values);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe("sectorStats", () => {
  test("applies the backend's counting rules", () => {
    const banks = sectorStats(universe()).get(BANKS);
    assert.ok(banks);
    assert.equal(banks.size, 4);
    // P/E and P/B: positive only (the loss maker has none, its negative P/B is left out).
    assert.equal(banks.medians.pe, 6);
    assert.equal(banks.counts.pe, 3);
    assert.equal(banks.medians.pb, 1.2);
    // ROE: every value, the negative one too → (10 + 20) / 2.
    assert.equal(banks.medians.roe, 15);
    // Dividend yield: payers only (BBB's 0 does not count).
    assert.equal(banks.medians.dividend_yield, 4);
    assert.equal(banks.counts.dividend_yield, 3);
    // Foreign ownership: zero counts.
    assert.equal(banks.medians.foreign_ratio, 10);
    assert.equal(banks.medians.market_cap, 250e9);
  });

  test("needs three values for a median and never averages prices", () => {
    const stats = sectorStats(universe());
    const reits = stats.get(REITS);
    assert.ok(reits);
    assert.equal(reits.medians.pe, undefined);
    assert.equal(reits.counts.pe, 2);
    assert.equal(reits.medians.pb, 0.5);
    assert.equal(reits.medians.close, undefined);
    assert.deepEqual(stats.get(TELECOM)?.medians, {});
    assert.equal(stats.has("Finance"), false);
  });

  test("is computed once per rows array", () => {
    const rows = universe();
    assert.equal(sectorStats(rows), sectorStats(rows));
    assert.notEqual(sectorStats(rows), sectorStats(universe()));
  });
});

describe("SEKTÖR filter", () => {
  test("matches the KAP sector", () => {
    const state = { ...DEFAULT_STATE, sector: BANKS };
    assert.deepEqual(symbols(filterRows(universe(), state)), ["AAA", "BBB", "CCC", "DDD"]);
  });

  test("an old link's TradingView sector still matches", () => {
    const state = { ...DEFAULT_STATE, sector: "Communications" };
    assert.deepEqual(symbols(filterRows(universe(), state)), ["TL1", "TL2"]);
  });

  test("keeps KAP's longest key from a URL", () => {
    const key = "seyahat-acentesi-tur-operatoru-ve-diger-rezervasyon-hizmetleri-ile-ilgili-faaliyetler";
    assert.equal(parseState(new URLSearchParams({ sector: key })).sector, key);
  });

  test("a stock page's sector link opens the sector in the fundamentals view", () => {
    const state = parseState(new URLSearchParams(sectorHref(BANKS, "fundamentals").split("?")[1]));
    assert.equal(state.sector, BANKS);
    assert.equal(state.view, "fundamentals");
    assert.equal(serializeState(state), `sector=${BANKS}&view=fundamentals`);
  });
});

describe("relative screens", () => {
  test("F/K below the sector average", () => {
    // Banks' median P/E is 6 (AAA only); REITs and telecoms have no P/E median; NOK has no sector.
    assert.deepEqual(symbols(filterRows(universe(), withPresets("pe_below_sector"))), ["AAA"]);
  });

  test("PD/DD below the sector average, a value that does not count never passes", () => {
    // DDD's negative P/B is below 1.2 but means negative equity; GY3 sits on the median (not below).
    assert.deepEqual(symbols(filterRows(universe(), withPresets("pb_below_sector"))), ["AAA", "GY1"]);
  });

  test("ROE above the sector average", () => {
    assert.deepEqual(symbols(filterRows(universe(), withPresets("roe_above_sector"))), ["AAA", "BBB", "GY2"]);
  });

  test("combine with the fixed screens on the same field", () => {
    const state = withPresets("low_pe", "pe_below_sector");
    assert.deepEqual(state.presets, ["low_pe", "pe_below_sector"]);
    assert.deepEqual(symbols(filterRows(universe(), state)), ["AAA"]);
  });

  test("compare with the whole sector, not with what other filters leave", () => {
    // Narrowed to BBB by the search, BBB's ROE (20) is still judged against all banks (15).
    const state = { ...withPresets("roe_above_sector"), q: "BBB" };
    assert.deepEqual(symbols(filterRows(universe(), state)), ["BBB"]);
  });

  test("open in the fundamentals view with their own order and survive the URL", () => {
    const state = withPresets("roe_above_sector", "pe_below_sector");
    assert.equal(state.view, "fundamentals");
    const query = serializeState(state);
    assert.match(query, /screen=pe_below_sector%2Croe_above_sector/);
    assert.deepEqual(parseState(new URLSearchParams(query)).presets, ["pe_below_sector", "roe_above_sector"]);
  });
});

describe("table helpers", () => {
  test("only compared columns carry a sector median", () => {
    assert.equal(hasSectorMedian("pe"), true);
    assert.equal(hasSectorMedian("dividend_yield"), true);
    assert.equal(hasSectorMedian("close"), false);
    assert.equal(hasSectorMedian("target_price"), false);
    assert.equal(hasSectorMedian("sector"), false);
    assert.equal(hasSectorMedian("constructor"), false);
  });

  test("the sector column sorts by the KAP sector's name", () => {
    const names: Record<string, string> = { [BANKS]: "Bankalar", [REITS]: "Gayrimenkul Yatırım Ortaklıkları", [TELECOM]: "Telekomünikasyon", Finance: "Finans" };
    const rows = universe().filter((row) => ["AAA", "GY1", "TL1", "NOK"].includes(row.symbol));
    const sorted = sortRows(rows, "sector", "asc", (key) => names[key] ?? key);
    assert.deepEqual(symbols(sorted), ["AAA", "NOK", "GY1", "TL1"]);
  });
});
