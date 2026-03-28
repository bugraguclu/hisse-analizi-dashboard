"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/locale-context";

const severityClassNames: Record<string, string> = {
  HIGH: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  WATCH: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  INFO: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

const severityKeys: Record<string, "severity.high" | "severity.medium" | "severity.info"> = {
  HIGH: "severity.high",
  WATCH: "severity.medium",
  INFO: "severity.info",
};

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const { t } = useLocale();
  const s = (severity || "INFO").toUpperCase();
  const className = severityClassNames[s] || severityClassNames.INFO;
  const labelKey = severityKeys[s] || severityKeys.INFO;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${className}`}>
      {t(labelKey)}
    </Badge>
  );
}

const categoryClassNames: Record<string, string> = {
  DIVIDEND: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  CAPITAL_INCREASE: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  LEGAL: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  MANAGEMENT: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  FINANCIAL_RESULTS: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  NEW_BUSINESS: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  OTHER: "bg-muted text-muted-foreground border-border",
};

const categoryKeys: Record<string, "category.dividend" | "category.capitalIncrease" | "category.legal" | "category.management" | "category.financial" | "category.newBusiness" | "category.other"> = {
  DIVIDEND: "category.dividend",
  CAPITAL_INCREASE: "category.capitalIncrease",
  LEGAL: "category.legal",
  MANAGEMENT: "category.management",
  FINANCIAL_RESULTS: "category.financial",
  NEW_BUSINESS: "category.newBusiness",
  OTHER: "category.other",
};

export function CategoryBadge({ category }: { category?: string | null }) {
  const { t } = useLocale();
  if (!category) return null;
  const key = category.toUpperCase();
  const className = categoryClassNames[key] || categoryClassNames.OTHER;
  const labelKey = categoryKeys[key] || categoryKeys.OTHER;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${className}`}>
      {t(labelKey)}
    </Badge>
  );
}
