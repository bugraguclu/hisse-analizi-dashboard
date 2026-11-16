export const DASHBOARD_COLUMNS = 6;
export const DASHBOARD_ROW_STEP = 32;
export const DASHBOARD_GAP = 16;
export const DASHBOARD_DESKTOP_QUERY = "(min-width: 64rem)";
export const MAX_GRID_ROWS = 128;
export const CARD_IDS = ["index", "watchlist", "breadth", "events"] as const;

export type CardId = (typeof CARD_IDS)[number];
export type LayoutItem = Readonly<{ id: CardId; x: number; y: number; w: number; h: number }>;
export type DashboardLayout = readonly LayoutItem[];
export type LayoutChange = "move" | "resize";

const LAYOUT_VERSION = 1;

export const CARD_LIMITS = {
  // Shorter than this, the chart's own controls leave no room for the plot.
  index: { minW: 3, minH: 15, maxH: 28 },
  watchlist: { minW: 2, minH: 10, maxH: 28 },
  breadth: { minW: 2, minH: 8, maxH: 28 },
  events: { minW: 2, minH: 7, maxH: 28 },
} as const;

export const DEFAULT_LAYOUT: DashboardLayout = [
  { id: "index", x: 0, y: 0, w: 4, h: 15 },
  { id: "watchlist", x: 4, y: 0, w: 2, h: 10 },
  { id: "breadth", x: 4, y: 10, w: 2, h: 16 },
  { id: "events", x: 0, y: 15, w: 4, h: 13 },
];

/** Visual top-to-bottom order doubles as the reading order when cards stack. */
export function readingOrder(layout: DashboardLayout): LayoutItem[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x || CARD_IDS.indexOf(a.id) - CARD_IDS.indexOf(b.id));
}

/** Rows the layout occupies, from the top of the grid to the bottom of its lowest card. */
export function layoutRows(layout: DashboardLayout): number {
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

export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  return a === b || (a.length === b.length && a.every((item) => {
    const other = b.find(({ id }) => id === item.id);
    return other !== undefined && other.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h;
  }));
}

/** The same array is returned when nothing moved, so callers can compare by identity. */
function applied(layout: DashboardLayout, placed: readonly LayoutItem[] | null): DashboardLayout {
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
export function moveCard(layout: DashboardLayout, id: CardId, x: number, y: number): DashboardLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const target = {
    ...current,
    x: bounded(x, current.x, 0, DASHBOARD_COLUMNS - current.w),
    y: bounded(y, current.y, 0, MAX_GRID_ROWS - current.h),
  };
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

/** Resize a card from its bottom-right corner. Its top-left corner never moves. */
export function resizeCard(layout: DashboardLayout, id: CardId, w: number, h: number): DashboardLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;

  const { minW, minH, maxH } = CARD_LIMITS[id];
  const target = {
    ...current,
    w: bounded(w, current.w, minW, DASHBOARD_COLUMNS - current.x),
    h: bounded(h, current.h, minH, maxH),
  };
  return applied(layout, stack(readingOrder(layout).filter((item) => item.id !== id), [target]));
}

/**
 * One keyboard or menu step. A resize changes one column or row. A move goes
 * on until the layout actually changes, because gravity undoes a single row.
 */
export function nudgeCard(layout: DashboardLayout, id: CardId, change: LayoutChange, dx: number, dy: number): DashboardLayout {
  const current = layout.find((item) => item.id === id);
  if (!current) return layout;
  if (change === "resize") return resizeCard(layout, id, current.w + dx, current.h + dy);

  const reach = dy === 0 ? 1 : layoutRows(layout);
  for (let step = 1; step <= reach; step++) {
    const next = moveCard(layout, id, current.x + dx * step, current.y + dy * step);
    if (next !== layout) return next;
  }
  return layout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gridInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function parseItem(value: unknown): LayoutItem | null {
  if (!isRecord(value)) return null;
  const id = CARD_IDS.find((candidate) => candidate === value.id);
  if (!id) return null;

  const { x, y } = value;
  if (!gridInteger(value.w, 1, DASHBOARD_COLUMNS) || !gridInteger(value.h, 1, MAX_GRID_ROWS)) return null;
  if (!gridInteger(x, 0, DASHBOARD_COLUMNS - 1) || !gridInteger(y, 0, MAX_GRID_ROWS - 1)) return null;
  // Sizes saved under earlier limits are brought inside the current ones.
  const { minW, minH, maxH } = CARD_LIMITS[id];
  const w = Math.max(minW, value.w);
  const h = Math.max(minH, Math.min(value.h, maxH));
  return { id, x: Math.min(x, DASHBOARD_COLUMNS - w), y, w, h };
}

/** Read a saved layout. Unknown cards are dropped, missing ones are appended and gaps are closed. */
export function parseLayout(raw: string | null): DashboardLayout | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(stored) || stored.version !== LAYOUT_VERSION || !Array.isArray(stored.items)) return null;

  const saved = new Map<CardId, LayoutItem>();
  for (const value of stored.items) {
    const item = parseItem(value);
    if (item && !saved.has(item.id)) saved.set(item.id, item);
    if (saved.size === CARD_IDS.length) break;
  }
  if (saved.size === 0) return null;

  const missing = DEFAULT_LAYOUT.filter(({ id }) => !saved.has(id));
  const placed = stack([...readingOrder([...saved.values()]), ...missing]);
  if (placed === null) return null;
  return DEFAULT_LAYOUT.map((item) => placed.find((position) => position.id === item.id) ?? item);
}

export function serializeLayout(layout: DashboardLayout): string {
  return JSON.stringify({ version: LAYOUT_VERSION, items: layout });
}
