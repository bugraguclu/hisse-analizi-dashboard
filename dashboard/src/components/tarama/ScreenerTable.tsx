"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Star } from "lucide-react";
import { ChangePill } from "@/components/dashboard/ui";
import {
  EMPTY_VALUE,
  formatChangePercent,
  formatCompact,
  formatNumber,
  formatPercent,
  TREND_TEXT_CLASS,
  trendTone,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useTaramaI18n, hasTaramaKey, type TaramaKey } from "./i18n";
import { rowSignals, techRating, RSI_OVERBOUGHT, RSI_OVERSOLD, VOLUME_SPIKE, type ColumnKey, type Row, type RowSignal, type SortDir, type SortKey, type TechRating } from "./model";

type Translate = ReturnType<typeof useTaramaI18n>["t"];

export interface TableContext {
  t: Translate;
  sectorName: (key: string) => string;
  industryName: (key: string) => string;
}

interface ColumnSpec {
  align: "left" | "right";
  sortable: boolean;
  /** Extra classes for header and cells (widths). */
  className?: string;
  render: (row: Row, ctx: TableContext) => ReactNode;
}

const missing = <span className="text-muted-foreground/70">{EMPTY_VALUE}</span>;

function num(value: number | undefined, decimals = 2): ReactNode {
  return value === undefined ? missing : formatNumber(value, decimals);
}

function compact(value: number | undefined): ReactNode {
  return value === undefined ? missing : formatCompact(value);
}

function level(value: number | undefined, decimals = 2): ReactNode {
  return value === undefined ? missing : formatPercent(value, decimals);
}

/** Signed percent in the up/down colour (returns, distances, upside). */
function signed(value: number | undefined): ReactNode {
  if (value === undefined) return missing;
  return <span className={TREND_TEXT_CLASS[trendTone(value)]}>{formatChangePercent(value)}</span>;
}

const RATING_CLASS: Record<TechRating, string> = {
  strongBuy: "font-semibold text-up",
  buy: "text-up",
  neutral: "text-warn",
  sell: "text-down",
  strongSell: "font-semibold text-down",
};

const REC_CLASS: Record<string, string> = {
  AL: "bg-up/10 text-up",
  TUT: "bg-warn/10 text-warn",
  SAT: "bg-down/10 text-down",
};

const SIGNAL_CLASS: Record<RowSignal, string> = {
  golden: "text-up",
  death: "text-down",
  oversold: "text-warn",
  overbought: "text-warn",
  nearHigh: "text-foreground",
  nearLow: "text-foreground",
  volumeSpike: "text-foreground",
};

export const COLUMNS: Record<ColumnKey, ColumnSpec> = {
  symbol: { align: "left", sortable: true, render: () => null },
  sector: {
    align: "left",
    sortable: true,
    render: (row, { sectorName, industryName }) =>
      row.sector ? (
        <span className="block max-w-[12rem] truncate font-sans text-muted-foreground xl:max-w-[16rem]" title={row.industry ? `${sectorName(row.sector)} · ${industryName(row.industry)}` : sectorName(row.sector)}>
          {sectorName(row.sector)}
        </span>
      ) : (
        missing
      ),
  },
  close: { align: "right", sortable: true, render: (row) => num(row.close) },
  change_pct: { align: "right", sortable: true, render: (row) => <ChangePill value={row.change_pct} /> },
  turnover: { align: "right", sortable: true, render: (row) => compact(row.turnover) },
  avg_turnover: { align: "right", sortable: true, render: (row) => compact(row.avg_turnover) },
  market_cap: { align: "right", sortable: true, render: (row) => compact(row.market_cap) },
  pe: {
    align: "right",
    sortable: true,
    render: (row, { t }) =>
      row.pe !== undefined ? (
        formatNumber(row.pe, 2)
      ) : row.loss ? (
        <span className="font-sans text-[11px] text-muted-foreground" title={t("value.lossTitle")}>
          {t("value.loss")}
        </span>
      ) : (
        missing
      ),
  },
  pb: { align: "right", sortable: true, render: (row) => num(row.pb) },
  ev_ebitda: { align: "right", sortable: true, render: (row) => num(row.ev_ebitda) },
  dividend_yield: { align: "right", sortable: true, render: (row) => level(row.dividend_yield) },
  roe: { align: "right", sortable: true, render: (row) => level(row.roe) },
  net_margin: { align: "right", sortable: true, render: (row) => level(row.net_margin) },
  rsi: {
    align: "right",
    sortable: true,
    render: (row) =>
      row.rsi === undefined ? (
        missing
      ) : (
        <span className={cn((row.rsi <= RSI_OVERSOLD || row.rsi >= RSI_OVERBOUGHT) && "font-semibold text-warn")}>{formatNumber(row.rsi, 1)}</span>
      ),
  },
  sma50_dist: { align: "right", sortable: true, render: (row) => signed(row.sma50_dist) },
  sma200_dist: { align: "right", sortable: true, render: (row) => signed(row.sma200_dist) },
  high_52w_dist: { align: "right", sortable: true, render: (row) => signed(row.high_52w_dist) },
  low_52w_dist: { align: "right", sortable: true, render: (row) => signed(row.low_52w_dist) },
  rel_volume: {
    align: "right",
    sortable: true,
    render: (row) =>
      row.rel_volume === undefined ? (
        missing
      ) : (
        <span className={cn(row.rel_volume >= VOLUME_SPIKE && "font-semibold text-foreground")}>{formatNumber(row.rel_volume, 2)}x</span>
      ),
  },
  tech_rating: {
    align: "left",
    sortable: true,
    render: (row, { t }) => {
      const rating = techRating(row.tech_rating);
      return rating ? <span className={cn("font-sans text-[12px]", RATING_CLASS[rating])}>{t(`rating.${rating}` as TaramaKey)}</span> : missing;
    },
  },
  signals: {
    align: "left",
    sortable: false,
    className: "min-w-[9rem]",
    render: (row, { t }) => {
      const signals = rowSignals(row);
      if (signals.length === 0) return missing;
      return (
        <span className="flex flex-wrap gap-1 font-sans">
          {signals.map((signal) => (
            <span key={signal} className={cn("whitespace-nowrap rounded-sm border border-border px-1.5 py-px text-[11px]", SIGNAL_CLASS[signal])}>
              {signal === "volumeSpike" ? t("signal.volumeSpike", { x: formatNumber(row.rel_volume, 1) }) : t(`signal.${signal}` as TaramaKey)}
            </span>
          ))}
        </span>
      );
    },
  },
  perf_1w: { align: "right", sortable: true, render: (row) => signed(row.perf_1w) },
  perf_1m: { align: "right", sortable: true, render: (row) => signed(row.perf_1m) },
  perf_3m: { align: "right", sortable: true, render: (row) => signed(row.perf_3m) },
  perf_ytd: { align: "right", sortable: true, render: (row) => signed(row.perf_ytd) },
  perf_1y: { align: "right", sortable: true, render: (row) => signed(row.perf_1y) },
  recommendation: {
    align: "left",
    sortable: true,
    render: (row, { t }) =>
      row.recommendation ? (
        <span className={cn("inline-flex rounded-sm px-1.5 py-px font-sans text-[11px] font-semibold", REC_CLASS[row.recommendation])}>
          {t(`rec.${row.recommendation}` as TaramaKey)}
        </span>
      ) : (
        missing
      ),
  },
  target_price: { align: "right", sortable: true, render: (row) => num(row.target_price) },
  upside: { align: "right", sortable: true, render: (row) => signed(row.upside) },
  foreign_ratio: { align: "right", sortable: true, render: (row) => level(row.foreign_ratio) },
};

export function columnLabel(key: ColumnKey, t: Translate): string {
  return t(`col.${key}` as TaramaKey);
}

export function columnTitle(key: ColumnKey, t: Translate): string | undefined {
  const titleKey = `col.${key}.title`;
  return hasTaramaKey(titleKey) ? t(titleKey) : undefined;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />;
}

export function ScreenerTable({
  rows,
  columns,
  sort,
  dir,
  onSort,
  favorites,
  onToggleFavorite,
  context,
}: {
  rows: readonly Row[];
  columns: readonly ColumnKey[];
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (ticker: string) => void;
  context: TableContext;
}) {
  const { t } = context;
  const header = (key: ColumnKey, spec: ColumnSpec, sticky = false) => {
    const active = sort === key;
    const label = columnLabel(key, t);
    const title = columnTitle(key, t);
    return (
      <th
        key={key}
        scope="col"
        aria-sort={spec.sortable ? (active ? (dir === "asc" ? "ascending" : "descending") : "none") : undefined}
        className={cn(
          "whitespace-nowrap border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
          spec.align === "right" ? "text-right" : "text-left",
          sticky && "sticky left-0 z-20 bg-card pl-4",
          spec.className,
        )}
      >
        {spec.sortable ? (
          <button
            type="button"
            onClick={() => onSort(key as SortKey)}
            title={title}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm uppercase tracking-wider transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              spec.align === "right" && "flex-row-reverse",
              active && "text-foreground",
            )}
          >
            {label}
            <SortIcon active={active} dir={dir} />
          </button>
        ) : (
          <span title={title}>{label}</span>
        )}
      </th>
    );
  };

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">{t("results.caption")}</caption>
        <thead>
          <tr>
            {header("symbol", COLUMNS.symbol, true)}
            {columns.map((key) => header(key, COLUMNS[key]))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const favorite = favorites.has(row.symbol);
            return (
              <tr key={row.symbol} className="group">
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-border bg-card py-2 pl-2 pr-3 text-left font-normal transition-colors group-hover:bg-surface max-lg:border-r"
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(row.symbol)}
                      aria-pressed={favorite}
                      aria-label={t(favorite ? "watch.remove" : "watch.add", { ticker: row.symbol })}
                      title={t(favorite ? "watch.remove" : "watch.add", { ticker: row.symbol })}
                      className={cn(
                        "shrink-0 rounded-sm p-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        favorite ? "text-foreground" : "text-muted-foreground/50 hover:text-foreground",
                      )}
                    >
                      <Star className={cn("h-3.5 w-3.5", favorite && "fill-current")} aria-hidden="true" />
                    </button>
                    <Link
                      href={`/hisse/${encodeURIComponent(row.symbol)}`}
                      className="min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="block font-mono text-[13px] font-semibold text-foreground group-hover:text-primary">{row.symbol}</span>
                      {row.name && <span className="block max-w-[11rem] truncate text-[11px] text-muted-foreground sm:max-w-[14rem]">{row.name}</span>}
                    </Link>
                  </div>
                </th>
                {columns.map((key) => {
                  const spec = COLUMNS[key];
                  return (
                    <td
                      key={key}
                      className={cn(
                        "whitespace-nowrap border-b border-border px-3 py-2 font-mono tabular-nums text-foreground transition-colors group-hover:bg-surface",
                        spec.align === "right" ? "text-right" : "text-left",
                        spec.className,
                      )}
                    >
                      {spec.render(row, context)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
