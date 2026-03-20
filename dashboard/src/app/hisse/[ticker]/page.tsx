"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatDate, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";

export default function HissePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const pricesQ = useQuery({ queryKey: ["prices", t], queryFn: () => api.prices(t, 90) });
  const ratiosQ = useQuery({ queryKey: ["ratios", t], queryFn: () => api.financialRatios(t) });
  const eventsQ = useQuery({ queryKey: ["hisse-events", t], queryFn: () => api.events({ ticker: t, limit: 10 }) });
  const infoQ = useQuery({ queryKey: ["fast-info", t], queryFn: () => api.fastInfo(t) });

  const prices = Array.isArray(pricesQ.data) ? pricesQ.data : [];
  const sorted = [...prices].sort((a, b) => new Date(a.trading_date || a.date || "").getTime() - new Date(b.trading_date || b.date || "").getTime());
  const chartData = sorted.map((p) => ({
    date: new Date(p.trading_date || p.date || "").toLocaleDateString("tr-TR", { day: "numeric", month: "short" }),
    close: p.close || 0,
    volume: p.volume || 0,
  }));

  const lastPrice = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const prevPrice = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const change = lastPrice && prevPrice && prevPrice.close ? ((lastPrice.close! - prevPrice.close!) / prevPrice.close!) * 100 : 0;
  const isUp = change >= 0;

  const ratios = Array.isArray(ratiosQ.data) && ratiosQ.data.length > 0 ? ratiosQ.data[0] : null;
  const events = Array.isArray(eventsQ.data) ? eventsQ.data : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-slate-800">{t}</h1>
            {lastPrice && (
              <>
                <span className="text-2xl font-bold font-mono text-slate-800">{formatNumber(lastPrice.close)}</span>
                <span className={`flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-lg ${isUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                  {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {isUp ? "+" : ""}{formatNumber(change)}%
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">Hisse detay sayfasi</p>
        </div>
        <div className="w-64">
          <TickerSearch />
        </div>
      </div>

      {/* Price stats */}
      {lastPrice && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Acilis", val: formatNumber(lastPrice.open) },
            { label: "Yuksek", val: formatNumber(lastPrice.high) },
            { label: "Dusuk", val: formatNumber(lastPrice.low) },
            { label: "Kapanis", val: formatNumber(lastPrice.close) },
            { label: "Hacim", val: formatCompact(lastPrice.volume) },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{item.label}</div>
              <div className="text-lg font-bold font-mono text-slate-800">{item.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Price chart */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Fiyat Grafigi (90 Gun)</h2>
        {pricesQ.isLoading ? <LoadingSpinner /> : chartData.length === 0 ? <EmptyState message="Fiyat verisi bulunamadi" /> : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 }} />
              <Area type="monotone" dataKey="close" stroke="#14b8a6" strokeWidth={2} fill="url(#colorClose)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume chart */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Hacim</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Bar dataKey="volume" fill="#14b8a6" opacity={0.4} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>

        {/* Financial ratios */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Finansal Oranlar</h2>
          {ratiosQ.isLoading ? <LoadingSpinner /> : !ratios ? <EmptyState message="Finansal oran verisi yok" /> : (
            <div className="space-y-3">
              {[
                { label: "ROE", value: ratios.roe, max: 0.5 },
                { label: "ROA", value: ratios.roa, max: 0.3 },
                { label: "Net Margin", value: ratios.net_margin, max: 0.4 },
                { label: "Gross Margin", value: ratios.gross_margin, max: 0.6 },
                { label: "Borc/Ozsermaye", value: ratios.debt_to_equity, max: 2 },
                { label: "Cari Oran", value: ratios.current_ratio, max: 3 },
              ].map((r) => {
                const pct = r.value != null ? Math.min(Math.abs(Number(r.value)) / r.max * 100, 100) : 0;
                return (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-slate-500 w-28 flex-shrink-0">{r.label}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold font-mono text-slate-700 w-16 text-right">
                      {r.value != null ? formatPercent(Number(r.value) * 100) : "-"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent events */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Son Olaylar</h2>
        </div>
        {eventsQ.isLoading ? <LoadingSpinner /> : events.length === 0 ? <EmptyState message="Olay bulunamadi" /> : (
          <div className="divide-y divide-slate-50">
            {events.map((e, i) => (
              <div key={e.id || i} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-700 truncate">{e.title || "-"}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code}</div>
                </div>
                <SeverityBadge severity={e.severity} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
