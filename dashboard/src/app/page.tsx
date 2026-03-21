"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatDate, formatCompact } from "@/lib/format";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { CardSkeleton, TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { SeverityBadge, CategoryBadge } from "@/components/shared/SeverityBadge";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Activity,
  ChevronRight,
  BarChart3,
  Newspaper,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Eye,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { StatsOut, EventOut } from "@/types";

const watchlist = [
  { ticker: "THYAO", name: "Turk Hava Yollari" },
  { ticker: "GARAN", name: "Garanti Bankasi" },
  { ticker: "SISE", name: "Sise Cam" },
  { ticker: "ASELS", name: "Aselsan" },
  { ticker: "EREGL", name: "Eregli Demir Celik" },
];

const indexSymbols = ["XU100", "XU030", "XUSIN"];

function MarketDate() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isOpen = day >= 1 && day <= 5 && hour >= 10 && hour < 18;
  const dateStr = now.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
  });

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {dateStr}, {isOpen ? "Piyasa Acik" : "Piyasa Kapali"}
      </p>
      <h1 className="text-2xl font-bold text-foreground">Piyasa Ozeti</h1>
    </div>
  );
}

function PortfolioCard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.stats(),
  });

  if (isLoading) return <CardSkeleton />;

  const totalEvents = (stats as StatsOut)?.total_normalized_events ?? 0;
  const totalPrices = (stats as StatsOut)?.total_price_records ?? 0;
  const pending = (stats as StatsOut)?.pending_outbox ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="col-span-full lg:col-span-2 bg-gradient-to-br from-primary/5 via-card to-card rounded-xl border border-border p-6 relative overflow-hidden"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="relative">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-md uppercase tracking-wide">
            Sistem Durumu
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
            <Activity className="h-3 w-3" />
            Aktif
          </span>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-4xl font-bold text-foreground font-mono">
            <SlidingNumber value={totalEvents} />
          </span>
          <span className="text-sm text-muted-foreground">olay islendi</span>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-border/60">
          <div>
            <p className="text-xs text-muted-foreground">Fiyat Kaydi</p>
            <p className="text-lg font-bold font-mono text-foreground">
              {formatCompact(totalPrices)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Gunluk Hacim</p>
            <p className="text-lg font-bold font-mono text-foreground">
              {formatCompact((stats as StatsOut)?.total_raw_events ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Bekleyen</p>
            <p className="text-lg font-bold font-mono text-foreground">{pending}</p>
          </div>
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
  const queries = [xu100, xu030, xu030, xusin];
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-card rounded-xl border border-border p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Piyasa Nabzi</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const isUp = item.change >= 0;
            return (
              <div
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  isUp
                    ? "bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10"
                    : "bg-red-500/5 border-red-500/10 hover:bg-red-500/10"
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {item.value > 0 ? formatNumber(item.value) : "-"}
                  </p>
                </div>
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-md ${
                    isUp
                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/15"
                      : "text-red-700 dark:text-red-400 bg-red-500/15"
                  }`}
                >
                  {isUp ? "+" : ""}
                  {item.change !== 0 ? `${formatNumber(item.change)}%` : "-"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

const periodMap: Record<string, string> = {
  "1H": "1hf",
  "1A": "1ay",
  "3A": "3ay",
  "YBB": "5y",
};

function PerformanceChart() {
  const [period, setPeriod] = useState("1A");
  const borsapyPeriod = periodMap[period] ?? "1ay";

  const { data, isLoading } = useQuery({
    queryKey: ["indexChart", "XU100", borsapyPeriod],
    queryFn: () => api.indexData("XU100", borsapyPeriod),
  });

  const raw = data as { data: Array<Record<string, unknown>> } | null;
  const chartData = (raw?.data ?? []).map((d) => ({
    date: new Date(String(d.Date ?? "")).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "short",
    }),
    close: Number(d.Close ?? 0),
  }));

  const periods = Object.keys(periodMap);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="lg:col-span-2 bg-card rounded-xl border border-border p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">BIST 100 Performans</h2>
        <div className="flex gap-0.5 border border-border rounded-lg overflow-hidden">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${
                p === period
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-[220px] bg-muted/30 rounded-lg animate-pulse" />
      ) : chartData.length > 0 ? (
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <defs>
                <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="4 8"
                vertical={false}
                stroke="hsl(var(--border))"
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickMargin={10}
                interval="preserveStartEnd"
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickMargin={10}
                tickFormatter={(v) => `${formatCompact(v)}`}
                domain={["dataMin - 50", "dataMax + 50"]}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(value: unknown) => [`${formatNumber(Number(value))}`, "BIST 100"]}
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: "hsl(var(--primary))",
                  stroke: "hsl(var(--card))",
                  strokeWidth: 2,
                }}
              />
            </LineChart>
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

  const results =
    screenerData && typeof screenerData === "object" && "results" in (screenerData as Record<string, unknown>)
      ? ((screenerData as Record<string, unknown>).results as Array<Record<string, unknown>>)
      : Array.isArray(screenerData)
        ? (screenerData as Array<Record<string, unknown>>)
        : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="bg-card rounded-xl border border-border"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Takip Listesi</h2>
        </div>
        <Link
          href="/tarama"
          className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          Yonet <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-3 px-5 py-2 border-t border-border bg-muted/30">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          Hisse
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-right">
          Fiyat
        </span>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide text-right">
          Sinyal
        </span>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {watchlist.map((w) => {
            const match = results.find(
              (r) => String(r.symbol ?? r.ticker ?? "").toUpperCase() === w.ticker
            );
            const price = match ? Number(match.criteria_7 ?? match.close ?? match.price ?? 0) : 0;

            return (
              <Link
                key={w.ticker}
                href={`/hisse/${w.ticker}`}
                className="grid grid-cols-3 items-center px-5 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <div>
                  <p className="text-sm font-bold text-foreground">{w.ticker}</p>
                  <p className="text-[11px] text-muted-foreground">{w.name}</p>
                </div>
                <p className="text-sm font-semibold text-foreground text-right font-mono">
                  {price > 0 ? `${formatNumber(price)}` : "-"}
                </p>
                <div className="flex items-center justify-end">
                  <Link
                    href={`/teknik/${w.ticker}`}
                    className="text-[11px] font-medium text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Teknik Analiz
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="col-span-full bg-card rounded-xl border border-border"
    >
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Son Gelismeler</h2>
        </div>
        <Link
          href="/events"
          className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          Tum raporlari gor <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : events.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState message="Henuz olay kaydedilmemis" />
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {events.map((e, i) => (
            <Link
              key={e.id || i}
              href={e.ticker ? `/hisse/${e.ticker}` : "/events"}
              className="flex items-start gap-4 px-5 py-3.5 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <div
                className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  e.severity === "HIGH"
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : e.severity === "WATCH"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                }`}
              >
                {e.severity === "HIGH" ? (
                  <TrendingDown className="h-4 w-4" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {e.ticker && (
                    <span className="text-xs font-bold text-primary">{e.ticker}</span>
                  )}
                  <CategoryBadge category={e.category} />
                  <SeverityBadge severity={e.severity} />
                </div>
                <p className="text-sm text-foreground truncate">{e.title || "-"}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {formatDate(e.published_at)} &middot; {e.source_code}
                </p>
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
    {
      label: "Hisse Analizi",
      href: "/hisse/THYAO",
      icon: BarChart3,
      desc: "Detayli hisse analizi",
      color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    {
      label: "Teknik Analiz",
      href: "/teknik/THYAO",
      icon: TrendingUp,
      desc: "RSI, MACD, Bollinger",
      color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Hisse Tarama",
      href: "/tarama",
      icon: RefreshCw,
      desc: "Filtreli tarama",
      color: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="col-span-full lg:col-span-3 grid grid-cols-3 gap-3"
    >
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.label}
            href={a.href}
            className="bg-card rounded-xl border border-border p-4 hover:shadow-md hover:border-primary/20 transition-all group"
          >
            <div
              className={`w-9 h-9 rounded-lg ${a.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}
            >
              <Icon className="h-4.5 w-4.5" />
            </div>
            <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {a.label}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{a.desc}</p>
          </Link>
        );
      })}
    </motion.div>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <MarketDate />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block">Canli veri</span>
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
            HA
          </div>
        </div>
      </motion.div>

      {/* Row 1: Portfolio + Market Pulse */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <PortfolioCard />
        <MarketPulse />
      </div>

      {/* Quick Actions */}
      <QuickActions />

      {/* Row 2: Performance Chart + Watchlist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <PerformanceChart />
        <WatchlistTable />
      </div>

      {/* Row 3: Latest Insights */}
      <LatestInsights />
    </div>
  );
}
