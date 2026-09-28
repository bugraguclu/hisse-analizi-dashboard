"use client";

import { ApiDataMeta } from "@/components/shared/DataMeta";
import { MeterBar, RATIO_FORMULA_KEY, TooltipNote, TooltipValueRow, useChartTooltip, useMiniChartI18n } from "@/components/charts/mini";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMultiple, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCompanySector, useRatios } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { SectorMetricKey } from "./sector";
import { useSectorName } from "./sector-ui";
import type { RatioKey, RatioPeriod } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

interface RatioRow {
  /** Every row is also a sector metric (same name), so it gets the sector median next to it. */
  key: RatioKey & SectorMetricKey;
  label: StockKey;
  kind: "percent" | "multiple";
  /** Value that fills the bar completely. */
  scale: number;
}

const GROUPS: Array<{ title: StockKey; rows: RatioRow[] }> = [
  {
    title: "ratios.groupProfitability",
    rows: [
      { key: "gross_margin", label: "ratios.grossMargin", kind: "percent", scale: 50 },
      { key: "operating_margin", label: "ratios.operatingMargin", kind: "percent", scale: 40 },
      { key: "ebitda_margin", label: "ratios.ebitdaMargin", kind: "percent", scale: 40 },
      { key: "net_margin", label: "ratios.netMargin", kind: "percent", scale: 30 },
      { key: "roe", label: "ratios.roe", kind: "percent", scale: 40 },
      { key: "roa", label: "ratios.roa", kind: "percent", scale: 20 },
    ],
  },
  {
    title: "ratios.groupBalance",
    rows: [
      { key: "current_ratio", label: "ratios.currentRatio", kind: "multiple", scale: 3 },
      { key: "debt_to_equity", label: "ratios.debtToEquity", kind: "multiple", scale: 3 },
      { key: "net_debt_ebitda", label: "ratios.netDebtEbitda", kind: "multiple", scale: 6 },
    ],
  },
  {
    title: "ratios.groupGrowth",
    rows: [
      { key: "revenue_growth_yoy", label: "ratios.revenueGrowth", kind: "percent", scale: 100 },
      { key: "net_income_growth_yoy", label: "ratios.netIncomeGrowth", kind: "percent", scale: 100 },
    ],
  },
];

/** { label: "2025" } → "2025 yıllık"; { label: "2026/06", ttm } → "Son 12 ay · 2026/06". */
export function usePeriodLabel() {
  const { t } = useStockI18n();
  return (period: RatioPeriod | null | undefined) => {
    if (!period) return null;
    if (period.ttm) return t("ratios.ttmPeriod", { period: period.label });
    return /^\d{4}$/.test(period.label) ? t("ratios.annualPeriod", { year: period.label }) : period.label;
  };
}

const samePeriod = (a: RatioPeriod | null | undefined, b: RatioPeriod | null | undefined) =>
  a?.label === b?.label && a?.ttm === b?.ttm;

/**
 * Two layouts of the rows: without the sector, label | bar | value; with it a
 * sector column is added, and in a narrow card the bar drops under its row so
 * the figures keep their room. Rows share the body's columns (subgrid), so the
 * figures line up down the card.
 */
const GRID_PLAIN = "grid-cols-[minmax(0,9rem)_1fr_auto]";
const GRID_SECTOR = "grid-cols-[minmax(0,1fr)_auto_auto] @sm:grid-cols-[minmax(0,9rem)_minmax(2.5rem,1fr)_auto_auto]";

/**
 * Profitability, balance-sheet and growth ratios from the latest annual KAP
 * statements (live endpoint), with DB-computed ratios filling missing fields,
 * next to the median of the stock's KAP sector (a column, and a tick on each
 * bar). Market multiples (F/K, PD/DD) live in the quote/valuation cards instead.
 */
export function RatiosCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const { t: tMini } = useMiniChartI18n();
  const periodLabel = usePeriodLabel();
  const ratiosQ = useRatios(ticker);
  const sectorQ = useCompanySector(ticker);
  const { getTriggerProps, tooltip } = useChartTooltip();
  const ratios = ratiosQ.data;
  const sector = sectorQ.data ?? null;
  const sectorName = useSectorName(sector);
  const mainPeriod = ratios?.mainPeriod ?? null;
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => ratios?.values[row.key] != null),
  })).filter((group) => group.rows.length > 0);
  const rowOrder = groups.flatMap((group) => group.rows.map((row) => row.key));
  // The column shows while the sector loads (no jump when it lands) and once any row has a median.
  const sectorPending = sectorQ.isPending;
  const withSector = sectorPending || rowOrder.some((key) => sector?.metrics[key]?.median != null);

  return (
    <SectionCard
      title={t("ratios.title")}
      actions={
        mainPeriod ? (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{periodLabel(mainPeriod)}</span>
        ) : null
      }
      footer={
        groups.length > 0 ? (
          <>
            {t(mainPeriod?.ttm ? "ratios.footerTtmAverages" : "ratios.footer")}
            {withSector && sectorName ? <span className="mt-1 block">{t("ratios.sectorFooter", { sector: sectorName })}</span> : null}
            <ApiDataMeta path={`/fundamentals/${ticker}/live-ratios`} className="mt-1" />
          </>
        ) : undefined
      }
    >
      {ratiosQ.isPending ? (
        <SectionSkeleton rows={6} />
      ) : ratiosQ.isError && !ratios ? (
        <SectionError error={ratiosQ.error} onRetry={ratiosQ.refetch} />
      ) : groups.length === 0 ? (
        <SectionEmpty message={t("ratios.empty")} hint={t("ratios.emptyHint")} />
      ) : (
        <div className={cn("grid gap-x-3", withSector ? GRID_SECTOR : GRID_PLAIN)}>
          {withSector ? (
            <div
              aria-hidden
              className="col-span-full -mx-1.5 grid grid-cols-subgrid px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <span className="col-start-2 row-start-1 text-right @sm:col-start-3">{ticker}</span>
              <span className="col-start-3 row-start-1 text-right @sm:col-start-4" title={sectorName ?? undefined}>
                {t("ratios.sectorColumn")}
              </span>
            </div>
          ) : null}
          {groups.map((group, groupIndex) => (
            <div key={group.title} className={cn("col-span-full grid grid-cols-subgrid", groupIndex > 0 && "mt-4")}>
              <h3 className="col-span-full mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(group.title)}</h3>
              <ul className="col-span-full grid grid-cols-subgrid gap-y-0.5">
                {group.rows.map((row) => {
                  const value = ratios?.values[row.key] ?? null;
                  const rowPeriod = ratios?.periods[row.key] ?? mainPeriod;
                  const delayMs = rowOrder.indexOf(row.key) * 40;
                  const format = (v: number | null) => (row.kind === "percent" ? formatPercent(v) : formatMultiple(v));
                  const formatted = format(value);
                  const stat = sector?.metrics[row.key];
                  const median = stat?.median ?? null;
                  const trigger = getTriggerProps(
                    row.key,
                    <>
                      <TooltipValueRow value={formatted} label={t(row.label)} />
                      {rowPeriod ? <TooltipNote>{periodLabel(rowPeriod)}</TooltipNote> : null}
                      {stat ? (
                        <TooltipNote>
                          {median != null
                            ? t("sector.median", { value: format(median), count: stat.count })
                            : t("sector.noMedian", { min: sector?.minCompanies ?? 3 })}
                        </TooltipNote>
                      ) : null}
                      {stat?.rank != null && stat.count > 1 ? (
                        <TooltipNote>{t("sector.rank", { rank: stat.rank, total: stat.count })}</TooltipNote>
                      ) : null}
                      <TooltipNote>{tMini(RATIO_FORMULA_KEY[row.key])}</TooltipNote>
                    </>,
                  );
                  return (
                    <li
                      key={row.key}
                      tabIndex={trigger.tabIndex}
                      aria-describedby={trigger["aria-describedby"]}
                      data-tooltip-scope={trigger["data-tooltip-scope"]}
                      onMouseEnter={trigger.onMouseEnter}
                      onMouseLeave={trigger.onMouseLeave}
                      onFocus={trigger.onFocus}
                      onBlur={trigger.onBlur}
                      onClick={trigger.onClick}
                      onKeyDown={trigger.onKeyDown}
                      className={cn(
                        "col-span-full -mx-1.5 grid min-h-7 grid-cols-subgrid items-center rounded-sm px-1.5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60",
                        withSector && "gap-y-1.5 py-1.5 @sm:gap-y-0 @sm:py-0",
                      )}
                    >
                      <span className="col-start-1 row-start-1 truncate text-[11px] font-medium text-muted-foreground">{t(row.label)}</span>
                      <MeterBar
                        value={value}
                        scale={row.scale}
                        reference={median}
                        delayMs={delayMs}
                        className={withSector ? "col-span-full row-start-2 @sm:col-span-1 @sm:col-start-2 @sm:row-start-1" : undefined}
                      />
                      <span
                        className={cn(
                          "text-right font-mono text-[11px] font-bold tabular-nums text-foreground",
                          withSector && "col-start-2 row-start-1 @sm:col-start-3",
                        )}
                      >
                        {formatted}
                        {rowPeriod && !samePeriod(rowPeriod, mainPeriod) ? (
                          <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">({periodLabel(rowPeriod)})</span>
                        ) : null}
                      </span>
                      {withSector ? (
                        <span className="col-start-3 row-start-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground @sm:col-start-4">
                          {sectorPending ? (
                            <Skeleton className="ml-auto h-3 w-10" />
                          ) : (
                            <>
                              <span className="sr-only">{t("ratios.sectorColumn")}: </span>
                              {format(median)}
                            </>
                          )}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {tooltip}
    </SectionCard>
  );
}
