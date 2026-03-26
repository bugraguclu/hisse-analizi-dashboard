"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatDate, formatCompact } from "@/lib/format";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { CardSkeleton, TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronRight,
  BarChart3,
  Newspaper,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Eye,
  Database,
  Zap,
  Clock,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Area,
  AreaChart,
} from "recharts";
import type { StatsOut, EventOut } from "@/types";

const watchlist = [
  { ticker: "THYAO", name: "Turk Hava Yollari" },
  { ticker: "GARAN", name: "Garanti Bankasi" },
  { ticker: "SISE", name: "Sise Cam" },
  { ticker: "ASELS", name: "Aselsan" },
  { ticker: "EREGL", name: "Eregli Demir Celik" },
];

const stagger = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function MarketDate() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isOpen = day >= 1 && day <= 5 && hour >= 10 && hour < 18;
  const dateStr = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <p className="text-sm text-muted-foreground capitalize">{dateStr}</p>
      <div className="flex items-center gap-3 mt-0.5">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Piyasa Ozeti</h1>
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
          isOpen ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
          {isOpen ? "Piyasa Acik" : "Piyasa Kapali"}
        </span>
      </div>
    </div>
  );
}

function SystemStatusCard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats(),
  });

  if (isLoading) return <CardSkeleton />;

  const totalEvents = (stats as StatsOut)?.total_normalized_events ?? 0;
  const totalPrices = (stats as StatsOut)?.total_price_records ?? 0;
  const pending = (stats as StatsOut)?.pending_outbox ?? 0;
  const rawEvents = (stats as StatsOut)?.total_raw_events ?? 0;

  const metrics = [
    { icon: Database, label: "Fiyat Kaydi", value: formatCompact(totalPrices), color: "text-blue-500" },
    { icon: Zap, label: "Ham Olay", value: formatCompact(rawEvents), color: "text-amber-500" },
    { icon: Clock, label: "Bekleyen", value: String(pending), color: "text-purple-500" },
  ];

  return (
    <motion.div
      custom={0}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="col-span-full lg:col-span-2 bg-card rounded-2xl border border-border/60 p-6 relative overflow-hidden"
    >
      <div className="absolute -top-20 -right-20 w-48 h-48 bg-primary/5 rounded-full blur-3xl" />
      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-bold text-primary uppercase tracking-wider">Sistem Durumu</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Activity className="h-3 w-3" />
            Aktif
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-foreground font-mono tracking-tight">
            <SlidingNumber value={totalEvents} />
          </span>
          <span className="text-sm text-muted-foreground">olay islendi</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-border/40">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <m.icon className={`h-3 w-3 ${m.color}`} />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{m.label}</p>
              </div>
              <p className="text-lg font-bold font-mono text-foreground">{m.value}</p>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function useIndexSummary(symbol: string) {
  return useQuery({
    queryKey: ["indexData", symbol],
    queryFn: () => api.indexData(symbol, "1ay"),
    staleTime: 120_000,
  });
}

function MarketPulse() {
  const xu100 = useIndexSummary("XU100");
  const xu030 = useIndexSummary("XU030");
  const xusin = useIndexSummary("XUSIN");
  const queries = [xu100, xu030, xusin];
  const isLoading = queries.some((q) => q.isLoading);

  const items = [xu100.data, xu030.data, xusin.data]
    .filter(Boolean)
    .map((d) => {
      const raw = d as { symbol: string; data: Array<Record<string, unknown>> };
      const arr = raw?.data ?? [];
      if (arr.length === 0) return { name: raw?.symbol ?? "", value: 0, change: 0 };
      const last = arr[arr.length - 1];
      const prev = arr.length > 1 ? arr[arr.length - 2] : last;
      const close = Number(last.Close ?? 0);
      const prevClose = Number(prev.Close ?? close);
      const change = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
      return { name: raw.symbol, value: close, change };
    });

  return (
    <motion.div
      custom={1}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="bg-card rounded-2xl border border-border/60 p-5"
    >
      <h2 className="text-sm font-semibold text-foreground mb-4">Piyasa Nabzi</h2>
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const isUp = item.change >= 0;
            return (
              <motion.div
                key={i}
                custom={i + 2}
                variants={stagger}
                initial="hidden"
                animate="show"
                className={`flex items-center justify-between p-3.5 rounded-xl border transition-all hover:shadow-sm ${
                  isUp
                    ? "bg-emerald-500/5 border-emerald-500/10"
                    : "bg-red-500/5 border-red-500/10"
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {item.value > 0 ? formatNumber(item.value) : "-"}
                  </p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg ${
                  isUp ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10" : "text-red-700 dark:text-red-400 bg-red-500/10"
                }`}>
                  {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {isUp ? "+" : ""}{item.change !== 0 ? `${formatNumber(item.change)}%` : "-"}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

const periodMap: Record<string, string> = {
  "1G": "1g",
  "1H": "1hf",
  "1A": "1ay",
  "3A": "3ay",
  "YBB": "5y",
};

function formatChartDate(dateStr: string, period: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  switch (period) {
    case "1G":
      return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    case "1H":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "1A":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "3A":
      return d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    case "YBB":
      return d.toLocaleDateString("tr-TR", { month: "short", year: "numeric" });
    default:
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  }
}

function PerformanceChart() {
  const [period, setPeriod] = useState("1A");
  const borsapyPeriod = periodMap[period] ?? "1ay";

  const { data, isLoading } = useQuery({
    queryKey: ["indexChart", "XU100", borsapyPeriod],
    queryFn: () => api.indexData("XU100", borsapyPeriod),
  });

  const raw = data as { data: Array<Record<string, unknown>> } | null;
  const rawData = raw?.data ?? [];
  const chartData = rawData.map((d) => {
    const dateRaw = String(d.Date ?? d.Datetime ?? d.date ?? d.datetime ?? d.timestamp ?? "");
    return {
      date: formatChartDate(dateRaw, period),
      rawDate: dateRaw,
      close: Number(d.Close ?? d.close ?? 0),
    };
  });

  const first = chartData.length > 0 ? chartData[0].close : 0;
  const last = chartData.length > 0 ? chartData[chartData.length - 1].close : 0;
  const changeAbs = last - first;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  const isUp = changeAbs >= 0;

  const periods = Object.keys(periodMap);

  return (
    <motion.div
      custom={4}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="lg:col-span-2 bg-card rounded-2xl border border-border/60 p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">BIST 100 Performans</h2>
          {chartData.length > 0 && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-muted-foreground font-mono">
                Son: {formatNumber(last)}
              </p>
              <span className={`text-[11px] font-bold font-mono ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {isUp ? "+" : ""}{formatNumber(changePct)}%
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                p === period
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-[220px] bg-muted/20 rounded-xl animate-pulse" />
      ) : chartData.length > 0 ? (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isUp ? "rgb(16,185,129)" : "rgb(239,68,68)"} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={isUp ? "rgb(16,185,129)" : "rgb(239,68,68)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" vertical={false} stroke="var(--color-muted-foreground)" strokeOpacity={0.15} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                tickMargin={10}
                interval="equidistantPreserveStart"
                minTickGap={40}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickMargin={10} tickFormatter={(v) => formatCompact(v)} domain={["dataMin - 50", "dataMax + 50"]} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-card)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  color: "var(--color-card-foreground)",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                }}
                labelStyle={{ color: "var(--color-muted-foreground)" }}
                formatter={(value: unknown) => [`${formatNumber(Number(value))}`, "BIST 100"]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={isUp ? "rgb(16,185,129)" : "rgb(239,68,68)"}
                strokeWidth={2}
                fill="url(#chartGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState message="Grafik verisi bulunamadi" />
      )}
    </motion.div>
  );
}

function WatchlistTable() {
  const { data: screenerData, isLoading } = useQuery({
    queryKey: ["screener"],
    queryFn: () => api.screener(),
    staleTime: 120_000,
  });

  // Backend returns: {"filters": {...}, "results": [...]}
  const screenerObj = screenerData as Record<string, unknown> | null;
  const results = screenerObj?.results
    ? (screenerObj.results as Array<Record<string, unknown>>)
    : Array.isArray(screenerData)
      ? (screenerData as Array<Record<string, unknown>>)
      : [];

  return (
    <motion.div
      custom={5}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Takip Listesi</h2>
        </div>
        <Link href="/tarama" className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors">
          Tumu <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {watchlist.map((w, i) => {
            const match = results.find(
              (r) => String(r.symbol ?? r.ticker ?? "").toUpperCase() === w.ticker
            );
            const price = match ? Number(match.criteria_7 ?? match.close ?? match.price ?? 0) : 0;

            return (
              <Link
                key={w.ticker}
                href={`/hisse/${w.ticker}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary">{w.ticker.slice(0, 2)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{w.ticker}</p>
                    <p className="text-[11px] text-muted-foreground">{w.name}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-foreground font-mono">
                    {price > 0 ? formatNumber(price) : "-"}
                  </p>
                  <Link
                    href={`/teknik/${w.ticker}`}
                    className="text-[10px] text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Teknik
                  </Link>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

function LatestInsights() {
  const { data, isLoading } = useQuery({
    queryKey: ["latestEvents"],
    queryFn: () => api.latestEvents(),
  });

  const events: EventOut[] = Array.isArray(data) ? data.slice(0, 5) : [];

  return (
    <motion.div
      custom={6}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="col-span-full bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Son Gelismeler</h2>
        </div>
        <Link href="/events" className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors">
          Tum raporlar <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : events.length === 0 ? (
        <div className="px-5 pb-5"><EmptyState message="Henuz olay kaydedilmemis" /></div>
      ) : (
        <div className="divide-y divide-border/30">
          {events.map((e, i) => (
            <Link
              key={e.id || i}
              href={e.ticker ? `/hisse/${e.ticker}` : "/events"}
              className="flex items-start gap-3.5 px-5 py-3.5 hover:bg-muted/20 transition-colors"
            >
              <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                e.severity === "HIGH"
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : e.severity === "WATCH"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
              }`}>
                {e.severity === "HIGH" ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  {e.ticker && <span className="text-xs font-bold text-primary">{e.ticker}</span>}
                  <CategoryBadge category={e.category} />
                  <SeverityBadge severity={e.severity} />
                </div>
                <p className="text-sm text-foreground truncate">{e.title || "-"}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function QuickActions() {
  const actions = [
    { label: "Hisse Analizi", href: "/hisse/THYAO", icon: BarChart3, desc: "Detayli hisse analizi", gradient: "from-blue-500/10 to-blue-500/5", iconColor: "text-blue-500" },
    { label: "Teknik Analiz", href: "/teknik/THYAO", icon: TrendingUp, desc: "RSI, MACD, Bollinger", gradient: "from-emerald-500/10 to-emerald-500/5", iconColor: "text-emerald-500" },
    { label: "Hisse Tarama", href: "/tarama", icon: RefreshCw, desc: "Filtreli tarama", gradient: "from-purple-500/10 to-purple-500/5", iconColor: "text-purple-500" },
  ];

  return (
    <div className="col-span-full grid grid-cols-1 sm:grid-cols-3 gap-3">
      {actions.map((a, i) => {
        const Icon = a.icon;
        return (
          <motion.div key={a.label} custom={i + 2} variants={stagger} initial="hidden" animate="show">
            <Link
              href={a.href}
              className="flex items-center gap-4 bg-card rounded-2xl border border-border/60 p-4 hover:border-primary/20 hover:shadow-md transition-all group"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${a.gradient} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                <Icon className={`h-5 w-5 ${a.iconColor}`} />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{a.label}</p>
                <p className="text-[11px] text-muted-foreground">{a.desc}</p>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <MarketDate />
        <div className="flex items-center gap-3">
          <div className="w-72 md:w-80">
            <TickerSearch />
          </div>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm shadow-primary/20 flex-shrink-0">
            <span className="text-[10px] font-bold text-primary-foreground">HA</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SystemStatusCard />
        <MarketPulse />
      </div>

      <QuickActions />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PerformanceChart />
        <WatchlistTable />
      </div>

      <LatestInsights />
    </div>
  );
}
