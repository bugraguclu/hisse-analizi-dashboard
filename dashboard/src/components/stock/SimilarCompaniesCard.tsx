"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { usePanel } from "@/components/workspace/panel";
import { EMPTY_VALUE, formatNumber } from "@/lib/format";
import { sectorLabel } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { useCompanyPeers } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import {
  componentLabel,
  formatPeerValue,
  industryName,
  reasonText,
  visibleReasons,
  type CompanyPeers,
  type Peer,
  type PeerValueKey,
} from "./peers";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

/** Companies listed before "Tümünü göster". */
const TOP_PEERS = 5;

interface Column {
  metric: PeerValueKey;
  label: StockKey;
}

/** Size first (what the score weighs most after the sub-sector), then the profile, then valuation. */
const COLUMNS: readonly Column[] = [
  { metric: "market_cap", label: "peers.col.marketCap" },
  { metric: "revenue", label: "similar.col.revenue" },
  { metric: "ebitda_margin", label: "similar.col.ebitdaMargin" },
  { metric: "net_margin", label: "peers.col.netMargin" },
  { metric: "roe", label: "peers.col.roe" },
  { metric: "debt_to_equity", label: "similar.col.debtToEquity" },
  { metric: "revenue_growth_yoy", label: "similar.col.growth" },
  { metric: "pe", label: "stats.pe" },
  { metric: "pb", label: "stats.pb" },
];

/** The half-width column of /analiz keeps the size and the headline profitability. */
const COMPACT_COLUMNS: ReadonlySet<PeerValueKey> = new Set(["market_cap", "net_margin", "roe", "pe"]);

const CELL = "whitespace-nowrap border-b border-border px-3 py-2 text-right align-top font-mono tabular-nums";
/** First column: stays in view while the figures scroll sideways on a phone. */
const STICKY = "sticky left-0 z-10 border-b border-border py-2 pl-4 pr-3 text-left align-top max-sm:border-r";

/** A column is shown when the stock or any listed company has a value (banks have no EBITDA margin or revenue). */
function visibleColumns(peers: CompanyPeers, shown: readonly Peer[], compact: boolean): Column[] {
  return COLUMNS.filter(
    (column) =>
      (!compact || COMPACT_COLUMNS.has(column.metric)) &&
      (peers.company.values[column.metric] != null || shown.some((peer) => peer.values[column.metric] != null)),
  );
}

/**
 * The companies most like this one — same sub-sector (TradingView industry) and
 * KAP sector, close in size and financial profile — each with its similarity
 * score, its figures next to the stock's and the reasons it was picked. When the
 * sub-sector is too small the comparison widens to the sector and the card says
 * so. Neutral colours: a different figure is information, not a verdict.
 */
export function SimilarCompaniesCard({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const { t, locale } = useStockI18n();
  const peersQ = useCompanyPeers(ticker);
  const data = peersQ.data ?? null;
  const [expanded, setExpanded] = useState(false);
  const { fill, columns: slotColumns } = usePanel();
  const short = compact || (fill && slotColumns <= 3);

  // No KAP sector: the sector card is not shown either; nothing to compare, no card.
  if (peersQ.isSuccess && !data) return null;

  const title = t("similar.title");
  if (peersQ.isPending) {
    return (
      <SectionCard title={title}>
        <SectionSkeleton rows={6} />
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard title={title}>
        <SectionError error={peersQ.error} onRetry={() => void peersQ.refetch()} />
      </SectionCard>
    );
  }

  const sectorName = sectorLabel(data.sector.key, locale, data.sector.kapName);
  const kapNames = { [data.sector.key]: data.sector.kapName };
  const industry = data.industry ? industryName(data.industry, locale) : null;
  const intro =
    data.scope === "industry" && industry
      ? t("similar.scope.industry", { industry })
      : data.scope === "sector"
        ? industry
          ? t("similar.scope.sector", { industry, count: data.industry?.size ?? 1, sector: sectorName })
          : t("similar.scope.sectorNoIndustry", { sector: sectorName })
        : data.scope === "industry_wide" && industry
          ? t("similar.scope.industryWide", { industry, sector: sectorName })
          : null;

  const weights = data.weights.map(({ metric, weight }) => `${componentLabel(metric, locale)} ${formatNumber(weight, 0)}`).join(" · ");
  const footer = (
    <>
      {t("similar.footer", { weights })}
      <ApiDataMeta path={`/fundamentals/${ticker}/peers`} className="mt-1" />
    </>
  );

  if (data.peers.length === 0) {
    return (
      <SectionCard title={title} footer={footer}>
        <SectionEmpty message={t("similar.empty")} />
      </SectionCard>
    );
  }

  const shown = expanded || fill ? data.peers : data.peers.slice(0, TOP_PEERS);
  const columns = visibleColumns(data, data.peers, short);
  const unavailable = data.unavailable.map((metric) => componentLabel(metric, locale));

  const cell = (values: Peer["values"], loss: boolean, column: Column): ReactNode => {
    const number = values[column.metric];
    if (number != null) return formatPeerValue(column.metric, number);
    if (column.metric === "pe" && loss) {
      return <span className="font-sans text-[11px] text-muted-foreground">{t("score.lossMaking")}</span>;
    }
    return <span className="text-muted-foreground/70">{EMPTY_VALUE}</span>;
  };

  const nameBlock = (symbol: string, name: string | null, isSelf: boolean) => (
    <>
      <span className={cn("block font-mono text-[13px] font-semibold text-foreground", !isSelf && "group-hover:text-primary")}>
        {symbol}
        {isSelf ? <span className="sr-only"> {t("peers.thisStock")}</span> : null}
      </span>
      {name ? <span className="block max-w-[11rem] truncate text-[11px] font-normal text-muted-foreground sm:max-w-[16rem]">{name}</span> : null}
    </>
  );

  const peerRow = (peer: Peer) => {
    const reasons = visibleReasons(peer).map((item) => reasonText(item, locale, kapNames));
    return (
      <tr key={peer.symbol} className="group">
        <th scope="row" className={cn(STICKY, "bg-card font-normal transition-colors group-hover:bg-surface")}>
          <Link
            href={`/hisse/${encodeURIComponent(peer.symbol)}`}
            className="block min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            {nameBlock(peer.symbol, peer.name, false)}
          </Link>
          <p
            className="mt-1 max-w-[11rem] whitespace-normal text-[11px] leading-snug text-muted-foreground sm:max-w-[16rem]"
            title={t("similar.reasonTitle", { ticker })}
          >
            <span className="font-medium text-foreground/80">{t("similar.why")}</span>{" "}
            {reasons.length > 0 ? reasons.join(" · ") : t("similar.noReason")}
          </p>
        </th>
        <td className={cn(CELL, "font-semibold text-foreground transition-colors group-hover:bg-surface")}>{formatNumber(peer.score, 0)}</td>
        {columns.map((column) => (
          <td key={column.metric} className={cn(CELL, "text-foreground transition-colors group-hover:bg-surface")}>
            {cell(peer.values, peer.loss, column)}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <SectionCard title={title} footer={footer}>
      {intro ? <p className="mb-3 text-xs text-muted-foreground">{intro}</p> : null}
      <div className="relative -mx-4 overflow-x-auto scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <caption className="sr-only">{t("similar.caption", { ticker })}</caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th scope="col" className={cn(STICKY, "bg-card font-semibold", short ? "sm:w-52" : "sm:w-72")}>
                {t("peers.stock")}
              </th>
              <th scope="col" title={t("similar.scoreTitle")} className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold">
                {t("similar.score")}
              </th>
              {columns.map((column) => (
                <th key={column.metric} scope="col" className="whitespace-nowrap border-b border-border px-3 py-2 text-right font-semibold">
                  {t(column.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="font-semibold">
              <th scope="row" className={cn(STICKY, "bg-card font-normal shadow-[inset_2px_0_0_var(--foreground)]")}>
                <span className="block min-w-0">{nameBlock(data.company.symbol, data.company.name, true)}</span>
              </th>
              <td className={cn(CELL, "text-muted-foreground/70")}>{EMPTY_VALUE}</td>
              {columns.map((column) => (
                <td key={column.metric} className={cn(CELL, "text-foreground")}>
                  {cell(data.company.values, data.company.loss, column)}
                </td>
              ))}
            </tr>
            {shown.map(peerRow)}
          </tbody>
        </table>
      </div>
      {unavailable.length > 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">{t("similar.unavailable", { metrics: unavailable.join(", ") })}</p>
      ) : null}
      {!fill && data.peers.length > TOP_PEERS ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-3 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {expanded ? t("common.showLess") : t("common.showAllCount", { count: data.peers.length })}
        </button>
      ) : null}
    </SectionCard>
  );
}
