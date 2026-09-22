"use client";

import { useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNotFoundError, useStatement, type StatementKind } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { CASHFLOW_SUMMARY, isEmphasisLine, statementLabel } from "./statementLabels";
import type { StatementPeriod } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, Segmented } from "./ui";

const KINDS: Array<{ value: StatementKind; label: StockKey }> = [
  { value: "balance", label: "fin.balance" },
  { value: "income", label: "fin.income" },
  { value: "cashflow", label: "fin.cashflow" },
];

/** TRY → million TRY (1 decimal below 10 mn so small items don't collapse to 0). */
function formatMillions(value: number | null): string {
  if (value == null) return formatNumber(null);
  const millions = value / 1_000_000;
  return formatNumber(millions, Math.abs(millions) < 10 ? 1 : 0);
}

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
      icon={<FileText />}
      actions={
        <>
          <Segmented
            label={t("fin.statementLabel")}
            value={kind}
            onChange={(value) => {
              setKind(value);
              setShowAll(false);
            }}
            options={KINDS.map((k) => ({ value: k.value, label: t(k.label) }))}
          />
          <Segmented
            label={t("fin.periodTypeLabel")}
            value={quarterly ? "interim" : "annual"}
            onChange={(value) => setQuarterly(value === "interim")}
            options={[
              { value: "annual", label: t("fin.annual") },
              { value: "interim", label: t("fin.interim") },
            ]}
          />
          {canShowDiscrete ? (
            <Segmented
              label={t("fin.viewLabel")}
              value={discrete ? "discrete" : "cumulative"}
              onChange={(value) => setDiscrete(value === "discrete")}
              options={[
                { value: "cumulative", label: t("fin.cumulativeView") },
                { value: "discrete", label: t("fin.discreteView") },
              ]}
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
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[34rem] text-xs">
              <caption className="sr-only">
                {t(KINDS.find((k) => k.value === kind)?.label ?? "fin.income")} · {t("fin.unitShort")}
              </caption>
              <thead>
                <tr className="border-b border-border/50">
                  <th scope="col" className="sticky left-0 z-10 bg-card py-2 pl-4 pr-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:pl-5">
                    {t("fin.unitShort")}
                  </th>
                  {periods.map((period) => {
                    const header = periodHeader(period);
                    return (
                      <th key={period.key} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] font-semibold text-foreground last:pr-4 sm:last:pr-5">
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
                  return (
                    <tr key={`${row.label}-${index}`} className="border-b border-border/20 transition-colors hover:bg-muted/20">
                      <th
                        scope="row"
                        title={row.label}
                        className={cn(
                          "sticky left-0 z-10 max-w-[18rem] bg-card py-2 pl-4 pr-3 text-left font-normal sm:pl-5",
                          emphasis ? "font-semibold text-foreground" : "text-muted-foreground",
                          row.depth >= 2 && !summaryMode && "pl-8 sm:pl-9",
                        )}
                      >
                        {statementLabel(row.label, locale)}
                      </th>
                      {row.values.map((value, i) => (
                        <td
                          key={periods[i]?.key ?? i}
                          className={cn(
                            "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums last:pr-4 sm:last:pr-5",
                            emphasis ? "font-semibold text-foreground" : "text-foreground/85",
                          )}
                        >
                          {formatMillions(value)}
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
