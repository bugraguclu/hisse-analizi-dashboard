"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { CardSkeleton } from "@/components/shared/LoadingSpinner";
import { TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

const watchlist = ["THYAO", "GARAN", "SISE", "ASELS"];

export function PriceSnapshot() {
  const { data, isLoading } = useQuery({
    queryKey: ["snapshot", watchlist],
    queryFn: () => api.snapshot(watchlist),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {watchlist.map((t) => <CardSkeleton key={t} />)}
      </div>
    );
  }

  const items = Array.isArray(data) ? data : (data && typeof data === "object" && "data" in (data as Record<string,unknown>)) ? (data as Record<string, unknown[]>).data : [];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {watchlist.map((ticker, index) => {
        const match = Array.isArray(items) ? items.find((p: Record<string, unknown>) =>
          ((p?.ticker as string) || (p?.symbol as string) || "").toUpperCase() === ticker
        ) : null;
        const price = match ? Number((match as Record<string, unknown>).close || (match as Record<string, unknown>).price || (match as Record<string, unknown>).last || 0) : 0;
        const change = match ? Number((match as Record<string, unknown>).change_pct || (match as Record<string, unknown>).change_percent || 0) : 0;
        const isUp = change >= 0;

        return (
          <motion.div
            key={ticker}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: index * 0.08 }}
          >
            <Link href={`/hisse/${ticker}`}>
              <div className="bg-card rounded-xl border border-border p-4 hover:shadow-lg transition-all hover:border-primary/30 cursor-pointer group">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{ticker}</span>
                  <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ${
                    isUp
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/10 text-red-600 dark:text-red-400"
                  }`}>
                    {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {isUp ? "+" : ""}{formatNumber(change)}%
                  </div>
                </div>
                <div className="text-xl font-bold font-mono text-foreground">{price > 0 ? `₺${formatNumber(price)}` : "-"}</div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
