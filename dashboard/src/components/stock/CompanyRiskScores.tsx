"use client";

import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { ShieldAlert, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";

interface CompanyRiskScoresProps {
  info: Record<string, unknown> | null;
}

function getRiskBadge(score: number | null | undefined, t: (key: TranslationKey) => string) {
  if (score == null) return { color: "bg-muted text-muted-foreground", label: "-", icon: AlertCircle };
  if (score <= 3) {
    return {
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      label: t("risk.low"),
      icon: CheckCircle2,
    };
  }
  if (score <= 6) {
    return {
      color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      label: t("risk.medium"),
      icon: AlertTriangle,
    };
  }
  return {
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    label: t("risk.high"),
    icon: ShieldAlert,
  };
}

export function CompanyRiskScores({ info }: CompanyRiskScoresProps) {
  const { t } = useLocale();

  if (!info) return null;

  const auditRisk = Number(info.auditRisk ?? info.audit_risk);
  const boardRisk = Number(info.boardRisk ?? info.board_risk);
  const compRisk = Number(info.compensationRisk ?? info.compensation_risk);
  const overallRisk = Number(info.overallRisk ?? info.overall_risk);

  const hasAnyRisk = [auditRisk, boardRisk, compRisk, overallRisk].some((val) => !isNaN(val) && val > 0);

  if (!hasAnyRisk) return null;

  const items = [
    { label: t("temel.overallRisk"), val: overallRisk },
    { label: t("temel.auditRisk"), val: auditRisk },
    { label: t("temel.boardRisk"), val: boardRisk },
    { label: t("temel.compensationRisk"), val: compRisk },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-foreground">{t("temel.riskScores")}</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(({ label, val }, i) => {
          const score = isNaN(val) || val <= 0 ? null : val;
          const badge = getRiskBadge(score, t);
          const Icon = badge.icon;
          const barWidth = score ? Math.min((score / 10) * 100, 100) : 0;

          return (
            <div key={i} className="bg-muted/30 rounded-xl p-3 border border-border/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">{label}</span>
                {score != null && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${badge.color}`}>
                    <Icon className="h-3 w-3" />
                    {score} / 10 &middot; {badge.label}
                  </span>
                )}
              </div>
              {score != null ? (
                <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${barWidth}%` }}
                    transition={{ duration: 0.5, delay: 0.1 * i }}
                    className={`h-full ${
                      score <= 3
                        ? "bg-emerald-500"
                        : score <= 6
                        ? "bg-amber-500"
                        : "bg-rose-500"
                    }`}
                  />
                </div>
              ) : (
                <span className="text-[11px] text-muted-foreground font-mono">-</span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
