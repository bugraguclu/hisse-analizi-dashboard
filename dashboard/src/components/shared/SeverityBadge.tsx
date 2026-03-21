"use client";

import { Badge } from "@/components/ui/badge";

// Backend Severity enum: INFO, WATCH, HIGH
const severityConfig: Record<string, { label: string; className: string }> = {
  HIGH: { label: "Yuksek", className: "bg-red-50 text-red-700 border-red-200" },
  WATCH: { label: "Takip", className: "bg-amber-50 text-amber-700 border-amber-200" },
  INFO: { label: "Bilgi", className: "bg-blue-50 text-blue-600 border-blue-200" },
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
    DIVIDEND: { label: "Temettu", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    CAPITAL_INCREASE: { label: "Sermaye Artirimi", className: "bg-blue-50 text-blue-700 border-blue-200" },
    LEGAL: { label: "Hukuki", className: "bg-red-50 text-red-600 border-red-200" },
    MANAGEMENT: { label: "Yonetim", className: "bg-amber-50 text-amber-700 border-amber-200" },
    FINANCIAL_RESULTS: { label: "Finansal", className: "bg-purple-50 text-purple-700 border-purple-200" },
    NEW_BUSINESS: { label: "Yeni Is", className: "bg-teal-50 text-teal-700 border-teal-200" },
    OTHER: { label: "Diger", className: "bg-slate-50 text-slate-500 border-slate-200" },
  };
  const config = catMap[category.toUpperCase()] || catMap.OTHER;
  return (
    <Badge variant="outline" className={`text-[11px] font-semibold ${config!.className}`}>
      {config!.label}
    </Badge>
  );
}
