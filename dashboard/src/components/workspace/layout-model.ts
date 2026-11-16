export const WORKSPACE_COLUMNS = 6;
export const WORKSPACE_ROW_STEP = 32;
export const WORKSPACE_GAP = 16;
export const WORKSPACE_DESKTOP_QUERY = "(min-width: 64rem)";
export const MAX_GRID_ROWS = 1024;

export type LayoutItem = Readonly<{ id: string; x: number; y: number; w: number; h: number }>;
export type WorkspaceLayout = readonly LayoutItem[];
export type LayoutChange = "move" | "resize";
/**
 * Sizes a card may be resized to, in columns and rows. A card that hugs its
 * content takes its height from that content, so only its width can be changed.
 */
export type CardLimits = Readonly<{ minW: number; minH: number; maxH: number; hug?: boolean }>;
export type Limits = (id: string) => CardLimits;

const LAYOUT_VERSION = 1;

export const DEFAULT_LIMITS: CardLimits = { minW: 2, minH: 5, maxH: 40 };

/** Visual top-to-bottom order doubles as the reading order when cards stack. */
export function readingOrder(layout: WorkspaceLayout): LayoutItem[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Rows the layout occupies, from the top of the grid to the bottom of its lowest card. */
export function layoutRows(layout: WorkspaceLayout): number {
  return Math.max(0, ...layout.map(({ y, h }) => y + h));
}

function sharesColumns(a: LayoutItem, b: LayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w;
}

/**
 * Cards have gravity toward the top of the grid: a card first drops below
 * whatever occupies its rows, then rises until the nearest card above stops it.
 */
function settle(item: LayoutItem, placed: readonly LayoutItem[]): LayoutItem {
  const column = placed.filter((other) => sharesColumns(item, other));
  let y = item.y;
  for (let blocked = true; blocked; ) {
    blocked = false;
    for (const other of column) {
      if (y < other.y + other.h && other.y < y + item.h) {
        y = other.y + other.h;
        blocked = true;
      }
    }
  }
  y = Math.max(0, ...column.filter((other) => other.y + other.h <= y).map((other) => other.y + other.h));
  return y === item.y ? item : { ...item, y };
}

/** Settle the cards one after another; earlier cards claim the higher rows. */
function stack(order: readonly LayoutItem[], pinned: readonly LayoutItem[] = []): LayoutItem[] | null {
  const placed = [...pinned];
  for (const item of order) placed.push(settle(item, placed));
  return layoutRows(placed) > MAX_GRID_ROWS ? null : placed;
}

function bounded(value: number, previous: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? Math.round(value) : previous;
  return Math.max(min, Math.min(next, max));
}

export function sameLayout(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return a === b || (a.length === b.length && a.every((item) => {
    const other = b.find(({ id }) => id === item.id);
    return other !== undefined && other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  }));
}

/** The same array is returned when nothing moved, so callers can compare by identity. */
function applied(layout: WorkspaceLayout, placed: readonly LayoutItem[] | null): WorkspaceLayout {
  if (placed === null) return layout;
  const next = layout.map((item) => placed.find(({ id }) => id === item.id) ?? item);
  return sameLayout(next, layout) ? layout : next;
}

/**
 * Move a card to a grid cell. The card takes the first free rows at or below
 * that cell and every other card closes the gap it left.
 *
 * A neighbour swaps sides once the dragged card crosses its vertical midpoint:
 * the bottom edge leads when the card is pushed down onto the cards stacked
 * beneath it, the top edge (where the handle is) leads everywhere else.
 */
export function moveCard(layout: WorkspaceLayout, id: string, x: number, y: number): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const target = {
    ...current,
    x: bounded(x, current.x, 0, WORKSPACE_COLUMNS - current.w),
    y: bounded(y, current.y, 0, MAX_GRID_ROWS - current.h),
  };
  if (target.x === current.x && target.y === current.y) return layout;

  const above: LayoutItem[] = [];
  const below: LayoutItem[] = [];
  for (const other of readingOrder(layout)) {
    if (other.id === id) continue;
    const middle = other.y + other.h / 2;
    const stackedBeneath = other.y >= current.y + current.h && sharesColumns(other, current);
    const staysAbove = stackedBeneath ? middle < target.y + target.h : middle <= target.y;
    (staysAbove ? above : below).push(other);
  }
  return applied(layout, stack([...above, target, ...below]));
}

/** Resize a card from its bottom-right corner, then close any gaps it leaves. */
export function resizeCard(layout: WorkspaceLayout, id: string, w: number, h: number, limits: Limits): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const { minW, minH, maxH, hug } = limits(id);
  const target = {
    ...current,
    w: bounded(w, current.w, Math.min(minW, WORKSPACE_COLUMNS - current.x), WORKSPACE_COLUMNS - current.x),
    h: hug ? current.h : bounded(h, current.h, minH, maxH),
  };
  if (target.w === current.w && target.h === current.h) return layout;
  const placed = stack(readingOrder(layout).filter((item) => item.id !== id), [target]);
  // Pack again if the new width removed support under the resized card or a neighbour.
  return applied(layout, placed && stack(readingOrder(placed)));
}

/**
 * One keyboard or menu step. A resize changes one column or row. A move goes
 * on until the layout actually changes, because gravity undoes a single row.
 */
export function nudgeCard(
  layout: WorkspaceLayout,
  id: string,
  change: LayoutChange,
  dx: number,
  dy: number,
  limits: Limits,
): WorkspaceLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;
  if (change === "resize") return resizeCard(layout, id, current.w + dx, current.h + dy, limits);

  const reach = dy === 0 ? 1 : layoutRows(layout);
  for (let step = 1; step <= reach; step++) {
    const next = moveCard(layout, id, current.x + dx * step, current.y + dy * step);
    if (next !== layout) return next;
  }
  return layout;
}

/** Close every gap, keeping the cards in their reading order. */
export function packLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return applied(layout, stack(readingOrder(layout)));
}

/**
 * Give cards that hug their content the heights measured on screen. The cards
 * beneath them follow, so a strip that grows a line never covers its neighbour.
 */
export function fitHeights(layout: WorkspaceLayout, heights: ReadonlyMap<string, number>): WorkspaceLayout {
  if (heights.size === 0) return layout;
  const sized = layout.map((item) => {
    const h = heights.get(item.id);
    return h === undefined || h === item.h || h < 1 ? item : { ...item, h };
  });
  return applied(layout, stack(readingOrder(sized)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gridInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseItem(value: unknown, ids: readonly string[], limits: Limits): LayoutItem | null {
  if (!isRecord(value)) return null;
  const id = ids.find((candidate) => candidate === value.id);
  if (id === undefined) return null;

  const { x, y } = value;
  if (!gridInteger(value.w, 1, WORKSPACE_COLUMNS) || !gridInteger(value.h, 1, MAX_GRID_ROWS)) return null;
  if (!gridInteger(x, 0, WORKSPACE_COLUMNS - 1) || !gridInteger(y, 0, MAX_GRID_ROWS - 1)) return null;
  // Sizes saved under earlier limits are brought inside the current ones.
  const { minW, minH, maxH, hug } = limits(id);
  const w = Math.max(minW, value.w);
  const h = hug ? value.h : Math.max(minH, Math.min(value.h, maxH));
  return { id, x: Math.min(x, WORKSPACE_COLUMNS - w), y, w, h };
}

/**
 * Read a saved layout for the cards a page has today. Cards the page no longer
 * has are dropped, new ones are appended full width and gaps are closed.
 */
export function parseLayout(raw: string | null, ids: readonly string[], limits: Limits): WorkspaceLayout | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(stored) || stored.version !== LAYOUT_VERSION || !Array.isArray(stored.items)) return null;

  const saved = new Map<string, LayoutItem>();
  for (const value of stored.items) {
    const item = parseItem(value, ids, limits);
    if (item && !saved.has(item.id)) saved.set(item.id, item);
  }
  if (saved.size === 0) return null;

  const bottom = layoutRows([...saved.values()]);
  const added = ids
    .filter((id) => !saved.has(id))
    .map((id) => ({ id, x: 0, y: bottom, w: WORKSPACE_COLUMNS, h: Math.max(limits(id).minH, 10) }));
  const placed = stack([...readingOrder([...saved.values()]), ...added]);
  if (placed === null) return null;
  return ids.flatMap((id) => placed.find((position) => position.id === id) ?? []);
}

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify({ version: LAYOUT_VERSION, items: layout });
}
