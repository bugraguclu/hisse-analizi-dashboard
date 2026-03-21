"use client";

import { Badge } from "@/components/ui/badge";

const severityConfig: Record<string, { label: string; className: string }> = {
  HIGH: { label: "Yuksek", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  WATCH: { label: "Takip", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  INFO: { label: "Bilgi", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
};

export function SeverityBadge({ severity }: { severity?: string | null }) {
  const s = (severity || "INFO").toUpperCase();
  const config = severityConfig[s] || severityConfig.INFO;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${config.className}`}>
      {config.label}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category?: string | null }) {
  if (!category) return null;
  const catMap: Record<string, { label: string; className: string }> = {
    DIVIDEND: { label: "Temettu", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    CAPITAL_INCREASE: { label: "Sermaye Artirimi", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    LEGAL: { label: "Hukuki", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
    MANAGEMENT: { label: "Yonetim", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    FINANCIAL_RESULTS: { label: "Finansal", className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
    NEW_BUSINESS: { label: "Yeni Is", className: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20" },
    OTHER: { label: "Diger", className: "bg-muted text-muted-foreground border-border" },
  };
  const config = catMap[category.toUpperCase()] || catMap.OTHER;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${config!.className}`}>
      {config!.label}
    </Badge>
  );
}
