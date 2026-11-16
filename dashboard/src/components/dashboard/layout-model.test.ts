import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARD_IDS,
  CARD_LIMITS,
  DASHBOARD_COLUMNS,
  DEFAULT_LAYOUT,
  MAX_GRID_ROWS,
  moveCard,
  nudgeCard,
  parseLayout,
  readingOrder,
  resizeCard,
  serializeLayout,
  type CardId,
  type DashboardLayout,
} from "./layout-model.ts";

function card(layout: DashboardLayout, id: CardId) {
  const item = layout.find((entry) => entry.id === id);
  assert.ok(item, `Missing ${id}`);
  return item;
}

/** Inside the grid, within the size limits, no overlaps, and no card with empty rows above it. */
function assertFits(layout: DashboardLayout) {
  assert.deepEqual(layout.map(({ id }) => id), [...CARD_IDS]);
  for (const [index, item] of layout.entries()) {
    const { minW, minH, maxH } = CARD_LIMITS[item.id];
    assert.ok(item.x >= 0 && item.x + item.w <= DASHBOARD_COLUMNS);
    assert.ok(item.y >= 0 && item.y + item.h <= MAX_GRID_ROWS);
    assert.ok(item.w >= minW && item.h >= minH && item.h <= maxH);
    for (const other of layout.slice(index + 1)) {
      const horizontalOverlap = item.x < other.x + other.w && other.x < item.x + item.w;
      const verticalOverlap = item.y < other.y + other.h && other.y < item.y + item.h;
      assert.ok(!horizontalOverlap || !verticalOverlap, `${item.id} overlaps ${other.id}`);
    }
    const rests = item.y === 0 || layout.some((other) =>
      other.id !== item.id && other.y + other.h === item.y && item.x < other.x + other.w && other.x < item.x + item.w);
    assert.ok(rests, `${item.id} has a gap above it`);
  }
}

test("the default layout fits and sorts in mobile reading order", () => {
  assertFits(DEFAULT_LAYOUT);
  assert.deepEqual(readingOrder([...DEFAULT_LAYOUT].reverse()).map(({ id }) => id), [...CARD_IDS]);
  assert.deepEqual(parseLayout(serializeLayout(DEFAULT_LAYOUT)), DEFAULT_LAYOUT);
});

test("a moved card takes its cell and the others close every gap", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "watchlist", 3, 5);
  assertFits(moved);
  // Nothing sits above column 3, so the card rises to the top and the chart yields.
  assert.deepEqual(card(moved, "watchlist"), { ...card(DEFAULT_LAYOUT, "watchlist"), x: 3, y: 0 });
  assert.equal(card(moved, "index").y, 10);
  assert.equal(card(moved, "breadth"), card(DEFAULT_LAYOUT, "breadth"));
  assert.equal(card(moved, "events").y, 25);
  assert.equal(card(DEFAULT_LAYOUT, "index").y, 0);

  for (const id of CARD_IDS) {
    for (let x = 0; x < DASHBOARD_COLUMNS; x++) {
      for (let y = 0; y < 40; y++) assertFits(moveCard(DEFAULT_LAYOUT, id, x, y));
    }
  }
});

test("stacked cards swap once the dragged edge crosses the neighbour's middle", () => {
  // Downward the bottom edge leads: the breadth card spans rows 10 to 26.
  assert.equal(moveCard(DEFAULT_LAYOUT, "watchlist", 4, 8), DEFAULT_LAYOUT);
  const lowered = moveCard(DEFAULT_LAYOUT, "watchlist", 4, 9);
  assert.equal(card(lowered, "breadth").y, 0);
  assert.equal(card(lowered, "watchlist").y, 16);
  assertFits(lowered);

  // Upward the top edge leads: the watchlist spans rows 0 to 10.
  assert.equal(moveCard(DEFAULT_LAYOUT, "breadth", 4, 5), DEFAULT_LAYOUT);
  const raised = moveCard(DEFAULT_LAYOUT, "breadth", 4, 4);
  assert.deepEqual(raised, lowered);

  // The same holds for a card arriving from another column.
  assert.equal(moveCard(DEFAULT_LAYOUT, "events", 0, 8), DEFAULT_LAYOUT);
  const promoted = moveCard(DEFAULT_LAYOUT, "events", 0, 7);
  assert.equal(card(promoted, "events").y, 0);
  assert.equal(card(promoted, "index").y, 13);
  assert.equal(card(promoted, "watchlist"), card(DEFAULT_LAYOUT, "watchlist"));
  assertFits(promoted);
});

test("moving clamps to the grid and ignores values that are not numbers", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "events", 999, 999);
  const events = card(moved, "events");
  assert.equal(events.x + events.w, DASHBOARD_COLUMNS);
  // Far below everything, it rests on the tallest card in its columns.
  assert.equal(events.y, 26);
  assertFits(moved);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", Number.NaN, Infinity), DEFAULT_LAYOUT);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", -5, -5), DEFAULT_LAYOUT);
});

test("resizing keeps the top left still and pushes other cards down", () => {
  const index = card(DEFAULT_LAYOUT, "index");
  const resized = resizeCard(DEFAULT_LAYOUT, "index", 100, 18);

  assertFits(resized);
  assert.deepEqual(card(resized, "index"), { ...index, w: DASHBOARD_COLUMNS, h: 18 });
  assert.equal(card(resized, "watchlist").y, 18);
  assert.equal(card(resized, "breadth").y, 28);
  assert.equal(card(resized, "events").y, 18);
  assert.equal(card(DEFAULT_LAYOUT, "watchlist").y, 0);
  assert.deepEqual(parseLayout(serializeLayout(resized)), resized);
});

test("resizing obeys the limits and lets the cards below rise into freed rows", () => {
  const narrowed = resizeCard(DEFAULT_LAYOUT, "index", -1, -1);
  assert.deepEqual(card(narrowed, "index"), { ...card(DEFAULT_LAYOUT, "index"), w: 3 });
  assert.equal(card(narrowed, "watchlist"), card(DEFAULT_LAYOUT, "watchlist"));
  assertFits(narrowed);

  const taller = resizeCard(DEFAULT_LAYOUT, "index", 4, 20);
  assert.equal(card(taller, "events").y, 20);
  assert.equal(card(resizeCard(taller, "index", 4, 16), "events").y, 16);

  const stretched = resizeCard(DEFAULT_LAYOUT, "watchlist", DASHBOARD_COLUMNS, 999);
  assert.equal(card(stretched, "watchlist").w, 2);
  assert.equal(card(stretched, "watchlist").h, CARD_LIMITS.watchlist.maxH);
  assert.equal(card(stretched, "breadth").y, CARD_LIMITS.watchlist.maxH);
  assertFits(stretched);
  assert.equal(resizeCard(DEFAULT_LAYOUT, "index", Number.NaN, Number.NaN), DEFAULT_LAYOUT);
});

test("a keyboard step always changes the layout or reports that it cannot", () => {
  assert.deepEqual(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, 1), moveCard(DEFAULT_LAYOUT, "watchlist", 4, 9));
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, -1), DEFAULT_LAYOUT);
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 1, 0), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", -1, 0), "watchlist").x, 3);
  // The lowest card in a column has nowhere further down to go.
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "breadth", "move", 0, 1), DEFAULT_LAYOUT);

  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", -1, 0), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", 0, 1), "watchlist").h, 11);
  for (const id of CARD_IDS) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "move", dx, dy));
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "resize", dx, dy));
    }
  }
});

test("invalid, empty or unsupported saved layouts use the caller's default", () => {
  for (const raw of [null, "invalid", "null", "[]", '{"version":2,"items":[]}', '{"version":1,"items":[false]}']) {
    assert.equal(parseLayout(raw), null);
  }
});

test("saved layouts recover missing, duplicate, invalid and colliding entries", () => {
  const index = { ...card(DEFAULT_LAYOUT, "index"), w: 6 };
  const watchlist = card(DEFAULT_LAYOUT, "watchlist");
  const raw = JSON.stringify({
    version: 1,
    items: [
      { ...index, x: -1 },
      index,
      { ...index, y: 50 },
      watchlist,
      { ...card(DEFAULT_LAYOUT, "events"), y: MAX_GRID_ROWS },
      { ...card(DEFAULT_LAYOUT, "breadth"), id: "unknown" },
    ],
  });

  const layout = parseLayout(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), index);
  assert.equal(card(layout, "watchlist").y, index.h);
  assert.equal(card(layout, "breadth").y, index.h + watchlist.h);
  assert.deepEqual(card(layout, "events"), card(DEFAULT_LAYOUT, "events"));
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
});

test("sizes saved outside the current limits are brought back inside them", () => {
  const raw = JSON.stringify({
    version: 1,
    items: [
      { id: "index", x: 0, y: 0, w: 1, h: 2 },
      { id: "watchlist", x: 5, y: 0, w: 1, h: 100 },
    ],
  });
  const layout = parseLayout(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), { id: "index", x: 0, y: 0, w: CARD_LIMITS.index.minW, h: CARD_LIMITS.index.minH });
  assert.deepEqual(card(layout, "watchlist"), { id: "watchlist", x: 4, y: 0, w: 2, h: CARD_LIMITS.watchlist.maxH });
});

test("a saved layout with empty rows between cards is closed up", () => {
  const spread = DEFAULT_LAYOUT.map((item) => (item.id === "events" ? { ...item, y: 60 } : item.id === "index" ? { ...item, y: 4 } : item));
  assert.deepEqual(parseLayout(serializeLayout(spread)), DEFAULT_LAYOUT);
});
