"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { Input } from "@/components/ui/input";

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Olaylar & KAP Bildirimleri</h1>
        <p className="text-sm text-slate-400 mt-0.5">Tum KAP bildirimleri, haberler ve fiyat olaylari</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-2">
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => { setSourceFilter(s); setPage(0); }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                sourceFilter === s
                  ? "bg-teal-50 border-teal-300 text-teal-700"
                  : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
            >
              {s || "Tumu"}
            </button>
          ))}
        </div>
        <Input
          placeholder="Ticker filtrele..."
          value={tickerFilter}
          onChange={(e) => { setTickerFilter(e.target.value.toUpperCase()); setPage(0); }}
          className="w-40 h-8 text-xs bg-white border-slate-200"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <LoadingSpinner />
        ) : events.length === 0 ? (
          <EmptyState message="Filtreye uygun olay bulunamadi" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Tarih</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Ticker</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Kaynak</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Baslik</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Kategori</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Onem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {events.map((e, i) => (
                    <tr key={e.id || i} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{formatDate(e.published_at)}</td>
                      <td className="px-4 py-3 font-semibold text-teal-600 text-xs">{e.ticker || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{e.source_code}</td>
                      <td className="px-4 py-3 text-slate-700 max-w-md truncate">{e.title || "-"}</td>
                      <td className="px-4 py-3"><CategoryBadge category={e.category} /></td>
                      <td className="px-4 py-3"><SeverityBadge severity={e.severity} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">{events.length} kayit gosteriliyor</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(Math.max(0, page - 1))}
                  className="px-3 py-1 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  Onceki
                </button>
                <button
                  disabled={events.length < limit}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
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
