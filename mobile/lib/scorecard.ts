/**
 * Rule-based stock scorecard (1–5 points) — the same categories, thresholds and
 * inputs as web `components/stock/FinancialHealthScorecard.tsx`, so the phone and
 * the web page give a stock the same grade. Pure TypeScript, no React.
 */

import type { RatioKey, SignalLevel } from "./stockParsers.ts";

type Direction = "higher" | "lower";
type Source = RatioKey | "pe" | "pb";
export type ValueKind = "pct" | "multiple" | "plain";

export interface ScoreMetricDef {
  id: string;
  label: string;
  source: Source;
  direction: Direction;
  /** Cut-offs for 5, 4, 3 and 2 points (anything worse scores 1). */
  thresholds: readonly [number, number, number, number];
  kind: ValueKind;
  /** Score used when the value is ≤ 0 (loss-making P/E, negative equity P/B). */
  nonPositiveScore?: number;
}

export interface ScoreCategoryDef {
  id: "profitability" | "growth" | "health" | "valuation";
  title: string;
  metrics: readonly ScoreMetricDef[];
}

export const SCORE_CATEGORIES: readonly ScoreCategoryDef[] = [
  {
    id: "profitability",
    title: "Kârlılık",
    metrics: [
      { id: "roe", source: "roe", label: "ROE", direction: "higher", thresholds: [30, 20, 10, 0], kind: "pct" },
      { id: "netMargin", source: "net_margin", label: "Net kâr marjı", direction: "higher", thresholds: [15, 8, 3, 0], kind: "pct" },
    ],
  },
  {
    id: "growth",
    title: "Büyüme",
    metrics: [
      { id: "revGrowth", source: "revenue_growth_yoy", label: "Satış büyümesi", direction: "higher", thresholds: [50, 30, 15, 0], kind: "pct" },
      { id: "niGrowth", source: "net_income_growth_yoy", label: "Net kâr büyümesi", direction: "higher", thresholds: [50, 30, 15, 0], kind: "pct" },
    ],
  },
  {
    id: "health",
    title: "Finansal sağlık",
    metrics: [
      { id: "current", source: "current_ratio", label: "Cari oran", direction: "higher", thresholds: [2, 1.5, 1, 0.8], kind: "multiple" },
      { id: "de", source: "debt_to_equity", label: "Borç / özkaynak", direction: "lower", thresholds: [0.5, 1, 2, 3], kind: "multiple" },
      { id: "nde", source: "net_debt_ebitda", label: "Net borç / FAVÖK", direction: "lower", thresholds: [0, 1, 2.5, 4], kind: "multiple" },
    ],
  },
  {
    id: "valuation",
    title: "Değerleme",
    metrics: [
      { id: "pe", source: "pe", label: "F/K", direction: "lower", thresholds: [8, 12, 18, 25], kind: "plain", nonPositiveScore: 1 },
      { id: "pb", source: "pb", label: "PD/DD", direction: "lower", thresholds: [1, 2, 3, 5], kind: "multiple", nonPositiveScore: 1 },
    ],
  },
];

export const TECH_SCORE: Record<SignalLevel, number> = { strongBuy: 5, buy: 4, neutral: 3, sell: 2, strongSell: 1 };

/** Sentinel P/E for loss-making companies (scored by `nonPositiveScore`, shown as "Zarar"). */
export const LOSS_MAKING_PE = -1;

export function scoreMetric(value: number, def: Pick<ScoreMetricDef, "direction" | "thresholds" | "nonPositiveScore">): number {
  if (def.nonPositiveScore !== undefined && value <= 0) return def.nonPositiveScore;
  const [s5, s4, s3, s2] = def.thresholds;
  if (def.direction === "higher") return value >= s5 ? 5 : value >= s4 ? 4 : value >= s3 ? 3 : value >= s2 ? 2 : 1;
  return value <= s5 ? 5 : value <= s4 ? 4 : value <= s3 ? 3 : value <= s2 ? 2 : 1;
}

function average(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

export interface ScoredMetric extends ScoreMetricDef {
  value: number | null;
  score: number | null;
}

export interface ScoredCategory extends Omit<ScoreCategoryDef, "metrics"> {
  metrics: ScoredMetric[];
  score: number | null;
}

export interface Scorecard {
  categories: ScoredCategory[];
  technicalLevel: SignalLevel | null;
  technicalScore: number | null;
  /** Average of the categories that could be scored; null without any input. */
  overall: number | null;
}

/**
 * Valuation multiples prefer the quote's market-data source (consolidated, trailing
 * twelve months); computed ratios are only a fallback, exactly as on the web page.
 */
export function buildScorecard(input: {
  ratios: Partial<Record<RatioKey, number>> | null | undefined;
  marketPe?: number | null;
  marketPb?: number | null;
  technicalLevel?: SignalLevel | null;
}): Scorecard {
  const values = input.ratios ?? {};
  const inputOf = (source: Source): number | null => {
    if (source === "pe") {
      const pe = input.marketPe ?? values.pe_ratio ?? null;
      if (pe != null) return pe;
      // A negative trailing net margin means a loss: score it as P/E ≤ 0 instead of
      // dropping it (otherwise a loss-maker's valuation would rest on P/B alone).
      return values.net_margin != null && values.net_margin < 0 ? LOSS_MAKING_PE : null;
    }
    if (source === "pb") return input.marketPb ?? values.pb_ratio ?? null;
    return values[source] ?? null;
  };

  const categories = SCORE_CATEGORIES.map((category) => {
    const metrics = category.metrics.map((metric) => {
      const value = inputOf(metric.source);
      return { ...metric, value, score: value == null || !Number.isFinite(value) ? null : scoreMetric(value, metric) };
    });
    return {
      id: category.id,
      title: category.title,
      metrics,
      score: average(metrics.flatMap((m) => (m.score == null ? [] : [m.score]))),
    };
  });
  const technicalLevel = input.technicalLevel ?? null;
  const technicalScore = technicalLevel ? TECH_SCORE[technicalLevel] : null;
  const overall = average(
    [...categories.map((c) => c.score), technicalScore].filter((s): s is number => s != null),
  );
  return { categories, technicalLevel, technicalScore, overall };
}
