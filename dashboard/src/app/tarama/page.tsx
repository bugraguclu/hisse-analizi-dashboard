"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { RowSkeleton } from "@/components/dashboard/ui";
import { ScreenerFilters, type StateUpdate } from "@/components/tarama/ScreenerFilters";
import { ScreenerResults } from "@/components/tarama/ScreenerResults";
import type { TableContext } from "@/components/tarama/ScreenerTable";
import { sectorLabel, useTaramaI18n } from "@/components/tarama/i18n";
import { buildCsvColumns, csvFileName } from "@/components/tarama/csv";
import {
  DEFAULT_STATE,
  breadth,
  clearFilters,
  defaultDir,
  filterRows,
  hasFilters,
  hasLegacyParams,
  paginate,
  parseState,
  serializeState,
  sortRows,
  toCsv,
  type ScreenerState,
  type SortKey,
  type ViewKey,
} from "@/components/tarama/model";
import { api, isApiError } from "@/lib/api";
import { formatMarketDate } from "@/lib/format";
import { STALE_TIME } from "@/lib/queryClient";
import { useLiveRefetchInterval } from "@/hooks/use-market-status";
import { useNow } from "@/hooks/use-now";
import { DEFAULT_WATCHLIST_ID, useWatchlists } from "@/hooks/use-watchlists";

/** The universe endpoint is cached for 120 s on the backend. */
const REFRESH_MS = 120_000;

function Header({ asOf, delay }: { asOf?: string; delay?: number }) {
  const { t } = useTaramaI18n();
  const now = useNow();
  let status: string | null = null;
  if (asOf && now !== null) {
    const sameDay = formatMarketDate(asOf, "date") === formatMarketDate(now, "date");
    status = t("status.updated", { time: formatMarketDate(asOf, sameDay ? "time" : "dayMonthTime") });
    if (delay) status += ` · ${t("status.delayed", { minutes: delay })}`;
  }
  return (
    <PageHeader
      title={t("page.title")}
      description={t("page.description")}
      actions={status ? <p className="text-[11px] text-muted-foreground">{status}</p> : undefined}
    />
  );
}

function Screener() {
  const { t, locale } = useTaramaI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useMemo(() => parseState(new URLSearchParams(search)), [search]);

  // Updates are applied to the newest state, not to the URL that may not have caught up
  // yet — a debounced edit and a click landing in the same tick must not undo each other.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const navigate = useCallback(
    (next: ScreenerState) => {
      latest.current = next;
      const query = serializeState(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const update = useCallback<StateUpdate>(
    (change) => {
      const previous = latest.current;
      const next = change(previous);
      if (serializeState(next) !== serializeState(previous)) navigate(next);
    },
    [navigate],
  );

  // Old links (?template=low_pe, ?condition=golden_cross, million-TL bounds) → current format.
  useEffect(() => {
    if (hasLegacyParams(new URLSearchParams(search))) navigate(parseState(new URLSearchParams(search)));
  }, [search, navigate]);

  const refetchInterval = useLiveRefetchInterval(REFRESH_MS);
  const universeQ = useQuery({
    queryKey: ["screenerUniverse"],
    queryFn: ({ signal }) => api.screenerUniverse(signal),
    staleTime: STALE_TIME.market,
    refetchInterval,
  });
  const data = universeQ.data;
  const status = data ? "ready" : universeQ.isError ? "error" : "loading";

  const turkishSectors = useMemo(() => new Map((data?.sectors ?? []).map((sector) => [sector.key, sector.name_tr])), [data]);
  const sectorName = useCallback((key: string) => sectorLabel(key, locale, turkishSectors), [locale, turkishSectors]);
  const industryName = useCallback((key: string) => (locale === "tr" ? (data?.industries[key] ?? key) : key), [locale, data]);

  const filtered = useMemo(() => (data ? filterRows(data.rows, state) : []), [data, state]);
  const sorted = useMemo(() => sortRows(filtered, state.sort, state.dir, sectorName), [filtered, state.sort, state.dir, sectorName]);
  const slice = useMemo(() => paginate(sorted, state.page, state.size), [sorted, state.page, state.size]);
  const counts = useMemo(() => breadth(filtered), [filtered]);

  const { lists, addTicker, removeTicker } = useWatchlists();
  const favoritesList = lists.find((list) => list.id === DEFAULT_WATCHLIST_ID) ?? lists[0];
  const favorites = useMemo(() => new Set(favoritesList?.tickers ?? []), [favoritesList]);
  const toggleFavorite = useCallback(
    (ticker: string) => {
      if (!favoritesList) return;
      if (favorites.has(ticker)) {
        removeTicker(favoritesList.id, ticker);
        toast(t("watch.removed", { ticker }));
        return;
      }
      const result = addTicker(favoritesList.id, ticker);
      if (result === "added") toast.success(t("watch.added", { ticker }));
      else if (result === "full") toast.error(t("watch.full"));
    },
    [favoritesList, favorites, addTicker, removeTicker, t],
  );

  const resultsRef = useRef<HTMLDivElement>(null);
  const goToPage = useCallback(
    (page: number) => {
      update((prev) => ({ ...prev, page }));
      // Paging from the bottom pager: bring the top of the table back into view.
      const node = resultsRef.current;
      if (node && node.getBoundingClientRect().top < 0) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        node.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      }
    },
    [update],
  );

  const context: TableContext = useMemo(() => ({ t, sectorName, industryName }), [t, sectorName, industryName]);

  function exportCsv() {
    const csv = toCsv(sorted, buildCsvColumns(locale, sectorName), locale !== "en");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFileName(data?.as_of);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const errorMessage = isApiError(universeQ.error) ? universeQ.error.detail : undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Header asOf={data?.as_of} delay={data?.delay_minutes} />

      <ScreenerFilters state={state} onChange={update} data={data} />

      <div ref={resultsRef} className="scroll-mt-20">
        <ScreenerResults
          state={state}
          data={data}
          status={status}
          errorMessage={errorMessage}
          onRetry={() => void universeQ.refetch()}
          isRefreshing={universeQ.isFetching && !universeQ.isPending}
          slice={slice}
          breadth={counts}
          hasFilters={hasFilters(state)}
          favorites={favorites}
          context={context}
          onView={(view: ViewKey) => update((prev) => ({ ...prev, view }))}
          onSort={(key: SortKey) =>
            update((prev) => ({
              ...prev,
              sort: key,
              dir: prev.sort === key ? (prev.dir === "asc" ? "desc" : "asc") : defaultDir(key),
              page: 1,
            }))
          }
          onResetSort={() => update((prev) => ({ ...prev, sort: DEFAULT_STATE.sort, dir: DEFAULT_STATE.dir, page: 1 }))}
          onPage={goToPage}
          onToggleFavorite={toggleFavorite}
          onClearFilters={() => update(clearFilters)}
          onExport={exportCsv}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("status.sources")} · {t("status.notAdvice")}
      </p>
    </div>
  );
}

function ScreenerFallback() {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-busy="true">
      <Header />
      <div className="card-surface h-40 skeleton-shimmer bg-muted/40" aria-hidden="true" />
      <div className="card-surface">
        <RowSkeleton rows={8} />
      </div>
    </div>
  );
}

export default function TaramaPage() {
  // useSearchParams needs a Suspense boundary for the static shell.
  return (
    <Suspense fallback={<ScreenerFallback />}>
      <Screener />
    </Suspense>
  );
}
