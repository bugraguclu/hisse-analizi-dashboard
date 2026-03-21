"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatDate, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

export default function HissePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const pricesQ = useQuery({ queryKey: ["prices", t], queryFn: () => api.prices(t, 90) });
  const ratiosQ = useQuery({ queryKey: ["ratios", t], queryFn: () => api.financialRatios(t) });
  const eventsQ = useQuery({ queryKey: ["hisse-events", t], queryFn: () => api.events({ ticker: t, limit: 10 }) });

  const prices = Array.isArray(pricesQ.data) ? pricesQ.data : [];
  const sorted = [...prices].sort((a, b) => new Date(a.trading_date || "").getTime() - new Date(b.trading_date || "").getTime());
  const chartData = sorted.map((p) => ({
    date: new Date(p.trading_date || "").toLocaleDateString("tr-TR", { day: "numeric", month: "short" }),
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
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">{t}</h1>
            {lastPrice && (
              <>
                <span className="text-2xl font-bold font-mono text-foreground">
                  ₺<SlidingNumber value={Math.round((lastPrice.close || 0) * 100) / 100} />
                </span>
                <span className={`flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-lg ${
                  isUp ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}>
                  {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {isUp ? "+" : ""}{formatNumber(change)}%
                </span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Hisse detay &middot;{" "}
            <Link href={`/teknik/${t}`} className="text-primary hover:underline">Teknik</Link>
            {" "}&middot;{" "}
            <Link href={`/temel/${t}`} className="text-primary hover:underline">Temel</Link>
          </p>
        </motion.div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* OHLCV Stats */}
      {lastPrice && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Acilis", val: formatNumber(lastPrice.open) },
            { label: "Yuksek", val: formatNumber(lastPrice.high) },
            { label: "Dusuk", val: formatNumber(lastPrice.low) },
            { label: "Kapanis", val: formatNumber(lastPrice.close) },
            { label: "Hacim", val: formatCompact(lastPrice.volume) },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-card rounded-xl border border-border p-4"
            >
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{item.label}</div>
              <div className="text-lg font-bold font-mono text-foreground">{item.val}</div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Price Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card rounded-xl border border-border p-5"
      >
        <h2 className="text-sm font-semibold text-foreground mb-4">Fiyat Grafigi (90 Gun)</h2>
        {pricesQ.isLoading ? <LoadingSpinner /> : chartData.length === 0 ? <EmptyState message="Fiyat verisi bulunamadi" /> : (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Area type="monotone" dataKey="close" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#colorClose)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume Chart */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Hacim</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                <Bar dataKey="volume" fill="hsl(var(--primary))" opacity={0.5} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </div>

        {/* Financial Ratios */}
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Finansal Oranlar</h2>
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
                    <span className="text-xs font-medium text-muted-foreground w-28 flex-shrink-0">{r.label}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                      />
                    </div>
                    <span className="text-xs font-bold font-mono text-foreground w-16 text-right">
                      {r.value != null ? formatPercent(Number(r.value) * 100) : "-"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Events */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Son Olaylar</h2>
        </div>
        {eventsQ.isLoading ? <LoadingSpinner /> : events.length === 0 ? <EmptyState message="Olay bulunamadi" /> : (
          <div className="divide-y divide-border/50">
            {events.map((e, i) => (
              <div key={e.id || i} className="px-5 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{e.title || "-"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code}</div>
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
