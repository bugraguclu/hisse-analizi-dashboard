"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMarketDate, EMPTY_VALUE } from "@/lib/format";
import { TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { CategoryBadge, SeverityBadge } from "@/components/shared/SeverityBadge";
import { useLocale } from "@/lib/locale-context";
import type { EventOut } from "@/types";
import { normalizeCategory } from "./eventTaxonomy";

export function EventsTable({
  events,
  total,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  emptyMessage,
  onRowSelect,
  page,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  events: EventOut[];
  /** Server-side total match count (X-Total-Count); falls back to events.length when omitted. */
  total?: number;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  emptyMessage: string;
  onRowSelect: (id: string) => void;
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useLocale();

  if (isError) return <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />;
  if (isLoading) return <TableSkeleton rows={8} />;
  if (events.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/20">
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.date")}</th>
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.ticker")}</th>
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.source")}</th>
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.heading")}</th>
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.category")}</th>
              <th scope="col" className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.severity")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {events.map((e, i) => {
              const category = normalizeCategory(e.category);
              return (
                <tr
                  key={e.id || i}
                  onClick={() => e.id && onRowSelect(e.id)}
                  onKeyDown={(ev) => {
                    if ((ev.key === "Enter" || ev.key === " ") && e.id) {
                      ev.preventDefault();
                      onRowSelect(e.id);
                    }
                  }}
                  tabIndex={e.id ? 0 : undefined}
                  role={e.id ? "button" : undefined}
                  aria-label={e.id ? `${t("events.detail")}: ${e.title || t("events.untitled")}` : undefined}
                  className="hover:bg-muted/15 focus-visible:bg-muted/20 outline-none transition-colors cursor-pointer"
                >
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatMarketDate(e.published_at, "dateTime")}</td>
                  <td className="px-5 py-3 text-xs">
                    {e.ticker ? (
                      <Link
                        href={`/hisse/${e.ticker}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="font-semibold text-primary hover:underline"
                      >
                        {e.ticker}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{e.source_code?.toUpperCase() || EMPTY_VALUE}</td>
                  <td className="px-5 py-3 text-xs text-foreground max-w-md truncate">{e.title || EMPTY_VALUE}</td>
                  <td className="px-5 py-3"><CategoryBadge category={category} /></td>
                  <td className="px-5 py-3"><SeverityBadge severity={e.severity} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
          {total ?? events.length} {t("common.records")}
        </span>
        <div className="flex gap-1.5">
          <button
            disabled={!hasPrev}
            onClick={onPrev}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="h-3 w-3" /> {t("common.previous")}
          </button>
          <span className="flex items-center px-2 text-[10px] font-mono text-muted-foreground" aria-hidden="true">
            {page + 1}
          </span>
          <button
            disabled={!hasNext}
            onClick={onNext}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
          >
            {t("common.next")} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </>
  );
}
