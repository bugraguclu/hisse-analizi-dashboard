"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { EMPTY_VALUE, formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { sectorHref } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { useCompanySector } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { CompanySector, SectorMetricKey, SectorPeer } from "./sector";
import { SectorLink, useSectorName } from "./sector-ui";
import { SectionCard, SectionError, SectionSkeleton } from "./ui";

/** Companies listed before "Tümünü göster": the largest by market cap. */
const TOP_PEERS = 8;

interface Column {
  metric: SectorMetricKey;
  label: StockKey;
  format: (value: number) => string;
}

/** Valuation first (the screener's fundamentals view has the same figures), then profitability and dividends. */
const COLUMNS: readonly Column[] = [
  { metric: "market_cap", label: "peers.col.marketCap", format: (v) => formatCompact(v) },
  { metric: "pe", label: "stats.pe", format: (v) => formatNumber(v) },
  { metric: "pb", label: "stats.pb", format: (v) => formatNumber(v) },
  { metric: "ev_ebitda", label: "profile.evEbitda", format: (v) => formatNumber(v) },
  { metric: "net_margin", label: "peers.col.netMargin", format: (v) => formatPercent(v, 1) },
  { metric: "roe", label: "peers.col.roe", format: (v) => formatPercent(v, 1) },
  { metric: "dividend_yield", label: "peers.col.dividendYield", format: (v) => formatPercent(v) },
];

/** The half-width column of /analiz keeps the headline figures. */
const COMPACT_COLUMNS: ReadonlySet<SectorMetricKey> = new Set(["market_cap", "pe", "pb", "roe", "dividend_yield"]);

const CELL = "whitespace-nowrap border-b border-border px-3 py-2 text-right font-mono tabular-nums";
/** First column: stays in view while the figures scroll sideways on a phone. */
const STICKY = "sticky left-0 z-10 border-b border-border py-2 pl-4 pr-3 text-left max-sm:border-r";

/** A column is shown when any company, or the median, has a value (a bank has no EV/EBITDA or margin). */
function visibleColumns(sector: CompanySector, compact: boolean): Column[] {
  return COLUMNS.filter(
    (column) =>
      (!compact || COMPACT_COLUMNS.has(column.metric)) &&
      (sector.metrics[column.metric]?.median != null || sector.peers.some((peer) => peer.values[column.metric] != null)),
  );
}

/**
 * The stock next to its KAP sector: the stock's row, the sector average
 * (median) and the sector's largest companies, with a link to Hisse Tarama
 * narrowed to the sector (every company, sortable). Neutral colours throughout:
 * above or below the median is information, not good or bad news.
 */
export function SectorComparisonCard({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const { t } = useStockI18n();
  const sectorQ = useCompanySector(ticker);
  const sector = sectorQ.data ?? null;
  const sectorName = useSectorName(sector);
  const [expanded, setExpanded] = useState(false);

  // No KAP sector (a handful of listings): nothing to compare, no card.
  if (sectorQ.isSuccess && !sector) return null;

  const title = t("peers.title");
  if (sectorQ.isPending) {
    return (
      <SectionCard title={title}>
        <SectionSkeleton rows={6} />
      </SectionCard>
    );
  }
  if (!sector || !sectorName) {
    return (
      <SectionCard title={title}>
        <SectionError error={sectorQ.error} onRetry={() => void sectorQ.refetch()} />
      </SectionCard>
    );
  }

  const columns = visibleColumns(sector, compact);
  const self = sector.peers.find((peer) => peer.symbol === ticker) ?? null;
  const others = sector.peers.filter((peer) => peer.symbol !== ticker);
  const shown = expanded ? others : others.slice(0, TOP_PEERS);
  const hasMedian = columns.some((column) => sector.metrics[column.metric]?.median != null);

  const value = (peer: SectorPeer, column: Column): ReactNode => {
    const number = peer.values[column.metric];
    if (number != null) return column.format(number);
    if (column.metric === "pe" && peer.loss) {
      return <span className="font-sans text-[11px] text-muted-foreground">{t("score.lossMaking")}</span>;
    }
    return <span className="text-muted-foreground/70">{EMPTY_VALUE}</span>;
  };

  const peerRow = (peer: SectorPeer, isSelf: boolean) => (
    <tr key={peer.symbol} className={cn("group", isSelf && "font-semibold")}>
      <th
        scope="row"
        className={cn(
          STICKY,
          "font-normal transition-colors",
          isSelf ? "bg-card shadow-[inset_2px_0_0_var(--foreground)]" : "bg-card group-hover:bg-surface",
        )}
      >
        {isSelf ? (
          <span className="block min-w-0">
            <span className="block font-mono text-[13px] font-semibold text-foreground">
              {peer.symbol}
              <span className="sr-only"> {t("peers.thisStock")}</span>
            </span>
            {peer.name ? <span className="block max-w-[11rem] truncate text-[11px] font-normal text-muted-foreground sm:max-w-[16rem]">{peer.name}</span> : null}
          </span>
        ) : (
          <Link href={`/hisse/${encodeURIComponent(peer.symbol)}`} className="block min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            <span className="block font-mono text-[13px] font-semibold text-foreground group-hover:text-primary">{peer.symbol}</span>
            {peer.name ? <span className="block max-w-[11rem] truncate text-[11px] text-muted-foreground sm:max-w-[16rem]">{peer.name}</span> : null}
          </Link>
        )}
      </th>
      {columns.map((column) => (
        <td key={column.metric} className={cn(CELL, "text-foreground transition-colors", !isSelf && "group-hover:bg-surface")}>
          {value(peer, column)}
        </td>
      ))}
    </tr>
  );

  return (
    <SectionCard
      title={title}
      actions={
        <Link
          href={sectorHref(sector.key, "fundamentals")}
          className="inline-flex items-center gap-1 rounded-sm text-[11px] font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t("peers.openScreener")}
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
      footer={
        <>
          {t("peers.footer")}
          <ApiDataMeta path={`/fundamentals/${ticker}/sector`} className="mt-1" />
        </>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        <SectorLink sector={sector} view="fundamentals" className="font-medium text-foreground" />
        {" · "}
        {t("peers.count", { count: sector.size })}
      </p>
      {!hasMedian ? <p className="mb-3 text-xs text-muted-foreground">{t("peers.noMedian", { count: sector.size, min: sector.minCompanies })}</p> : null}
      <div className="relative -mx-4 overflow-x-auto scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">{t("peers.caption", { ticker, sector: sectorName })}</caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* A set width: with few figure columns (a bank's) the spare room goes between the figures. */}
              <th scope="col" className={cn(STICKY, "bg-card font-semibold", compact ? "sm:w-52" : "sm:w-64")}>
                {t("peers.stock")}
              </th>
              {columns.map((column) => (
                <th key={column.metric} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold">
                  {t(column.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {self ? peerRow(self, true) : null}
            {hasMedian ? (
              <tr>
                <th scope="row" className={cn(STICKY, "bg-surface font-normal")}>
                  <span className="block text-[12px] font-semibold text-foreground">{t("peers.average")}</span>
                  <span className="block text-[11px] text-muted-foreground">{t("peers.averageDetail", { count: sector.size })}</span>
                </th>
                {columns.map((column) => {
                  const median = sector.metrics[column.metric]?.median;
                  return (
                    <td key={column.metric} className={cn(CELL, "bg-surface font-semibold text-foreground")}>
                      {median != null ? column.format(median) : <span className="font-normal text-muted-foreground/70">{EMPTY_VALUE}</span>}
                    </td>
                  );
                })}
              </tr>
            ) : null}
            {shown.map((peer) => peerRow(peer, false))}
          </tbody>
        </table>
      </div>
      {others.length > TOP_PEERS ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-3 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {expanded ? t("common.showLess") : t("common.showAllCount", { count: sector.peers.length })}
        </button>
      ) : null}
    </SectionCard>
  );
}
