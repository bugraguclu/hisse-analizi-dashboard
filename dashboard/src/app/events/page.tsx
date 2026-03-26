"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { Input } from "@/components/ui/input";
import { motion, AnimatePresence } from "framer-motion";
import { Newspaper, ChevronLeft, ChevronRight, X, ExternalLink, Search } from "lucide-react";
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
  const [tickerInput, setTickerInput] = useState("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suggestRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const limit = 25;

  const [suggestQuery, setSuggestQuery] = useState("");
  const { data: suggestions } = useQuery({
    queryKey: ["tickerSuggest", suggestQuery],
    queryFn: () => api.search(suggestQuery),
    enabled: suggestQuery.length >= 2,
    staleTime: 60_000,
  });
  const suggestList = Array.isArray(suggestions) ? suggestions.slice(0, 6) : [];

  const handleTickerChange = useCallback((value: string) => {
    const upper = value.toUpperCase();
    setTickerInput(upper);

    clearTimeout(suggestRef.current);
    suggestRef.current = setTimeout(() => {
      setSuggestQuery(upper);
      if (upper.length >= 2) setShowSuggestions(true);
      else setShowSuggestions(false);
    }, 300);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTickerFilter(upper);
      setPage(0);
    }, 500);
  }, []);

  const handleSuggestionSelect = useCallback((ticker: string) => {
    setTickerInput(ticker);
    setTickerFilter(ticker);
    setShowSuggestions(false);
    setPage(0);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(suggestRef.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (inputWrapperRef.current && !inputWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
        <div className="relative" ref={inputWrapperRef}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
          <Input
            placeholder="Ticker ara (orn: THY, GAR...)"
            value={tickerInput}
            onChange={(e) => handleTickerChange(e.target.value)}
            onFocus={() => { if (suggestList.length > 0 && tickerInput.length >= 2) setShowSuggestions(true); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                clearTimeout(debounceRef.current);
                setTickerFilter(tickerInput);
                setShowSuggestions(false);
                setPage(0);
              }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            className="w-52 h-8 text-xs pl-8"
          />
          {showSuggestions && suggestList.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-card border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden">
              {suggestList.map((item: Record<string, unknown>, i: number) => {
                const ticker = String(item.ticker ?? item.symbol ?? "");
                const name = String(item.name ?? item.display_name ?? item.legal_name ?? "");
                return (
                  <button
                    key={i}
                    onClick={() => handleSuggestionSelect(ticker)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                  >
                    <span className="text-xs font-bold text-primary min-w-[50px]">{ticker}</span>
                    <span className="text-[11px] text-muted-foreground truncate">{name}</span>
                  </button>
                );
              })}
            </div>
          )}
          {tickerFilter && (
            <button
              onClick={() => { setTickerInput(""); setTickerFilter(""); setSuggestQuery(""); setPage(0); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted/50 transition-colors"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>
      </motion.div>

      {/* Table */}
      <motion.div custom={2} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        {isLoading ? (
          <LoadingSpinner />
        ) : events.length === 0 ? (
          <EmptyState message={tickerFilter ? `"${tickerFilter}" icin olay bulunamadi — daha kisa bir arama deneyin` : "Filtreye uygun olay bulunamadi"} />
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
