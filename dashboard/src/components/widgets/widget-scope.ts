import { addWidget, type Layout, type WidgetInstance } from "./model.ts";

/** Whether a card's data follows a stock, independently of its gallery category. */
export type WidgetScope = "stock" | "general";

type ScopeMeta = { stock?: boolean };

export function widgetScope(meta: ScopeMeta): WidgetScope {
  return meta.stock ? "stock" : "general";
}

type MetadataLookup = (type: string) => ScopeMeta | undefined;

export function rowScope(row: Layout["rows"][number], metaForType: MetadataLookup): WidgetScope {
  return widgetScope(metaForType(row.columns[0]?.widgets[0]?.type) ?? {});
}

/** Keep cards beneath their scope heading, preserving sizes and order within each group. */
export function groupWidgetsByScope(layout: Layout, metaForType: MetadataLookup): Layout {
  const groups: Record<WidgetScope, Layout["rows"]> = { stock: [], general: [] };
  const usedIds = new Set(layout.rows.flatMap((row) => [row.id, ...row.columns.map((column) => column.id)]));
  const splitId = (id: string, scope: WidgetScope) => {
    let suffix = 0;
    let next: string;
    do {
      next = `${id.slice(0, 48)}-${scope}${suffix || ""}`;
      suffix++;
    } while (usedIds.has(next));
    usedIds.add(next);
    return next;
  };

  for (const row of layout.rows) {
    const firstScope = rowScope(row, metaForType);
    for (const scope of ["stock", "general"] as const) {
      const columns = row.columns.flatMap((column) => {
        const widgets = column.widgets.filter((widget) => widgetScope(metaForType(widget.type) ?? {}) === scope);
        if (widgets.length === 0) return [];
        if (widgets.length === column.widgets.length) return [column];
        const keepId = widgetScope(metaForType(column.widgets[0].type) ?? {}) === scope;
        return [{ ...column, id: keepId ? column.id : splitId(column.id, scope), widgets }];
      });
      if (columns.length === 0) continue;
      const unchanged = columns.length === row.columns.length && columns.every((column, i) => column === row.columns[i]);
      groups[scope].push(unchanged ? row : {
        id: scope === firstScope ? row.id : splitId(row.id, scope),
        columns,
      });
    }
  }
  const rows = [...groups.stock, ...groups.general];
  return rows.length === layout.rows.length && rows.every((row, i) => row === layout.rows[i]) ? layout : { rows };
}

/** An unpositioned addition fills its own section, never the other section's free space. */
export function addWidgetInScope(layout: Layout, widget: Omit<WidgetInstance, "id">, width: number, metaForType: MetadataLookup) {
  const grouped = groupWidgetsByScope(layout, metaForType);
  const scope = widgetScope(metaForType(widget.type) ?? {});
  const rows = grouped.rows.filter((row) => rowScope(row, metaForType) === scope);
  const added = addWidget({ rows }, widget, width);
  const other = grouped.rows.filter((row) => rowScope(row, metaForType) !== scope);
  return { id: added.id, layout: { rows: scope === "stock" ? [...added.layout.rows, ...other] : [...other, ...added.layout.rows] } };
}

/** Only stock cards without their own symbol follow the page's stock picker. */
export function pageStockUsage(layout: Layout, metaForType: (type: string) => ScopeMeta | undefined) {
  let stock = 0;
  let followingPage = 0;
  for (const row of layout.rows) {
    for (const column of row.columns) {
      for (const widget of column.widgets) {
        if (!metaForType(widget.type)?.stock) continue;
        stock++;
        if (!widget.ticker) followingPage++;
      }
    }
  }
  return { stock, followingPage };
}
