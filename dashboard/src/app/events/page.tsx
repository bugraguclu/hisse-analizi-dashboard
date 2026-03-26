"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { Newspaper, ChevronLeft, ChevronRight, X, ExternalLink } from "lucide-react";
import type { EventOut, EventDetailOut } from "@/types";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function EventDetailModal({
  eventId,
  onClose,
}: {
  eventId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["eventDetail", eventId],
    queryFn: () => api.eventDetail(eventId),
    enabled: !!eventId,
  });

  const detail = data as EventDetailOut | null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative bg-card border border-border/60 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <h3 className="text-sm font-semibold text-foreground">Olay Detayi</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(80vh - 60px)" }}>
          {isLoading ? (
            <LoadingSpinner />
          ) : !detail ? (
            <EmptyState message="Olay detayi bulunamadi" />
          ) : (
            <>
              <div>
                <h2 className="text-base font-semibold text-foreground leading-snug">
                  {detail.title || "Basliks\u0131z"}
                </h2>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {detail.ticker && (
                    <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {detail.ticker}
                    </span>
                  )}
                  <CategoryBadge category={detail.category} />
                  <SeverityBadge severity={detail.severity} />
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {formatDate(detail.published_at)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {detail.source_code}
                  </span>
                </div>
              </div>

              {detail.excerpt && (
                <div className="bg-muted/30 rounded-xl p-4">
                  <p className="text-sm text-foreground leading-relaxed">{detail.excerpt}</p>
                </div>
              )}

              {detail.body_text && (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                    {detail.body_text}
                  </p>
                </div>
              )}

              {detail.event_url && (
                <a
                  href={detail.event_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Kaynaga git
                </a>
              )}

              {detail.metadata_json && Object.keys(detail.metadata_json).length > 0 && (
                <div className="bg-muted/20 rounded-xl p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Ek Bilgiler
                  </h4>
                  <div className="space-y-1.5">
                    {Object.entries(detail.metadata_json).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="text-foreground font-mono">{String(val)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function EventsPage() {
  const [sourceFilter, setSourceFilter] = useState("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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

  const events: EventOut[] = Array.isArray(data) ? data : [];
  const sources = ["", "kap", "official_news", "official_ir", "price"];
  const sourceLabels: Record<string, string> = {
    "": "Tumu",
    kap: "KAP",
    official_news: "Haberler",
    official_ir: "IR",
    price: "Fiyat",
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
              <Newspaper className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Olaylar & KAP Bildirimleri</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Tum KAP bildirimleri, haberler ve fiyat olaylari</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Filters */}
      <motion.div custom={1} variants={stagger} initial="hidden" animate="show" className="flex flex-wrap gap-3 items-center">
        <div className="bg-muted/50 rounded-lg p-0.5 flex gap-0.5">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(0); }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                sourceFilter === s
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
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
      </motion.div>

      {/* Table */}
      <motion.div custom={2} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        {isLoading ? (
          <LoadingSpinner />
        ) : events.length === 0 ? (
          <EmptyState message="Filtreye uygun olay bulunamadi" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20">
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tarih</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ticker</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Kaynak</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Baslik</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Kategori</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Onem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {events.map((e, i) => (
                    <tr
                      key={e.id || i}
                      onClick={() => e.id && setSelectedEventId(e.id)}
                      className="hover:bg-muted/15 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDate(e.published_at)}</td>
                      <td className="px-5 py-3 font-semibold text-primary text-xs">{e.ticker || "-"}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{e.source_code}</td>
                      <td className="px-5 py-3 text-xs text-foreground max-w-md truncate">{e.title || "-"}</td>
                      <td className="px-5 py-3"><CategoryBadge category={e.category} /></td>
                      <td className="px-5 py-3"><SeverityBadge severity={e.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
              <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">{events.length} kayit</span>
              <div className="flex gap-1.5">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-3 w-3" /> Onceki
                </button>
                <button
                  disabled={events.length < limit}
                  onClick={() => setPage(page + 1)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
                >
                  Sonraki <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>

      {/* Event Detail Modal */}
      <AnimatePresence>
        {selectedEventId && (
          <EventDetailModal
            eventId={selectedEventId}
            onClose={() => setSelectedEventId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
