"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { motion } from "framer-motion";

export function LatestEvents() {
  const { data, isLoading } = useQuery({
    queryKey: ["latestEvents"],
    queryFn: () => api.latestEvents(),
  });

  if (isLoading) return <TableSkeleton rows={6} />;

  const events = Array.isArray(data) ? data : [];
  if (events.length === 0) return <EmptyState message="Henuz olay kaydedilmemis" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-left">
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tarih</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ticker</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Kaynak</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Baslik</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Kategori</th>
            <th className="px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Onem</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {events.slice(0, 10).map((e, i) => (
            <motion.tr
              key={e.id || i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              className="hover:bg-muted/30 transition-colors"
            >
              <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDate(e.published_at)}</td>
              <td className="px-4 py-3 font-semibold text-primary text-xs">{e.ticker || "-"}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{e.source_code}</td>
              <td className="px-4 py-3 text-foreground max-w-xs truncate text-sm">{e.title || "-"}</td>
              <td className="px-4 py-3"><CategoryBadge category={e.category} /></td>
              <td className="px-4 py-3"><SeverityBadge severity={e.severity} /></td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
