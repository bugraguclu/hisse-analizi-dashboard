import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LIMITS,
  MAX_GRID_ROWS,
  WORKSPACE_COLUMNS,
  fitHeights,
  moveCard,
  nudgeCard,
  packLayout,
  parseLayout,
  readingOrder,
  resizeCard,
  serializeLayout,
  type CardLimits,
  type WorkspaceLayout,
} from "./layout-model.ts";

/** The home page's cards: a wide chart over the news, beside two narrower lists. */
const CARD_IDS = ["index", "watchlist", "breadth", "events"];
const CARD_LIMITS: Record<string, CardLimits> = {
  index: { minW: 3, minH: 15, maxH: 28 },
  watchlist: { minW: 2, minH: 10, maxH: 28 },
  breadth: { minW: 2, minH: 8, maxH: 28 },
  events: { minW: 2, minH: 7, maxH: 28 },
};
const limits = (id: string) => CARD_LIMITS[id] ?? DEFAULT_LIMITS;
const DEFAULT_LAYOUT: WorkspaceLayout = [
  { id: "index", x: 0, y: 0, w: 4, h: 15 },
  { id: "watchlist", x: 4, y: 0, w: 2, h: 10 },
  { id: "breadth", x: 4, y: 10, w: 2, h: 16 },
  { id: "events", x: 0, y: 15, w: 4, h: 13 },
];
const parse = (raw: string | null) => parseLayout(raw, CARD_IDS, limits);

function card(layout: WorkspaceLayout, id: string) {
  const item = layout.find((entry) => entry.id === id);
  assert.ok(item, `Missing ${id}`);
  return item;
}

/** Inside the grid, within the size limits, no overlaps, and no card with empty rows above it. */
function assertFits(layout: WorkspaceLayout) {
  assert.deepEqual(layout.map(({ id }) => id), [...CARD_IDS]);
  for (const [index, item] of layout.entries()) {
    const { minW, minH, maxH } = limits(item.id);
    assert.ok(item.x >= 0 && item.x + item.w <= WORKSPACE_COLUMNS);
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
  assert.deepEqual(parse(serializeLayout(DEFAULT_LAYOUT)), DEFAULT_LAYOUT);
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
    for (let x = 0; x < WORKSPACE_COLUMNS; x++) {
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
  assert.equal(events.x + events.w, WORKSPACE_COLUMNS);
  // Far below everything, it rests on the tallest card in its columns.
  assert.equal(events.y, 26);
  assertFits(moved);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", Number.NaN, Infinity), DEFAULT_LAYOUT);
  assert.equal(moveCard(DEFAULT_LAYOUT, "index", -5, -5), DEFAULT_LAYOUT);
});

test("resizing keeps the top left still and pushes other cards down", () => {
  const index = card(DEFAULT_LAYOUT, "index");
  const resized = resizeCard(DEFAULT_LAYOUT, "index", 100, 18, limits);

  assertFits(resized);
  assert.deepEqual(card(resized, "index"), { ...index, w: WORKSPACE_COLUMNS, h: 18 });
  assert.equal(card(resized, "watchlist").y, 18);
  assert.equal(card(resized, "breadth").y, 28);
  assert.equal(card(resized, "events").y, 18);
  assert.equal(card(DEFAULT_LAYOUT, "watchlist").y, 0);
  assert.deepEqual(parse(serializeLayout(resized)), resized);
});

test("resizing obeys the limits and lets the cards below rise into freed rows", () => {
  const narrowed = resizeCard(DEFAULT_LAYOUT, "index", -1, -1, limits);
  assert.deepEqual(card(narrowed, "index"), { ...card(DEFAULT_LAYOUT, "index"), w: 3 });
  assert.equal(card(narrowed, "watchlist"), card(DEFAULT_LAYOUT, "watchlist"));
  assertFits(narrowed);

  const taller = resizeCard(DEFAULT_LAYOUT, "index", 4, 20, limits);
  assert.equal(card(taller, "events").y, 20);
  assert.equal(card(resizeCard(taller, "index", 4, 16, limits), "events").y, 16);

  const stretched = resizeCard(DEFAULT_LAYOUT, "watchlist", WORKSPACE_COLUMNS, 999, limits);
  assert.equal(card(stretched, "watchlist").w, 2);
  assert.equal(card(stretched, "watchlist").h, CARD_LIMITS.watchlist.maxH);
  assert.equal(card(stretched, "breadth").y, CARD_LIMITS.watchlist.maxH);
  assertFits(stretched);
  assert.equal(resizeCard(DEFAULT_LAYOUT, "index", Number.NaN, Number.NaN, limits), DEFAULT_LAYOUT);
});

test("narrowing a card closes a gap before the layout is saved", () => {
  const moved = moveCard(DEFAULT_LAYOUT, "index", 2, 0);
  const narrower = resizeCard(moved, "events", 2, card(moved, "events").h, limits);
  assert.equal(card(narrower, "events").y, 0);
  assertFits(narrower);
  assert.deepEqual(parse(serializeLayout(narrower)), narrower);
});

test("a keyboard step always changes the layout or reports that it cannot", () => {
  assert.deepEqual(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, 1, limits), moveCard(DEFAULT_LAYOUT, "watchlist", 4, 9));
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 0, -1, limits), DEFAULT_LAYOUT);
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", 1, 0, limits), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "move", -1, 0, limits), "watchlist").x, 3);
  // The lowest card in a column has nowhere further down to go.
  assert.equal(nudgeCard(DEFAULT_LAYOUT, "breadth", "move", 0, 1, limits), DEFAULT_LAYOUT);

  assert.equal(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", -1, 0, limits), DEFAULT_LAYOUT);
  assert.equal(card(nudgeCard(DEFAULT_LAYOUT, "watchlist", "resize", 0, 1, limits), "watchlist").h, 11);
  for (const id of CARD_IDS) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "move", dx, dy, limits));
      assertFits(nudgeCard(DEFAULT_LAYOUT, id, "resize", dx, dy, limits));
    }
  }
});

test("invalid, empty or unsupported saved layouts use the caller's default", () => {
  for (const raw of [null, "invalid", "null", "[]", '{"version":2,"items":[]}', '{"version":1,"items":[false]}']) {
    assert.equal(parse(raw), null);
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

  const layout = parse(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), index);
  assert.equal(card(layout, "watchlist").y, index.h);
  // The two cards without a usable entry follow at the bottom, full width.
  assert.deepEqual(card(layout, "breadth"), { id: "breadth", x: 0, y: index.h + watchlist.h, w: WORKSPACE_COLUMNS, h: 10 });
  assert.deepEqual(card(layout, "events"), { id: "events", x: 0, y: index.h + watchlist.h + 10, w: WORKSPACE_COLUMNS, h: 10 });
  assert.deepEqual(parse(serializeLayout(layout)), layout);
});

test("sizes saved outside the current limits are brought back inside them", () => {
  const raw = JSON.stringify({
    version: 1,
    items: [
      { id: "index", x: 0, y: 0, w: 1, h: 2 },
      { id: "watchlist", x: 5, y: 0, w: 1, h: 100 },
      { id: "breadth", x: 0, y: 40, w: 2, h: 8 },
      { id: "events", x: 2, y: 40, w: 2, h: 7 },
    ],
  });
  const layout = parse(raw);
  assert.ok(layout);
  assertFits(layout);
  assert.deepEqual(card(layout, "index"), { id: "index", x: 0, y: 0, w: CARD_LIMITS.index.minW, h: CARD_LIMITS.index.minH });
  assert.deepEqual(card(layout, "watchlist"), { id: "watchlist", x: 4, y: 0, w: 2, h: CARD_LIMITS.watchlist.maxH });
});

test("a saved layout with empty rows between cards is closed up", () => {
  const spread = DEFAULT_LAYOUT.map((item) => (item.id === "events" ? { ...item, y: 60 } : item.id === "index" ? { ...item, y: 4 } : item));
  assert.deepEqual(parse(serializeLayout(spread)), DEFAULT_LAYOUT);
});

test("a card the page gained since the layout was saved is appended full width", () => {
  const raw = serializeLayout(DEFAULT_LAYOUT.filter(({ id }) => id !== "events"));
  const layout = parse(raw);
  assert.ok(layout);
  assert.deepEqual(layout.map(({ id }) => id), CARD_IDS);
  assert.deepEqual(card(layout, "events"), { id: "events", x: 0, y: 26, w: WORKSPACE_COLUMNS, h: 10 });
});

test("cards that hug their content take the measured height and push the rest", () => {
  assert.equal(fitHeights(DEFAULT_LAYOUT, new Map()), DEFAULT_LAYOUT);
  assert.equal(fitHeights(DEFAULT_LAYOUT, new Map([["watchlist", 10]])), DEFAULT_LAYOUT);

  const grown = fitHeights(DEFAULT_LAYOUT, new Map([["watchlist", 13], ["missing", 4]]));
  assert.equal(card(grown, "watchlist").h, 13);
  assert.equal(card(grown, "breadth").y, 13);
  assert.equal(card(grown, "index"), card(DEFAULT_LAYOUT, "index"));

  const shrunk = fitHeights(grown, new Map([["watchlist", 3]]));
  assert.equal(card(shrunk, "breadth").y, 3);
});

test("packing closes gaps without changing the reading order", () => {
  const loose = DEFAULT_LAYOUT.map((item) => ({ ...item, y: item.y * 2 + 3 }));
  assert.deepEqual(packLayout(loose), DEFAULT_LAYOUT);
  assert.equal(packLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
});
