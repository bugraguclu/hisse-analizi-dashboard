"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNotFoundError, useStatement, type StatementKind } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { CASHFLOW_SUMMARY, isEmphasisLine, statementLabel } from "./statementLabels";
import type { StatementPeriod } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

const KINDS: Array<{ value: StatementKind; label: StockKey }> = [
  { value: "balance", label: "fin.balance" },
  { value: "income", label: "fin.income" },
  { value: "cashflow", label: "fin.cashflow" },
];

const MINUS_SIGN = "−";

/** One precision per row so its figures line up: whole millions, unless every figure in the
 *  row is small (< 10 mn) and fractional — then 1 decimal, so small items don't collapse to 0. */
function rowDecimals(values: ReadonlyArray<number | null>): number {
  const millions = values.filter((v): v is number => v != null).map((v) => v / 1_000_000);
  return millions.some((m) => Math.abs(m) >= 10) || millions.every((m) => Number.isInteger(m)) ? 0 : 1;
}

/** TRY → million TRY with a real minus sign (Intl's default hyphen reads as a dash in a
 *  dense figures table); values that round to zero print as a plain "0". */
function formatMillions(value: number | null, decimals: number): string {
  if (value == null) return formatNumber(null);
  const millions = value / 1_000_000;
  if (Math.round(millions * 10 ** decimals) === 0) return formatNumber(0, decimals);
  const formatted = formatNumber(millions, decimals);
  return formatted.startsWith("-") ? `${MINUS_SIGN}${formatted.slice(1)}` : formatted;
}

/** Label-cell indent per depth tier. On phones the label text gets a fixed width that shrinks by
 *  the same amount as the indent grows, so every sticky label cell is equally narrow (~10rem)
 *  and two figure columns stay visible beside it; from `sm` the column sizes to its content. */
const LABEL_TIERS = [
  { indent: "pl-4", width: "w-[8.5rem]" },
  { indent: "pl-6", width: "w-[8rem]" },
  { indent: "pl-8", width: "w-[7.5rem]" },
] as const;

/** API path segment of each statement (lib/api.ts), for the provenance line. */
const STATEMENT_PATHS: Record<StatementKind, string> = {
  income: "income-statement",
  balance: "balance-sheet",
  cashflow: "cashflow",
};

export function FinancialStatements({ ticker }: { ticker: string }) {
  const { t, locale } = useStockI18n();
  const [kind, setKind] = useState<StatementKind>("income");
  const [quarterly, setQuarterly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [discrete, setDiscrete] = useState(false);
  const statementQ = useStatement(ticker, kind, quarterly);
  const table = statementQ.data ?? null;

  const isFlow = kind !== "balance";
  // Single-quarter view is only offered when the backend sends de-cumulated values.
  const canShowDiscrete = isFlow && quarterly && table?.cumulative === true && table.discreteRows !== null;
  const showDiscrete = canShowDiscrete && discrete;
  const cumulative = isFlow && quarterly && table?.cumulative !== false && !showDiscrete;
  const allRows = (showDiscrete ? table?.discreteRows : table?.rows) ?? [];
  const summaryRows = allRows.filter((row) => CASHFLOW_SUMMARY.has(row.label));
  // Fall back to every line if the upstream labels ever stop matching the summary list.
  const summaryMode = kind === "cashflow" && !showAll && summaryRows.length > 0;
  const rows = summaryMode ? summaryRows : allRows;
  const periods = table?.periods ?? [];

  const periodHeader = (period: StatementPeriod) => {
    if (period.year == null || period.month == null) return { main: period.key, sub: null };
    const main = !quarterly && period.month === 12 ? String(period.year) : `${period.year}/${String(period.month).padStart(2, "0")}`;
    let sub: string | null = null;
    if (quarterly && isFlow) {
      if (showDiscrete || table?.cumulative === false) sub = t("fin.quarterN", { n: Math.ceil(period.month / 3) });
      else sub = t("fin.months", { count: period.months ?? period.month });
    }
    return { main, sub };
  };

  const footer = (
    <div className="space-y-1">
      <p>
        {t("fin.unitNote")}
        {cumulative ? ` ${t("fin.cumulativeNote")}` : ""}
        {showDiscrete ? ` ${t("fin.discreteNote")}` : ""}
      </p>
      {table?.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      <ApiDataMeta path={`/fundamentals/${ticker}/${STATEMENT_PATHS[kind]}`} />
      {table?.source ? (
        <p className="flex flex-wrap items-center gap-1">
          {t("fin.source", { source: table.source })}
          {table.sourceUrl ? (
            <a href={table.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
              {t("fin.openSource")} <ExternalLink aria-hidden className="h-3 w-3" />
              <span className="sr-only">{t("common.opensInNewTab")}</span>
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );

  return (
    <SectionCard
      title={t("fin.title")}
      actions={
        <>
          <SegmentedControl
            label={t("fin.statementLabel")}
            value={kind}
            onChange={(value) => {
              setKind(value);
              setShowAll(false);
            }}
            options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))}
            size="xs"
          />
          <SegmentedControl
            label={t("fin.periodTypeLabel")}
            value={quarterly ? "interim" : "annual"}
            onChange={(value) => setQuarterly(value === "interim")}
            options={[
              { value: "annual", label: t("fin.annual") },
              { value: "interim", label: t("fin.interim") },
            ]}
            size="xs"
          />
          {canShowDiscrete ? (
            <SegmentedControl
              label={t("fin.viewLabel")}
              value={discrete ? "discrete" : "cumulative"}
              onChange={(value) => setDiscrete(value === "discrete")}
              options={[
                { value: "cumulative", label: t("fin.cumulativeView") },
                { value: "discrete", label: t("fin.discreteView") },
              ]}
              size="xs"
            />
          ) : null}
        </>
      }
      footer={footer}
    >
      {statementQ.isPending ? (
        <SectionSkeleton rows={8} />
      ) : statementQ.isError ? (
        isNotFoundError(statementQ.error) ? (
          <SectionEmpty message={t("fin.notAvailable")} />
        ) : (
          <SectionError error={statementQ.error} showDetail onRetry={() => void statementQ.refetch()} />
        )
      ) : !table || table.unavailable || rows.length === 0 || periods.length === 0 ? (
        <SectionEmpty message={t("fin.notAvailable")} />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto scrollbar-thin">
            {/* Separate borders drawn on the cells: in the collapsed model the sticky label cell
                paints over the row rules, which then stop short of the label column. */}
            <table className="w-full border-separate border-spacing-0 text-xs sm:min-w-[34rem]">
              <caption className="sr-only">
                {t(KINDS.find((k) => k.value === kind)?.label ?? "fin.income")} · {t("fin.unitShort")}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-20 border-b border-border/50 bg-card py-2 pl-4 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("fin.unitShort")}
                  </th>
                  {periods.map((period) => {
                    const header = periodHeader(period);
                    return (
                      <th key={period.key} scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-border/50 bg-card px-3 py-2 text-right font-mono text-[11px] font-semibold text-foreground last:pr-4">
                        {header.main}
                        {header.sub ? <span className="block font-sans text-[10px] font-medium text-muted-foreground">{header.sub}</span> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const emphasis = isEmphasisLine(row.label);
                  const decimals = rowDecimals(row.values);
                  const tier = LABEL_TIERS[summaryMode ? 0 : Math.min(Math.max(row.depth, 0), 2)];
                  // Rule above every row but the first (the header draws that one); stronger above totals.
                  const rule = cn("border-t group-first:border-t-0", emphasis ? "border-border/60" : "border-border/20");
                  return (
                    <tr key={`${row.label}-${index}`} className="group transition-colors hover:bg-muted/20">
                      <th
                        scope="row"
                        title={row.label}
                        className={cn(
                          // Opaque hover tint: the sticky label cell must hide figures scrolling under it.
                          "sticky left-0 z-10 max-w-[18rem] bg-card py-2 pr-3 text-left font-normal group-hover:bg-[color-mix(in_oklab,var(--color-muted)_20%,var(--color-card))]",
                          rule,
                          tier.indent,
                          emphasis ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span className={cn("block sm:w-auto", tier.width)}>{statementLabel(row.label, locale)}</span>
                      </th>
                      {row.values.map((value, i) => (
                        <td
                          key={periods[i]?.key ?? i}
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums last:pr-4",
                            rule,
                            emphasis ? "font-semibold text-foreground" : "text-foreground/85",
                          )}
                        >
                          {formatMillions(value, decimals)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {kind === "cashflow" && summaryRows.length > 0 && summaryRows.length < allRows.length ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-pressed={showAll}
              className="mt-3 text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {showAll ? t("fin.showSummary") : t("fin.showAll")}
            </button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
