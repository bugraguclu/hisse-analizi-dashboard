import type { BuiltInPage } from "./defaults";
import { GRID_COLUMNS, clampWidgetHeight, widgetsInOrder, type Layout, type Row, type WidgetInstance } from "./model";

const stockCards = {
  quote: "stock.quote",
  chart: "stock.chart",
  scorecard: "stock.scorecard",
  analysts: "stock.analysts",
  kap: "stock.kap",
  news: "stock.news",
  ratios: "stock.ratios",
  signals: "stock.signals",
  sector: "stock.sector",
  dividends: "stock.dividends",
  earnings: "stock.earnings",
  statements: "stock.statements",
  profile: "stock.profile",
  holders: "stock.holders",
  summary: "stock.technicalSummary",
  averages: "stock.movingAverages",
  indicators: "stock.indicators",
  pivots: "stock.pivots",
};

const sources = {
  home: {
    key: "hisse.dashboard.layout",
    cards: {
      index: "market.index",
      watchlist: "market.watchlist",
      breadth: "market.breadth",
      events: "market.events",
    },
  },
  macro: {
    key: "hisse.layout.macro",
    cards: {
      kpi: "macro.kpis",
      corridor: "macro.corridor",
      policy: "macro.policyInflation",
      inflation: "macro.inflationTiles",
      trend: "macro.inflationTrend",
      monthly: "macro.monthlyCpi",
      markets: "macro.markets",
      calendar: "macro.calendar",
      activity: "macro.activity",
      external: "macro.external",
    },
  },
  "stock.overview": { key: "hisse.layout.stock-overview", cards: stockCards },
  "stock.fundamental": { key: "hisse.layout.stock-fundamental", cards: stockCards },
  "stock.technical": { key: "hisse.layout.stock-technical", cards: stockCards },
  "stock.combined": { key: "hisse.layout.stock-combined", cards: stockCards },
} satisfies Record<BuiltInPage, { key: string; cards: Record<string, string> }>;

/**
 * Cards the old editor sized to their content ("hug"): the height saved for
 * them was measured for one stock at one moment, so they stay auto height.
 */
const naturalHeight = new Set([
  "stock.quote",
  "stock.scorecard",
  "stock.analysts",
  "stock.ratios",
  "stock.signals",
  "stock.earnings",
  "stock.holders",
  "stock.profile",
  "stock.technicalSummary",
  "stock.movingAverages",
  "stock.indicators",
  "stock.pivots",
  "macro.kpis",
  "macro.corridor",
  "macro.inflationTiles",
  "macro.markets",
  "macro.calendar",
  "macro.activity",
  "macro.external",
]);

/** Old grid: 6 columns, 32px row pitch with a 16px gap. */
const OLD_COLUMNS = 6;
const SPAN = GRID_COLUMNS / OLD_COLUMNS;

type SavedCard = { x: number; y: number; w: number; h: number; widget: WidgetInstance };

function isGridInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function savedCards(raw: string, mapping: Readonly<Record<string, string>>, widgets: readonly WidgetInstance[]): SavedCard[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 ||
      !("items" in data) || !Array.isArray(data.items)) return [];

  const defaultsByType = new Map(widgets.map((widget) => [widget.type, widget]));
  const found = new Map<string, SavedCard>();
  for (const item of data.items) {
    if (!item || typeof item !== "object") continue;
    const { id, x, y, w, h } = item as Record<string, unknown>;
    if (typeof id !== "string" || !Object.hasOwn(mapping, id)) continue;
    const widget = defaultsByType.get(mapping[id]);
    if (!widget || found.has(widget.id)) continue;
    if (!isGridInteger(w, 1, OLD_COLUMNS) || !isGridInteger(x, 0, OLD_COLUMNS - w) ||
        !isGridInteger(h, 1, 1024) || !isGridInteger(y, 0, 1024 - h)) continue;
    found.set(widget.id, { x, y, w, h, widget });
  }
  return [...found.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Bands of cards that overlap vertically (a tall card and the cards stacked
 * beside it). Within a band, cards whose horizontal spans overlap form one
 * column, top to bottom; columns keep their left-to-right order.
 */
function bands(cards: readonly SavedCard[]): SavedCard[][][] {
  const result: SavedCard[][][] = [];
  let band: SavedCard[] = [];
  let bottom = -1;
  const close = () => {
    if (band.length === 0) return;
    const columns: Array<{ left: number; right: number; cards: SavedCard[] }> = [];
    for (const card of band) {
      const right = card.x + card.w;
      const overlapping = columns.filter((column) => card.x < column.right && right > column.left);
      const merged = { left: card.x, right, cards: [card] };
      for (const column of overlapping) {
        merged.left = Math.min(merged.left, column.left);
        merged.right = Math.max(merged.right, column.right);
        merged.cards.push(...column.cards);
        columns.splice(columns.indexOf(column), 1);
      }
      columns.push(merged);
    }
    columns.sort((a, b) => a.left - b.left);
    result.push(columns.map((column) => column.cards.sort((a, b) => a.y - b.y || a.x - b.x)));
    band = [];
  };
  for (const card of cards) {
    if (band.length > 0 && card.y >= bottom) close();
    band.push(card);
    bottom = Math.max(band.length === 1 ? 0 : bottom, card.y + card.h);
  }
  close();
  return result;
}

/**
 * The old editor used free placement on a 6-column grid. The widget editor
 * stacks 12-column rows of columns, so each band of the old grid becomes a row
 * and cards stacked in one old column share a column. Cards the old layout did
 * not have (section headings, newer widgets) go in front of the row holding
 * the card they precede by default, never inside it.
 */
export function readWorkspaceLayout(
  page: BuiltInPage,
  defaults: Layout,
  read: (key: string) => string | null,
): Layout | null {
  const source = sources[page];
  const raw = read(source.key);
  if (!raw) return null;
  const defaultWidgets = widgetsInOrder(defaults);
  const cards = savedCards(raw, source.cards, defaultWidgets);
  if (cards.length === 0) return null;

  const migratedIds = new Set(cards.map(({ widget }) => widget.id));
  const extrasBefore = new Map<string, WidgetInstance[]>();
  let extras: WidgetInstance[] = [];
  for (const widget of defaultWidgets) {
    if (!migratedIds.has(widget.id)) {
      extras.push(widget);
    } else if (extras.length > 0) {
      extrasBefore.set(widget.id, extras);
      extras = [];
    }
  }
  const defaultWidth = (widget: WidgetInstance) =>
    defaults.rows.flatMap((entry) => entry.columns).find((column) => column.widgets.includes(widget))?.width ?? GRID_COLUMNS;

  const rows: Row[] = [];
  const prefix = `workspace-${page.replace(".", "-")}`;
  let extraRow: Row | null = null;
  function addRow(): Row {
    const row: Row = { id: `${prefix}-r${rows.length}`, columns: [] };
    rows.push(row);
    return row;
  }
  // Extras in a run share rows where they fit, as on the default page; headings stay alone.
  function addExtra(widget: WidgetInstance) {
    const width = defaultWidth(widget);
    const heading = widget.type === "general.heading";
    const fits = extraRow && !heading && extraRow.columns.reduce((sum, column) => sum + column.width, 0) + width <= GRID_COLUMNS &&
      extraRow.columns[0].widgets[0].type !== "general.heading";
    const row = fits && extraRow ? extraRow : addRow();
    row.columns.push({ id: `${row.id}c${row.columns.length}`, width, widgets: [widget] });
    extraRow = row;
  }

  for (const columns of bands(cards)) {
    const before = columns.flat().sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap(({ widget }) => extrasBefore.get(widget.id) ?? []);
    before.forEach(addExtra);
    extraRow = null;
    const row = addRow();
    for (const stack of columns) {
      const left = Math.min(...stack.map((card) => card.x));
      const right = Math.max(...stack.map((card) => card.x + card.w));
      row.columns.push({
        id: `${row.id}c${row.columns.length}`,
        width: (right - left) * SPAN,
        widgets: stack.map(({ widget, h }) => (naturalHeight.has(widget.type) ? { ...widget } : { ...widget, height: clampWidgetHeight(widget, h * 32 - 16) })),
      });
    }
    // The home page's chart-and-feed beside watchlist-and-breadth is a rail (phone order kept).
    if (page === "home" && row.columns.length === 2 && row.columns[0].widgets.length >= 2) row.rail = true;
  }
  extras.forEach(addExtra);
  return { rows };
}

export type WorkspaceOverrides = Partial<Record<BuiltInPage, Layout>> & { workspaceMigrated?: true };

/** Preserve existing widget layouts, including pages intentionally left empty. */
export function migrateWorkspaceOverrides(
  current: WorkspaceOverrides,
  defaults: Readonly<Record<BuiltInPage, Layout>>,
  read: (key: string) => string | null,
): WorkspaceOverrides {
  if (current.workspaceMigrated) return current;
  const next: WorkspaceOverrides = { ...current, workspaceMigrated: true };
  try {
    for (const page of Object.keys(defaults) as BuiltInPage[]) {
      if (next[page]) continue;
      const layout = readWorkspaceLayout(page, defaults[page], read);
      if (layout) next[page] = layout;
    }
  } catch {
    return current;
  }
  return next;
}
