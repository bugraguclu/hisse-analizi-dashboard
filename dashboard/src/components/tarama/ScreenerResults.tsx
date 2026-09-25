"use client";

import { AlertTriangle, Download, Inbox } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RowSkeleton } from "@/components/dashboard/ui";
import { ErrorState } from "@/components/shared/ErrorState";
import type { ScreenerUniverseOut } from "@/types";
import { columnLabel, ScreenerTable, type TableContext } from "./ScreenerTable";
import { Pagination } from "./Pagination";
import { useTaramaI18n, type TaramaKey } from "./i18n";
import { DEFAULT_STATE, VIEWS, VIEW_COLUMNS, type PageSlice, type Row, type ScreenerState, type SortKey, type ViewKey } from "./model";

const HEADING_ID = "screener-results-heading";

export function ScreenerResults({
  state,
  data,
  status,
  errorMessage,
  onRetry,
  isRefreshing,
  slice,
  breadth,
  hasFilters,
  favorites,
  context,
  onView,
  onSort,
  onResetSort,
  onPage,
  onToggleFavorite,
  onClearFilters,
  onExport,
}: {
  state: ScreenerState;
  data: ScreenerUniverseOut | undefined;
  status: "loading" | "error" | "ready";
  errorMessage?: string;
  onRetry: () => void;
  isRefreshing: boolean;
  slice: PageSlice<Row>;
  breadth: { up: number; down: number; flat: number };
  hasFilters: boolean;
  favorites: ReadonlySet<string>;
  context: TableContext;
  onView: (view: ViewKey) => void;
  onSort: (key: SortKey) => void;
  onResetSort: () => void;
  onPage: (page: number) => void;
  onToggleFavorite: (ticker: string) => void;
  onClearFilters: () => void;
  onExport: () => void;
}) {
  const { t } = useTaramaI18n();
  const columns = VIEW_COLUMNS[state.view];
  const sortHidden = state.sort !== "symbol" && !columns.includes(state.sort);
  const sortChanged = state.sort !== DEFAULT_STATE.sort || state.dir !== DEFAULT_STATE.dir;
  const total = data?.count ?? 0;

  let summary: string | null = null;
  if (status === "ready") {
    const count = hasFilters ? t("results.count", { shown: slice.total, total }) : t("results.countAll", { total });
    summary = slice.total > 0 ? `${count} · ${t("results.breadth", breadth)}` : count;
  }

  return (
    <section aria-labelledby={HEADING_ID} className="card-surface min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={HEADING_ID} className="text-[13px] font-semibold text-foreground">
            {t("results.title")}
          </h2>
          <p className="mt-0.5 min-h-4 text-[11px] text-muted-foreground" aria-live="polite">
            {summary}
            {status === "loading" && <span className="inline-block h-3 w-40 rounded-sm bg-muted skeleton-shimmer align-middle" aria-hidden="true" />}
            {isRefreshing && status === "ready" && <span className="ml-2">{t("results.refreshing")}</span>}
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <SegmentedControl<ViewKey>
            label={t("view.label")}
            value={state.view}
            onChange={onView}
            options={VIEWS.map((view) => ({ value: view, label: t(`view.${view}` as TaramaKey) }))}
          />
          <button
            type="button"
            onClick={onExport}
            disabled={status !== "ready" || slice.total === 0}
            title={t("results.exportTitle")}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t("results.export")}
          </button>
        </div>
      </div>

      {data?.warnings.map((warning) =>
        warning === "analyst" || warning === "indices" ? (
          <p key={warning} className="flex items-start gap-2 border-b border-border bg-surface px-4 py-2 text-[12px] text-warn">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t(warning === "analyst" ? "warn.analyst" : "warn.indices")}
          </p>
        ) : null,
      )}

      {sortHidden && status === "ready" && (
        <p className="flex flex-wrap items-center gap-x-2 border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
          {t("results.sortedBy", {
            column: columnLabel(state.sort, t),
            direction: t(state.dir === "asc" ? "results.asc" : "results.desc"),
          })}
          {sortChanged && (
            <button type="button" onClick={onResetSort} className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              {t("results.resetSort")}
            </button>
          )}
        </p>
      )}

      {status === "loading" ? (
        <RowSkeleton rows={10} />
      ) : status === "error" ? (
        <ErrorState message={errorMessage || t("error.load")} onRetry={onRetry} />
      ) : slice.total === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <Inbox className="h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="text-[13px] font-medium text-foreground">{t("results.empty")}</p>
          <p className="text-[12px] text-muted-foreground">{t("results.emptyHint")}</p>
          {hasFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-1 inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t("filters.clearAll")}
            </button>
          )}
        </div>
      ) : (
        <>
          <ScreenerTable
            rows={slice.rows}
            columns={columns}
            sort={state.sort}
            dir={state.dir}
            onSort={onSort}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            context={context}
          />
          <Pagination slice={slice} onPage={onPage} />
        </>
      )}
    </section>
  );
}
