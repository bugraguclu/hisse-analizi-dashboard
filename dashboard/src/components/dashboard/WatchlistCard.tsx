"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Archive, Plus, Trash2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";
import { formatMarketDate, formatNumber } from "@/lib/format";
import { buildOfflineWatchlistSnapshot } from "@/lib/local-store/offline-cache";
import { STALE_TIME } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/shell-context";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import { useIsDisconnected, useOfflineSummary } from "@/hooks/use-network-status";
import { DEFAULT_WATCHLIST_ID, useWatchlists, type Watchlist, type WatchlistUndoReceipt } from "@/hooks/use-watchlists";
import { useCompanies } from "./queries";
import { CardBody, CardHeading, ChangePill, DashboardCard } from "./ui";

const HEADING_ID = "watchlist-heading";

export function WatchlistCard({ className }: { className?: string }) {
  const { t } = useLocale();
  const { openWorkspaceManager } = useShell();
  const { lists, createList, deleteList, addTicker, removeTicker, undoChange } = useWatchlists();
  const disconnected = useIsDisconnected();
  const offlineSummary = useOfflineSummary();
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
  const offlineWatchlist = useMemo(
    () => buildOfflineWatchlistSnapshot(offlineSummary, tickers),
    [offlineSummary, tickers],
  );
  const usingOfflineCache = !snapshotQ.data && (snapshotQ.isError || disconnected) && offlineWatchlist !== null;
  const effectiveSnapshot = snapshotQ.data ?? (usingOfflineCache ? offlineWatchlist.snapshot : undefined);
  const names = useMemo(() => {
    const live = companiesQ.data;
    if (live && live.length > 0) return new Map(live.map((c) => [c.ticker, c.display_name]));
    return new Map((offlineSummary?.companies?.items ?? []).map((c) => [c.ticker, c.display_name]));
  }, [companiesQ.data, offlineSummary]);

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

  function offerUndo(message: string, receipt: WatchlistUndoReceipt | null, onRestored?: () => void) {
    if (!receipt) return;
    toast(message, {
      action: {
        label: t("watchlist.undo"),
        onClick: () => {
          const outcome = undoChange(receipt);
          if (outcome === "undone") {
            onRestored?.();
            toast.success(t("watchlist.undone"));
          } else if (outcome === "expired") {
            toast.warning(t("watchlist.undoExpired"));
          } else {
            toast.warning(t("watchlist.undoConflict"));
          }
        },
      },
    });
  }

  function handleRemoveTicker(listId: string, ticker: string) {
    const receipt = removeTicker(listId, ticker);
    offerUndo(t("watchlist.tickerRemoved", { ticker }), receipt);
  }

  function handleDelete() {
    if (lists.length <= 1) return;
    const deletedId = activeList.id;
    const deletedName = listLabel(activeList);
    const receipt = deleteList(deletedId);
    if (!receipt) return;
    setSelectedId(lists.find((l) => l.id !== deletedId)?.id ?? DEFAULT_WATCHLIST_ID);
    offerUndo(t("watchlist.listDeleted", { name: deletedName }), receipt, () => setSelectedId(deletedId));
  }

  return (
    // overflow-visible: the add-stock search dropdown must not be clipped by the card.
    <DashboardCard labelledBy={HEADING_ID} className={cn("overflow-visible", className)} entranceOrder={1}>
      <CardHeading
        id={HEADING_ID}
        title={t("dashboard.watchlist")}
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setEditing((value) => !value);
                setNotice(null);
              }}
              aria-expanded={editing}
              className="rounded-sm text-xs text-primary underline-offset-4 motion-press hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {editing ? t("watchlist.done") : t("watchlist.editLists")}
            </button>
          </div>
        }
      />

      {lists.length > 1 && (
        <div role="group" aria-label={t("watchlist.lists")} className="flex shrink-0 items-center gap-4 overflow-x-auto border-b border-border px-4 scrollbar-none">
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => setSelectedId(list.id)}
              aria-pressed={list.id === activeList.id}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 py-2 text-xs font-medium motion-press focus-visible:outline-2 focus-visible:outline-ring",
                list.id === activeList.id ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {listLabel(list)}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="shrink-0 space-y-3 border-b border-border bg-surface/60 px-4 py-3">
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
              className="inline-flex h-8 items-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background motion-press hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t("watchlist.newList")}
            </button>
          </form>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            {lists.length > 1 ? (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive motion-press hover:text-destructive/80"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                {t("watchlist.deleteList")}: {listLabel(activeList)}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openWorkspaceManager("backup")}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              {t("offline.backupShortcut")}
            </button>
          </div>
        </div>
      )}

      <CardBody>
        {tickers.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{t("watchlist.emptyList")}</p>
        ) : (
          <>
            {usingOfflineCache && offlineWatchlist && (
              <div role="status" className="flex items-center justify-between gap-2 border-b border-border bg-warn/10 px-4 py-1.5 text-[11px] text-warn">
                <span className="inline-flex items-center gap-1.5">
                  <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {t("offline.cachedBadge", { time: formatMarketDate(offlineWatchlist.newestSavedAt, "dayMonthTime") })}
                </span>
                <span className="hidden text-[10px] text-muted-foreground sm:inline">{t("offline.delayNote")}</span>
              </div>
            )}
            {snapshotQ.isError && !effectiveSnapshot && (
              <ErrorState compact message={t("watchlist.quoteError")} onRetry={() => void snapshotQ.refetch()} />
            )}
            {/* A wide card lists the stocks in two columns instead of stretching each row. */}
            <ul className="slot-wide:grid slot-wide:grid-cols-2 slot-wide:gap-x-6 skeleton-rows" aria-busy={snapshotQ.isFetching && !usingOfflineCache}>
              {tickers.map((ticker) => {
                const quote = effectiveSnapshot?.snapshot[ticker];
                const loading = !quote && !usingOfflineCache && (snapshotQ.isPending || snapshotQ.isPlaceholderData);
                return (
                  <li
                    key={ticker}
                    className="flex items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 hover:bg-muted/40 slot-wide:last:border-b"
                  >
                    <Link
                      href={`/hisse/${ticker}`}
                      className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="block font-mono text-[13px] font-semibold text-foreground">{ticker}</span>
                      {names.get(ticker) && <span className="block truncate text-[11px] text-muted-foreground">{names.get(ticker)}</span>}
                    </Link>
                    {loading ? (
                      <span className="flex h-8 w-28 shrink-0 flex-col items-end justify-center gap-1" aria-hidden="true">
                        <span className="flex items-center gap-2">
                          <Skeleton as="span" className="h-3.5 w-12 origin-right" />
                          <Skeleton as="span" className="h-4 w-12 origin-right" />
                        </span>
                        <Skeleton as="span" className="h-2.5 w-20 origin-right bg-skeleton/70" />
                      </span>
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
                        onClick={() => handleRemoveTicker(activeList.id, ticker)}
                        aria-label={t("watchlist.remove", { ticker })}
                        className="rounded-sm p-1 text-muted-foreground motion-press hover:bg-destructive/10 hover:text-destructive"
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
      </CardBody>
    </DashboardCard>
  );
}
