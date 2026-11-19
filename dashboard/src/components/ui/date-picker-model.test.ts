import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, dayParts, periodAllowed, shiftDate, shiftMonth } from "./date-picker-model.ts";

test("date keys and parts preserve the calendar day", () => {
  assert.equal(dayKey(2026, 10, 19), "2026-11-19");
  assert.deepEqual(dayParts("2026-11-19"), [2026, 10, 19]);
});

test("day navigation crosses leap days and year boundaries", () => {
  assert.equal(shiftDate("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDate("2025-02-28", 1), "2025-03-01");
  assert.equal(shiftDate("2026-01-01", -1), "2025-12-31");
});

test("PageUp/PageDown clamp to the last real day of the target month", () => {
  assert.equal(shiftMonth("2024-01-31", 1), "2024-02-29");
  assert.equal(shiftMonth("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftMonth("2026-12-19", 1), "2027-01-19");
});

test("month/year availability includes periods partially inside the bounds", () => {
  const min = "2026-11-12", max = "2026-11-19";
  assert.equal(periodAllowed(2026, 10, min, max), true);
  assert.equal(periodAllowed(2026, 9, min, max), false);
  assert.equal(periodAllowed(2026, 11, min, max), false);
  assert.equal(periodAllowed(2026, undefined, min, max), true);
  assert.equal(periodAllowed(2025, undefined, min, max), false);
  assert.equal(periodAllowed(2027, undefined, min, max), false);
});
