"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { formatNumber } from "@/lib/format";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { ErrorState } from "@/components/shared/ErrorState";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import { DEFAULT_WATCHLIST_ID, useWatchlists, type Watchlist } from "@/hooks/use-watchlists";
import { useCompanies } from "./queries";
import { CardHeading, ChangePill, DashboardCard } from "./ui";

const HEADING_ID = "watchlist-heading";

export function WatchlistCard({ className }: { className?: string }) {
  const { t } = useLocale();
  const { lists, createList, deleteList, addTicker, removeTicker } = useWatchlists();
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_WATCHLIST_ID);
  const [editing, setEditing] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const activeList: Watchlist = lists.find((l) => l.id === selectedId) ?? lists[0];
  const tickers = activeList.tickers;
  const listLabel = (list: Watchlist) => list.name || t("watchlist.favorites");

  const refetchInterval = useLiveRefetchInterval(60_000);
  const snapshotQ = useQuery({
    queryKey: ["snapshot", [...tickers].sort().join(",")],
    queryFn: ({ signal }) => api.snapshot(tickers, signal),
    enabled: tickers.length > 0,
    staleTime: STALE_TIME.live,
    refetchInterval,
    placeholderData: (previous) => previous,
  });
  const companiesQ = useCompanies();
  const names = useMemo(() => new Map((companiesQ.data ?? []).map((c) => [c.ticker, c.display_name])), [companiesQ.data]);

  function handleCreate() {
    const id = createList(newListName);
    if (id) {
      setSelectedId(id);
      setNewListName("");
    }
  }

  function handleAdd(ticker: string) {
    const result = addTicker(activeList.id, ticker);
    setNotice(result === "duplicate" ? t("watchlist.alreadyInList", { ticker }) : null);
  }

  function handleDelete() {
    if (lists.length <= 1) return;
    if (!window.confirm(t("watchlist.deleteConfirm", { name: listLabel(activeList) }))) return;
    deleteList(activeList.id);
    setSelectedId(lists.find((l) => l.id !== activeList.id)?.id ?? DEFAULT_WATCHLIST_ID);
  }

  return (
    // overflow-visible: the add-stock search dropdown must not be clipped by the card.
    <DashboardCard labelledBy={HEADING_ID} className={cn("overflow-visible", className)}>
      <CardHeading
        id={HEADING_ID}
        title={t("dashboard.watchlist")}
        action={
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setNotice(null);
            }}
            aria-expanded={editing}
            className="rounded-sm text-xs text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {editing ? t("watchlist.done") : t("watchlist.editLists")}
          </button>
        }
      />

      {lists.length > 1 && (
        <div role="group" aria-label={t("watchlist.lists")} className="flex items-center gap-4 overflow-x-auto border-b border-border px-4 scrollbar-none">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => setSelectedId(list.id)}
              aria-pressed={list.id === activeList.id}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                list.id === activeList.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {listLabel(list)}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-3 border-b border-border bg-surface/60 px-4 py-3">
          <div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">{t("watchlist.addHint")}</p>
            <TickerSearch onSelect={handleAdd} />
            {notice && (
              <p role="status" className="mt-1.5 text-[11px] text-warn">
                {notice}
              </p>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleCreate();
            }}
          >
            <input
              type="text"
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              placeholder={t("watchlist.listName")}
              aria-label={t("watchlist.listName")}
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40 focus:ring-2 focus:ring-ring/25"
            />
            <button
              type="submit"
              disabled={!newListName.trim()}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("watchlist.newList")}
            </button>
          </form>
          {lists.length > 1 && (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive transition-colors hover:text-destructive/80"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              {t("watchlist.deleteList")}: {listLabel(activeList)}
            </button>
          )}
        </div>
      )}

      {tickers.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t("watchlist.emptyList")}</p>
      ) : (
        <>
          {snapshotQ.isError && !snapshotQ.data && (
            <ErrorState compact message={t("watchlist.quoteError")} onRetry={() => void snapshotQ.refetch()} />
          )}
          <ul className="divide-y divide-border" aria-busy={snapshotQ.isFetching}>
            {tickers.map((ticker) => {
              const quote = snapshotQ.data?.snapshot[ticker];
              const loading = !quote && (snapshotQ.isPending || snapshotQ.isPlaceholderData);
              return (
                <li key={ticker} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40">
                  <Link
                    href={`/hisse/${ticker}`}
                    className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="block font-mono text-[13px] font-semibold text-foreground">{ticker}</span>
                    {names.get(ticker) && <span className="block truncate text-[11px] text-muted-foreground">{names.get(ticker)}</span>}
                  </Link>
                  {loading ? (
                    <span className="h-8 w-28 rounded-sm bg-muted/60 skeleton-shimmer" aria-hidden="true" />
                  ) : (
                    <span className="flex flex-col items-end gap-0.5 text-right">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">{formatNumber(quote?.last_price)}</span>
                        <ChangePill value={quote?.change_percent} />
                      </span>
                      {quote?.day_low != null && quote?.day_high != null && (
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground" title={t("watchlist.dayRange")}>
                          {formatNumber(quote.day_low)} – {formatNumber(quote.day_high)}
                        </span>
                      )}
                    </span>
                  )}
                  {editing && (
                    <button
                      type="button"
                      onClick={() => removeTicker(activeList.id, ticker)}
                      aria-label={t("watchlist.remove", { ticker })}
                      className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </DashboardCard>
  );
}
