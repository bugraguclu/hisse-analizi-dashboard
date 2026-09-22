"use client";

import { Suspense, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Newspaper } from "lucide-react";
import { api, isApiError } from "@/lib/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useLocale } from "@/lib/locale-context";
import type { SourceOut } from "@/types";
import { EventFilters } from "@/components/events/EventFilters";
import { EventsTable } from "@/components/events/EventsTable";
import { EventDetailModal } from "@/components/events/EventDetailModal";

const PAGE_SIZE = 25;

const stagger = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: Math.min(i * 0.04, 0.12), duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function EventsPageInner() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const sourceCode = searchParams.get("source") ?? "";
  const ticker = (searchParams.get("ticker") ?? "").toUpperCase();
  const search = searchParams.get("search") ?? "";
  const category = searchParams.get("category") ?? "";
  const severity = searchParams.get("severity") ?? "";
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";
  const page = Math.max(0, Number(searchParams.get("page") ?? "0") || 0);
  const selectedEventId = searchParams.get("event");

  // Single place that reads+writes the URL query string so every filter
  // (and the currently open event) is shareable and restorable on reload.
  const setParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const sourcesQ = useQuery({ queryKey: ["sources"], queryFn: () => api.sources(), staleTime: 300_000 });
  const sources: SourceOut[] = (Array.isArray(sourcesQ.data) ? sourcesQ.data : []).filter((s) => s.enabled);

  // since/until are sent as naive "local" datetimes — B3's contract treats a
  // timezone-less value as Europe/Istanbul, so no manual offset needed.
  const sinceIso = since ? `${since}T00:00:00` : undefined;
  const untilIso = until ? `${until}T23:59:59` : undefined;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["events", sourceCode, ticker, search, category, severity, since, until, page],
    queryFn: ({ signal }) =>
      api.eventsPage({
        source_code: sourceCode || undefined,
        ticker: ticker || undefined,
        search: !ticker && search ? search : undefined,
        category: category || undefined,
        severity: severity || undefined,
        since: sinceIso,
        until: untilIso,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }, signal),
  });

  const pageEvents = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;
  const hasPrev = page > 0;

  const emptyMessage = ticker
    ? `"${ticker}" ${t("events.noEventsForTicker")}`
    : t("events.noEventsFiltered");

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
            <Newspaper className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">{t("events.title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("events.subtitle")}</p>
          </div>
        </div>
      </motion.div>

      <motion.div custom={1} variants={stagger} initial="hidden" animate="show">
        <EventFilters
          sources={sources}
          values={{ sourceCode, ticker, search, category, severity, since, until }}
          onSourceChange={(code) => setParams({ source: code || null, page: null })}
          onTickerSelect={(tk) => setParams({ ticker: tk || null, search: null, page: null })}
          onSearchChange={(q) => setParams({ search: q || null, ticker: null, page: null })}
          onTickerClear={() => setParams({ ticker: null, search: null, page: null })}
          onCategoryChange={(v) => setParams({ category: v || null, page: null })}
          onSeverityChange={(v) => setParams({ severity: v || null, page: null })}
          onSinceChange={(v) => setParams({ since: v || null, page: null })}
          onUntilChange={(v) => setParams({ until: v || null, page: null })}
        />
      </motion.div>

      <motion.div custom={2} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        <EventsTable
          events={pageEvents}
          total={total}
          isLoading={isLoading}
          isError={isError}
          errorMessage={isApiError(error) ? error.detail : undefined}
          onRetry={() => { void refetch(); }}
          emptyMessage={emptyMessage}
          onRowSelect={(id) => setParams({ event: id })}
          page={page}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => setParams({ page: page > 1 ? String(page - 1) : null })}
          onNext={() => setParams({ page: String(page + 1) })}
        />
      </motion.div>

      <AnimatePresence>
        {selectedEventId && (
          <EventDetailModal eventId={selectedEventId} onClose={() => setParams({ event: null })} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function EventsPage() {
  const { t } = useLocale();
  return (
    <Suspense fallback={<LoadingSpinner text={t("common.loading")} />}>
      <EventsPageInner />
    </Suspense>
  );
}
