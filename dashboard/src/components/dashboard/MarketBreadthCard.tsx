"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { formatNumber, toFiniteNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Company, ScreenerRow } from "@/types";
import { SegmentBar } from "@/components/charts/mini";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useCompanies, useScreenerRows } from "./queries";
import { CardHeading, ChangePill, DashboardCard, GroupLabel, RowSkeleton } from "./ui";

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
    <div className="border-t border-border pb-2">
      <GroupLabel>{title}</GroupLabel>
      {movers.length === 0 ? (
        <p className="px-4 py-2 text-xs text-muted-foreground">{t("common.noData")}</p>
      ) : (
        <ul>
          {movers.map((mover) => (
            <li key={mover.ticker}>
              <Link
                href={`/hisse/${mover.ticker}`}
                title={mover.name || undefined}
                className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto_4.25rem] items-center gap-x-3 px-4 py-[5px] transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                <span className="font-mono text-xs font-semibold text-foreground">{mover.ticker}</span>
                <span className="truncate text-[11px] text-muted-foreground">{mover.name}</span>
                <span className="font-mono text-xs tabular-nums text-foreground">{formatNumber(mover.price)}</span>
                <ChangePill value={mover.change} className="min-w-0 justify-self-end" />
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
  const [highlight, setHighlight] = useState<string | null>(null);

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
            <span
              role="img"
              aria-label={`${breadth.up} ${t("dashboard.advancers")}`}
              tabIndex={0}
              className={cn("outline-none transition-opacity", "text-up", highlight != null && highlight !== "up" && "opacity-50")}
              onMouseEnter={() => setHighlight("up")}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight("up")}
              onBlur={() => setHighlight(null)}
            >
              {breadth.up} {t("dashboard.advancers")}
            </span>
            <span
              role="img"
              aria-label={`${breadth.flat} ${t("dashboard.unchanged")}`}
              tabIndex={0}
              className={cn("outline-none transition-opacity", "text-muted-foreground", highlight != null && highlight !== "flat" && "opacity-50")}
              onMouseEnter={() => setHighlight("flat")}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight("flat")}
              onBlur={() => setHighlight(null)}
            >
              {breadth.flat} {t("dashboard.unchanged")}
            </span>
            <span
              role="img"
              aria-label={`${breadth.down} ${t("dashboard.decliners")}`}
              tabIndex={0}
              className={cn("outline-none transition-opacity", "text-down", highlight != null && highlight !== "down" && "opacity-50")}
              onMouseEnter={() => setHighlight("down")}
              onMouseLeave={() => setHighlight(null)}
              onFocus={() => setHighlight("down")}
              onBlur={() => setHighlight(null)}
            >
              {breadth.down} {t("dashboard.decliners")}
            </span>
          </div>
          <SegmentBar
            segments={[
              { key: "up", label: t("dashboard.advancers"), value: breadth.up, tone: "up" },
              { key: "flat", label: t("dashboard.unchanged"), value: breadth.flat, tone: "muted" },
              { key: "down", label: t("dashboard.decliners"), value: breadth.down, tone: "down" },
            ]}
            ariaLabel={summary}
            highlightKey={highlight}
            onHighlightChange={setHighlight}
            className="mt-2"
          />
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
        className="border-b-0 pb-2"
        title={t("dashboard.breadth")}
        subtitle={breadth ? t(breadth.scope === "bist100" ? "dashboard.universeBist100" : "dashboard.universeAll") : undefined}
      />
      {body}
    </DashboardCard>
  );
}
