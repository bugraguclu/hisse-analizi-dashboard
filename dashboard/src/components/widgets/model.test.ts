import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addWidget,
  buildLayout,
  findWidget,
  insertWidget,
  isNoopMove,
  type Layout,
  moveWidget,
  moveWidgetStep,
  removeWidget,
  resizeColumn,
  row,
  sanitizeLayout,
  setWidgetHeight,
  setWidgetWidth,
  updateWidget,
  widgetsInOrder,
} from "./model.ts";

/** Compact picture of a layout: one string per row, "width:type+type" per column. */
function shape(layout: Layout): string[] {
  return layout.rows.map((r) => r.columns.map((c) => `${c.width}:${c.widgets.map((w) => w.type).join("+")}`).join(" "));
}

function idOf(layout: Layout, type: string): string {
  const widget = widgetsInOrder(layout).find((w) => w.type === type);
  assert.ok(widget, `no ${type}`);
  return widget.id;
}

const home = () => buildLayout("home", [row([8, "chart", "events"], [4, "watch", "breadth"]), row([6, "a"], [6, "b"]), row([12, "wide"])]);

describe("buildLayout", () => {
  test("gives deterministic ids", () => {
    const layout = home();
    assert.deepEqual(shape(layout), ["8:chart+events 4:watch+breadth", "6:a 6:b", "12:wide"]);
    assert.equal(layout.rows[0].id, "home-r0");
    assert.equal(layout.rows[0].columns[1].id, "home-r0c1");
    assert.equal(idOf(layout, "watch"), "home-w2");
  });
});

describe("moveWidget", () => {
  test("into another stack", () => {
    const layout = home();
    const next = moveWidget(layout, idOf(layout, "a"), { kind: "stack", columnId: "home-r0c1", beforeWidgetId: idOf(layout, "breadth") });
    // "b" inherits the freed half of its row.
    assert.deepEqual(shape(next), ["8:chart+events 4:watch+a+breadth", "12:b", "12:wide"]);
    assert.deepEqual(shape(layout), ["8:chart+events 4:watch+breadth", "6:a 6:b", "12:wide"], "input untouched");
  });

  test("beside a column shrinks the widest", () => {
    const layout = home();
    const next = moveWidget(layout, idOf(layout, "wide"), { kind: "column", rowId: "home-r1", beforeColumnId: null });
    assert.deepEqual(shape(next), ["8:chart+events 4:watch+breadth", "4:a 4:b 4:wide"]);
  });

  test("a 12-wide newcomer beside a narrow card takes the free room", () => {
    const layout = buildLayout("t", [row([4, "small"]), row([12, "big"])]);
    const next = moveWidget(layout, idOf(layout, "big"), { kind: "column", rowId: "t-r0", beforeColumnId: null });
    assert.deepEqual(shape(next), ["4:small 8:big"]);
  });

  test("reorders columns within a row and keeps their widths", () => {
    const layout = buildLayout("t", [row([8, "chart"], [4, "watch"])]);
    const next = moveWidget(layout, idOf(layout, "watch"), { kind: "column", rowId: "t-r0", beforeColumnId: "t-r0c0" });
    assert.deepEqual(shape(next), ["4:watch 8:chart"]);
  });

  test("to the end of the same row", () => {
    const layout = buildLayout("t", [row([4, "a"], [4, "b"], [4, "c"])]);
    const next = moveWidget(layout, idOf(layout, "a"), { kind: "column", rowId: "t-r0", beforeColumnId: null });
    assert.deepEqual(shape(next), ["4:b 4:c 4:a"]);
  });

  test("into a new row keeps the width", () => {
    const layout = home();
    const next = moveWidget(layout, idOf(layout, "watch"), { kind: "row", beforeRowId: null });
    assert.deepEqual(shape(next), ["8:chart+events 4:breadth", "6:a 6:b", "12:wide", "4:watch"]);
  });

  test("above its own (removed) row re-anchors on the next row", () => {
    const layout = buildLayout("t", [row([12, "x"]), row([6, "y"]), row([12, "z"])]);
    const next = moveWidget(layout, idOf(layout, "x"), { kind: "row", beforeRowId: "t-r2" });
    assert.deepEqual(shape(next), ["6:y", "12:x", "12:z"]);
  });

  test("falls back to a new row when the target row is full of narrow columns", () => {
    const layout = buildLayout("t", [row([2, "a"], [2, "b"], [2, "c"], [2, "d"], [2, "e"], [2, "f"]), row([6, "g"])]);
    const next = moveWidget(layout, idOf(layout, "g"), { kind: "column", rowId: "t-r0", beforeColumnId: null });
    assert.deepEqual(shape(next), ["2:a 2:b 2:c 2:d 2:e 2:f", "6:g"]);
  });

  test("unknown widget leaves the layout as is", () => {
    const layout = home();
    assert.equal(moveWidget(layout, "nope", { kind: "row", beforeRowId: null }), layout);
  });
});

describe("isNoopMove", () => {
  test("recognises the widget's own place", () => {
    const layout = home();
    const events = idOf(layout, "events");
    assert.ok(isNoopMove(layout, events, { kind: "stack", columnId: "home-r0c0", beforeWidgetId: null }));
    assert.ok(isNoopMove(layout, events, { kind: "stack", columnId: "home-r0c0", beforeWidgetId: events }));
    assert.ok(!isNoopMove(layout, events, { kind: "stack", columnId: "home-r0c0", beforeWidgetId: idOf(layout, "chart") }));
    const wide = idOf(layout, "wide");
    assert.ok(isNoopMove(layout, wide, { kind: "row", beforeRowId: "home-r2" }));
    assert.ok(isNoopMove(layout, wide, { kind: "row", beforeRowId: null }));
    assert.ok(!isNoopMove(layout, wide, { kind: "row", beforeRowId: "home-r1" }));
    const b = idOf(layout, "b");
    assert.ok(isNoopMove(layout, b, { kind: "column", rowId: "home-r1", beforeColumnId: null }));
    assert.ok(!isNoopMove(layout, b, { kind: "column", rowId: "home-r1", beforeColumnId: "home-r1c0" }));
  });
});

describe("moveWidgetStep", () => {
  test("up/down reorder a stack, then leave it", () => {
    const layout = home();
    const breadth = idOf(layout, "breadth");
    const up = moveWidgetStep(layout, breadth, "up");
    assert.deepEqual(shape(up), ["8:chart+events 4:breadth+watch", "6:a 6:b", "12:wide"]);
    const out = moveWidgetStep(layout, breadth, "down");
    assert.deepEqual(shape(out), ["8:chart+events 4:watch", "4:breadth", "6:a 6:b", "12:wide"]);
  });

  test("a widget alone in its row swaps rows", () => {
    const layout = home();
    assert.deepEqual(shape(moveWidgetStep(layout, idOf(layout, "wide"), "up")), ["8:chart+events 4:watch+breadth", "12:wide", "6:a 6:b"]);
    assert.equal(moveWidgetStep(layout, idOf(layout, "wide"), "down"), layout);
  });

  test("left/right swap columns or split a stack", () => {
    const layout = home();
    assert.deepEqual(shape(moveWidgetStep(layout, idOf(layout, "b"), "left")), ["8:chart+events 4:watch+breadth", "6:b 6:a", "12:wide"]);
    assert.equal(moveWidgetStep(layout, idOf(layout, "b"), "right"), layout);
    const split = moveWidgetStep(layout, idOf(layout, "watch"), "left");
    assert.deepEqual(shape(split), ["4:chart+events 4:watch 4:breadth", "6:a 6:b", "12:wide"]);
  });
});

describe("removeWidget", () => {
  test("the partner of a removed card fills the row", () => {
    const layout = home();
    assert.deepEqual(shape(removeWidget(layout, idOf(layout, "a"))), ["8:chart+events 4:watch+breadth", "12:b", "12:wide"]);
    assert.deepEqual(shape(removeWidget(layout, idOf(layout, "b"))), ["8:chart+events 4:watch+breadth", "12:a", "12:wide"]);
  });

  test("a row with free room keeps it", () => {
    const layout = buildLayout("t", [row([4, "a"], [4, "b"])]);
    assert.deepEqual(shape(removeWidget(layout, idOf(layout, "a"))), ["4:b"]);
  });

  test("a stacked card leaves its column", () => {
    const layout = home();
    assert.deepEqual(shape(removeWidget(layout, idOf(layout, "watch"))), ["8:chart+events 4:breadth", "6:a 6:b", "12:wide"]);
  });
});

describe("resizeColumn", () => {
  test("in a full row the edge is a divider", () => {
    const layout = home();
    assert.deepEqual(shape(resizeColumn(layout, "home-r1c0", 8)).slice(1, 2), ["8:a 4:b"]);
    assert.deepEqual(shape(resizeColumn(layout, "home-r1c0", 3)).slice(1, 2), ["3:a 9:b"]);
    assert.deepEqual(shape(resizeColumn(layout, "home-r1c0", 12)).slice(1, 2), ["10:a 2:b"], "neighbour stops at the minimum");
  });

  test("the last column of a full row can't grow", () => {
    const layout = home();
    assert.equal(resizeColumn(layout, "home-r1c1", 9), layout);
  });

  test("grows into free room first, then narrows the next column", () => {
    const layout = buildLayout("t", [row([4, "a"], [4, "b"])]);
    assert.deepEqual(shape(resizeColumn(layout, "t-r0c0", 7)), ["7:a 4:b"]);
    assert.deepEqual(shape(resizeColumn(layout, "t-r0c0", 10)), ["10:a 2:b"]);
    assert.deepEqual(shape(resizeColumn(layout, "t-r0c0", 2)), ["2:a 4:b"], "shrinking frees room");
    assert.deepEqual(shape(resizeColumn(layout, "t-r0c1", 12)), ["4:a 8:b"]);
  });
});

describe("setWidgetWidth", () => {
  test("takes room from the others, widest first", () => {
    const layout = buildLayout("t", [row([6, "a"], [6, "b"])]);
    assert.deepEqual(shape(setWidgetWidth(layout, idOf(layout, "a"), 8)), ["8:a 4:b"]);
    assert.deepEqual(shape(setWidgetWidth(layout, idOf(layout, "a"), 3)), ["3:a 6:b"]);
  });

  test("full width moves the widget to its own row below", () => {
    const layout = home();
    const next = setWidgetWidth(layout, idOf(layout, "watch"), 12);
    assert.deepEqual(shape(next), ["8:chart+events 4:breadth", "12:watch", "6:a 6:b", "12:wide"]);
    const alone = setWidgetWidth(layout, idOf(layout, "b"), 12);
    assert.deepEqual(shape(alone), ["8:chart+events 4:watch+breadth", "12:a", "12:b", "12:wide"]);
  });

  test("a lone widget simply widens", () => {
    const layout = buildLayout("t", [row([4, "a"])]);
    assert.deepEqual(shape(setWidgetWidth(layout, idOf(layout, "a"), 12)), ["12:a"]);
  });
});

describe("heights and settings", () => {
  test("setWidgetHeight snaps, clamps and resets", () => {
    const layout = home();
    const id = idOf(layout, "chart");
    const fixed = setWidgetHeight(layout, id, 403);
    assert.equal(findWidget(fixed, id)?.widget.height, 400);
    assert.equal(findWidget(setWidgetHeight(layout, id, 10), id)?.widget.height, 120);
    const auto = setWidgetHeight(fixed, id, null);
    assert.equal("height" in (findWidget(auto, id)?.widget ?? {}), false);
  });

  test("updateWidget validates tickers and drops cleared options", () => {
    const layout = home();
    const id = idOf(layout, "chart");
    const next = updateWidget(layout, id, { ticker: " garan ", options: { view: "technical", compact: true } });
    assert.deepEqual(findWidget(next, id)?.widget, { id, type: "chart", ticker: "GARAN", options: { view: "technical", compact: true } });
    const cleared = updateWidget(next, id, { ticker: "not a ticker!", options: { view: null, compact: null } });
    assert.deepEqual(findWidget(cleared, id)?.widget, { id, type: "chart" });
  });
});

describe("adding", () => {
  test("addWidget fills the last row's free room, else opens a row", () => {
    const layout = buildLayout("t", [row([6, "a"])]);
    const first = addWidget(layout, { type: "b" }, 6);
    assert.deepEqual(shape(first.layout), ["6:a 6:b"]);
    assert.equal(findWidget(first.layout, first.id)?.widget.type, "b");
    assert.deepEqual(shape(addWidget(first.layout, { type: "c" }, 4).layout), ["6:a 6:b", "4:c"]);
    assert.deepEqual(shape(addWidget({ rows: [] }, { type: "x" }, 12).layout), ["12:x"]);
  });

  test("insertWidget places at a target", () => {
    const layout = home();
    const next = insertWidget(layout, { type: "new" }, 6, { kind: "row", beforeRowId: "home-r1" });
    assert.deepEqual(shape(next.layout), ["8:chart+events 4:watch+breadth", "6:new", "6:a 6:b", "12:wide"]);
  });
});

describe("sanitizeLayout", () => {
  const known = (type: string) => type !== "gone";

  test("keeps a valid layout as it is", () => {
    const layout = home();
    assert.deepEqual(sanitizeLayout(JSON.parse(JSON.stringify(layout)), known), layout);
  });

  test("drops junk, unknown types and empty containers", () => {
    const raw = {
      rows: [
        { id: "r1", columns: [{ id: "c1", width: 6, widgets: [{ id: "w1", type: "gone" }] }] },
        "junk",
        { id: "r2", columns: [{ id: "c2", width: 40, widgets: [{ id: "w2", type: "ok", height: 9999, ticker: "thyao", options: { view: "x", bad: {}, "no key": 1 } }] }] },
      ],
    };
    const clean = sanitizeLayout(raw, known);
    assert.deepEqual(clean, { rows: [{ id: "r2", columns: [{ id: "c2", width: 12, widgets: [{ id: "w2", type: "ok", height: 2400, ticker: "THYAO", options: { view: "x" } }] }] }] });
  });

  test("makes ids unique and splits over-full rows", () => {
    const columns = Array.from({ length: 8 }, () => ({ id: "same", width: 2, widgets: [{ id: "same", type: "ok" }] }));
    const clean = sanitizeLayout({ rows: [{ id: "r", columns }] }, known);
    assert.ok(clean);
    assert.deepEqual(clean.rows.map((r) => r.columns.length), [6, 2]);
    const ids = clean.rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.widgets.map((w) => w.id)])]);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("returns null when nothing is usable", () => {
    assert.equal(sanitizeLayout(null, known), null);
    assert.equal(sanitizeLayout({ rows: "x" }, known), null);
    assert.equal(sanitizeLayout({ rows: [{ columns: [{ widgets: [{ type: "gone" }] }] }] }, known), null);
  });
});
