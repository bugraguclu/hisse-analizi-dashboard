import type { BuiltInPage } from "./defaults";
import { clampHeight, widgetsInOrder, type Layout, type Row, type WidgetInstance } from "./model";

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

const naturalHeight = new Set([
  "stock.quote",
  "macro.kpis",
  "macro.inflationTiles",
  "macro.markets",
  "macro.calendar",
  "macro.activity",
  "macro.external",
]);

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
    if (!isGridInteger(w, 1, 6) || !isGridInteger(x, 0, 6 - w) ||
        !isGridInteger(h, 1, 1024) || !isGridInteger(y, 0, 1024 - h)) continue;
    found.set(widget.id, { x, y, w, h, widget });
  }
  return [...found.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The old editor used free placement on a 6-column grid. The widget editor
 * stacks 12-column rows, so cards with the same top edge share a row when
 * possible. Other cards keep their visual reading order, width and height.
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

  // Keep headings and widgets without an old position near their default neighbours.
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

  const rows: Row[] = [];
  function addRow(): Row {
    const row = { id: `workspace-${page.replace(".", "-")}-r${rows.length}`, columns: [] };
    rows.push(row);
    return row;
  }

  function addExtra(widget: WidgetInstance) {
    const row = addRow();
    const width = defaults.rows.flatMap((entry) => entry.columns)
      .find((column) => column.widgets.includes(widget))?.width ?? 12;
    row.columns.push({ id: `${row.id}c0`, width, widgets: [widget] });
  }

  let row: Row | undefined;
  let top = -1;
  let right = 0;
  for (const { x, y, w, h, widget } of cards) {
    const before = extrasBefore.get(widget.id);
    if (before) {
      before.forEach(addExtra);
      row = undefined;
    }
    if (!row || y !== top || x < right) row = addRow();
    top = y;
    right = x + w;
    row.columns.push({
      id: `${row.id}c${row.columns.length}`,
      width: w * 2,
      widgets: [{ ...widget, ...(naturalHeight.has(widget.type) ? {} : { height: clampHeight(h * 32 - 16) }) }],
    });
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
