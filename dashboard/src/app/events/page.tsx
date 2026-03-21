"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";

export default function EventsPage() {
  const [sourceFilter, setSourceFilter] = useState("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const { data, isLoading } = useQuery({
    queryKey: ["events", sourceFilter, tickerFilter, page],
    queryFn: () =>
      api.events({
        source_code: sourceFilter || undefined,
        ticker: tickerFilter || undefined,
        limit,
        offset: page * limit,
      }),
  });

  const events = Array.isArray(data) ? data : [];
  const sources = ["", "kap", "official_news", "official_ir", "price"];
  const sourceLabels: Record<string, string> = {
    "": "Tumu",
    kap: "KAP",
    official_news: "Haberler",
    official_ir: "IR",
    price: "Fiyat",
  };

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-foreground">Olaylar & KAP Bildirimleri</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Tum KAP bildirimleri, haberler ve fiyat olaylari</p>
      </motion.div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(0); }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                sourceFilter === s
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/20 hover:text-foreground"
              }`}
            >
              {sourceLabels[s] || s}
            </button>
          ))}
        </div>
        <Input
          placeholder="Ticker filtrele..."
          value={tickerFilter}
          onChange={(e) => { setTickerFilter(e.target.value.toUpperCase()); setPage(0); }}
          className="w-40 h-8 text-xs"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <LoadingSpinner />
        ) : events.length === 0 ? (
          <EmptyState message="Filtreye uygun olay bulunamadi" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Tarih</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ticker</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Kaynak</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Baslik</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Kategori</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Onem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {events.map((e, i) => (
                    <tr key={e.id || i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDate(e.published_at)}</td>
                      <td className="px-4 py-3 font-semibold text-primary text-xs">{e.ticker || "-"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{e.source_code}</td>
                      <td className="px-4 py-3 text-foreground max-w-md truncate">{e.title || "-"}</td>
                      <td className="px-4 py-3"><CategoryBadge category={e.category} /></td>
                      <td className="px-4 py-3"><SeverityBadge severity={e.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <span className="text-xs text-muted-foreground">{events.length} kayit gosteriliyor</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                  className="px-3 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  Onceki
                </button>
                <button
                  disabled={events.length < limit}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 text-xs font-medium rounded-md border border-border text-foreground hover:bg-accent disabled:opacity-30 transition-colors"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
