"use client";

import { Suspense, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { api, isApiError } from "@/lib/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { useLocale } from "@/lib/locale-context";
import type { IndicesOut, ScreenerOut, ScreenerRow } from "@/types";
import { IndicesStrip } from "@/components/tarama/IndicesStrip";
import {
  ScreenerFilters,
  RANGE_FILTER_KEYS,
  EMPTY_RANGE_FILTERS,
  rangesToApiFilters,
  type RangeFilters,
} from "@/components/tarama/ScreenerFilters";
import { ScreenerTable, type ScreenerSortKey } from "@/components/tarama/ScreenerTable";
import { ScannerPanel, type ScannerRow } from "@/components/tarama/ScannerPanel";
import { CompaniesGrid } from "@/components/tarama/CompaniesGrid";

const PAGE_SIZE = 25;

const stagger = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: Math.min(i * 0.04, 0.12), duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function getSortValue(row: ScreenerRow, key: ScreenerSortKey): string | number | null {
  switch (key) {
    case "symbol":
      return String(row.symbol ?? "");
    case "close":
      return typeof row.close === "number" ? row.close : null;
    case "change_pct": {
      const v = row.change_pct ?? row.change_percent;
      return typeof v === "number" ? v : null;
    }
    case "volume":
      return typeof row.volume === "number" ? row.volume : null;
    case "market_cap":
      return typeof row.market_cap === "number" ? row.market_cap : null;
    default:
      return null;
  }
}

function TaramaPageInner() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTemplate = searchParams.get("template") ?? "";
  const sortKey = (searchParams.get("sort") as ScreenerSortKey | null) ?? "symbol";
  const sortDir = searchParams.get("dir") === "desc" ? "desc" : "asc";
  const page = Math.max(0, Number(searchParams.get("page") ?? "0") || 0);
  const condition = searchParams.get("condition") ?? "";

  const ranges: RangeFilters = useMemo(() => {
    const out = { ...EMPTY_RANGE_FILTERS };
    for (const key of RANGE_FILTER_KEYS) {
      out[key] = [searchParams.get(`${key}_min`) ?? "", searchParams.get(`${key}_max`) ?? ""];
    }
    return out;
  }, [searchParams]);

  const setParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  const templatesQ = useQuery({ queryKey: ["screenerTemplates"], queryFn: () => api.screenerTemplates(), staleTime: 300_000 });
  const templatesRaw = templatesQ.data as { templates?: unknown } | null;
  const templates: string[] = Array.isArray(templatesRaw?.templates) ? templatesRaw.templates.map(String) : [];

  const rangeFilterPayload = useMemo(() => rangesToApiFilters(ranges), [ranges]);
  const screenerFilters = useMemo(() => {
    const payload: Record<string, unknown> = { ...rangeFilterPayload };
    if (activeTemplate) payload.template = activeTemplate;
    return payload;
  }, [activeTemplate, rangeFilterPayload]);
  const hasScreenerFilters = Object.keys(screenerFilters).length > 0;

  const screenerQ = useQuery({
    queryKey: ["screener", activeTemplate, JSON.stringify(rangeFilterPayload)],
    queryFn: () => (hasScreenerFilters ? api.screener(screenerFilters) : api.screener()) as Promise<ScreenerOut | ScreenerRow[]>,
  });
  const screenerData = screenerQ.data;
  const stocks: ScreenerRow[] = useMemo(() => (
    Array.isArray(screenerData)
      ? screenerData
      : Array.isArray(screenerData?.results)
        ? screenerData.results
        : []
  ), [screenerData]);

  const sortedStocks = useMemo(() => {
    const arr = [...stocks];
    arr.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" || typeof bv === "string"
        ? String(av).localeCompare(String(bv), "tr")
        : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [stocks, sortKey, sortDir]);

  const scannerQ = useQuery({
    queryKey: ["scanner", condition],
    queryFn: () => api.scanner(condition || undefined) as Promise<{ results?: ScannerRow[] } | ScannerRow[]>,
  });
  const scannerData = scannerQ.data;
  const scanResults: ScannerRow[] = Array.isArray(scannerData)
    ? scannerData
    : Array.isArray(scannerData?.results)
      ? scannerData.results
      : [];

  const indicesQ = useQuery({ queryKey: ["indexQuotes"], queryFn: () => api.indices() as Promise<IndicesOut>, staleTime: 120_000 });

  const allCompaniesQ = useQuery({ queryKey: ["allCompanies"], queryFn: () => api.allCompanies() as Promise<{ companies?: Array<{ symbol?: string; name?: string }> }>, staleTime: 300_000 });
  const companies = (allCompaniesQ.data?.companies ?? [])
    .filter((c) => c.symbol)
    .map((c) => ({ symbol: String(c.symbol), name: String(c.name ?? "") }));

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
            <Search className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">{t("nav.screening")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("tarama.screenerDesc")}</p>
          </div>
        </div>
      </motion.div>

      <motion.div custom={1} variants={stagger} initial="hidden" animate="show">
        <IndicesStrip
          data={indicesQ.data}
          isLoading={indicesQ.isLoading}
          isError={indicesQ.isError}
          errorMessage={isApiError(indicesQ.error) ? indicesQ.error.detail : undefined}
          onRetry={() => { void indicesQ.refetch(); }}
        />
      </motion.div>

      <motion.div custom={2} variants={stagger} initial="hidden" animate="show">
        <ScreenerFilters
          templates={templates}
          activeTemplate={activeTemplate}
          onTemplateChange={(id) => setParams({ template: id || null, page: null })}
          initialRanges={ranges}
          onRangesCommit={(next) => {
            const updates: Record<string, string | null> = { page: null };
            for (const key of RANGE_FILTER_KEYS) {
              updates[`${key}_min`] = next[key][0] || null;
              updates[`${key}_max`] = next[key][1] || null;
            }
            setParams(updates);
          }}
        />
      </motion.div>

      <motion.div custom={3} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("tarama.results")}</h2>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">{stocks.length} {t("common.stocks")}</span>
        </div>
        <ScreenerTable
          rows={sortedStocks}
          isLoading={screenerQ.isLoading}
          isError={screenerQ.isError}
          errorMessage={isApiError(screenerQ.error) ? screenerQ.error.detail : undefined}
          onRetry={() => { void screenerQ.refetch(); }}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={(key) => {
            if (key === sortKey) setParams({ dir: sortDir === "asc" ? "desc" : "asc", page: null });
            else setParams({ sort: key, dir: key === "symbol" ? "asc" : "desc", page: null });
          }}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => setParams({ page: p > 0 ? String(p) : null })}
        />
      </motion.div>

      <motion.div custom={4} variants={stagger} initial="hidden" animate="show">
        <ScannerPanel
          condition={condition}
          onConditionChange={(v) => setParams({ condition: v || null })}
          rows={scanResults}
          isLoading={scannerQ.isLoading}
          isError={scannerQ.isError}
          errorMessage={isApiError(scannerQ.error) ? scannerQ.error.detail : undefined}
          onRetry={() => { void scannerQ.refetch(); }}
        />
      </motion.div>

      <motion.div custom={5} variants={stagger} initial="hidden" animate="show">
        <CompaniesGrid companies={companies} />
      </motion.div>
    </div>
  );
}

export default function TaramaPage() {
  const { t } = useLocale();
  return (
    <Suspense fallback={<LoadingSpinner text={t("common.loading")} />}>
      <TaramaPageInner />
    </Suspense>
  );
}
