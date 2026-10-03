/**
 * Widget layouts: a page is a list of rows, a row is a list of columns on a
 * 12-column grid, a column is a stack of widgets. This mirrors how the pages
 * were laid out by hand (PAIR = a row of two 6-wide columns, STACK = a column
 * with several cards), so a default layout renders like the page did and a
 * customised one still lines up: columns in a row stretch to the tallest, and
 * the cards of a shorter column share the extra height.
 *
 * Every operation here is pure (layout in, new layout out) so the editor can
 * preview a drag on a copy and commit on drop. Pure module — no React, safe to
 * unit test with node:test.
 */

export const GRID_COLUMNS = 12;
/** Narrowest column (2/12 ≈ 200px at the 1280px page width). */
export const MIN_WIDTH = 2;
/** Fixed widget heights (px) snap to this step and stay within these bounds. */
export const HEIGHT_STEP = 8;
export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 2400;

export const MAX_ROWS = 60;
export const MAX_WIDGETS = 60;
const MAX_TEXT_LENGTH = 4000;
const MAX_OPTION_KEYS = 16;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

export type OptionValue = string | number | boolean;

export interface WidgetInstance {
  id: string;
  /** Registry key, e.g. "stock.dividends". */
  type: string;
  /** Fixed height in px; absent = the widget is as tall as its content (and grows with its row). */
  height?: number;
  /** Stock widgets: this symbol instead of the page's. */
  ticker?: string;
  /** Widget-specific settings (variant, compact, text…). */
  options?: Record<string, OptionValue>;
}

export interface Column {
  id: string;
  /** Span on the 12-column grid. */
  width: number;
  widgets: WidgetInstance[];
}

export interface Row {
  id: string;
  columns: Column[];
  rail?: true;
}

export interface Layout {
  rows: Row[];
}

/** Where a dragged widget lands. `before*` null = at the end. */
export type DropTarget =
  /** Into a column's stack, above `beforeWidgetId`. */
  | { kind: "stack"; columnId: string; beforeWidgetId: string | null }
  /** As a new column in a row, left of `beforeColumnId`. */
  | { kind: "column"; rowId: string; beforeColumnId: string | null }
  /** As a new row of its own, above `beforeRowId`. */
  | { kind: "row"; beforeRowId: string | null };

export type MoveDirection = "up" | "down" | "left" | "right";

// ---------------------------------------------------------------------------
// Ids and lookups
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Short id, unique within a page (and practically across pages). */
export function newId(prefix: "w" | "c" | "r" | "p"): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface WidgetLocation {
  rowIndex: number;
  columnIndex: number;
  widgetIndex: number;
  row: Row;
  column: Column;
  widget: WidgetInstance;
}

export function findWidget(layout: Layout, widgetId: string): WidgetLocation | null {
  for (let rowIndex = 0; rowIndex < layout.rows.length; rowIndex++) {
    const row = layout.rows[rowIndex];
    for (let columnIndex = 0; columnIndex < row.columns.length; columnIndex++) {
      const column = row.columns[columnIndex];
      const widgetIndex = column.widgets.findIndex((w) => w.id === widgetId);
      if (widgetIndex >= 0) return { rowIndex, columnIndex, widgetIndex, row, column, widget: column.widgets[widgetIndex] };
    }
  }
  return null;
}

export function rowWidth(row: Row): number {
  return row.columns.reduce((sum, column) => sum + column.width, 0);
}

export function widgetCount(layout: Layout): number {
  return layout.rows.reduce((sum, row) => sum + row.columns.reduce((n, column) => n + column.widgets.length, 0), 0);
}

/** Every widget in reading order (row by row, column by column, top to bottom). */
export function widgetsInOrder(layout: Layout): WidgetInstance[] {
  return layout.rows.flatMap((row) => row.columns.flatMap((column) => column.widgets));
}

function clone(layout: Layout): Layout {
  return {
    rows: layout.rows.map((row) => ({
      id: row.id,
      ...(row.rail ? { rail: true as const } : {}),
      columns: row.columns.map((column) => ({
        id: column.id,
        width: column.width,
        widgets: column.widgets.map((w) => ({
          ...w,
          ...(w.options ? { options: { ...w.options } } : {}),
        })),
      })),
    })),
  };
}

function clampWidth(width: number): number {
  return Math.min(GRID_COLUMNS, Math.max(MIN_WIDTH, Math.round(width)));
}

export function clampHeight(height: number): number {
  const snapped = Math.round(height / HEIGHT_STEP) * HEIGHT_STEP;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, snapped));
}

// ---------------------------------------------------------------------------
// Row fitting
// ---------------------------------------------------------------------------

/**
 * Shrinks the columns of an over-full row one step at a time, always the
 * widest, so a 12-wide newcomer beside a 4-wide card ends up 8 wide and three
 * halves become thirds. On a tie `keepId` gives way last; when `pinned` it
 * only shrinks once nothing else can. False when even MIN_WIDTH columns don't fit.
 */
function fitRow(row: Row, keepId: string | null, pinned = false): boolean {
  let excess = rowWidth(row) - GRID_COLUMNS;
  while (excess > 0) {
    let target: Column | null = null;
    for (const column of row.columns) {
      if (column.width <= MIN_WIDTH || (pinned && column.id === keepId)) continue;
      if (!target || column.width > target.width || (column.width === target.width && target.id === keepId)) target = column;
    }
    if (!target && pinned) target = row.columns.find((column) => column.id === keepId && column.width > MIN_WIDTH) ?? null;
    if (!target) return false;
    target.width -= 1;
    excess -= 1;
  }
  return true;
}

/**
 * Drops empty columns and rows. When a column disappears from a row that was
 * full, its neighbour (left, else right) takes over its width, so removing one
 * card of a pair leaves a full-width card rather than a half-empty row.
 */
function prune(layout: Layout): Layout {
  const rows: Row[] = [];
  for (const row of layout.rows) {
    const wasFull = rowWidth(row) >= GRID_COLUMNS;
    const columns: Column[] = [];
    let freed = 0;
    for (const column of row.columns) {
      if (column.widgets.length === 0) {
        if (wasFull) {
          // Give it to the column on the left when there is one…
          if (columns.length > 0) columns[columns.length - 1].width += column.width;
          else freed += column.width; // …else to the next kept column.
        }
        continue;
      }
      if (freed > 0) {
        column.width += freed;
        freed = 0;
      }
      columns.push(column);
    }
    if (columns.length > 0) {
      const keptRow: Row = { id: row.id, columns };
      if (row.rail) keptRow.rail = true;
      rows.push(keptRow);
    }
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// Editing operations
// ---------------------------------------------------------------------------

function detach(layout: Layout, widgetId: string): { layout: Layout; widget: WidgetInstance; width: number } | null {
  const next = clone(layout);
  const at = findWidget(next, widgetId);
  if (!at) return null;
  at.column.widgets.splice(at.widgetIndex, 1);
  return { layout: next, widget: at.widget, width: at.column.width };
}

/** Puts `widget` at `target` (ids refer to `layout`); null when the target no longer exists. */
function insertAt(layout: Layout, widget: WidgetInstance, width: number, target: DropTarget): Layout | null {
  if (target.kind === "stack") {
    for (const row of layout.rows) {
      const column = row.columns.find((c) => c.id === target.columnId);
      if (!column) continue;
      const index = target.beforeWidgetId === null ? column.widgets.length : column.widgets.findIndex((w) => w.id === target.beforeWidgetId);
      if (index < 0) return null;
      column.widgets.splice(index, 0, widget);
      return layout;
    }
    return null;
  }

  if (target.kind === "column") {
    const rowIndex = layout.rows.findIndex((r) => r.id === target.rowId);
    if (rowIndex < 0) return null;
    const row = layout.rows[rowIndex];
    const index = target.beforeColumnId === null ? row.columns.length : row.columns.findIndex((c) => c.id === target.beforeColumnId);
    if (index < 0) return null;
    const column: Column = { id: newId("c"), width: clampWidth(width), widgets: [widget] };
    row.columns.splice(index, 0, column);
    if (!fitRow(row, column.id)) {
      // Too many columns for this row: the widget opens a new row below it instead.
      row.columns.splice(index, 1);
      column.width = clampWidth(width);
      layout.rows.splice(rowIndex + 1, 0, { id: newId("r"), columns: [column] });
    }
    return layout;
  }

  const index = target.beforeRowId === null ? layout.rows.length : layout.rows.findIndex((r) => r.id === target.beforeRowId);
  if (index < 0) return null;
  layout.rows.splice(index, 0, { id: newId("r"), columns: [{ id: newId("c"), width: clampWidth(width), widgets: [widget] }] });
  return layout;
}

/**
 * Moves a widget to `target`, keeping its width (a column it lands in decides
 * its width; a new column or row gets the widget's old column width, shrinking
 * the row's widest columns when it doesn't fit). Returns the input unchanged
 * when nothing would move.
 */
export function moveWidget(layout: Layout, widgetId: string, target: DropTarget): Layout {
  const at = findWidget(layout, widgetId);
  if (!at) return layout;
  if (isNoopMove(layout, widgetId, target)) return layout;

  if (target.kind === "column" && target.rowId === at.row.id && at.column.widgets.length === 1) {
    const next = clone(layout);
    const row = next.rows[at.rowIndex];
    const [col] = row.columns.splice(at.columnIndex, 1);
    const insertIndex = target.beforeColumnId === null
      ? row.columns.length
      : row.columns.findIndex((c) => c.id === target.beforeColumnId);
    if (insertIndex < 0) return layout;
    row.columns.splice(insertIndex, 0, col);
    return next;
  }

  const detached = detach(layout, widgetId);
  if (!detached) return layout;
  // Resolve against the layout before pruning: the widget's own (now empty)
  // column or row may be the anchor, and pruning would merge widths first.
  const pruned = prune(detached.layout);
  const placed = insertAt(pruned, detached.widget, detached.width, resolveAnchor(detached.layout, pruned, target));
  return placed ?? layout;
}

/**
 * A target anchored on a column/row that pruning removed (the dragged widget's
 * own) is re-anchored on its next sibling, so "above my old row" still means
 * the same place.
 */
function resolveAnchor(before: Layout, after: Layout, target: DropTarget): DropTarget {
  if (target.kind === "row" && target.beforeRowId !== null && !after.rows.some((r) => r.id === target.beforeRowId)) {
    const index = before.rows.findIndex((r) => r.id === target.beforeRowId);
    const next = before.rows.slice(index + 1).find((r) => after.rows.some((a) => a.id === r.id));
    return { kind: "row", beforeRowId: next?.id ?? null };
  }
  if (target.kind === "column" && target.beforeColumnId !== null) {
    const row = after.rows.find((r) => r.id === target.rowId);
    if (row && !row.columns.some((c) => c.id === target.beforeColumnId)) {
      const original = before.rows.find((r) => r.id === target.rowId);
      const index = original?.columns.findIndex((c) => c.id === target.beforeColumnId) ?? -1;
      const next = original?.columns.slice(index + 1).find((c) => row.columns.some((a) => a.id === c.id));
      return { kind: "column", rowId: target.rowId, beforeColumnId: next?.id ?? null };
    }
  }
  return target;
}

/** True when dropping `widgetId` at `target` would leave the layout as it is. */
export function isNoopMove(layout: Layout, widgetId: string, target: DropTarget): boolean {
  const at = findWidget(layout, widgetId);
  if (!at) return true;
  const alone = at.column.widgets.length === 1;
  if (target.kind === "stack") {
    if (target.columnId !== at.column.id) return false;
    const next = at.column.widgets[at.widgetIndex + 1];
    return target.beforeWidgetId === widgetId || target.beforeWidgetId === (next?.id ?? null);
  }
  if (target.kind === "column") {
    if (!alone || target.rowId !== at.row.id) return false;
    const next = at.row.columns[at.columnIndex + 1];
    return target.beforeColumnId === at.column.id || target.beforeColumnId === (next?.id ?? null);
  }
  if (!alone || at.row.columns.length !== 1) return false;
  const next = layout.rows[at.rowIndex + 1];
  return target.beforeRowId === at.row.id || target.beforeRowId === (next?.id ?? null);
}

function columnSpan(r: Row, colIndex: number): [start: number, end: number] {
  let start = 0;
  for (let i = 0; i < colIndex; i++) {
    start += r.columns[i].width;
  }
  return [start, start + r.columns[colIndex].width];
}

function bestOverlapColumnIndex(row: Row, colIndex: number, otherRow: Row): number {
  const [s1, e1] = columnSpan(row, colIndex);
  let bestIndex = 0;
  let maxOverlap = -1;
  let start2 = 0;
  for (let j = 0; j < otherRow.columns.length; j++) {
    const w = otherRow.columns[j].width;
    const end2 = start2 + w;
    const overlap = Math.max(0, Math.min(e1, end2) - Math.max(s1, start2));
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestIndex = j;
    }
    start2 = end2;
  }
  return bestIndex;
}

/**
 * Keyboard / menu moves. Up/down reorder within the stack, then merge into
 * neighbouring stacks or rows (swapping full rows when lone); left/right swap
 * columns, merge into a neighbour stack, or split the widget out.
 */
export function moveWidgetStep(layout: Layout, widgetId: string, direction: MoveDirection): Layout {
  const at = findWidget(layout, widgetId);
  if (!at) return layout;
  const { row, column, rowIndex, columnIndex, widgetIndex } = at;
  const isLone = row.columns.length === 1 && column.widgets.length === 1;

  if (direction === "up") {
    // 1. Not first in its stack → swap with the card above.
    if (widgetIndex > 0) {
      const next = clone(layout);
      const widgets = next.rows[rowIndex].columns[columnIndex].widgets;
      [widgets[widgetIndex], widgets[widgetIndex - 1]] = [widgets[widgetIndex - 1], widgets[widgetIndex]];
      return next;
    }
    // 2. No row above → no-op.
    if (rowIndex === 0) return layout;
    const rowAbove = layout.rows[rowIndex - 1];

    // 3. Lone card:
    if (isLone) {
      if (column.width === GRID_COLUMNS) {
        const next = clone(layout);
        [next.rows[rowIndex], next.rows[rowIndex - 1]] = [next.rows[rowIndex - 1], next.rows[rowIndex]];
        return next;
      }
      const free = freeWidth(rowAbove);
      if (free >= MIN_WIDTH) {
        const next = clone(layout);
        const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
        const joinWidth = Math.min(column.width, free);
        next.rows[rowIndex - 1].columns.push({ id: newId("c"), width: joinWidth, widgets: [widget] });
        return prune(next);
      }
      // else → bottom of the row above's best-overlap stack.
      const targetColIdx = bestOverlapColumnIndex(row, columnIndex, rowAbove);
      const next = clone(layout);
      const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
      next.rows[rowIndex - 1].columns[targetColIdx].widgets.push(widget);
      return prune(next);
    }

    // 4. Otherwise (it shares its row and is first in its stack) → bottom of the row above's best-overlap stack.
    const targetColIdx = bestOverlapColumnIndex(row, columnIndex, rowAbove);
    const next = clone(layout);
    const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
    next.rows[rowIndex - 1].columns[targetColIdx].widgets.push(widget);
    return prune(next);
  }

  if (direction === "down") {
    // 1. Not last in its stack → swap with the card below.
    if (widgetIndex < column.widgets.length - 1) {
      const next = clone(layout);
      const widgets = next.rows[rowIndex].columns[columnIndex].widgets;
      [widgets[widgetIndex], widgets[widgetIndex + 1]] = [widgets[widgetIndex + 1], widgets[widgetIndex]];
      return next;
    }

    // 2. Lone card:
    if (isLone) {
      if (rowIndex === layout.rows.length - 1) return layout;
      if (column.width === GRID_COLUMNS) {
        const next = clone(layout);
        [next.rows[rowIndex], next.rows[rowIndex + 1]] = [next.rows[rowIndex + 1], next.rows[rowIndex]];
        return next;
      }
      const rowBelow = layout.rows[rowIndex + 1];
      const free = freeWidth(rowBelow);
      if (free >= MIN_WIDTH) {
        const next = clone(layout);
        const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
        const joinWidth = Math.min(column.width, free);
        next.rows[rowIndex + 1].columns.push({ id: newId("c"), width: joinWidth, widgets: [widget] });
        return prune(next);
      }
      // else → top of its best-overlap stack.
      const targetColIdx = bestOverlapColumnIndex(row, columnIndex, rowBelow);
      const next = clone(layout);
      const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
      next.rows[rowIndex + 1].columns[targetColIdx].widgets.unshift(widget);
      return prune(next);
    }

    // 3. It shares its row and is last in its stack:
    if (rowIndex < layout.rows.length - 1) {
      const rowBelow = layout.rows[rowIndex + 1];
      const targetColIdx = bestOverlapColumnIndex(row, columnIndex, rowBelow);
      const next = clone(layout);
      const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
      next.rows[rowIndex + 1].columns[targetColIdx].widgets.unshift(widget);
      return prune(next);
    }
    // no row below → split into a new last row (keeps its column width).
    const next = clone(layout);
    const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
    next.rows.push({ id: newId("r"), columns: [{ id: newId("c"), width: column.width, widgets: [widget] }] });
    return prune(next);
  }

  // LEFT / RIGHT
  const step = direction === "left" ? -1 : 1;
  const neighbour = row.columns[columnIndex + step];
  if (neighbour) {
    if (column.widgets.length === 1) {
      // alone in its column → swap the columns (widths travel with them);
      const next = clone(layout);
      const columns = next.rows[rowIndex].columns;
      [columns[columnIndex], columns[columnIndex + step]] = [columns[columnIndex + step], columns[columnIndex]];
      return next;
    }
    // else → into the neighbour's stack at min(own index, neighbour length).
    const next = clone(layout);
    const [widget] = next.rows[rowIndex].columns[columnIndex].widgets.splice(widgetIndex, 1);
    const targetCol = next.rows[rowIndex].columns[columnIndex + step];
    const insertIdx = Math.min(widgetIndex, targetCol.widgets.length);
    targetCol.widgets.splice(insertIdx, 0, widget);
    return prune(next);
  }

  // No neighbour:
  if (column.widgets.length > 1) {
    // it shares its column → split into a new column at that edge (today's behaviour: new column gets the old width, then fitRow);
    const beforeColumnId = direction === "left" ? column.id : null;
    return moveWidget(layout, widgetId, { kind: "column", rowId: row.id, beforeColumnId });
  }
  // else → no-op.
  return layout;
}

export function canMoveStep(layout: Layout, widgetId: string, direction: MoveDirection): boolean {
  return moveWidgetStep(layout, widgetId, direction) !== layout;
}

export function removeWidget(layout: Layout, widgetId: string): Layout {
  const detached = detach(layout, widgetId);
  return detached ? prune(detached.layout) : layout;
}

/**
 * Sets a column's width from a preset: takes free room in the row first, then
 * narrows the other columns (widest first). The full width (12) can't share a
 * row, so a widget asking for it moves to a row of its own just below.
 */
export function setWidgetWidth(layout: Layout, widgetId: string, width: number): Layout {
  const at = findWidget(layout, widgetId);
  if (!at) return layout;
  const wanted = clampWidth(width);
  if (wanted === GRID_COLUMNS && at.column.widgets.length > 1) {
    const moved = clone(moveWidget(layout, widgetId, { kind: "row", beforeRowId: layout.rows[at.rowIndex + 1]?.id ?? null }));
    const target = findWidget(moved, widgetId);
    if (!target) return layout;
    target.column.width = GRID_COLUMNS;
    return moved;
  }
  if (at.column.width === wanted) return layout;
  const others = at.row.columns.length - 1;
  if (others * MIN_WIDTH + wanted > GRID_COLUMNS) {
    // No room beside the other columns: a row of its own, right below this one.
    const moved = clone(moveWidget(layout, widgetId, { kind: "row", beforeRowId: layout.rows[at.rowIndex + 1]?.id ?? null }));
    const target = findWidget(moved, widgetId);
    if (!target) return layout;
    target.column.width = wanted;
    return moved;
  }
  const next = clone(layout);
  const target = findWidget(next, widgetId);
  if (!target) return layout;
  target.column.width = wanted;
  fitRow(target.row, target.column.id, true);
  return next;
}

/**
 * Drag on a column's right edge. In a full row the edge is a divider (the next
 * column gives or takes the width); in a row with free room the column grows
 * into that room first, then narrows the column(s) after it.
 */
export function resizeColumn(layout: Layout, columnId: string, width: number): Layout {
  const next = clone(layout);
  for (const row of next.rows) {
    const index = row.columns.findIndex((c) => c.id === columnId);
    if (index < 0) continue;
    const column = row.columns[index];
    const after = row.columns.slice(index + 1);
    const full = rowWidth(row) >= GRID_COLUMNS;
    const free = GRID_COLUMNS - rowWidth(row);
    const room = free + after.reduce((sum, c) => sum + (c.width - MIN_WIDTH), 0);
    const wanted = Math.min(column.width + room, clampWidth(width));
    if (wanted === column.width) return layout;
    const delta = wanted - column.width;
    column.width = wanted;
    if (delta > 0) {
      let take = full ? delta : delta - free;
      for (const other of after) {
        if (take <= 0) break;
        const give = Math.min(take, other.width - MIN_WIDTH);
        other.width -= give;
        take -= give;
      }
    } else if (full && after.length > 0) {
      after[0].width -= delta; // divider: the neighbour takes what this column gave up
    }
    return next;
  }
  return layout;
}

export function setWidgetHeight(layout: Layout, widgetId: string, height: number | null): Layout {
  const next = clone(layout);
  const at = findWidget(next, widgetId);
  if (!at) return layout;
  const value = height === null ? undefined : clampHeight(height);
  if (at.widget.height === value) return layout;
  if (value === undefined) delete at.widget.height;
  else at.widget.height = value;
  return next;
}

export function updateWidget(
  layout: Layout,
  widgetId: string,
  patch: { ticker?: string | null; options?: Record<string, OptionValue | null> },
): Layout {
  const at = findWidget(layout, widgetId);
  if (!at) return layout;
  const original = at.widget;

  let newTicker: string | undefined = original.ticker;
  if (patch.ticker !== undefined) {
    const normalized = patch.ticker === null ? null : normalizeTicker(patch.ticker);
    newTicker = normalized ?? undefined;
  }

  let newOptions: Record<string, OptionValue> | undefined = original.options ? { ...original.options } : undefined;
  if (patch.options) {
    const opts: Record<string, OptionValue> = { ...(original.options ?? {}) };
    for (const [key, value] of Object.entries(patch.options)) {
      if (value === null) {
        delete opts[key];
      } else {
        opts[key] = typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : value;
      }
    }
    newOptions = Object.keys(opts).length > 0 ? opts : undefined;
  }

  const tickerSame = original.ticker === newTicker;
  const origOpts = original.options ?? {};
  const nextOpts = newOptions ?? {};
  const origKeys = Object.keys(origOpts);
  const nextKeys = Object.keys(nextOpts);
  let optionsSame = origKeys.length === nextKeys.length;
  if (optionsSame) {
    for (const k of origKeys) {
      if (origOpts[k] !== nextOpts[k]) {
        optionsSame = false;
        break;
      }
    }
  }

  if (tickerSame && optionsSame) return layout;

  const next = clone(layout);
  const target = findWidget(next, widgetId)!.widget;
  if (newTicker !== undefined) target.ticker = newTicker;
  else delete target.ticker;
  if (newOptions !== undefined) target.options = newOptions;
  else delete target.options;
  return next;
}

/** Appends a widget: beside the last row's columns when it fits there, else in a new row. */
export function addWidget(layout: Layout, widget: Omit<WidgetInstance, "id">, width: number): { layout: Layout; id: string } {
  const id = newId("w");
  const instance: WidgetInstance = { ...widget, id };
  const next = clone(layout);
  const w = clampWidth(width);
  const last = next.rows[next.rows.length - 1];
  if (last && rowWidth(last) + w <= GRID_COLUMNS) {
    last.columns.push({ id: newId("c"), width: w, widgets: [instance] });
  } else {
    next.rows.push({ id: newId("r"), columns: [{ id: newId("c"), width: w, widgets: [instance] }] });
  }
  return { layout: next, id };
}

/** Adds a widget at a specific place (the "+" in a row's free room, between rows…). */
export function insertWidget(layout: Layout, widget: Omit<WidgetInstance, "id">, width: number, target: DropTarget): { layout: Layout; id: string } {
  const id = newId("w");
  const placed = insertAt(clone(layout), { ...widget, id }, width, target);
  return placed ? { layout: placed, id } : addWidget(layout, widget, width);
}

/** Unused width at the end of each row (0 = full). */
export function freeWidth(row: Row): number {
  return Math.max(0, GRID_COLUMNS - rowWidth(row));
}

/** A copy with fresh ids — for templates and duplicated pages. */
export function withFreshIds(layout: Layout): Layout {
  return {
    rows: layout.rows.map((row) => {
      const r: Row = {
        id: newId("r"),
        columns: row.columns.map((column) => ({
          id: newId("c"),
          width: column.width,
          widgets: column.widgets.map((w) => ({ ...w, options: w.options ? { ...w.options } : undefined, id: newId("w") })),
        })),
      };
      if (row.rail) r.rail = true;
      return r;
    }),
  };
}

// ---------------------------------------------------------------------------
// Building and validating
// ---------------------------------------------------------------------------

/** Shorthand for default layouts: `row([6, "stock.ratios"], [6, "stock.signals", "stock.news"])`. */
export type ColumnSpec = [width: number, ...widgets: Array<string | Omit<WidgetInstance, "id">>];

export type RowSpec = ColumnSpec[] | { rail: true; columns: [ColumnSpec, ColumnSpec] };

export function row(...columns: ColumnSpec[]): ColumnSpec[] {
  return columns;
}

export function railRow(main: ColumnSpec, rail: ColumnSpec): { rail: true; columns: [ColumnSpec, ColumnSpec] } {
  return { rail: true, columns: [main, rail] };
}

/** Builds a layout with deterministic ids (stable across server and client renders). */
export function buildLayout(prefix: string, rows: RowSpec[]): Layout {
  let widgetIndex = 0;
  return {
    rows: rows.map((rowSpec, r) => {
      const isRail = !Array.isArray(rowSpec) && rowSpec.rail === true;
      const columns = Array.isArray(rowSpec) ? rowSpec : rowSpec.columns;
      const rowObj: Row = {
        id: `${prefix}-r${r}`,
        columns: columns.map(([width, ...widgets], c) => ({
          id: `${prefix}-r${r}c${c}`,
          width,
          widgets: widgets.map((spec) => {
            const id = `${prefix}-w${widgetIndex++}`;
            return typeof spec === "string" ? { id, type: spec } : { ...spec, id };
          }),
        })),
      };
      if (isRail) rowObj.rail = true;
      return rowObj;
    }),
  };
}

export function normalizeTicker(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return TICKER_RE.test(ticker) ? ticker : null;
}

function sanitizeOptions(raw: unknown): Record<string, OptionValue> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const options: Record<string, OptionValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_OPTION_KEYS || !/^[a-zA-Z][\w-]{0,31}$/.test(key)) continue;
    if (typeof value === "string") options[key] = value.slice(0, MAX_TEXT_LENGTH);
    else if (typeof value === "boolean") options[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) options[key] = value;
    else continue;
    count++;
  }
  return count > 0 ? options : undefined;
}

const ID_RE = /^[\w-]{1,64}$/;

/**
 * Validates untrusted storage content: unknown widget types are dropped, ids
 * are made unique, widths clamped and over-full rows fitted (or split).
 * Returns null when nothing usable remains.
 */
export function sanitizeLayout(raw: unknown, isKnownType: (type: string) => boolean): Layout | null {
  if (!raw || typeof raw !== "object") return null;
  const rawRows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rawRows)) return null;
  if (rawRows.length === 0) return { rows: [] };
  const seen = new Set<string>();
  const uniqueId = (value: unknown, prefix: "w" | "c" | "r") => {
    const id = typeof value === "string" && ID_RE.test(value) && !seen.has(value) ? value : newId(prefix);
    seen.add(id);
    return id;
  };
  const rows: Row[] = [];
  let widgets = 0;
  for (const rawRow of rawRows) {
    if (rows.length >= MAX_ROWS || widgets >= MAX_WIDGETS) break;
    if (!rawRow || typeof rawRow !== "object") continue;
    const isRail = (rawRow as { rail?: unknown }).rail === true;
    const rawColumns = (rawRow as { columns?: unknown }).columns;
    if (!Array.isArray(rawColumns)) continue;
    const columns: Column[] = [];
    for (const rawColumn of rawColumns) {
      if (!rawColumn || typeof rawColumn !== "object") continue;
      const { id, width, widgets: rawWidgets } = rawColumn as Record<string, unknown>;
      if (!Array.isArray(rawWidgets)) continue;
      const stack: WidgetInstance[] = [];
      for (const rawWidget of rawWidgets) {
        if (widgets >= MAX_WIDGETS) break;
        if (!rawWidget || typeof rawWidget !== "object") continue;
        const w = rawWidget as Record<string, unknown>;
        if (typeof w.type !== "string" || !isKnownType(w.type)) continue;
        const instance: WidgetInstance = { id: uniqueId(w.id, "w"), type: w.type };
        if (typeof w.height === "number" && Number.isFinite(w.height)) instance.height = clampHeight(w.height);
        const ticker = normalizeTicker(w.ticker);
        if (ticker) instance.ticker = ticker;
        const options = sanitizeOptions(w.options);
        if (options) instance.options = options;
        stack.push(instance);
        widgets++;
      }
      if (stack.length === 0) continue;
      const span = typeof width === "number" && Number.isFinite(width) ? clampWidth(width) : GRID_COLUMNS;
      columns.push({ id: uniqueId(id, "c"), width: span, widgets: stack });
    }
    if (columns.length === 0) continue;
    // A row with more columns than the grid holds continues in the next one.
    let current: Row = { id: uniqueId((rawRow as { id?: unknown }).id, "r"), columns: [] };
    if (isRail) current.rail = true;
    for (const column of columns) {
      if ((current.columns.length + 1) * MIN_WIDTH > GRID_COLUMNS) {
        rows.push(current);
        current = { id: newId("r"), columns: [] };
      }
      current.columns.push(column);
      fitRow(current, null);
    }
    rows.push(current);
  }
  return rows.length > 0 ? { rows } : null;
}
