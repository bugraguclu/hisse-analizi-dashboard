"use client";

import { FilterChoiceList, FilterMenu, useFilterBarText, type FilterOption } from "@/components/ui/filter-bar";
import type { StateUpdate } from "./ScreenerFilters";
import { columnLabel } from "./ScreenerTable";
import { useTaramaI18n } from "./i18n";
import { PAGE_SIZES, VIEW_COLUMNS, defaultDir, type PageSize, type ScreenerState, type SortDir, type SortKey } from "./model";

/**
 * SIRALA: the sort column, its direction and the page size — the same menu as
 * on /events. The column headers still sort too; this menu names the order and
 * holds what the table has no place for (direction, rows per page).
 */
export function ScreenerSortMenu({ state, onChange }: { state: ScreenerState; onChange: StateUpdate }) {
  const { t } = useTaramaI18n();
  const text = useFilterBarText();

  // The current view's columns; an order set in another view stays listed so it shows as picked.
  const keys: SortKey[] = ["symbol", ...VIEW_COLUMNS[state.view].filter((key): key is SortKey => key !== "signals")];
  if (!keys.includes(state.sort)) keys.push(state.sort);
  const sortOptions: FilterOption<SortKey>[] = keys.map((key) => ({ value: key, label: columnLabel(key, t) }));
  const dirOptions: FilterOption<SortDir>[] = [
    { value: "asc", label: t("sort.asc") },
    { value: "desc", label: t("sort.desc") },
  ];
  const sizeOptions: FilterOption<`${PageSize}`>[] = PAGE_SIZES.map((size) => ({ value: `${size}`, label: `${size}` }));

  return (
    <FilterMenu label={text.sort} value={`${columnLabel(state.sort, t)} · ${t(state.dir === "asc" ? "sort.asc" : "sort.desc")}`} icon="sort">
      {/* A new column starts in its natural direction (names and cheapness ascending, the rest largest first). */}
      <FilterChoiceList
        label={t("sort.label")}
        showLabel
        value={state.sort}
        options={sortOptions}
        onChange={(sort) => onChange((prev) => ({ ...prev, sort, dir: defaultDir(sort), page: 1 }))}
      />
      <div className="mt-1 border-t border-border">
        <FilterChoiceList
          label={t("sort.direction")}
          showLabel
          value={state.dir}
          options={dirOptions}
          onChange={(dir) => onChange((prev) => ({ ...prev, dir, page: 1 }))}
        />
      </div>
      <div className="mt-1 border-t border-border">
        <FilterChoiceList
          label={t("results.pageSize")}
          showLabel
          value={`${state.size}`}
          options={sizeOptions}
          onChange={(size) => onChange((prev) => ({ ...prev, size: Number(size) as PageSize, page: 1 }))}
        />
      </div>
    </FilterMenu>
  );
}
