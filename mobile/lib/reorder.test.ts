import assert from "node:assert/strict";
import { test } from "node:test";
import { dropIndex, HOME_SECTION_IDS, moveItem, sanitizeHomeSections } from "./reorder.ts";

test("moveItem moves forward and backward and clamps the target", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 99), ["a", "c", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
});

test("dropIndex passes a row only once the dragged centre crosses its centre", () => {
  const rows = [0, 1, 2, 3].map((i) => ({ y: i * 60, height: 60 }));
  assert.equal(dropIndex(rows, 0, 0), 0);
  assert.equal(dropIndex(rows, 0, 59), 0);
  assert.equal(dropIndex(rows, 0, 60), 1);
  // Clamped to the top edge: the row still reaches the first slot.
  assert.equal(dropIndex(rows, 3, -180), 0);
  assert.equal(dropIndex(rows, 0, 500), 3);
  assert.equal(dropIndex(rows, 3, -61), 2);
  assert.equal(dropIndex(rows, 3, -500), 0);
});

test("sanitizeHomeSections keeps order, drops junk and appends missing sections", () => {
  const result = sanitizeHomeSections([
    { id: "movers", visible: false },
    { id: "bogus", visible: true },
    { id: "movers", visible: true },
    "x",
    { id: "summary" },
  ]);
  assert.deepEqual(result.slice(0, 2), [
    { id: "movers", visible: false },
    { id: "summary", visible: true },
  ]);
  assert.deepEqual(
    result.map((s) => s.id).sort(),
    [...HOME_SECTION_IDS].sort(),
  );
  assert.equal(sanitizeHomeSections(null).length, HOME_SECTION_IDS.length);
});
