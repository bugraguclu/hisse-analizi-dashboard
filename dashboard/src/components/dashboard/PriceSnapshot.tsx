"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { CardSkeleton } from "@/components/shared/LoadingSpinner";
import { TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

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
      {watchlist.map((ticker) => {
        const match = Array.isArray(items) ? items.find((p: Record<string, unknown>) =>
          ((p?.ticker as string) || (p?.symbol as string) || "").toUpperCase() === ticker
        ) : null;
        const price = match ? Number((match as Record<string, unknown>).close || (match as Record<string, unknown>).price || (match as Record<string, unknown>).last || 0) : 0;
        const change = match ? Number((match as Record<string, unknown>).change_pct || (match as Record<string, unknown>).change_percent || 0) : 0;
        const isUp = change >= 0;

        return (
          <Link key={ticker} href={`/hisse/${ticker}`}>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-all hover:border-teal-200 cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-slate-800">{ticker}</span>
                <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md ${isUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                  {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {isUp ? "+" : ""}{formatNumber(change)}%
                </div>
              </div>
              <div className="text-xl font-bold font-mono text-slate-800">{price > 0 ? formatNumber(price) : "-"}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
