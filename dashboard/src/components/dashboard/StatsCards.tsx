"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/format";
import { CardSkeleton } from "@/components/shared/LoadingSpinner";
import { Newspaper, DollarSign, BarChart3, Bell, FileText, Clock } from "lucide-react";

const cardConfig = [
  { key: "total_normalized_events", label: "Toplam Olay", icon: Newspaper, color: "text-teal-600", bg: "bg-teal-50" },
  { key: "total_price_records", label: "Fiyat Kaydi", icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50" },
  { key: "total_raw_events", label: "Ham Olay", icon: BarChart3, color: "text-emerald-600", bg: "bg-emerald-50" },
  { key: "total_notifications", label: "Bildirim", icon: Bell, color: "text-amber-600", bg: "bg-amber-50" },
  { key: "total_financial_records", label: "Finansal Kayit", icon: FileText, color: "text-purple-600", bg: "bg-purple-50" },
  { key: "pending_outbox", label: "Bekleyen", icon: Clock, color: "text-slate-600", bg: "bg-slate-50" },
];

export function StatsCards() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats(),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cardConfig.map((c) => {
        const Icon = c.icon;
        const val = data ? (data as Record<string, unknown>)[c.key] : 0;
        return (
          <div key={c.key} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{c.label}</span>
              <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
                <Icon className={`h-4 w-4 ${c.color}`} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-800 font-mono">{formatCompact(Number(val) || 0)}</div>
          </div>
        );
      })}
    </div>
  );
}
