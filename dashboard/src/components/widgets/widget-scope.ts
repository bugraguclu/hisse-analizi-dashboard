import { addWidget, type Layout, type Row, type WidgetInstance } from "./model.ts";

/** Whether a card's data follows a stock, independently of its gallery category. */
export type WidgetScope = "stock" | "general";

type ScopeMeta = { stock?: boolean; category?: string; type?: string };

export function widgetScope(meta: ScopeMeta): WidgetScope {
  return meta.stock ? "stock" : "general";
}

/**
 * Headings and notes have no data of their own: they belong to the cards
 * around them, so a heading can introduce stock cards and a note can sit
 * under a chart.
 */
export function isNeutral(meta: ScopeMeta | undefined): boolean {
  return meta?.category === "general";
}

type MetadataLookup = (type: string) => ScopeMeta | undefined;

/**
 * Each widget's section. A heading or note added from a section's add button
 * remembers that section. Otherwise a heading takes the section of the card
 * under it in its column and a note of the card above it, then the row's
 * cards, then the row above (or below); a page of only headings and notes is
 * general.
 */
export function widgetScopes(layout: Layout, metaForType: MetadataLookup): Map<string, WidgetScope> {
  const own = (widget: WidgetInstance): WidgetScope | null => {
    const meta = metaForType(widget.type);
    return isNeutral(meta) ? null : widgetScope(meta ?? {});
  };
  const rowAnchor = layout.rows.map((row) => {
    for (const column of row.columns) for (const widget of column.widgets) {
      const scope = own(widget) ?? (widget.options?.section === "stock" || widget.options?.section === "general" ? widget.options.section : null);
      if (scope) return scope;
    }
    return null;
  });
  const nearRow = (index: number, step: 1 | -1) => {
    for (let i = index + step; i >= 0 && i < rowAnchor.length; i += step) if (rowAnchor[i]) return rowAnchor[i];
    return null;
  };

  const scopes = new Map<string, WidgetScope>();
  layout.rows.forEach((row, rowIndex) => {
    for (const column of row.columns) {
      const inColumn = column.widgets.map(own);
      column.widgets.forEach((widget, index) => {
        const section = widget.options?.section;
        const scope = inColumn[index] ?? (section === "stock" || section === "general" ? section : null);
        if (scope) {
          scopes.set(widget.id, scope);
          return;
        }
        const next = inColumn.slice(index + 1).find(Boolean) ?? null;
        const previous = inColumn.slice(0, index).reverse().find(Boolean) ?? null;
        const forward = widget.type === "general.heading";
        scopes.set(widget.id, (forward ? next ?? previous : previous ?? next) ?? rowAnchor[rowIndex] ??
          nearRow(rowIndex, -1) ?? nearRow(rowIndex, 1) ?? "general");
      });
    }
  });
  return scopes;
}

/** The section of each row of a layout already grouped by scope. */
export function rowScopes(layout: Layout, metaForType: MetadataLookup): WidgetScope[] {
  const scopes = widgetScopes(layout, metaForType);
  return layout.rows.map((row) => scopes.get(row.columns[0]?.widgets[0]?.id ?? "") ?? "general");
}

/** Keep cards beneath their scope heading, preserving sizes and order within each group. */
export function groupWidgetsByScope(layout: Layout, metaForType: MetadataLookup): Layout {
  const scopes = widgetScopes(layout, metaForType);
  const scopeOf = (widget: WidgetInstance) => scopes.get(widget.id) ?? "general";
  const groups: Record<WidgetScope, Row[]> = { stock: [], general: [] };
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
    const firstScope = scopeOf(row.columns[0].widgets[0]);
    for (const scope of ["stock", "general"] as const) {
      const columns = row.columns.flatMap((column) => {
        const widgets = column.widgets.filter((widget) => scopeOf(widget) === scope);
        if (widgets.length === 0) return [];
        if (widgets.length === column.widgets.length) return [column];
        const keepId = scopeOf(column.widgets[0]) === scope;
        return [{ ...column, id: keepId ? column.id : splitId(column.id, scope), widgets }];
      });
      if (columns.length === 0) continue;
      const unchanged = columns.length === row.columns.length && columns.every((column, i) => column === row.columns[i]);
      const split: Row = { id: scope === firstScope ? row.id : splitId(row.id, scope), columns };
      // The part that keeps the row's id keeps its shape too.
      if (row.rail && scope === firstScope) split.rail = true;
      groups[scope].push(unchanged ? row : split);
    }
  }
  const rows = [...groups.stock, ...groups.general];
  return rows.length === layout.rows.length && rows.every((row, i) => row === layout.rows[i]) ? layout : { rows };
}

/**
 * An unpositioned addition fills its own section, never the other section's
 * free space. A heading or note goes to `section` (the one its add button
 * belongs to), else to the general section.
 */
export function addWidgetInScope(
  layout: Layout,
  widget: Omit<WidgetInstance, "id">,
  width: number,
  metaForType: MetadataLookup,
  section?: WidgetScope,
) {
  const grouped = groupWidgetsByScope(layout, metaForType);
  const meta = metaForType(widget.type);
  const neutral = isNeutral(meta);
  const scope = neutral ? section ?? "general" : widgetScope(meta ?? {});
  const scopes = rowScopes(grouped, metaForType);
  const rows = grouped.rows.filter((_, index) => scopes[index] === scope);
  const added = addWidget({ rows }, neutral ? { ...widget, options: { ...widget.options, section: scope } } : widget, width);
  const other = grouped.rows.filter((_, index) => scopes[index] !== scope);
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
