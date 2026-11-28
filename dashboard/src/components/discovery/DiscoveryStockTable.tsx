"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import {
  EMPTY_VALUE,
  formatChangePercent,
  formatCompact,
  formatNumber,
  formatPercent,
  formatPrice,
  TREND_TEXT_CLASS,
  trendTone,
} from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import {
  defaultDir,
  foldText,
  sortRows,
  type NumericField,
  type Row,
  type SortDir,
  type SortKey,
} from "@/components/tarama/model";
import type { DiscoveryGroupMetrics } from "@/lib/discovery";

type TableColKey = "close" | "change_pct" | "market_cap" | "pe" | "pb" | "ev_ebitda" | "roe" | "dividend_yield";

interface TableColumn {
  key: TableColKey;
  label: Record<Locale, string>;
  format: (value: number) => string;
  isChange?: boolean;
}

const COLUMNS: readonly TableColumn[] = [
  { key: "close", label: { tr: "Fiyat (₺)", en: "Price (₺)", fr: "Cours (₺)" }, format: (v) => formatPrice(v) },
  {
    key: "change_pct",
    label: { tr: "Günlük", en: "Day", fr: "Jour" },
    format: (v) => formatChangePercent(v),
    isChange: true,
  },
  { key: "market_cap", label: { tr: "Piyasa Değeri", en: "Market Cap", fr: "Capitalisation" }, format: (v) => formatCompact(v) },
  { key: "pe", label: { tr: "F/K", en: "P/E", fr: "PER" }, format: (v) => formatNumber(v) },
  { key: "pb", label: { tr: "PD/DD", en: "P/B", fr: "C/VC" }, format: (v) => formatNumber(v) },
  { key: "ev_ebitda", label: { tr: "FD/FAVÖK", en: "EV/EBITDA", fr: "VE/EBITDA" }, format: (v) => formatNumber(v) },
  { key: "roe", label: { tr: "ROE", en: "ROE", fr: "ROE" }, format: (v) => formatPercent(v, 1) },
  { key: "dividend_yield", label: { tr: "Temettü", en: "Yield", fr: "Dividende" }, format: (v) => formatPercent(v) },
];

const COPY: Record<
  Locale,
  {
    stockCol: string;
    medianRow: string;
    loss: string;
    searchPlaceholder: string;
    searchLabel: string;
    clear: string;
    showing: (shown: number, total: number) => string;
    empty: string;
    showAll: (n: number) => string;
    sortLabel: string;
    asc: string;
    desc: string;
  }
> = {
  tr: {
    sortLabel: "Sırala",
    asc: "artan",
    desc: "azalan",
    stockCol: "Hisse",
    medianRow: "Grup medyanı",
    loss: "Zararda",
    searchPlaceholder: "Bu listede hisse ara…",
    searchLabel: "Listede hisse ara",
    clear: "Temizle",
    showing: (s, n) => `${s} / ${n} hisse`,
    empty: "Bu aramayla eşleşen hisse bulunamadı.",
    showAll: (n) => `Tüm ${n} hisseyi göster`,
  },
  en: {
    sortLabel: "Sort by",
    asc: "ascending",
    desc: "descending",
    stockCol: "Stock",
    medianRow: "Group median",
    loss: "Loss",
    searchPlaceholder: "Filter stocks in this list…",
    searchLabel: "Filter stocks in list",
    clear: "Clear",
    showing: (s, n) => `${s} of ${n} stocks`,
    empty: "No stocks match this filter.",
    showAll: (n) => `Show all ${n} stocks`,
  },
  fr: {
    sortLabel: "Trier par",
    asc: "croissant",
    desc: "décroissant",
    stockCol: "Action",
    medianRow: "Médiane du groupe",
    loss: "Déficitaire",
    searchPlaceholder: "Filtrer dans cette liste…",
    searchLabel: "Filtrer la liste",
    clear: "Effacer",
    showing: (s, n) => `${s} / ${n} actions`,
    empty: "Aucune action ne correspond.",
    showAll: (n) => `Afficher les ${n} actions`,
  },
};

const INITIAL_LIMIT = 40;

export function DiscoveryStockTable({
  headingId,
  caption,
  rows,
  metrics,
  hideEvEbitda = false,
}: {
  headingId: string;
  caption: string;
  rows: readonly Row[];
  metrics: DiscoveryGroupMetrics;
  hideEvEbitda?: boolean;
}) {
  const { locale } = useLocale();
  const copy = COPY[locale];
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("market_cap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showAll, setShowAll] = useState(false);

  const visibleCols = useMemo(
    () =>
      COLUMNS.filter((col) => {
        if (col.key === "ev_ebitda" && hideEvEbitda) return false;
        if (col.key === "ev_ebitda") {
          return metrics.medians.ev_ebitda !== undefined || rows.some((r) => r.ev_ebitda !== undefined);
        }
        return true;
      }),
    [hideEvEbitda, metrics.medians.ev_ebitda, rows],
  );

  const filtered = useMemo(() => {
    const needle = foldText(query.trim());
    const base = needle
      ? rows.filter((row) => foldText(row.symbol).includes(needle) || (row.name ? foldText(row.name).includes(needle) : false))
      : rows;
    return sortRows(base, sortKey, sortDir);
  }, [query, rows, sortDir, sortKey]);

  const displayed = showAll || query.trim() ? filtered : filtered.slice(0, INITIAL_LIMIT);
  const hasMedianRow = visibleCols.some((col) => metrics.medians[col.key as NumericField] !== undefined);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono tabular-nums text-xs text-muted-foreground">
          {copy.showing(displayed.length, filtered.length)}
        </p>
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchLabel}
            className="h-8 pointer-coarse:h-11 w-full rounded-md border border-input bg-card pl-8 pr-7 pointer-coarse:pr-9 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={copy.clear}
              className="motion-press-subtle absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* On narrow screens the table becomes stacked cards and its header row (with the sort
          buttons) is hidden, so offer the same sorting as a select. */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground sm:hidden">
        <span>{copy.sortLabel}</span>
        <select
          value={`${sortKey}:${sortDir}`}
          onChange={(event) => {
            const [key, dir] = event.target.value.split(":") as [SortKey, SortDir];
            setSortKey(key);
            setSortDir(dir);
          }}
          className="h-8 pointer-coarse:min-h-11 flex-1 rounded-md border border-input bg-card px-2 text-xs text-foreground"
        >
          {[{ key: "symbol" as SortKey, label: copy.stockCol }, ...visibleCols.map((col) => ({ key: col.key as SortKey, label: col.label[locale] }))].flatMap(
            (option) =>
              (["desc", "asc"] as const).map((dir) => (
                <option key={`${option.key}:${dir}`} value={`${option.key}:${dir}`}>
                  {option.label} ({dir === "asc" ? copy.asc : copy.desc})
                </option>
              )),
          )}
        </select>
      </label>

      <div
        tabIndex={0}
        role="region"
        aria-labelledby={headingId}
        className="discovery-table-wrap card-surface max-h-[70vh] scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {displayed.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{copy.empty}</p>
        ) : (
          <table role="table" className="discovery-table text-[13px]">
            <caption className="sr-only">{caption}</caption>
            <thead role="rowgroup">
              <tr role="row" className="bg-surface text-[11px] font-medium text-muted-foreground">
                <th
                  scope="col"
                      role="columnheader"
                  aria-sort={sortKey === "symbol" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className="sticky left-0 z-[3] border-b border-border bg-surface py-2.5 pl-4 pr-3 text-left"
                >
                  <button
                    type="button"
                    onClick={() => toggleSort("symbol")}
                    className="motion-press-subtle inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                  >
                    {copy.stockCol}
                    {sortKey === "symbol" &&
                      (sortDir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />)}
                  </button>
                </th>
                {visibleCols.map((col) => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      role="columnheader"
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      className="whitespace-nowrap border-b border-border bg-surface px-3 py-2.5 text-right"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "motion-press-subtle inline-flex items-center justify-end gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                          active && "font-semibold text-foreground",
                        )}
                      >
                        {col.label[locale]}
                        {active &&
                          (sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden="true" />
                          ))}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {hasMedianRow && !query.trim() && (
                <tr role="row" className="bg-surface/60 font-medium text-foreground">
                  <th
                    scope="row"
                    role="rowheader"
                    className="border-b border-border bg-surface/95 py-2.5 pl-4 pr-3 text-left text-xs font-semibold text-foreground"
                  >
                    {copy.medianRow}
                  </th>
                  {visibleCols.map((col) => {
                    const medianVal = metrics.medians[col.key as NumericField];
                    return (
                      <td
                        key={col.key}
                        role="cell"
                        data-label={col.label[locale]}
                        className={cn(
                          "whitespace-nowrap border-b border-border px-3 py-2.5 text-right font-mono text-xs tabular-nums",
                          col.isChange && medianVal !== undefined ? TREND_TEXT_CLASS[trendTone(medianVal)] : "text-foreground",
                        )}
                      >
                        {medianVal !== undefined ? col.format(medianVal) : EMPTY_VALUE}
                      </td>
                    );
                  })}
                </tr>
              )}
              {displayed.map((row) => (
                <tr role="row" key={row.symbol} className="group transition-colors hover:bg-surface/50">
                  <th
                    scope="row"
                    role="rowheader"
                    className="border-b border-border bg-card py-2.5 pl-4 pr-3 text-left font-normal transition-colors group-hover:bg-surface/80"
                  >
                    <Link
                      href={`/hisse/${encodeURIComponent(row.symbol)}`}
                      className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="block font-mono text-[13px] font-semibold text-foreground group-hover:text-primary">
                        {row.symbol}
                      </span>
                      {row.name && (
                        <span className="block max-w-[12rem] truncate text-[11px] text-muted-foreground sm:max-w-[16rem]">
                          {row.name}
                        </span>
                      )}
                    </Link>
                  </th>
                  {visibleCols.map((col) => {
                    const value = row[col.key];
                    const hasVal = value !== undefined && Number.isFinite(value);
                    return (
                      <td
                        key={col.key}
                        role="cell"
                        data-label={col.label[locale]}
                        className={cn(
                          "whitespace-nowrap border-b border-border px-3 py-2.5 text-right font-mono tabular-nums",
                          col.isChange && hasVal ? TREND_TEXT_CLASS[trendTone(value)] : "text-foreground",
                        )}
                      >
                        {hasVal ? (
                          col.format(value)
                        ) : col.key === "pe" && row.loss ? (
                          <span className="font-sans text-[11px] text-muted-foreground">{copy.loss}</span>
                        ) : (
                          <span className="text-muted-foreground/65">{EMPTY_VALUE}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!showAll && !query.trim() && filtered.length > INITIAL_LIMIT && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="motion-press-subtle rounded-md border border-border bg-card px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11"
          >
            {copy.showAll(filtered.length)}
          </button>
        </div>
      )}
    </div>
  );
}
