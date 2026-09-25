"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaramaI18n } from "./i18n";
import { pageList, type PageSlice } from "./model";

const pagerButton =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border px-2 font-mono text-[12px] tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40";

/** Rows per page are picked in the filter bar's SIRALA menu. */
export function Pagination({ slice, onPage }: { slice: PageSlice<unknown>; onPage: (page: number) => void }) {
  const { t } = useTaramaI18n();
  const { page, pageCount, from, to, total } = slice;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="text-[12px] tabular-nums text-muted-foreground">{t("results.range", { from, to, total })}</span>

      {pageCount > 1 && (
        <nav aria-label={t("results.pagination")} className="flex items-center gap-1">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label={t("results.prev")} className={cn(pagerButton, "text-foreground hover:bg-muted")}>
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {pageList(page, pageCount).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-[12px] text-muted-foreground max-sm:hidden">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPage(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={t("results.goToPage", { page: item })}
                className={cn(
                  pagerButton,
                  "max-sm:hidden",
                  item === page ? "border-foreground/25 bg-muted font-semibold text-foreground max-sm:inline-flex" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item}
              </button>
            ),
          )}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria-label={t("results.next")} className={cn(pagerButton, "text-foreground hover:bg-muted")}>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
