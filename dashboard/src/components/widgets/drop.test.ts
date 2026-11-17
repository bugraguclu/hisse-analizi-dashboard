import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hitTest, type MeasuredBoard } from "./drop.ts";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

/**
 * Two rows on a 1000px board, gap 16:
 *   r0 (0–400):  c0 [0–600] chart (0–200), events (216–400) | c1 [616–1000] watch (0–400)
 *   r1 (416–616): c2 [0–400] note — free room right of it
 */
const board: MeasuredBoard = {
  box: box(0, 0, 1000, 616),
  rows: [
    {
      id: "r0",
      box: box(0, 0, 1000, 400),
      columns: [
        { id: "c0", box: box(0, 0, 600, 400), widgets: [{ id: "chart", box: box(0, 0, 600, 200) }, { id: "events", box: box(0, 216, 600, 400) }] },
        { id: "c1", box: box(616, 0, 1000, 400), widgets: [{ id: "watch", box: box(616, 0, 1000, 400) }] },
      ],
    },
    { id: "r1", box: box(0, 416, 1000, 616), columns: [{ id: "c2", box: box(0, 416, 400, 616), widgets: [{ id: "note", box: box(0, 416, 400, 616) }] }] },
  ],
};

describe("hitTest", () => {
  test("stack positions follow the cards' middles", () => {
    assert.deepEqual(hitTest(board, 300, 90, 16)?.target, { kind: "stack", columnId: "c0", beforeWidgetId: "chart" });
    assert.deepEqual(hitTest(board, 300, 150, 16)?.target, { kind: "stack", columnId: "c0", beforeWidgetId: "events" });
    assert.deepEqual(hitTest(board, 300, 350, 16)?.target, { kind: "stack", columnId: "c0", beforeWidgetId: null });
    const line = hitTest(board, 300, 150, 16)?.line;
    assert.deepEqual(line, { orientation: "horizontal", x: 0, y: 208, length: 600 });
  });

  test("column edges and gaps open a new column", () => {
    assert.deepEqual(hitTest(board, 580, 200, 16)?.target, { kind: "column", rowId: "r0", beforeColumnId: "c1" });
    assert.deepEqual(hitTest(board, 608, 200, 16)?.target, { kind: "column", rowId: "r0", beforeColumnId: "c1" });
    assert.deepEqual(hitTest(board, 990, 200, 16)?.target, { kind: "column", rowId: "r0", beforeColumnId: null });
    assert.deepEqual(hitTest(board, 10, 200, 16)?.target, { kind: "column", rowId: "r0", beforeColumnId: "c0" });
    assert.deepEqual(hitTest(board, 608, 200, 16)?.line, { orientation: "vertical", x: 608, y: 0, length: 400 });
  });

  test("a row's free room is a new column at its end", () => {
    assert.deepEqual(hitTest(board, 700, 500, 16)?.target, { kind: "column", rowId: "r1", beforeColumnId: null });
  });

  test("row edges and gaps open a new row", () => {
    assert.deepEqual(hitTest(board, 300, 408, 16)?.target, { kind: "row", beforeRowId: "r1" });
    assert.deepEqual(hitTest(board, 300, 5, 16)?.target, { kind: "row", beforeRowId: "r0" });
    assert.deepEqual(hitTest(board, 300, 395, 16)?.target, { kind: "row", beforeRowId: "r1" });
    assert.deepEqual(hitTest(board, 300, 700, 16)?.target, { kind: "row", beforeRowId: null });
    assert.deepEqual(hitTest(board, 300, -20, 16)?.target, { kind: "row", beforeRowId: "r0" });
    assert.deepEqual(hitTest(board, 300, 408, 16)?.line, { orientation: "horizontal", x: 0, y: 408, length: 1000 });
  });

  test("an empty board offers its first row", () => {
    assert.deepEqual(hitTest({ box: box(0, 0, 1000, 0), rows: [] }, 10, 10, 16)?.target, { kind: "row", beforeRowId: null });
  });
});
