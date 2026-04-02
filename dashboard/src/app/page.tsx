"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatDate, formatCompact } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
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
  X,
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
  ReferenceLine,
} from "recharts";
import type { StatsOut, EventOut } from "@/types";
import type { TranslationKey } from "@/lib/i18n";

interface WatchlistItem {
  ticker: string;
  name: string;
}

interface WatchlistGroup {
  id: string;
  name: string;
  items: WatchlistItem[];
}

const DEFAULT_WATCHLISTS: WatchlistGroup[] = [
  {
    id: "favorites",
    name: "Favoriler",
    items: [
      { ticker: "THYAO", name: "Turk Hava Yollari" },
      { ticker: "GARAN", name: "Garanti Bankasi" },
      { ticker: "SISE", name: "Sise Cam" },
      { ticker: "ASELS", name: "Aselsan" },
      { ticker: "EREGL", name: "Eregli Demir Celik" },
    ],
  },
];

function getWatchlists(): WatchlistGroup[] {
  if (typeof window === "undefined") return DEFAULT_WATCHLISTS;
  try {
    const stored = localStorage.getItem("watchlists");
    if (stored) {
      const parsed = JSON.parse(stored) as WatchlistGroup[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_WATCHLISTS;
}

function saveWatchlists(lists: WatchlistGroup[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("watchlists", JSON.stringify(lists));
}

const stagger = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function MarketDate() {
  const { t } = useLocale();
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const isOpen = day >= 1 && day <= 5 && hour >= 10 && hour < 18;
  const dateStr = now.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      <p className="text-sm text-muted-foreground capitalize">{dateStr}</p>
      <div className="flex items-center gap-3 mt-0.5">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">{t("dashboard.marketOverview")}</h1>
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
          isOpen ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
          {isOpen ? t("dashboard.marketOpen") : t("dashboard.marketClosed")}
        </span>
      </div>
    </div>
  );
}

function SystemStatusCard() {
  const { t } = useLocale();
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
    { icon: Database, label: t("dashboard.priceRecords"), value: formatCompact(totalPrices), color: "text-blue-500" },
    { icon: Zap, label: t("dashboard.rawEvents"), value: formatCompact(rawEvents), color: "text-amber-500" },
    { icon: Clock, label: t("dashboard.pending"), value: String(pending), color: "text-purple-500" },
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
          <span className="text-[11px] font-bold text-primary uppercase tracking-wider">{t("dashboard.systemStatus")}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <Activity className="h-3 w-3" />
            {t("dashboard.active")}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-foreground font-mono tracking-tight">
            <SlidingNumber value={totalEvents} />
          </span>
          <span className="text-sm text-muted-foreground">{t("dashboard.eventsProcessed")}</span>
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
  const { t } = useLocale();
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
      const first = arr[0];
      const close = Number(last.Close ?? 0);
      const firstClose = Number(first.Close ?? close);
      const change = firstClose > 0 ? ((close - firstClose) / firstClose) * 100 : 0;
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
      <h2 className="text-sm font-semibold text-foreground mb-4">{t("dashboard.marketPulse")}</h2>
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
                    ? "bg-red-500/5 border-red-500/10"
                    : "bg-emerald-500/5 border-emerald-500/10"
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {item.value > 0 ? formatNumber(item.value) : "-"}
                  </p>
                </div>
                <div className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg ${
                  isUp ? "text-red-700 dark:text-red-400 bg-red-500/10" : "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
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
  "5G": "5g",
  "1A": "1ay",
  "3A": "3ay",
  "6A": "6ay",
  "YBK": "ytd",
  "1Y": "1y",
  "5Y": "5y",
  "Maks.": "max",
};

const periodLabelKeys: Record<string, TranslationKey> = {
  "1G": "index.today",
  "5G": "index.5days",
  "1A": "index.1month",
  "3A": "index.3months",
  "6A": "index.6months",
  "YBK": "index.ytd",
  "1Y": "index.1year",
  "5Y": "index.5years",
  "Maks.": "index.allTime",
};

function formatChartDate(dateStr: string, period: string): string {
  // borsapy may return dates like "2025-03-27 09:30:00+03:00" or ISO strings
  // Replace space with T for proper parsing if needed
  const normalized = dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr;
  switch (period) {
    case "1G":
      return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    case "5G":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    case "1A":
    case "3A":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "6A":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "YBK":
    case "1Y":
      return d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    case "5Y":
    case "Maks.":
      return d.toLocaleDateString("tr-TR", { year: "numeric" });
    default:
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  }
}

function PerformanceChart() {
  const { t } = useLocale();
  const [period, setPeriod] = useState("1G");
  const borsapyPeriod = periodMap[period] ?? "1g";

  const { data, isLoading } = useQuery({
    queryKey: ["indexChart", "XU100", borsapyPeriod],
    queryFn: () => api.indexData("XU100", borsapyPeriod),
  });

  const raw = data as { data: Array<Record<string, unknown>> } | null;
  const rawData = raw?.data ?? [];
  // Deduplicate entries with same formatted date (can happen with intraday data)
  const chartData = rawData.map((d) => {
    const dateRaw = String(d.Date ?? d.Datetime ?? d.date ?? d.datetime ?? d.timestamp ?? "");
    return {
      date: formatChartDate(dateRaw, period),
      rawDate: dateRaw,
      close: Number(d.Close ?? d.close ?? 0),
      open: Number(d.Open ?? d.open ?? 0),
      high: Number(d.High ?? d.high ?? 0),
      low: Number(d.Low ?? d.low ?? 0),
    };
  });

  // Price stats
  const first = chartData.length > 0 ? chartData[0] : null;
  const last = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const lastClose = last?.close ?? 0;
  const prevClose = first?.close ?? 0;
  const changeAbs = lastClose - prevClose;
  const changePct = prevClose > 0 ? (changeAbs / prevClose) * 100 : 0;
  const isUp = changeAbs >= 0;

  // OHLC aggregated from chart data
  const openPrice = first?.open ?? first?.close ?? 0;
  const highPrice = chartData.length > 0 ? Math.max(...chartData.map((d) => d.high || d.close)) : 0;
  const lowPrice = chartData.length > 0 ? Math.min(...chartData.filter((d) => (d.low || d.close) > 0).map((d) => d.low || d.close)) : 0;

  // 52-week high/low (approximate from data if period is long enough)
  const allCloses = chartData.map((d) => d.close).filter((v) => v > 0);
  const maxClose = allCloses.length > 0 ? Math.max(...allCloses) : 0;
  const minClose = allCloses.length > 0 ? Math.min(...allCloses) : 0;

  const periods = Object.keys(periodMap);

  // Period label via i18n
  const periodLabel = periodLabelKeys[period] ? t(periodLabelKeys[period]) : "";

  // Last update time
  const lastDateStr = last?.rawDate ?? "";
  const normalizedLastDate = lastDateStr.includes("T") ? lastDateStr : lastDateStr.replace(" ", "T");
  const lastDate = new Date(normalizedLastDate);
  const dateLabel = !isNaN(lastDate.getTime())
    ? lastDate.toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "Europe/Istanbul" }) +
      " " +
      lastDate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) +
      " GMT+3"
    : "";

  return (
    <motion.div
      custom={4}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="lg:col-span-2 bg-card rounded-2xl border border-border/60 p-5"
    >
      {/* Header: Price + Change */}
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">BIST 100</h2>
        </div>
        {chartData.length > 0 ? (
          <div className="mt-1">
            <span className="text-3xl font-bold text-foreground font-mono tracking-tight">
              {formatNumber(lastClose, 2)}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-sm font-semibold font-mono ${isUp ? "text-red-500" : "text-emerald-500"}`}>
                {isUp ? "+" : ""}{formatNumber(changeAbs, 2)} ({isUp ? "+" : "-"}%{formatNumber(Math.abs(changePct), 2)})
              </span>
              <span className={`text-sm ${isUp ? "text-red-500" : "text-emerald-500"}`}>
                {isUp ? "\u2191" : "\u2193"}
              </span>
              <span className="text-xs text-muted-foreground ml-1">{periodLabel}</span>
            </div>
            {dateLabel && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{dateLabel}</p>
            )}
          </div>
        ) : !isLoading ? (
          <span className="text-2xl font-bold text-foreground font-mono">-</span>
        ) : null}
      </div>

      {/* Period tabs */}
      <div className="flex gap-0 border-b border-border/40 mb-4">
        {periods.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-2 text-xs font-semibold transition-all border-b-2 ${
              p === period
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart */}
      {isLoading ? (
        <div className="h-[200px] bg-muted/20 rounded-xl animate-pulse" />
      ) : chartData.length > 0 ? (
        <>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="bist100Gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="var(--color-muted-foreground)" strokeOpacity={0.1} />
                {prevClose > 0 && (
                  <ReferenceLine
                    y={prevClose}
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                    label={{
                      value: `${t("index.prevClose")} ${formatNumber(prevClose, 2)}`,
                      position: "right",
                      fontSize: 9,
                      fill: "var(--color-muted-foreground)",
                    }}
                  />
                )}
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickMargin={8}
                  interval="equidistantPreserveStart"
                  minTickGap={50}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickMargin={8}
                  tickFormatter={(v) => formatCompact(v)}
                  domain={["dataMin - 30", "dataMax + 30"]}
                  width={55}
                />
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
                  formatter={(value: unknown) => [`${formatNumber(Number(value), 2)}`, "BIST 100"]}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"}
                  strokeWidth={1.5}
                  fill="url(#bist100Gradient)"
                  dot={false}
                  activeDot={{ r: 3, fill: isUp ? "rgb(239,68,68)" : "rgb(16,185,129)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Bottom stats bar - like Google Finance */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-border/40">
            {[
              [t("index.open"), openPrice],
              [t("index.high"), highPrice],
              [t("index.low"), lowPrice],
              [t("index.prevClose"), prevClose],
              [period === "1G" || period === "5G" ? t("index.periodHigh") : t("index.52wHigh"), maxClose],
              [period === "1G" || period === "5G" ? t("index.periodLow") : t("index.52wLow"), minClose],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex flex-col">
                <span className="text-[10px] text-muted-foreground">{String(label)}</span>
                <span className="text-xs font-semibold font-mono text-foreground">
                  {Number(value) > 0 ? formatNumber(Number(value), 2) : "-"}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <EmptyState message={t("dashboard.chartNoData")} />
      )}
    </motion.div>
  );
}

function WatchlistTable() {
  const { t } = useLocale();
  const [watchlists, setWatchlists] = useState<WatchlistGroup[]>(DEFAULT_WATCHLISTS);
  const [activeListId, setActiveListId] = useState<string>("");
  const [showManage, setShowManage] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [addTickerInput, setAddTickerInput] = useState("");

  // Load from localStorage on mount
  useEffect(() => {
    const loaded = getWatchlists();
    setWatchlists(loaded);
    setActiveListId(loaded[0]?.id ?? "");
  }, []);

  const activeList = watchlists.find((l) => l.id === activeListId) ?? watchlists[0];
  const activeItems = activeList?.items ?? [];
  const tickers = activeItems.map((w) => w.ticker);

  const { data: snapshotData, isLoading: snapshotLoading } = useQuery({
    queryKey: ["snapshot", tickers.join(",")],
    queryFn: () => api.snapshot(tickers),
    enabled: tickers.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: screenerData, isLoading: screenerLoading } = useQuery({
    queryKey: ["screener"],
    queryFn: () => api.screener(),
    staleTime: 120_000,
  });

  const isLoading = snapshotLoading && screenerLoading;

  const snapshotArr = Array.isArray(snapshotData) ? snapshotData as Record<string, unknown>[]
    : snapshotData && typeof snapshotData === "object" && "data" in (snapshotData as Record<string, unknown>)
    ? ((snapshotData as Record<string, unknown>).data as Record<string, unknown>[])
    : [];

  const screenerObj = screenerData as Record<string, unknown> | null;
  const results = screenerObj?.results
    ? (screenerObj.results as Array<Record<string, unknown>>)
    : Array.isArray(screenerData)
      ? (screenerData as Array<Record<string, unknown>>)
      : [];

  function handleCreateList() {
    if (!newListName.trim()) return;
    const newList: WatchlistGroup = {
      id: `list-${Date.now()}`,
      name: newListName.trim(),
      items: [],
    };
    const updated = [...watchlists, newList];
    setWatchlists(updated);
    saveWatchlists(updated);
    setActiveListId(newList.id);
    setNewListName("");
  }

  function handleDeleteList(listId: string) {
    if (watchlists.length <= 1) return;
    const updated = watchlists.filter((l) => l.id !== listId);
    setWatchlists(updated);
    saveWatchlists(updated);
    if (activeListId === listId) setActiveListId(updated[0]?.id ?? "");
  }

  function handleAddTicker() {
    if (!addTickerInput.trim() || !activeList) return;
    const ticker = addTickerInput.trim().toUpperCase();
    if (activeList.items.some((i) => i.ticker === ticker)) {
      setAddTickerInput("");
      return;
    }
    const updated = watchlists.map((l) =>
      l.id === activeList.id
        ? { ...l, items: [...l.items, { ticker, name: "" }] }
        : l
    );
    setWatchlists(updated);
    saveWatchlists(updated);
    setAddTickerInput("");
  }

  function handleRemoveTicker(ticker: string) {
    if (!activeList) return;
    const updated = watchlists.map((l) =>
      l.id === activeList.id
        ? { ...l, items: l.items.filter((i) => i.ticker !== ticker) }
        : l
    );
    setWatchlists(updated);
    saveWatchlists(updated);
  }

  return (
    <motion.div
      custom={5}
      variants={stagger}
      initial="hidden"
      animate="show"
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{t("dashboard.watchlist")}</h2>
        </div>
        <button
          onClick={() => setShowManage(!showManage)}
          className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {showManage ? t("index.close") : t("watchlist.editLists")}
        </button>
      </div>

      {/* List tabs */}
      <div className="flex items-center gap-1 px-5 pb-2 overflow-x-auto">
        {watchlists.map((list) => (
          <button
            key={list.id}
            onClick={() => setActiveListId(list.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
              activeListId === list.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            {list.name}
          </button>
        ))}
      </div>

      {/* Manage panel */}
      {showManage && (
        <div className="px-5 pb-3 space-y-3 border-b border-border/40">
          {/* New list */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("watchlist.listName")}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateList(); }}
              className="flex-1 h-8 px-3 text-xs border border-border/60 rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
            />
            <button
              onClick={handleCreateList}
              disabled={!newListName.trim()}
              className="px-3 h-8 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-30 transition-colors"
            >
              {t("watchlist.newList")}
            </button>
          </div>
          {/* Add ticker to active list */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="THYAO, GARAN..."
              value={addTickerInput}
              onChange={(e) => setAddTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddTicker(); }}
              className="flex-1 h-8 px-3 text-xs border border-border/60 rounded-lg bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
            />
            <button
              onClick={handleAddTicker}
              disabled={!addTickerInput.trim()}
              className="px-3 h-8 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-30 transition-colors"
            >
              {t("watchlist.addStock")}
            </button>
          </div>
          {/* Delete list */}
          {watchlists.length > 1 && activeList && (
            <button
              onClick={() => handleDeleteList(activeList.id)}
              className="text-[11px] text-red-500 hover:text-red-400 font-medium transition-colors"
            >
              {t("watchlist.deleteList")}: {activeList.name}
            </button>
          )}
        </div>
      )}

      {/* Stock list */}
      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : activeItems.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-xs text-muted-foreground">{t("watchlist.emptyList")}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {activeItems.map((w) => {
            const snapMatch = snapshotArr.find(
              (s) => String(s.symbol ?? s.ticker ?? "").toUpperCase() === w.ticker
            );
            const scrMatch = results.find(
              (r) => String(r.symbol ?? r.ticker ?? "").toUpperCase() === w.ticker
            );
            const price = snapMatch
              ? Number(snapMatch.close ?? snapMatch.price ?? snapMatch.last ?? 0)
              : scrMatch ? Number(scrMatch.criteria_7 ?? scrMatch.close ?? scrMatch.price ?? 0) : 0;

            return (
              <div key={w.ticker} className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors">
                <Link href={`/hisse/${w.ticker}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-primary">{w.ticker.slice(0, 2)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{w.ticker}</p>
                    {w.name && <p className="text-[11px] text-muted-foreground">{w.name}</p>}
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-foreground font-mono">
                    {price > 0 ? formatNumber(price) : "-"}
                  </p>
                  {showManage && (
                    <button
                      onClick={() => handleRemoveTicker(w.ticker)}
                      className="p-1 rounded hover:bg-red-500/10 transition-colors"
                    >
                      <X className="h-3 w-3 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

function LatestInsights() {
  const { t } = useLocale();
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
          <h2 className="text-sm font-semibold text-foreground">{t("dashboard.latestDevelopments")}</h2>
        </div>
        <Link href="/events" className="text-[11px] font-medium text-primary hover:text-primary/80 flex items-center gap-0.5 transition-colors">
          {t("dashboard.allReports")} <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : events.length === 0 ? (
        <div className="px-5 pb-5"><EmptyState message={t("dashboard.noEventsYet")} /></div>
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
                <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code?.toUpperCase()}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function QuickActions() {
  const { t } = useLocale();
  const actions = [
    { label: t("quick.stockAnalysis"), href: "/hisse/THYAO", icon: BarChart3, desc: t("dashboard.detailedAnalysis"), gradient: "from-blue-500/10 to-blue-500/5", iconColor: "text-blue-500" },
    { label: t("quick.technicalAnalysis"), href: "/analiz/THYAO", icon: TrendingUp, desc: t("quick.rsiMacdBollinger"), gradient: "from-emerald-500/10 to-emerald-500/5", iconColor: "text-emerald-500" },
    { label: t("quick.screening"), href: "/tarama", icon: RefreshCw, desc: t("quick.filteredScreening"), gradient: "from-purple-500/10 to-purple-500/5", iconColor: "text-purple-500" },
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

function IndicesOverview() {
  const { locale } = useLocale();
  const indicesQ = useQuery({ queryKey: ["allIndices"], queryFn: () => api.indices(), staleTime: 120_000 });
  const rawIndices = indicesQ.data;
  const indices: Record<string, unknown>[] = Array.isArray(rawIndices) ? rawIndices as Record<string, unknown>[]
    : rawIndices && typeof rawIndices === "object" && "data" in (rawIndices as Record<string, unknown>)
    ? ((rawIndices as Record<string, unknown>).data as Record<string, unknown>[]) : [];

  if (indicesQ.isLoading) return <CardSkeleton />;
  if (indices.length === 0) return null;

  const title = locale === "en" ? "All BIST Indices" : locale === "fr" ? "Tous les indices BIST" : "Tum BIST Endeksleri";

  return (
    <motion.div custom={12} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">{indices.length}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-0 divide-x divide-y divide-border/20">
        {indices.slice(0, 18).map((idx, i) => {
          const symbol = String(idx.symbol ?? idx.name ?? idx.code ?? "");
          const close = Number(idx.close ?? idx.last ?? idx.value ?? 0);
          const change = Number(idx.change_pct ?? idx.change_percent ?? idx.changePercent ?? 0);
          const isUp = change >= 0;
          return (
            <Link key={i} href={`/tarama`} className="px-4 py-3 hover:bg-muted/10 transition-colors">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{symbol}</div>
              <div className="text-sm font-bold font-mono text-foreground mt-0.5">{close > 0 ? formatCompact(close) : "-"}</div>
              {change !== 0 && (
                <div className={`text-[10px] font-semibold mt-0.5 ${isUp ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                  {isUp ? "+" : ""}{formatNumber(change)}%
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </motion.div>
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

      <IndicesOverview />

      <LatestInsights />
    </div>
  );
}
