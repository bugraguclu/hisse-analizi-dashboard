"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber, formatCompact, formatChangePercent, EMPTY_VALUE } from "@/lib/format";
import { trendText } from "@/lib/trend";
import { TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";
import type { ScreenerRow } from "@/types";

export type ScreenerSortKey = "symbol" | "close" | "change_pct" | "volume" | "market_cap";

const COLUMNS: { key: ScreenerSortKey; labelKey: TranslationKey }[] = [
  { key: "symbol", labelKey: "events.ticker" },
  { key: "close", labelKey: "tarama.price" },
  { key: "change_pct", labelKey: "tarama.change" },
  { key: "volume", labelKey: "index.volume" },
  { key: "market_cap", labelKey: "temel.marketCap" },
];

export function ScreenerTable({
  rows,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  sortKey,
  sortDir,
  onSortChange,
  page,
  pageSize,
  onPageChange,
}: {
  rows: ScreenerRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  sortKey: ScreenerSortKey;
  sortDir: "asc" | "desc";
  onSortChange: (key: ScreenerSortKey) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();

  if (isError) return <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />;
  if (isLoading) return <TableSkeleton rows={8} />;
  if (rows.length === 0) return <EmptyState message={t("tarama.noResults")} />;

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // `page` comes straight from the URL and can outlive the result set it was
  // computed against (filters/template changed, a bookmarked/shared link, a
  // shrunk result set) — clamp so we never slice past the end and render a
  // silently blank table while the pager still claims there's more.
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/20">
              {COLUMNS.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th key={col.key} scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider" aria-sort={isSorted ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      onClick={() => onSortChange(col.key)}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t(col.labelKey)}
                      {isSorted ? (
                        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {pageRows.map((s, i) => {
              const ticker = String(s.symbol ?? "");
              const price = typeof s.close === "number" ? s.close : null;
              const change = s.change_pct ?? s.change_percent ?? null;
              const volume = typeof s.volume === "number" ? s.volume : null;
              const marketCap = typeof s.market_cap === "number" ? s.market_cap : null;
              return (
                <tr key={`${ticker}-${i}`} className="hover:bg-muted/15 transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/hisse/${ticker}`} className="font-semibold text-primary hover:underline text-xs">{ticker}</Link>
                    {s.name && <p className="text-[10px] text-muted-foreground truncate max-w-[150px] mt-0.5">{String(s.name)}</p>}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-foreground">{price != null ? formatNumber(price) : EMPTY_VALUE}</td>
                  <td className={`px-5 py-3 font-mono text-xs font-semibold ${change == null ? "text-muted-foreground" : trendText(change)}`}>
                    {change == null ? EMPTY_VALUE : (
                      <span className="flex items-center gap-1">
                        {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {formatChangePercent(change)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{volume != null && volume > 0 ? formatCompact(volume) : EMPTY_VALUE}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{marketCap != null && marketCap > 0 ? formatCompact(marketCap) : EMPTY_VALUE}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
            {t("tarama.page")} {safePage + 1} / {pageCount}
          </span>
          <div className="flex gap-1.5">
            <button
              disabled={safePage === 0}
              onClick={() => onPageChange(Math.max(0, safePage - 1))}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-3 w-3" /> {t("common.previous")}
            </button>
            <button
              disabled={safePage + 1 >= pageCount}
              onClick={() => onPageChange(safePage + 1)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
            >
              {t("common.next")} <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
