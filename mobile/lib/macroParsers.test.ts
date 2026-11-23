import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MacroIndicator, MarketQuote } from "../../dashboard/src/components/makro/types.ts";
import {
  buildYieldCurve,
  formatIndicatorChange,
  formatIndicatorPeriod,
  formatIndicatorValue,
  istanbulDayKey,
  MACRO_INDICATOR_GROUPS,
  parseEconomicCalendar,
  parseMacroOverview,
  splitCalendarRows,
} from "./macroParsers.ts";

// Trimmed from the live `/api/macro/calendar` response (2026-11-23).
const CALENDAR = {
  calendar: [
    {
      Date: "2026-11-20", Time: "10:00", Country: "Türkiye", Importance: "high",
      Event: "Tüketici Güveni (Kas. 2026)", Actual: "85,0", Forecast: null, Previous: "83,6",
      id: "tv1", country_code: "TR", title_tr: "Tüketici Güveni", period_label: "Kas. 2026", key_event: false,
    },
    {
      Date: "2026-11-23", Time: "16:30", Country: "ABD", Importance: "mid",
      Event: "Chicago Fed", Actual: null, Forecast: "0,1", Previous: "-0,2",
      id: "tv2", country_code: "US", title_tr: "Chicago Fed Ulusal Aktivite Endeksi", key_event: false,
    },
    {
      Date: "2026-12-10", Time: "14:00", Country: "Türkiye", Importance: "high",
      Event: "TCMB Faiz Kararı", Actual: null, Forecast: "35%", Previous: "36%",
      id: "tv3", country_code: "TR", title_tr: "TCMB Faiz Kararı", key_event: true,
    },
    { Date: "bad", Event: "dropped" },
  ],
  source: "TradingView",
  available: true,
  window: { start: "2026-11-16", end: "2026-12-14" },
  as_of: "2026-11-23T13:50:06+03:00",
};

describe("economic calendar", () => {
  test("reads the live `calendar` array and drops malformed rows", () => {
    const parsed = parseEconomicCalendar(CALENDAR);
    assert.equal(parsed.available, true);
    assert.equal(parsed.rows.length, 3);
    assert.deepEqual(
      parsed.rows.map((r) => [r.id, r.countryCode, r.importance, r.keyEvent]),
      [
        ["tv1", "TR", "high", false],
        ["tv2", "US", "mid", false],
        ["tv3", "TR", "high", true],
      ],
    );
    assert.equal(parsed.rows[0].title, "Tüketici Güveni");
    assert.equal(parsed.rows[1].actual, null);
    assert.equal(parsed.asOf, "2026-11-23T13:50:06+03:00");
  });

  test("splits upcoming (soonest first) from released (newest first)", () => {
    const { rows } = parseEconomicCalendar(CALENDAR);
    const { upcoming, recent } = splitCalendarRows(rows, "2026-11-23");
    assert.deepEqual(upcoming.map((r) => r.id), ["tv2", "tv3"]);
    assert.deepEqual(recent.map((r) => r.id), ["tv1"]);
  });

  test("Istanbul day keys roll over at local midnight", () => {
    // 21:30 UTC on the 23rd is 00:30 on the 24th in Istanbul.
    assert.equal(istanbulDayKey(Date.parse("2026-11-23T21:30:00Z")), "2026-11-24");
    assert.equal(istanbulDayKey(Date.parse("2026-11-23T12:00:00Z"), -7), "2026-11-16");
  });
});

const bond = (key: string, years: number, last: number, change: number | null): MarketQuote => ({
  key, group: "bond", name: key, unit: "percent", symbol: null, tenor_years: years, derived: false,
  last, previous_close: null, change, change_percent: null, updated_at: "2026-11-23T16:38:35+03:00",
});

describe("yield curve", () => {
  test("orders tenors and computes the 2s10s and TR–US spreads", () => {
    const curve = buildYieldCurve(
      [
        bond("tr10y", 10, 33.59, -0.05),
        bond("tr02y", 2, 36.5, 0.13),
        bond("tr05y", 5, 36.25, null),
        { ...bond("us10y", 10, 4.972, 0.01), group: "global", tenor_years: null },
        { ...bond("usdtry", 0, 50.6, 0.1), group: "fx", unit: "TRY", tenor_years: null },
      ],
      36,
    );
    assert.deepEqual(curve.points.map((p) => p.label), ["2Y", "5Y", "10Y"]);
    assert.equal(curve.spread2s10s, -2.91);
    assert.equal(curve.spreadUs10y, 28.62);
    assert.equal(curve.policy, 36);
    assert.equal(curve.points[1].change, null);
  });

  test("no bonds means no curve, not a flat zero line", () => {
    const curve = buildYieldCurve([], null);
    assert.equal(curve.points.length, 0);
    assert.equal(curve.spread2s10s, null);
  });
});

const indicator = (patch: Partial<MacroIndicator>): MacroIndicator => ({
  key: "x", symbol: "X", group: "growth", name: "X", unit: "percent", frequency: "month",
  value: 1, previous: null, change: null, period: "2026-10-31", ...patch,
});

describe("indicator formatting", () => {
  test("money aggregates are compact and balances signed", () => {
    const ca = indicator({ key: "current_account", unit: "USD", value: 2_720_000_000, change: -1_333_000_000 });
    assert.equal(formatIndicatorValue(ca, ca.value), "+$2,7 Mr");
    assert.equal(formatIndicatorChange(ca), "−$1,3 Mr");
    const reserves = indicator({ key: "fx_reserves", unit: "USD", value: 59_250_000_000 });
    assert.equal(formatIndicatorValue(reserves, reserves.value), "$59,3 Mr");
    const budget = indicator({ key: "budget_balance", unit: "TRY", value: -481_100_000_000 });
    assert.equal(formatIndicatorValue(budget, budget.value), "−481,1 Mr ₺");
    const gold = indicator({ key: "gold_reserves", unit: "tonnes", value: 532.14 });
    assert.equal(formatIndicatorValue(gold, gold.value), "532,1 ton");
  });

  test("rates change in points; missing values stay a dash", () => {
    assert.equal(formatIndicatorChange(indicator({ change: -0.88 })), "−0,9 puan");
    assert.equal(formatIndicatorChange(indicator({ change: null })), "—");
    assert.equal(formatIndicatorValue(indicator({}), null), "—");
  });

  test("periods follow the release frequency", () => {
    assert.equal(formatIndicatorPeriod("2026-09-30", "quarter"), "3. çeyrek 2026");
    assert.equal(formatIndicatorPeriod("2025-12-31", "year"), "2025");
    assert.equal(formatIndicatorPeriod(null, "month"), "—");
  });

  test("every backend indicator group has a section", () => {
    const groups = new Set(MACRO_INDICATOR_GROUPS.map((g) => g.id));
    for (const group of ["growth", "labor", "prices", "external", "fiscal", "monetary", "global"]) {
      assert.ok(groups.has(group as MacroIndicator["group"]), group);
    }
  });
});

describe("macro overview", () => {
  test("corridor and real rate come from TCMB rows; missing inputs stay null", () => {
    const parsed = parseMacroOverview({
      tcmbRates: {
        data: [
          { type: "policy", borrowing: null, lending: 36 },
          { type: "overnight", borrowing: 34.5, lending: 39 },
          { type: "late_liquidity", borrowing: null, lending: 42 },
        ],
      } as never,
      inflation: {
        latest: { yearly_inflation: 29.77, monthly_inflation: 2.58, date: "2026-10-01" },
        tufe_history: [
          { Date: "2026-10-01", YearlyInflation: 29.77, MonthlyInflation: 2.58 },
          { Date: "2026-09-01", YearlyInflation: 29.73, MonthlyInflation: 1.84 },
        ],
      } as never,
      todayIso: "2026-11-23",
    });
    assert.equal(parsed.corridor.policy, 36);
    assert.equal(parsed.corridor.overnightBorrowing, 34.5);
    assert.equal(parsed.corridor.lateLiquidityLending, 42);
    assert.equal(parsed.latestRealRate, 6.23);
    assert.equal(parsed.inflation.cpiYearlyDelta, 0.04);
    assert.equal(parsed.inflation.ppiYearly, null);
    assert.deepEqual(parsed.markets, []);
  });
});
