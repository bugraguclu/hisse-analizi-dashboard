"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatDate, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Building2, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

export default function HissePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const historyQ = useQuery({ queryKey: ["tickerHistory", t], queryFn: () => api.tickerHistory(t, "3ay") });
  const ratiosQ = useQuery({ queryKey: ["ratios", t], queryFn: () => api.financialRatios(t) });
  const eventsQ = useQuery({ queryKey: ["hisse-events", t], queryFn: () => api.events({ ticker: t, limit: 10 }) });
  const signalsQ = useQuery({ queryKey: ["signals", t], queryFn: () => api.signals(t) });

  const historyData = (historyQ.data as { data: Array<Record<string, unknown>> } | null)?.data ?? [];
  const chartData = historyData.map((d) => ({
    date: new Date(String(d.Date ?? "")).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }),
    close: Number(d.Close ?? 0),
    volume: Number(d.Volume ?? 0),
    open: Number(d.Open ?? 0),
    high: Number(d.High ?? 0),
    low: Number(d.Low ?? 0),
  }));

  const lastPrice = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const prevPrice = chartData.length > 1 ? chartData[chartData.length - 2] : null;
  const change = lastPrice && prevPrice && prevPrice.close > 0
    ? ((lastPrice.close - prevPrice.close) / prevPrice.close) * 100 : 0;
  const isUp = change >= 0;

  const ratios = Array.isArray(ratiosQ.data) && ratiosQ.data.length > 0 ? ratiosQ.data[0] : null;
  const events = Array.isArray(eventsQ.data) ? eventsQ.data : [];

  // Backend returns: {"ticker": ..., "signals": {...}}
  // signals could be {"summary": {"recommendation": "BUY", ...}, "RSI": "AL", ...}
  const signalsRaw = signalsQ.data as Record<string, unknown> | null;
  const signalsObj = (signalsRaw?.signals && typeof signalsRaw.signals === "object"
    ? signalsRaw.signals
    : signalsRaw) as Record<string, unknown> | null;
  const summary = signalsObj?.summary as Record<string, unknown> | undefined;
  const recommendation = summary?.recommendation ? String(summary.recommendation)
    : summary?.signal ? String(summary.signal) : null;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{t.slice(0, 2)}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{t}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Link href={`/teknik/${t}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Teknik
                </Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/temel/${t}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Temel
                </Link>
              </div>
            </div>
            {lastPrice && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-2xl font-bold font-mono text-foreground">
                  <SlidingNumber value={Math.round(lastPrice.close * 100) / 100} />
                </span>
                <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                  isUp ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}>
                  {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {isUp ? "+" : ""}{formatNumber(change)}%
                </span>
                {recommendation && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg uppercase ${
                    recommendation.includes("BUY") ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : recommendation.includes("SELL") ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}>
                    {recommendation.replace("STRONG_", "Guclu ").replace("BUY", "Al").replace("SELL", "Sat").replace("NEUTRAL", "Notr")}
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.div>
        <div className="w-72 md:w-80"><TickerSearch /></div>
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
              custom={i + 1}
              variants={stagger}
              initial="hidden"
              animate="show"
              className="bg-card rounded-xl border border-border/60 p-4 hover:shadow-sm transition-shadow"
            >
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{item.label}</div>
              <div className="text-lg font-bold font-mono text-foreground">{item.val}</div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Price Chart */}
      <motion.div custom={6} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Fiyat Grafigi (3 Ay)</h2>
        {historyQ.isLoading ? <LoadingSpinner /> : chartData.length === 0 ? <EmptyState message="Fiyat verisi bulunamadi" /> : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="var(--color-muted-foreground)" strokeOpacity={0.3} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 12, color: "var(--color-card-foreground)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
              />
              <Area type="monotone" dataKey="close" stroke="var(--color-primary)" strokeWidth={2} fill="url(#colorClose)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Volume Chart */}
        <motion.div custom={7} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Hacim</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="4 8" stroke="var(--color-muted-foreground)" strokeOpacity={0.3} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v) => formatCompact(v)} />
                <Bar dataKey="volume" fill="var(--color-primary)" opacity={0.4} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState />}
        </motion.div>

        {/* Financial Ratios */}
        <motion.div custom={8} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Finansal Oranlar</h2>
          {ratiosQ.isLoading ? <LoadingSpinner /> : ratiosQ.isError ? <ErrorState message="Finansal oranlar yuklenemedi" onRetry={() => ratiosQ.refetch()} /> : !ratios ? <EmptyState message="Bu hisse icin finansal oran verisi henuz yok" /> : (
            <div className="space-y-3">
              {[
                { label: "Brut Kar Marji", value: ratios.gross_margin, max: 50, unit: "%", color: "from-amber-500 to-amber-400" },
                { label: "EBITDA Marji", value: ratios.ebitda_margin, max: 40, unit: "%", color: "from-violet-500 to-violet-400" },
                { label: "Net Kar Marji", value: ratios.net_margin, max: 30, unit: "%", color: "from-blue-500 to-blue-400" },
                { label: "ROE", value: ratios.roe, max: 30, unit: "%", color: "from-emerald-500 to-emerald-400" },
                { label: "ROA", value: ratios.roa, max: 20, unit: "%", color: "from-cyan-500 to-cyan-400" },
                { label: "Cari Oran", value: ratios.current_ratio, max: 3, unit: "x", color: "from-teal-500 to-teal-400" },
                { label: "Net Borc/EBITDA", value: ratios.net_debt_ebitda, max: 10, unit: "x", color: "from-red-500 to-red-400" },
                { label: "Borc/Ozsermaye", value: ratios.debt_to_equity, max: 3, unit: "x", color: "from-orange-500 to-orange-400" },
                { label: "F/K", value: ratios.pe_ratio, max: 30, unit: "", color: "from-pink-500 to-pink-400" },
              ].filter((r) => r.value != null).map((r) => {
                const val = Number(r.value);
                const pct = Math.min(Math.abs(val) / r.max * 100, 100);
                const display = r.unit === "%" ? `%${formatNumber(val)}`
                  : r.unit === "x" ? `${formatNumber(val)}x`
                  : formatNumber(val);
                return (
                  <div key={r.label} className="flex items-center gap-3">
                    <span className="text-[11px] font-medium text-muted-foreground w-28 flex-shrink-0">{r.label}</span>
                    <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
                        className={`h-full rounded-full bg-gradient-to-r ${r.color}`}
                      />
                    </div>
                    <span className="text-[11px] font-bold font-mono text-foreground w-20 text-right">
                      {display}
                    </span>
                  </div>
                );
              })}
              {[
                { label: "Brut Kar Marji", value: ratios.gross_margin },
                { label: "EBITDA Marji", value: ratios.ebitda_margin },
                { label: "Net Kar Marji", value: ratios.net_margin },
                { label: "ROE", value: ratios.roe },
                { label: "ROA", value: ratios.roa },
                { label: "Cari Oran", value: ratios.current_ratio },
              ].every((r) => r.value == null) && (
                <p className="text-xs text-muted-foreground text-center py-2">Bazi oranlar bu hisse icin hesaplanamamistir</p>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Recent Events */}
      <motion.div custom={9} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/40">
          <h2 className="text-sm font-semibold text-foreground">Son Olaylar</h2>
        </div>
        {eventsQ.isLoading ? <LoadingSpinner /> : eventsQ.isError ? <ErrorState message="Olaylar yuklenemedi" onRetry={() => eventsQ.refetch()} /> : events.length === 0 ? <EmptyState message="Bu hisse icin henuz olay kaydedilmemis" /> : (
          <div className="divide-y divide-border/30">
            {events.map((e, i) => (
              <div key={e.id || i} className="px-5 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{e.title || "-"}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code}</div>
                </div>
                <SeverityBadge severity={e.severity} />
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
