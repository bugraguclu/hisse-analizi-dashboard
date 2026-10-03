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
  railRow,
  row,
  sanitizeLayout,
  setWidgetHeight,
  setWidgetWidth,
  updateWidget,
  widgetsInOrder,
  withFreshIds,
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

  test("A2: moving a single-card column inside its own row keeps widths", () => {
    const l1 = buildLayout("t", [row([8, "A"], [4, "B"])]);
    const n1 = moveWidget(l1, idOf(l1, "A"), { kind: "column", rowId: "t-r0", beforeColumnId: null });
    assert.deepEqual(shape(n1), ["4:B 8:A"]);

    const l2 = buildLayout("m", [row([4, "corridor"], [8, "policy"])]);
    const n2 = moveWidget(l2, idOf(l2, "policy"), { kind: "column", rowId: "m-r0", beforeColumnId: "m-r0c0" });
    assert.deepEqual(shape(n2), ["8:policy 4:corridor"]);

    const l3 = buildLayout("t", [row([6, "A"], [3, "B"], [3, "C"])]);
    const n3 = moveWidget(l3, idOf(l3, "A"), { kind: "column", rowId: "t-r0", beforeColumnId: null });
    assert.deepEqual(shape(n3), ["3:B 3:C 6:A"]);
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
  test("up/down reorder a stack, then merge into neighbouring stack", () => {
    const layout = home();
    const breadth = idOf(layout, "breadth");
    const up = moveWidgetStep(layout, breadth, "up");
    assert.deepEqual(shape(up), ["8:chart+events 4:breadth+watch", "6:a 6:b", "12:wide"]);
    const down = moveWidgetStep(layout, breadth, "down");
    assert.deepEqual(shape(down), ["8:chart+events 4:watch", "6:a 6:breadth+b", "12:wide"]);
  });

  test("a widget alone in its row swaps rows", () => {
    const layout = home();
    assert.deepEqual(shape(moveWidgetStep(layout, idOf(layout, "wide"), "up")), ["8:chart+events 4:watch+breadth", "12:wide", "6:a 6:b"]);
    assert.equal(moveWidgetStep(layout, idOf(layout, "wide"), "down"), layout);
  });

  test("left/right swap columns or merge into neighbour stack", () => {
    const layout = home();
    assert.deepEqual(shape(moveWidgetStep(layout, idOf(layout, "b"), "left")), ["8:chart+events 4:watch+breadth", "6:b 6:a", "12:wide"]);
    assert.equal(moveWidgetStep(layout, idOf(layout, "b"), "right"), layout);
    const intoNeighbour = moveWidgetStep(layout, idOf(layout, "watch"), "left");
    assert.deepEqual(shape(intoNeighbour), ["8:watch+chart+events 4:breadth", "6:a 6:b", "12:wide"]);
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

  test("A1: an empty layout is a valid saved layout", () => {
    assert.deepEqual(sanitizeLayout({ rows: [] }, known), { rows: [] });
    // all-unknown types still falls back to null
    assert.equal(sanitizeLayout({ rows: [{ columns: [{ widgets: [{ type: "gone" }] }] }] }, known), null);
    // remove every widget of home layout, round-trip and sanitize
    const homeLayout = buildLayout("home", [row([8, "market.index", "market.events"], [4, "market.watchlist", "market.breadth"])]);
    let empty = homeLayout;
    for (const w of widgetsInOrder(homeLayout)) empty = removeWidget(empty, w.id);
    assert.deepEqual(empty, { rows: [] });
    const stored = JSON.parse(JSON.stringify(empty));
    assert.deepEqual(sanitizeLayout(stored, () => true), { rows: [] });
  });
});

describe("A3: no-op edits create no history and no override", () => {
  test("identical patch returns same reference", () => {
    const layout = buildLayout("technical", [row([12, "stock.technicalSummary"]), row([12, { type: "stock.chart", options: { view: "technical" } }])]);
    const chart = layout.rows[1].columns[0].widgets[0];
    const patch = { ticker: null, options: { view: "technical" } };
    const next = updateWidget(layout, chart.id, patch);
    assert.equal(next, layout);
  });

  test("{ticker: null} on widget with no ticker returns same reference", () => {
    const layout = home();
    const chart = idOf(layout, "chart");
    const next = updateWidget(layout, chart, { ticker: null });
    assert.equal(next, layout);
  });

  test("null for an absent option key returns same reference", () => {
    const layout = home();
    const chart = idOf(layout, "chart");
    const next = updateWidget(layout, chart, { options: { absent: null } });
    assert.equal(next, layout);
  });

  test("a real change returns a new object", () => {
    const layout = home();
    const chart = idOf(layout, "chart");
    const next = updateWidget(layout, chart, { ticker: "THYAO" });
    assert.notEqual(next, layout);
    assert.equal(findWidget(next, chart)?.widget.ticker, "THYAO");
  });
});

describe("A4: keyboard moves (a)-(f)", () => {
  test("(a) stock.overview: news down, up, right restores rows 3-4", () => {
    const ov = buildLayout("overview", [
      row([12, "stock.quote"]),
      row([12, "stock.chart"]),
      row([6, "stock.scorecard"], [6, "stock.analysts"]),
      row([6, "stock.kap"], [6, "stock.news"]),
      row([6, "stock.ratios"], [6, "stock.signals"]),
      row([12, "stock.sector"]),
      row([6, "stock.dividends"], [6, "stock.earnings"]),
      row([12, "stock.statements"]),
    ]);
    const newsId = idOf(ov, "stock.news");
    let l = ov;
    l = moveWidgetStep(l, newsId, "down");
    l = moveWidgetStep(l, newsId, "up");
    l = moveWidgetStep(l, newsId, "right");
    assert.equal(shape(l)[3], "6:stock.kap 6:stock.news");
    assert.equal(shape(l)[4], "6:stock.ratios 6:stock.signals");
  });

  test("(b) overview: statements (lone, 12 wide) up swaps with dividends|earnings row", () => {
    const ov = buildLayout("overview", [
      row([6, "stock.dividends"], [6, "stock.earnings"]),
      row([12, "stock.statements"]),
    ]);
    const next = moveWidgetStep(ov, idOf(ov, "stock.statements"), "up");
    assert.deepEqual(shape(next), ["12:stock.statements", "6:stock.dividends 6:stock.earnings"]);
  });

  test("(c) a lone 6-wide card under a row with 6 free joins as new last column", () => {
    const l = buildLayout("t", [row([6, "x"]), row([6, "card"])]);
    const next = moveWidgetStep(l, idOf(l, "card"), "up");
    assert.deepEqual(shape(next), ["6:x 6:card"]);
  });

  test("(d) home: watchlist sequence", () => {
    const homeL = buildLayout("home", [row([8, "market.index", "market.events"], [4, "market.watchlist", "market.breadth"])]);
    const wId = idOf(homeL, "market.watchlist");
    let l = homeL;
    l = moveWidgetStep(l, wId, "down");
    assert.deepEqual(shape(l), ["8:market.index+market.events 4:market.breadth+market.watchlist"]);
    l = moveWidgetStep(l, wId, "down");
    assert.deepEqual(shape(l), ["8:market.index+market.events 4:market.breadth", "4:market.watchlist"]);
    l = moveWidgetStep(l, wId, "up");
    assert.deepEqual(shape(l), ["8:market.index+market.events+market.watchlist 4:market.breadth"]);
    l = moveWidgetStep(l, wId, "right");
    assert.deepEqual(shape(l), ["8:market.index+market.events 4:market.breadth+market.watchlist"]);
    l = moveWidgetStep(l, wId, "up");
    assert.deepEqual(shape(l), ["8:market.index+market.events 4:market.watchlist+market.breadth"]);
  });

  test("(e) reachability: BFS over W moves (depth <= 6) puts W in Y stack in < 2 s", () => {
    const t0 = performance.now();
    const homeL = buildLayout("home", [row([8, "market.index", "market.events"], [4, "market.watchlist", "market.breadth"])]);
    const overviewL = buildLayout("ov", [
      row([6, "stock.scorecard"], [6, "stock.analysts"]),
      row([6, "stock.kap"], [6, "stock.news"]),
      row([6, "stock.ratios"], [6, "stock.signals"]),
    ]);

    for (const layout of [homeL, overviewL]) {
      const all = widgetsInOrder(layout);
      for (const w of all) {
        for (const y of all) {
          if (w.id === y.id) continue;
          const queue = [{ l: layout, depth: 0 }];
          const seen = new Set([shape(layout).join("/")]);
          let found = false;
          while (queue.length > 0) {
            const { l, depth } = queue.shift()!;
            const atW = findWidget(l, w.id)!;
            const atY = findWidget(l, y.id)!;
            if (atW.column.id === atY.column.id) {
              found = true;
              break;
            }
            if (depth >= 6) continue;
            for (const dir of ["up", "down", "left", "right"] as const) {
              const nextL = moveWidgetStep(l, w.id, dir);
              if (nextL === l) continue;
              const key = shape(nextL).join("/");
              if (!seen.has(key)) {
                seen.add(key);
                queue.push({ l: nextL, depth: depth + 1 });
              }
            }
          }
          assert.ok(found, `could not reach ${y.type} from ${w.type}`);
        }
      }
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 2000, `BFS took ${elapsed}ms >= 2000ms`);
  });

  test("(f) invariants hold after every move step", () => {
    function checkInvariants(l: Layout, label: string) {
      const ids = new Set<string>();
      for (const r of l.rows) {
        assert.ok(!ids.has(r.id), `${label}: dup row id ${r.id}`);
        ids.add(r.id);
        assert.ok(r.columns.length > 0, `${label}: empty row ${r.id}`);
        const w = r.columns.reduce((s, c) => s + c.width, 0);
        assert.ok(w <= 12, `${label}: row width ${w} > 12`);
        for (const c of r.columns) {
          assert.ok(!ids.has(c.id), `${label}: dup col id ${c.id}`);
          ids.add(c.id);
          assert.ok(c.widgets.length > 0, `${label}: empty col ${c.id}`);
          assert.ok(Number.isInteger(c.width) && c.width >= 2 && c.width <= 12, `${label}: bad width ${c.width}`);
          for (const x of c.widgets) {
            assert.ok(!ids.has(x.id), `${label}: dup widget id ${x.id}`);
            ids.add(x.id);
          }
        }
      }
    }

    const testLayout = buildLayout("inv", [
      row([8, "a", "b"], [4, "c", "d"]),
      row([6, "e"], [6, "f"]),
      row([12, "g"]),
    ]);
    const all = widgetsInOrder(testLayout);
    for (const w of all) {
      for (const dir of ["up", "down", "left", "right"] as const) {
        const next = moveWidgetStep(testLayout, w.id, dir);
        checkInvariants(next, `${w.type} ${dir}`);
      }
    }
  });
});

describe("A5: rail rows in the model", () => {
  test("railRow sets the flag, survives clone, withFreshIds and sanitize round-trip", () => {
    const layout = buildLayout("h", [
      railRow([8, "market.index", "market.events"], [4, "market.watchlist", "market.breadth"]),
      row([12, "full"]),
    ]);
    assert.equal(layout.rows[0].rail, true);
    assert.equal(layout.rows[1].rail, undefined);

    // withFreshIds
    const fresh = withFreshIds(layout);
    assert.equal(fresh.rows[0].rail, true);
    assert.equal(fresh.rows[1].rail, undefined);

    // sanitize round-trip
    const serialized = JSON.parse(JSON.stringify(layout));
    const sanitized = sanitizeLayout(serialized, () => true);
    assert.ok(sanitized);
    assert.equal(sanitized.rows[0].rail, true);
    assert.equal(sanitized.rows[1].rail, undefined);

    // rail: "yes" dropped
    const badRail = JSON.parse(JSON.stringify(layout));
    badRail.rows[0].rail = "yes";
    const sanitizedBad = sanitizeLayout(badRail, () => true);
    assert.ok(sanitizedBad);
    assert.equal(sanitizedBad.rows[0].rail, undefined);

    // moves inside the row keep the rail flag
    const moved = moveWidgetStep(layout, idOf(layout, "market.events"), "up");
    assert.equal(moved.rows[0].rail, true);
  });
});

describe("A6: full width preset on card with stack-mates", () => {
  test("[6: note, chart], chart -> full moves only chart to new row below", () => {
    const layout = buildLayout("p", [row([6, "general.note", "stock.chart"])]);
    const chartId = idOf(layout, "stock.chart");
    const next = setWidgetWidth(layout, chartId, 12);
    assert.deepEqual(shape(next), ["6:general.note", "12:stock.chart"]);
  });

  test("two-column row, stack-mates keep their column", () => {
    const layout = buildLayout("q", [row([6, "general.note", "stock.chart"], [6, "stock.news"])]);
    const chartId = idOf(layout, "stock.chart");
    const next = setWidgetWidth(layout, chartId, 12);
    assert.deepEqual(shape(next), ["6:general.note 6:stock.news", "12:stock.chart"]);
  });
});
