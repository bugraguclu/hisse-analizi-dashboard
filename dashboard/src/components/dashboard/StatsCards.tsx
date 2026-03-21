"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CardSkeleton } from "@/components/shared/LoadingSpinner";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { Newspaper, DollarSign, BarChart3, Bell, FileText, Clock, type LucideIcon } from "lucide-react";
import type { StatsOut } from "@/types";
import { motion } from "framer-motion";

interface CardConfig {
  key: keyof StatsOut;
  label: string;
  icon: LucideIcon;
  gradient: string;
}

const cardConfig: readonly CardConfig[] = [
  { key: "total_normalized_events", label: "Toplam Olay", icon: Newspaper, gradient: "from-blue-500/10 to-indigo-500/10" },
  { key: "total_price_records", label: "Fiyat Kaydi", icon: DollarSign, gradient: "from-emerald-500/10 to-teal-500/10" },
  { key: "total_raw_events", label: "Ham Olay", icon: BarChart3, gradient: "from-violet-500/10 to-purple-500/10" },
  { key: "total_notifications", label: "Bildirim", icon: Bell, gradient: "from-amber-500/10 to-orange-500/10" },
  { key: "total_financial_records", label: "Finansal Kayit", icon: FileText, gradient: "from-rose-500/10 to-pink-500/10" },
  { key: "pending_outbox", label: "Bekleyen", icon: Clock, gradient: "from-cyan-500/10 to-sky-500/10" },
] as const;

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
      {cardConfig.map((c, index) => {
        const Icon = c.icon;
        const val = data ? Number(data[c.key]) || 0 : 0;
        return (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.05 }}
            className={`bg-card rounded-xl border border-border p-4 hover:shadow-lg transition-all group bg-gradient-to-br ${c.gradient}`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{c.label}</span>
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Icon className="h-4 w-4 text-primary" />
              </div>
            </div>
            <div className="text-2xl font-bold text-foreground font-mono">
              <SlidingNumber value={val} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
