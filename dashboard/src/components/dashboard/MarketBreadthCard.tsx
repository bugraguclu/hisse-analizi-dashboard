"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { formatNumber, toFiniteNumber } from "@/lib/format";
import type { Company, ScreenerRow } from "@/types";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useCompanies, useScreenerRows } from "./queries";
import { CardHeading, ChangePill, DashboardCard, RowSkeleton } from "./ui";

const HEADING_ID = "breadth-heading";
const MOVER_COUNT = 5;
/** Below this many tracked symbols in the screener, fall back to the whole market. */
const MIN_TRACKED = 20;
/** Moves smaller than this (in %) round to 0,00 and count as unchanged. */
const FLAT_EPSILON = 0.005;

export interface Mover {
  ticker: string;
  name: string;
  price: number | null;
  change: number;
}

export interface Breadth {
  scope: "bist100" | "all";
  up: number;
  down: number;
  flat: number;
  gainers: Mover[];
  losers: Mover[];
}

function rowChange(row: ScreenerRow): number | null {
  return toFiniteNumber(row.change_pct ?? row.change_percent);
}

/**
 * Advancers/decliners and top movers from screener rows. Uses the tracked
 * BIST 100 constituents when available (so penny stocks at the ±10 % limit
 * don't dominate), otherwise every row. Rows without a change are skipped.
 */
export function computeBreadth(rows: readonly ScreenerRow[], companies: readonly Company[] | undefined): Breadth {
  const names = new Map((companies ?? []).map((c) => [c.ticker, c.display_name]));
  const tracked = rows.filter((row) => names.has(row.symbol));
  const scope = tracked.length >= MIN_TRACKED ? "bist100" : "all";
  const universe = scope === "bist100" ? tracked : rows;

  let up = 0;
  let down = 0;
  let flat = 0;
  const movers: Mover[] = [];
  for (const row of universe) {
    const change = rowChange(row);
    if (change === null || !row.symbol) continue;
    if (Math.abs(change) < FLAT_EPSILON) flat += 1;
    else if (change > 0) up += 1;
    else down += 1;
    movers.push({ ticker: row.symbol, name: names.get(row.symbol) ?? row.name ?? "", price: toFiniteNumber(row.close), change });
  }
  movers.sort((a, b) => b.change - a.change);
  return {
    scope,
    up,
    down,
    flat,
    gainers: movers.filter((m) => m.change >= FLAT_EPSILON).slice(0, MOVER_COUNT),
    losers: movers.filter((m) => m.change <= -FLAT_EPSILON).slice(-MOVER_COUNT).reverse(),
  };
}

function MoverList({ title, movers }: { title: string; movers: Mover[] }) {
  const { t } = useLocale();
  return (
    <div className="px-5 pb-3">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {movers.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t("common.noData")}</p>
      ) : (
        <ul className="divide-y divide-border/30">
          {movers.map((mover) => (
            <li key={mover.ticker}>
              <Link
                href={`/hisse/${mover.ticker}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-bold text-foreground">{mover.ticker}</span>
                  {mover.name && <span className="block truncate text-[11px] text-muted-foreground">{mover.name}</span>}
                </span>
                <span className="font-mono text-xs tabular-nums text-foreground">{formatNumber(mover.price)}</span>
                <ChangePill value={mover.change} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MarketBreadthCard({ className }: { className?: string }) {
  const { t } = useLocale();
  const screenerQ = useScreenerRows();
  const companiesQ = useCompanies();
  const rows = screenerQ.data?.results;
  const breadth = useMemo(() => (rows ? computeBreadth(rows, companiesQ.data) : null), [rows, companiesQ.data]);
  const total = breadth ? breadth.up + breadth.down + breadth.flat : 0;
  const pct = (n: number) => `${total > 0 ? (n / total) * 100 : 0}%`;

  let body: React.ReactNode;
  if (screenerQ.isPending || (companiesQ.isPending && !companiesQ.isError)) {
    body = <RowSkeleton rows={6} />;
  } else if (screenerQ.isError) {
    body = <ErrorState compact message={t("dashboard.moversUnavailable")} onRetry={() => void screenerQ.refetch()} />;
  } else if (!breadth || total === 0) {
    body = <EmptyState compact message={t("dashboard.moversUnavailable")} />;
  } else {
    const summary = `${breadth.up} ${t("dashboard.advancers")}, ${breadth.down} ${t("dashboard.decliners")}, ${breadth.flat} ${t("dashboard.unchanged")}`;
    body = (
      <>
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="text-up">
              {breadth.up} {t("dashboard.advancers")}
            </span>
            <span className="text-muted-foreground">
              {breadth.flat} {t("dashboard.unchanged")}
            </span>
            <span className="text-down">
              {breadth.down} {t("dashboard.decliners")}
            </span>
          </div>
          <div role="img" aria-label={summary} className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-up" style={{ width: pct(breadth.up) }} />
            <div className="h-full bg-muted-foreground/30" style={{ width: pct(breadth.flat) }} />
            <div className="h-full bg-down" style={{ width: pct(breadth.down) }} />
          </div>
        </div>
        <MoverList title={t("dashboard.topGainers")} movers={breadth.gainers} />
        <MoverList title={t("dashboard.topLosers")} movers={breadth.losers} />
      </>
    );
  }

  return (
    <DashboardCard labelledBy={HEADING_ID} className={className}>
      <CardHeading
        id={HEADING_ID}
        icon={<Activity className="h-4 w-4" />}
        title={t("dashboard.breadth")}
        subtitle={breadth ? t(breadth.scope === "bist100" ? "dashboard.universeBist100" : "dashboard.universeAll") : undefined}
      />
      {body}
    </DashboardCard>
  );
}
