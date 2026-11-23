import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, test } from "node:test";

// The app resolves extensionless source imports through its bundler.
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function resolve(s, c, next) { if (s.startsWith(".") && !/\\.\\w+$/.test(s)) { try { return await next(s + ".ts", c); } catch {} } return next(s, c); }',
    ),
);
const { DEFAULT_LAYOUTS } = await import("./defaults.ts");
const { widgetsInOrder } = await import("./model.ts");
const { migrateWorkspaceOverrides, readWorkspaceLayout } = await import("./workspace-migration.ts");

const savedHome = JSON.stringify({
  version: 1,
  items: [
    { id: "events", x: 2, y: 20, w: 4, h: 10 },
    { id: "watchlist", x: 0, y: 0, w: 2, h: 8 },
    { id: "breadth", x: 0, y: 8, w: 2, h: 12 },
    { id: "index", x: 2, y: 0, w: 4, h: 14 },
  ],
});

describe("workspace layout migration", () => {
  test("adapts the home grid to widget rows in reading order", () => {
    const layout = readWorkspaceLayout("home", DEFAULT_LAYOUTS.home, (key) => {
      assert.equal(key, "hisse.dashboard.layout");
      return savedHome;
    });
    assert.ok(layout);
    assert.deepEqual(layout.rows.map(({ columns }) => columns.map(({ width, widgets }) => [
      width, ...widgets.map((widget) => `${widget.type}@${widget.height}`),
    ])), [
      [[4, "market.watchlist@240", "market.breadth@368"], [8, "market.index@432"]],
      [[8, "market.events@304"]],
    ]);
  });

  test("keeps cards stacked in an old column together, as the home rail", () => {
    const layout = readWorkspaceLayout("home", DEFAULT_LAYOUTS.home, () => JSON.stringify({
      version: 1,
      items: [
        { id: "index", x: 0, y: 0, w: 4, h: 14 },
        { id: "watchlist", x: 4, y: 0, w: 2, h: 10 },
        { id: "breadth", x: 4, y: 10, w: 2, h: 16 },
        { id: "events", x: 0, y: 14, w: 4, h: 12 },
      ],
    }));
    assert.ok(layout);
    assert.equal(layout.rows.length, 1);
    assert.equal(layout.rows[0].rail, true);
    assert.deepEqual(layout.rows[0].columns.map(({ width, widgets }) => [width, widgets.map(({ type }) => type)]), [
      [8, ["market.index", "market.events"]],
      [4, ["market.watchlist", "market.breadth"]],
    ]);
  });

  test("leaves cards that sized to their content at auto height", () => {
    const layout = readWorkspaceLayout("stock.fundamental", DEFAULT_LAYOUTS["stock.fundamental"], () => JSON.stringify({
      version: 1,
      items: [
        { id: "scorecard", x: 0, y: 0, w: 3, h: 14 },
        { id: "holders", x: 3, y: 0, w: 3, h: 9 },
        { id: "statements", x: 0, y: 14, w: 6, h: 16 },
      ],
    }));
    assert.ok(layout);
    const byType = new Map(widgetsInOrder(layout).map((widget) => [widget.type, widget]));
    assert.equal(byType.get("stock.scorecard")?.height, undefined);
    assert.equal(byType.get("stock.holders")?.height, undefined);
    assert.equal(byType.get("stock.statements")?.height, 496);
    // Cards the old layout lacked never split the row the visitor built.
    const first = layout.rows.find((row) => row.columns.some(({ widgets }) => widgets.some(({ type }) => type === "stock.scorecard")));
    assert.deepEqual(first?.columns.map(({ widgets }) => widgets[0].type), ["stock.scorecard", "stock.holders"]);
  });

  test("retains the macro heading anchors, new cards, and natural-height widgets", () => {
    const defaults = DEFAULT_LAYOUTS.macro;
    const layout = readWorkspaceLayout("macro", defaults, (key) => {
      assert.equal(key, "hisse.layout.macro");
      return JSON.stringify({ version: 1, items: [{ id: "markets", x: 0, y: 0, w: 6, h: 18 }] });
    });
    assert.ok(layout);
    const migrated = widgetsInOrder(layout);
    assert.deepEqual(migrated, widgetsInOrder(defaults));
    assert.ok(migrated.some(({ options }) => options?.anchor === "piyasalar"));
    assert.ok(migrated.some(({ type }) => type === "macro.fxBulletin"));
  });

  test("retains technical chart settings and drops incompatible saved data", () => {
    const page = "stock.technical";
    const defaults = DEFAULT_LAYOUTS[page];
    assert.equal(readWorkspaceLayout(page, defaults, () => "invalid"), null);
    assert.equal(readWorkspaceLayout(page, defaults, () => '{"version":0,"items":[]}'), null);
    const layout = readWorkspaceLayout(page, defaults, (key) => {
      assert.equal(key, "hisse.layout.stock-technical");
      return JSON.stringify({
        version: 1,
        items: [
          { id: "chart", x: 3, y: 0, w: 6, h: 9 },
          { id: "chart", x: 0, y: 0, w: 6, h: 12 },
          { id: "chart", x: 0, y: 0, w: 6, h: 17 },
        ],
      });
    });
    assert.ok(layout);
    const charts = widgetsInOrder(layout).filter(({ type }) => type === "stock.chart");
    assert.equal(charts.length, 1);
    assert.equal(charts[0].options?.view, "technical");
    assert.equal(charts[0].height, 368);
  });

  test("leaves widget overrides alone and only imports legacy layouts once", () => {
    const read = (key: string) => key === "hisse.dashboard.layout" ? savedHome : null;
    const blank = { rows: [] };
    const existing = migrateWorkspaceOverrides({ home: blank }, DEFAULT_LAYOUTS, read);
    assert.equal(existing.home, blank);
    assert.equal(existing.workspaceMigrated, true);

    const first = migrateWorkspaceOverrides({}, DEFAULT_LAYOUTS, read);
    assert.ok(first.home);
    const reset = { ...first };
    delete reset.home;
    const afterReset = migrateWorkspaceOverrides(reset, DEFAULT_LAYOUTS, read);
    assert.equal(afterReset, reset);
    assert.equal(afterReset.home, undefined);
  });

  test("permits a retry if storage access temporarily fails", () => {
    const current = {};
    assert.equal(migrateWorkspaceOverrides(current, DEFAULT_LAYOUTS, () => {
      throw new Error("storage access denied");
    }), current);
    const retry = migrateWorkspaceOverrides(current, DEFAULT_LAYOUTS, () => savedHome);
    assert.ok(retry.home);
  });
});
