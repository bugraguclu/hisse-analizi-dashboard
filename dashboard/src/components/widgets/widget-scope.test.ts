import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layout, WidgetInstance } from "./model.ts";
import { addWidgetInScope, groupWidgetsByScope, pageStockUsage, rowScope } from "./widget-scope.ts";

const metadata: Record<string, { stock?: boolean }> = {
  chart: { stock: true },
  dividends: { stock: true },
  index: {},
  calendar: {},
  note: {},
};

function layout(...widgets: WidgetInstance[]): Layout {
  return { rows: [{ id: "row", columns: [{ id: "column", width: 12, widgets }] }] };
}

test("market, macro and note widgets never require a page stock, including stale ticker fields", () => {
  const page = layout(
    { id: "index", type: "index", ticker: "THYAO" },
    { id: "calendar", type: "calendar" },
    { id: "note", type: "note" },
    { id: "unknown", type: "removed-widget" },
  );
  assert.deepEqual(pageStockUsage(page, (type) => metadata[type]), { stock: 0, followingPage: 0 });
});

test("only stock widgets that inherit their ticker are controlled by the page picker", () => {
  const page: Layout = { rows: [
    { id: "first", columns: [
      { id: "left", width: 6, widgets: [{ id: "chart", type: "chart" }] },
      { id: "right", width: 6, widgets: [{ id: "own", type: "dividends", ticker: "ASELS" }] },
    ] },
    { id: "second", columns: [{ id: "bottom", width: 12, widgets: [{ id: "dividends", type: "dividends" }] }] },
  ] };
  const before = JSON.stringify(page);
  assert.deepEqual(pageStockUsage(page, (type) => metadata[type]), { stock: 3, followingPage: 2 });
  assert.equal(JSON.stringify(page), before);
});

test("pages with independently selected stocks do not need a page stock picker", () => {
  const page = layout({ id: "own", type: "chart", ticker: "TUPRS" });
  assert.deepEqual(pageStockUsage(page, (type) => metadata[type]), { stock: 1, followingPage: 0 });
  assert.deepEqual(pageStockUsage({ rows: [] }, (type) => metadata[type]), { stock: 0, followingPage: 0 });
});

test("scope sections split mixed stacks without changing widget sizes or stock settings", () => {
  const page = layout(
    { id: "note", type: "note", height: 240 },
    { id: "chart", type: "chart", ticker: "ASELS", height: 480 },
    { id: "calendar", type: "calendar" },
  );
  const before = JSON.stringify(page);
  const grouped = groupWidgetsByScope(page, (type) => metadata[type]);
  assert.deepEqual(grouped.rows.map((row) => rowScope(row, (type) => metadata[type])), ["stock", "general"]);
  assert.deepEqual(grouped.rows[0].columns[0].widgets, [page.rows[0].columns[0].widgets[1]]);
  assert.deepEqual(grouped.rows[1].columns[0].widgets.map((widget) => widget.id), ["note", "calendar"]);
  assert.equal(grouped.rows[0].columns[0].width, 12);
  assert.equal(new Set(grouped.rows.map((row) => row.id)).size, 2);
  assert.equal(new Set(grouped.rows.flatMap((row) => row.columns.map((column) => column.id))).size, 2);
  assert.equal(JSON.stringify(page), before);
  assert.equal(groupWidgetsByScope(grouped, (type) => metadata[type]), grouped);
});

test("alternating additions always land beneath the matching scope heading", () => {
  const lookup = (type: string) => metadata[type];
  let page: Layout = { rows: [] };
  for (const type of ["note", "chart", "calendar", "dividends", "index"]) {
    page = addWidgetInScope(page, { type }, 6, lookup).layout;
  }
  assert.deepEqual(page.rows.map((row) => rowScope(row, lookup)), ["stock", "general", "general"]);
  assert.deepEqual(page.rows.flatMap((row) => row.columns.flatMap((column) => column.widgets.map((widget) => widget.type))), [
    "chart", "dividends", "note", "calendar", "index",
  ]);
  // A saved page already in sections keeps the same structure after reloading.
  const reloaded = JSON.parse(JSON.stringify(page)) as Layout;
  assert.equal(groupWidgetsByScope(reloaded, lookup), reloaded);
});

test("grouping preserves rows, column widths and order inside each scope", () => {
  const page: Layout = { rows: [
    { id: "general", columns: [{ id: "note", width: 4, widgets: [{ id: "w-note", type: "note" }] }] },
    { id: "mixed", columns: [
      { id: "chart", width: 8, widgets: [{ id: "w-chart", type: "chart" }] },
      { id: "calendar", width: 4, widgets: [{ id: "w-calendar", type: "calendar" }] },
    ] },
    { id: "stock", columns: [{ id: "dividends", width: 6, widgets: [{ id: "w-dividends", type: "dividends" }] }] },
  ] };
  const grouped = groupWidgetsByScope(page, (type) => metadata[type]);
  assert.deepEqual(grouped.rows.flatMap((row) => row.columns.map((column) => [column.id, column.width])), [
    ["chart", 8], ["dividends", 6], ["note", 4], ["calendar", 4],
  ]);
  assert.equal(grouped.rows[1], page.rows[2]);
  assert.equal(grouped.rows[2], page.rows[0]);
});
