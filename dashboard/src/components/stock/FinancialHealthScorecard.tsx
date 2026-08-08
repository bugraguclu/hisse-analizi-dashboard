"use client";

import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { Star, Award, TrendingUp, DollarSign, Activity, Scale } from "lucide-react";
import { formatNumber } from "@/lib/format";

interface FinancialHealthScorecardProps {
  info?: Record<string, unknown> | null;
  ratios?: Record<string, unknown> | null;
  signals?: Record<string, unknown> | null;
}

function StarRating({ score }: { score: number }) {
  const fullStars = Math.floor(score);
  const hasHalf = score % 1 >= 0.5;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-4 w-4 ${
            star <= fullStars
              ? "fill-amber-400 text-amber-400"
              : star === fullStars + 1 && hasHalf
              ? "fill-amber-400/50 text-amber-400"
              : "fill-muted/20 text-muted-foreground/30"
          }`}
        />
      ))}
      <span className="text-xs font-bold font-mono text-foreground ml-1.5">{score.toFixed(1)} / 5</span>
    </div>
  );
}

export function FinancialHealthScorecard({ info, ratios, signals }: FinancialHealthScorecardProps) {
  const { t } = useLocale();

  // 1. Profitability score (0-5)
  const roe = Number(ratios?.roe ?? 0);
  const netMargin = Number(ratios?.net_margin ?? 0);
  let profScore = 2.5;
  if (roe > 25) profScore += 1.5;
  else if (roe > 15) profScore += 1.0;
  else if (roe < 0) profScore -= 1.5;
  if (netMargin > 15) profScore += 1.0;
  else if (netMargin < 0) profScore -= 1.0;
  profScore = Math.max(1, Math.min(5, profScore));

  // 2. Growth score (0-5)
  const revGrowth = Number(ratios?.revenue_growth_yoy ?? 0);
  const netGrowth = Number(ratios?.net_income_growth_yoy ?? 0);
  let growthScore = 2.5;
  if (revGrowth > 30) growthScore += 1.25;
  else if (revGrowth > 10) growthScore += 0.5;
  else if (revGrowth < 0) growthScore -= 1.0;
  if (netGrowth > 30) growthScore += 1.25;
  else if (netGrowth < 0) growthScore -= 1.0;
  growthScore = Math.max(1, Math.min(5, growthScore));

  // 3. Health & Leverage score (0-5)
  const currentRatio = Number(ratios?.current_ratio ?? 0);
  const netDebtEbitda = Number(ratios?.net_debt_ebitda ?? 0);
  let healthScore = 3.0;
  if (currentRatio >= 1.5) healthScore += 1.0;
  else if (currentRatio < 1.0 && currentRatio > 0) healthScore -= 1.0;
  if (netDebtEbitda > 0 && netDebtEbitda <= 2.0) healthScore += 1.0;
  else if (netDebtEbitda > 3.5) healthScore -= 1.5;
  healthScore = Math.max(1, Math.min(5, healthScore));

  // 4. Valuation score (0-5)
  const pe = Number(ratios?.pe_ratio ?? info?.trailingPE ?? 0);
  const pb = Number(ratios?.pb_ratio ?? info?.priceToBook ?? 0);
  let valScore = 3.0;
  if (pe > 0 && pe < 12) valScore += 1.0;
  else if (pe > 30) valScore -= 1.0;
  if (pb > 0 && pb < 2.0) valScore += 1.0;
  else if (pb > 6.0) valScore -= 1.0;
  valScore = Math.max(1, Math.min(5, valScore));

  // 5. Technical score (0-5)
  const summary = signals?.summary as { signal?: string } | undefined;
  const signalStr = String(summary?.signal || "");
  let techScore = 3.0;
  if (signalStr.includes("BUY") || signalStr === "AL") techScore += 1.5;
  else if (signalStr.includes("SELL") || signalStr === "SAT") techScore -= 1.5;
  techScore = Math.max(1, Math.min(5, techScore));

  const overallAvg = (profScore + growthScore + healthScore + valScore + techScore) / 5;

  const categories = [
    {
      title: t("scorecard.profitability"),
      score: profScore,
      icon: DollarSign,
      desc: roe > 0 ? `ROE: %${formatNumber(roe)}` : "-",
    },
    {
      title: t("scorecard.growth"),
      score: growthScore,
      icon: TrendingUp,
      desc: revGrowth !== 0 ? `YoY: %${formatNumber(revGrowth)}` : "-",
    },
    {
      title: t("scorecard.health"),
      score: healthScore,
      icon: Scale,
      desc: currentRatio > 0 ? `Cari: ${formatNumber(currentRatio)}` : "-",
    },
    {
      title: t("scorecard.valuation"),
      score: valScore,
      icon: Award,
      desc: pe > 0 ? `F/K: ${formatNumber(pe)}` : "-",
    },
    {
      title: t("scorecard.techTrend"),
      score: techScore,
      icon: Activity,
      desc: signalStr || "-",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 p-5 space-y-4"
    >
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-bold text-foreground">
            {t("scorecard.title")}
          </h2>
        </div>
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-xl">
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {t("scorecard.overall")}
          </span>
          <StarRating score={overallAvg} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {categories.map((cat, i) => {
          const Icon = cat.icon;
          return (
            <div key={i} className="bg-muted/30 rounded-xl p-3 border border-border/30 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">{cat.title}</span>
                </div>
                <div className="mb-2">
                  <StarRating score={cat.score} />
                </div>
              </div>
              {cat.desc !== "-" && (
                <span className="text-[10px] text-muted-foreground font-mono truncate">{cat.desc}</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
