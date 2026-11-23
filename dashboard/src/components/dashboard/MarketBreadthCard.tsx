"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { formatMarketDate, formatNumber, toFiniteNumber } from "@/lib/format";
import { useIsDisconnected, useOfflineSummary } from "@/hooks/use-network-status";
import { cn } from "@/lib/utils";
import type { Company, ScreenerRow } from "@/types";
import { SegmentBar } from "@/components/charts/mini";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { presetHref } from "@/components/tarama/model";
import { useCompanies, useScreenerRows } from "./queries";
import { usePanelSize } from "@/components/workspace/panel";
import { CardBody, CardHeading, ChangePill, DashboardCard, GroupLabel, RowSkeleton } from "./ui";

/** Movers per list in the card's default place; in a layout slot both lists grow with the card. */
const MOVER_COUNT = 5;
const MOVER_ROW_HEIGHT = 26;
/** The breadth bar and one list heading, which the lists share the card's body with. */
const BAR_HEIGHT = 52;
const LIST_HEADING_HEIGHT = 42;
/** From this width the two lists sit side by side instead of one under the other. */
const WIDE_WIDTH = 560;
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

type RankedMover = Mover & { move: number; cap: number };

/**
 * /tarama's order for a daily-change sort: the change at display precision (the
 * screener keeps two decimals), then market cap, then ticker. Stocks at the ±10 %
 * limit often tie, so without it the list a heading opens would start differently.
 */
function byMove(dir: 1 | -1) {
  return (a: RankedMover, b: RankedMover) => dir * (a.move - b.move) || b.cap - a.cap || a.ticker.localeCompare(b.ticker, "tr");
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
  const movers: RankedMover[] = [];
  for (const row of universe) {
    const change = rowChange(row);
    if (change === null || !row.symbol) continue;
    if (Math.abs(change) < FLAT_EPSILON) flat += 1;
    else if (change > 0) up += 1;
    else down += 1;
    movers.push({
      ticker: row.symbol,
      name: names.get(row.symbol) ?? row.name ?? "",
      price: toFiniteNumber(row.close),
      change,
      move: Number(change.toFixed(2)),
      cap: toFiniteNumber(row.market_cap) ?? -1,
    });
  }
  return {
    scope,
    up,
    down,
    flat,
    gainers: movers.filter((m) => m.change >= FLAT_EPSILON).sort(byMove(-1)),
    losers: movers.filter((m) => m.change <= -FLAT_EPSILON).sort(byMove(1)),
  };
}

/** `href` opens the whole list on /tarama; an empty list has nothing more to show there. */
function MoverList({ title, movers, href }: { title: string; movers: Mover[]; href: string }) {
  const { t } = useLocale();
  return (
    <div className="border-t border-border pb-2">
      <GroupLabel href={movers.length > 0 ? href : undefined} action={t("common.viewAll")}>
        {title}
      </GroupLabel>
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
  const headingId = useId();
  const { t } = useLocale();
  const screenerQ = useScreenerRows();
  const companiesQ = useCompanies();
  const disconnected = useIsDisconnected();
  const offlineSummary = useOfflineSummary();
  const rows = screenerQ.data?.results;
  const cachedBreadth = (screenerQ.isError || disconnected) ? offlineSummary?.breadth : undefined;
  const liveBreadth = useMemo(() => (rows ? computeBreadth(rows, companiesQ.data) : null), [rows, companiesQ.data]);
  const usingOfflineCache = !liveBreadth && cachedBreadth !== undefined;
  const breadth = liveBreadth ?? cachedBreadth?.data ?? null;
  const total = breadth ? breadth.up + breadth.down + breadth.flat : 0;
  // In a layout slot both lists are as long as the card has room for. A wide card
  // puts them side by side, so the same height shows twice as many movers.
  const [bodyRef, room] = usePanelSize();
  const wide = room !== null && room.width >= WIDE_WIDTH;
  const lists = wide ? 1 : 2;
  const moverCount = room
    ? Math.max(1, Math.floor((room.height - BAR_HEIGHT - LIST_HEADING_HEIGHT * lists) / (MOVER_ROW_HEIGHT * lists)))
    : MOVER_COUNT;
  const [highlight, setHighlight] = useState<string | null>(null);
  // The legend uses pointer events like the bar's tooltip, so moving between a label and a segment
  // leaves one before entering the other; a label only clears its own highlight.
  const clearHighlight = (key: string) => setHighlight((current) => (current === key ? null : current));

  const pending = (screenerQ.isPending || companiesQ.isPending) && !usingOfflineCache;

  let body: React.ReactNode;
  if (pending) {
    body = <RowSkeleton rows={6} />;
  } else if (screenerQ.isLoadingError && !usingOfflineCache) {
    body = <ErrorState compact message={t("dashboard.moversUnavailable")} onRetry={() => void screenerQ.refetch()} />;
  } else if (!breadth || total === 0) {
    body = <EmptyState compact message={t("dashboard.moversUnavailable")} />;
  } else {
    const summary = `${breadth.up} ${t("dashboard.advancers")}, ${breadth.down} ${t("dashboard.decliners")}, ${breadth.flat} ${t("dashboard.unchanged")}`;
    // The screener lists the same universe as this card, so its first rows are these movers.
    const screenerIndex = breadth.scope === "bist100" ? "XU100" : "";
    body = (
      <>
        {usingOfflineCache && cachedBreadth && (
          <p role="status" className="mx-5 mb-3 rounded-sm bg-warn/10 px-2.5 py-1 text-[11px] text-warn">
            {t("offline.cachedBadge", { time: formatMarketDate(cachedBreadth.savedAt, "dayMonthTime") })}
          </p>
        )}
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
            <span
              role="img"
              aria-label={`${breadth.up} ${t("dashboard.advancers")}`}
              tabIndex={0}
              className={cn("outline-none motion-fade", "text-up", highlight != null && highlight !== "up" && "opacity-50")}
              onPointerEnter={() => setHighlight("up")}
              onPointerLeave={() => clearHighlight("up")}
              onFocus={() => setHighlight("up")}
              onBlur={() => clearHighlight("up")}
            >
              {breadth.up} {t("dashboard.advancers")}
            </span>
            <span
              role="img"
              aria-label={`${breadth.flat} ${t("dashboard.unchanged")}`}
              tabIndex={0}
              className={cn("outline-none motion-fade", "text-muted-foreground", highlight != null && highlight !== "flat" && "opacity-50")}
              onPointerEnter={() => setHighlight("flat")}
              onPointerLeave={() => clearHighlight("flat")}
              onFocus={() => setHighlight("flat")}
              onBlur={() => clearHighlight("flat")}
            >
              {breadth.flat} {t("dashboard.unchanged")}
            </span>
            <span
              role="img"
              aria-label={`${breadth.down} ${t("dashboard.decliners")}`}
              tabIndex={0}
              className={cn("outline-none motion-fade", "text-down", highlight != null && highlight !== "down" && "opacity-50")}
              onPointerEnter={() => setHighlight("down")}
              onPointerLeave={() => clearHighlight("down")}
              onFocus={() => setHighlight("down")}
              onBlur={() => clearHighlight("down")}
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
        <div className={cn(wide && "grid grid-cols-2 divide-x divide-border")}>
          <MoverList title={t("dashboard.topGainers")} movers={breadth.gainers.slice(0, moverCount)} href={presetHref("top_gainers", screenerIndex)} />
          <MoverList title={t("dashboard.topLosers")} movers={breadth.losers.slice(0, moverCount)} href={presetHref("top_losers", screenerIndex)} />
        </div>
      </>
    );
  }

  return (
    <DashboardCard labelledBy={headingId} className={className} entranceOrder={2}>
      <CardHeading
        id={headingId}
        className="border-b-0 pb-2"
        title={t("dashboard.breadth")}
        subtitle={breadth ? t(breadth.scope === "bist100" ? "dashboard.universeBist100" : "dashboard.universeAll") : undefined}
      />
      <CardBody ref={bodyRef} endless pending={pending} reveal={!pending && total > 0}>
        {body}
      </CardBody>
    </DashboardCard>
  );
}
