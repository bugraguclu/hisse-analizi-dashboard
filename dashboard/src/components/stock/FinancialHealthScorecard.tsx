"use client";

import { useId, useState, type ReactNode } from "react";
import { Activity, Award, ChevronDown, DollarSign, Scale, Star, TrendingUp } from "lucide-react";
import { formatMultiple, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFastInfo, useRatios, useSignals } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { RatioKey, SignalLevel } from "./types";
import { SectionCard, SectionEmpty, SectionSkeleton, useSignalLabel } from "./ui";

type Direction = "higher" | "lower";

interface MetricDef {
  id: string;
  label: StockKey;
  direction: Direction;
  /** Cut-offs for 5, 4, 3 and 2 points (anything worse scores 1). */
  thresholds: [number, number, number, number];
  /** Formats thresholds (and values unless `display` is set). */
  format: (value: number) => string;
  display?: (value: number) => string;
  /** Score used when value ≤ 0 (e.g. loss-making P/E, negative equity P/B). */
  nonPositiveScore?: number;
}

interface CategoryDef {
  id: string;
  title: StockKey;
  icon: ReactNode;
  metrics: Array<MetricDef & { source: RatioKey | "pe" | "pb" }>;
}

const pct = (v: number) => formatPercent(v, 0);
const mult = (v: number) => formatMultiple(v, 1);
const plain = (v: number) => formatNumber(v, 0);
const pctValue = (v: number) => formatPercent(v, 1);
const multValue = (v: number) => formatMultiple(v, 2);
const plainValue = (v: number) => formatNumber(v, 2);
/** Sentinel P/E for loss-making companies (scored by `nonPositiveScore`, shown as "Zarar"). */
const LOSS_MAKING_PE = -1;

/**
 * Transparent, rule-based scores (1-5). Thresholds are nominal-TL rules of
 * thumb for BIST companies; categories without input data are not scored.
 */
const CATEGORIES: CategoryDef[] = [
  {
    id: "profitability",
    title: "score.profitability",
    icon: <DollarSign aria-hidden className="h-4 w-4" />,
    metrics: [
      { id: "roe", source: "roe", label: "ratios.roe", direction: "higher", thresholds: [30, 20, 10, 0], format: pct, display: pctValue },
      { id: "netMargin", source: "net_margin", label: "ratios.netMargin", direction: "higher", thresholds: [15, 8, 3, 0], format: pct, display: pctValue },
    ],
  },
  {
    id: "growth",
    title: "score.growth",
    icon: <TrendingUp aria-hidden className="h-4 w-4" />,
    metrics: [
      { id: "revGrowth", source: "revenue_growth_yoy", label: "ratios.revenueGrowth", direction: "higher", thresholds: [50, 30, 15, 0], format: pct, display: pctValue },
      { id: "niGrowth", source: "net_income_growth_yoy", label: "ratios.netIncomeGrowth", direction: "higher", thresholds: [50, 30, 15, 0], format: pct, display: pctValue },
    ],
  },
  {
    id: "health",
    title: "score.health",
    icon: <Scale aria-hidden className="h-4 w-4" />,
    metrics: [
      { id: "current", source: "current_ratio", label: "ratios.currentRatio", direction: "higher", thresholds: [2, 1.5, 1, 0.8], format: mult, display: multValue },
      { id: "de", source: "debt_to_equity", label: "ratios.debtToEquity", direction: "lower", thresholds: [0.5, 1, 2, 3], format: mult, display: multValue },
      { id: "nde", source: "net_debt_ebitda", label: "ratios.netDebtEbitda", direction: "lower", thresholds: [0, 1, 2.5, 4], format: mult, display: multValue },
    ],
  },
  {
    id: "valuation",
    title: "score.valuation",
    icon: <Award aria-hidden className="h-4 w-4" />,
    metrics: [
      { id: "pe", source: "pe", label: "stats.pe", direction: "lower", thresholds: [8, 12, 18, 25], format: plain, display: plainValue, nonPositiveScore: 1 },
      { id: "pb", source: "pb", label: "stats.pb", direction: "lower", thresholds: [1, 2, 3, 5], format: mult, display: multValue, nonPositiveScore: 1 },
    ],
  },
];

const TECH_SCORE: Record<SignalLevel, number> = { strongBuy: 5, buy: 4, neutral: 3, sell: 2, strongSell: 1 };

function scoreMetric(value: number, def: MetricDef): number {
  if (def.nonPositiveScore !== undefined && value <= 0) return def.nonPositiveScore;
  const [s5, s4, s3, s2] = def.thresholds;
  if (def.direction === "higher") return value >= s5 ? 5 : value >= s4 ? 4 : value >= s3 ? 3 : value >= s2 ? 2 : 1;
  return value <= s5 ? 5 : value <= s4 ? 4 : value <= s3 ? 3 : value <= s2 ? 2 : 1;
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function StarRating({ score, label }: { score: number; label: string }) {
  const rounded = Math.round(score * 2) / 2;
  return (
    <span role="img" aria-label={label} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = rounded >= star ? "full" : rounded >= star - 0.5 ? "half" : "empty";
        return (
          <span key={star} aria-hidden className="relative inline-block h-3.5 w-3.5">
            <Star className="absolute inset-0 h-3.5 w-3.5 fill-muted text-muted-foreground/30" />
            {fill !== "empty" ? (
              <span className={cn("absolute inset-y-0 left-0 overflow-hidden", fill === "half" ? "w-1/2" : "w-full")}>
                <Star className="h-3.5 w-3.5 fill-foreground text-foreground" />
              </span>
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

export function FinancialHealthScorecard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalLabel = useSignalLabel();
  const [showMethod, setShowMethod] = useState(false);
  const methodId = useId();
  const ratiosQ = useRatios(ticker);
  const signalsQ = useSignals(ticker);
  // Valuation multiples come from the same market-data source as the quote stats
  // (consolidated, trailing 12 months, always current) so the page shows one F/K and
  // one PD/DD; the computed ratios are only a fallback (they can lag a quarter, and
  // banks are computed from bank-only statements).
  const fastQ = useFastInfo(ticker);

  const values = ratiosQ.data?.values ?? {};
  const inputOf = (source: RatioKey | "pe" | "pb"): number | null => {
    if (source === "pe") {
      const pe = fastQ.data?.pe ?? values.pe_ratio ?? null;
      if (pe != null) return pe;
      // Neither source publishes a P/E for loss-making companies. A negative trailing net
      // margin means negative earnings — score it like any P/E ≤ 0 instead of dropping it
      // (otherwise valuation would rest on P/B alone and a loss-maker could score 5/5).
      return values.net_margin != null && values.net_margin < 0 ? LOSS_MAKING_PE : null;
    }
    if (source === "pb") return fastQ.data?.pb ?? values.pb_ratio ?? null;
    return values[source] ?? null;
  };

  const scored = CATEGORIES.map((category) => {
    const metrics = category.metrics.map((metric) => {
      const value = inputOf(metric.source);
      return { ...metric, value, score: value == null ? null : scoreMetric(value, metric) };
    });
    return { ...category, metrics, score: average(metrics.flatMap((m) => (m.score == null ? [] : [m.score]))) };
  });
  const technicalLevel = signalsQ.data?.summary?.level ?? null;
  const technicalScore = technicalLevel ? TECH_SCORE[technicalLevel] : null;
  const categoryScores = [...scored.map((c) => c.score), technicalScore].filter((s): s is number => s != null);
  const overall = average(categoryScores);
  const outOf = (score: number) => t("score.outOf", { score: formatNumber(score, 1) });

  const pending = ratiosQ.isPending || signalsQ.isPending;

  return (
    <SectionCard
      title={t("score.title")}
      actions={
        overall != null && !pending ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-warn/20 bg-warn/10 px-2 py-1 text-[11px] font-semibold text-warn">
            {t("score.overall")}
            <StarRating score={overall} label={outOf(overall)} />
            <span className="font-mono tabular-nums">{formatNumber(overall, 1)}</span>
          </span>
        ) : null
      }
      footer={t("score.disclaimer")}
    >
      {pending ? (
        <SectionSkeleton rows={5} />
      ) : categoryScores.length === 0 ? (
        <SectionEmpty message={t("score.empty")} />
      ) : (
        <>
          <ul className="divide-y divide-border/40">
            {scored.map((category) => {
              const detailText = category.metrics
                .filter((m) => m.value != null)
                .map((m) =>
                  m.id === "pe" && (m.value as number) <= 0
                    ? `${t(m.label)} ${t("score.lossMaking")}`
                    : `${t(m.label)} ${(m.display ?? m.format)(m.value as number)}`,
                )
                .join(" · ");
              return (
                <li key={category.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0">
                  <span className="flex w-36 shrink-0 items-center gap-2 text-xs font-semibold text-foreground">
                    <span className="text-muted-foreground">{category.icon}</span>
                    {t(category.title)}
                  </span>
                  {category.score != null ? (
                    <>
                      <StarRating score={category.score} label={outOf(category.score)} />
                      <span className="font-mono text-[11px] font-bold tabular-nums text-foreground">{formatNumber(category.score, 1)}</span>
                      <span className="min-w-0 flex-1 line-clamp-2 text-[11px] text-muted-foreground" title={detailText}>
                        {detailText}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">{t("score.noData")}</span>
                  )}
                </li>
              );
            })}
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="flex w-36 shrink-0 items-center gap-2 text-xs font-semibold text-foreground">
                <Activity aria-hidden className="h-4 w-4 text-muted-foreground" />
                {t("score.technical")}
              </span>
              {technicalScore != null ? (
                <>
                  <StarRating score={technicalScore} label={outOf(technicalScore)} />
                  <span className="font-mono text-[11px] font-bold tabular-nums text-foreground">{formatNumber(technicalScore, 1)}</span>
                  <span className="min-w-0 flex-1 line-clamp-2 text-[11px] text-muted-foreground">
                    {t("score.technicalInput", { signal: signalLabel(technicalLevel) })}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">{t("score.noData")}</span>
              )}
            </li>
          </ul>

          <button
            type="button"
            aria-expanded={showMethod}
            aria-controls={methodId}
            onClick={() => setShowMethod((open) => !open)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronDown aria-hidden className={cn("h-3.5 w-3.5 transition-transform", showMethod && "rotate-180")} />
            {t("score.howCalculated")}
          </button>
          {showMethod ? (
            <div id={methodId} className="mt-2 space-y-3 rounded-lg bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <p>{t("score.methodIntro")}</p>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[26rem] text-left">
                  <thead>
                    <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider">
                      <th scope="col" className="py-1 pr-2 font-semibold">{t("score.metric")}</th>
                      <th scope="col" className="py-1 pr-2 text-right font-semibold">{t("score.value")}</th>
                      <th scope="col" className="py-1 pr-2 text-right font-semibold">{t("score.points")}</th>
                      <th scope="col" className="py-1 font-semibold">{t("score.thresholds")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scored.flatMap((category) =>
                      category.metrics.map((m) => {
                        const [s5, s4, s3, s2] = m.thresholds;
                        const op = m.direction === "higher" ? "≥" : "≤";
                        const rules = `5: ${op}${m.format(s5)} · 4: ${op}${m.format(s4)} · 3: ${op}${m.format(s3)} · 2: ${op}${m.format(s2)}`;
                        return (
                          <tr key={m.id} className="border-b border-border/20 last:border-0">
                            <td className="py-1 pr-2 text-foreground">{t(m.label)}</td>
                            <td className="py-1 pr-2 text-right font-mono tabular-nums text-foreground">
                              {m.value == null ? t("score.noData") : (m.display ?? m.format)(m.value)}
                            </td>
                            <td className="py-1 pr-2 text-right font-mono tabular-nums text-foreground">{m.score ?? "—"}</td>
                            <td className="py-1 font-mono">
                              {rules}
                              {m.nonPositiveScore !== undefined ? ` · ≤0: ${m.nonPositiveScore}` : ""}
                            </td>
                          </tr>
                        );
                      }),
                    )}
                    <tr>
                      <td className="py-1 pr-2 text-foreground">{t("score.technical")}</td>
                      <td className="py-1 pr-2 text-right text-foreground">{technicalLevel ? signalLabel(technicalLevel) : t("score.noData")}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums text-foreground">{technicalScore ?? "—"}</td>
                      <td className="py-1">{t("score.technicalRule")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>{t("score.methodAverage")}</p>
            </div>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
