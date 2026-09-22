"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Eye, Plus, Trash2, X } from "lucide-react";
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
        icon={<Eye className="h-4 w-4" />}
        title={t("dashboard.watchlist")}
        action={
          <button
            type="button"
            onClick={() => {
              setEditing((value) => !value);
              setNotice(null);
            }}
            aria-expanded={editing}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {editing ? t("watchlist.done") : t("watchlist.editLists")}
          </button>
        }
      />

      {lists.length > 1 && (
        <div role="group" aria-label={t("watchlist.lists")} className="flex items-center gap-1 overflow-x-auto px-5 pb-2">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => setSelectedId(list.id)}
              aria-pressed={list.id === activeList.id}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                list.id === activeList.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {listLabel(list)}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-3 border-b border-border/40 px-5 pb-4">
          <div>
            <p className="mb-1.5 text-[11px] text-muted-foreground">{t("watchlist.addHint")}</p>
            <TickerSearch onSelect={handleAdd} />
            {notice && (
              <p role="status" className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
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
              className="h-8 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 text-xs text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="submit"
              disabled={!newListName.trim()}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
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
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">{t("watchlist.emptyList")}</p>
      ) : (
        <>
          {snapshotQ.isError && !snapshotQ.data && (
            <ErrorState compact message={t("watchlist.quoteError")} onRetry={() => void snapshotQ.refetch()} />
          )}
          <ul className="divide-y divide-border/30" aria-busy={snapshotQ.isFetching}>
            {tickers.map((ticker) => {
              const quote = snapshotQ.data?.snapshot[ticker];
              const loading = !quote && (snapshotQ.isPending || snapshotQ.isPlaceholderData);
              return (
                <li key={ticker} className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-muted/20">
                  <Link
                    href={`/hisse/${ticker}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[10px] font-bold text-primary" aria-hidden="true">
                      {ticker.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{ticker}</span>
                      {names.get(ticker) && <span className="block truncate text-[11px] text-muted-foreground">{names.get(ticker)}</span>}
                    </span>
                  </Link>
                  {loading ? (
                    <span className="h-8 w-28 animate-pulse rounded-md bg-muted/40" aria-hidden="true" />
                  ) : (
                    <span className="flex flex-col items-end gap-0.5 text-right">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{formatNumber(quote?.last_price)}</span>
                        <ChangePill value={quote?.change_percent} className="min-w-[4rem]" />
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
                      className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10"
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
