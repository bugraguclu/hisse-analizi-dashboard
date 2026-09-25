"use client";

import { ApiDataMeta } from "@/components/shared/DataMeta";
import { MeterBar, RATIO_FORMULA_KEY, TooltipNote, TooltipValueRow, useChartTooltip, useMiniChartI18n } from "@/components/charts/mini";
import { formatMultiple, formatPercent } from "@/lib/format";
import { useRatios } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { RatioKey, RatioPeriod } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

interface RatioRow {
  key: RatioKey;
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
 * Profitability, balance-sheet and growth ratios from the latest annual KAP
 * statements (live endpoint), with DB-computed ratios filling missing fields.
 * Market multiples (F/K, PD/DD) live in the quote/valuation cards instead.
 */
export function RatiosCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const { t: tMini } = useMiniChartI18n();
  const periodLabel = usePeriodLabel();
  const ratiosQ = useRatios(ticker);
  const { getTriggerProps, tooltip } = useChartTooltip();
  const ratios = ratiosQ.data;
  const mainPeriod = ratios?.mainPeriod ?? null;
  const groups = GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => ratios?.values[row.key] != null),
  })).filter((group) => group.rows.length > 0);
  const rowOrder = groups.flatMap((group) => group.rows.map((row) => row.key));

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
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(group.title)}</h3>
              <ul className="space-y-0.5">
                {group.rows.map((row) => {
                  const value = ratios?.values[row.key] ?? null;
                  const rowPeriod = ratios?.periods[row.key] ?? mainPeriod;
                  const delayMs = rowOrder.indexOf(row.key) * 40;
                  const formatted = row.kind === "percent" ? formatPercent(value) : formatMultiple(value);
                  const trigger = getTriggerProps(
                    row.key,
                    <>
                      <TooltipValueRow value={formatted} label={t(row.label)} />
                      {rowPeriod ? <TooltipNote>{periodLabel(rowPeriod)}</TooltipNote> : null}
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
                      className="-mx-1.5 grid min-h-7 grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-sm px-1.5 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <span className="truncate text-[11px] font-medium text-muted-foreground">{t(row.label)}</span>
                      <MeterBar value={value} scale={row.scale} delayMs={delayMs} />
                      <span className="text-right font-mono text-[11px] font-bold tabular-nums text-foreground">
                        {formatted}
                        {rowPeriod && !samePeriod(rowPeriod, mainPeriod) ? (
                          <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">({periodLabel(rowPeriod)})</span>
                        ) : null}
                      </span>
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
