"use client";

import { use, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatDate, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Building2, BarChart3, Sparkles, X, ExternalLink, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { motion } from "framer-motion";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import type { TranslationKey } from "@/lib/i18n";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

const pricePeriodMap: Record<string, string> = {
  "1G": "1g",
  "5G": "5g",
  "1A": "1ay",
  "3A": "3ay",
  "6A": "6ay",
  "YBK": "1y",
  "1Y": "1y",
  "5Y": "5y",
  "Maks.": "max",
};

function formatPriceChartDate(dateStr: string, period: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  switch (period) {
    case "1G":
      return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    case "5G":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "1A":
    case "3A":
      return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
    case "6A":
      return d.toLocaleDateString("tr-TR", { month: "short", day: "2-digit" });
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

function formatRecommendation(rec: string, t: (key: TranslationKey) => string): string {
  const upper = rec.toUpperCase();
  if (upper.includes("STRONG") && upper.includes("BUY")) return t("signal.strongBuy");
  if (upper.includes("STRONG") && upper.includes("SELL")) return t("signal.strongSell");
  if (upper.includes("BUY")) return t("signal.buy");
  if (upper.includes("SELL")) return t("signal.sell");
  if (upper.includes("NEUTRAL")) return t("signal.neutral");
  return rec;
}

function EventDetailModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { t } = useLocale();
  const { data, isLoading } = useQuery({
    queryKey: ["eventDetail", eventId],
    queryFn: () => api.eventDetail(eventId),
    enabled: !!eventId,
  });
  const detail = data as Record<string, unknown> | null;

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
          <h3 className="text-sm font-semibold text-foreground">{t("events.detail")}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4" style={{ maxHeight: "calc(80vh - 60px)" }}>
          {isLoading ? (
            <LoadingSpinner />
          ) : !detail ? (
            <EmptyState message={t("events.detailNotFound")} />
          ) : (
            <>
              <h2 className="text-base font-semibold text-foreground leading-snug">
                {String(detail.title || t("events.untitled"))}
              </h2>
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                {detail.ticker ? (
                  <span className="font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{String(detail.ticker)}</span>
                ) : null}
                <SeverityBadge severity={String(detail.severity ?? "INFO")} />
                <span className="font-mono">{formatDate(String(detail.published_at ?? ""))}</span>
                <span>{String(detail.source_code ?? "").toUpperCase()}</span>
              </div>
              {detail.excerpt && (
                <div className="bg-muted/30 rounded-xl p-4">
                  <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t("events.summary")}</h4>
                  <p className="text-sm text-foreground leading-relaxed">{String(detail.excerpt)}</p>
                </div>
              )}
              {detail.body_text && (
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{String(detail.body_text)}</p>
              )}
              {detail.event_url && (
                <a href={String(detail.event_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors">
                  <ExternalLink className="h-3 w-3" /> {t("events.goToSource")}
                </a>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function HissePage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const sym = ticker.toUpperCase();
  const { t } = useLocale();
  const [pricePeriod, setPricePeriod] = useState("3A");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showAiReport, setShowAiReport] = useState(false);
  const [aiReportContent, setAiReportContent] = useState<string | null>(null);
  const [aiReportLoading, setAiReportLoading] = useState(false);
  const borsapyPeriod = pricePeriodMap[pricePeriod] ?? "3ay";

  const historyQ = useQuery({ queryKey: ["tickerHistory", sym, borsapyPeriod], queryFn: () => api.tickerHistory(sym, borsapyPeriod) });
  const ratiosQ = useQuery({ queryKey: ["ratios", sym], queryFn: () => api.financialRatios(sym) });
  const liveRatiosQ = useQuery({
    queryKey: ["liveRatios", sym],
    queryFn: () => api.liveRatios(sym),
    enabled: !ratiosQ.isLoading && (!Array.isArray(ratiosQ.data) || ratiosQ.data.length === 0),
  });
  const eventsQ = useQuery({ queryKey: ["hisse-events", sym], queryFn: () => api.events({ ticker: sym, limit: 10 }) });
  const liveNewsQ = useQuery({
    queryKey: ["liveNews", sym],
    queryFn: () => api.liveNews(sym),
    enabled: !eventsQ.isLoading && (!Array.isArray(eventsQ.data) || eventsQ.data.length === 0),
  });
  const signalsQ = useQuery({ queryKey: ["signals", sym], queryFn: () => api.signals(sym) });

  const historyData = (historyQ.data as { data: Array<Record<string, unknown>> } | null)?.data ?? [];
  const chartData = historyData.map((d) => {
    const dateRaw = String(d.Date ?? d.Datetime ?? d.date ?? d.datetime ?? d.timestamp ?? "");
    return {
      date: formatPriceChartDate(dateRaw, pricePeriod),
      rawDate: dateRaw,
      close: Number(d.Close ?? 0),
      volume: Number(d.Volume ?? 0),
      open: Number(d.Open ?? 0),
      high: Number(d.High ?? 0),
      low: Number(d.Low ?? 0),
    };
  });

  const first = chartData.length > 0 ? chartData[0] : null;
  const lastPrice = chartData.length > 0 ? chartData[chartData.length - 1] : null;
  const lastClose = lastPrice?.close ?? 0;
  const firstClose = first?.close ?? 0;
  const changeAbs = lastClose - firstClose;
  const change = firstClose > 0 ? (changeAbs / firstClose) * 100 : 0;
  const isUp = change >= 0;

  // Try DB ratios first, then live ratios as fallback
  const dbRatios = Array.isArray(ratiosQ.data) && ratiosQ.data.length > 0 ? ratiosQ.data[0] : null;
  const liveRatiosRaw = liveRatiosQ.data as Record<string, unknown> | null;
  const liveRatiosObj = liveRatiosRaw?.ratios as Record<string, unknown> | null;
  const ratios = dbRatios || liveRatiosObj;
  const ratiosLoading = ratiosQ.isLoading || (!dbRatios && liveRatiosQ.isLoading);

  // Try DB events first, then live news as fallback
  const dbEvents = Array.isArray(eventsQ.data) ? eventsQ.data : [];
  const liveNewsRaw = liveNewsQ.data as Record<string, unknown> | null;
  const liveNewsArr = Array.isArray(liveNewsRaw?.news) ? (liveNewsRaw.news as Array<Record<string, unknown>>) : [];
  const liveEventsFormatted = liveNewsArr.map((n, i) => ({
    id: `live-${i}`,
    title: String(n.Title ?? n.title ?? "-"),
    published_at: String(n.Date ?? n.date ?? ""),
    source_code: "KAP",
    severity: "INFO" as const,
  }));
  const events = dbEvents.length > 0 ? dbEvents : liveEventsFormatted;
  const eventsLoading = eventsQ.isLoading || (dbEvents.length === 0 && liveNewsQ.isLoading);

  // Backend returns: {"ticker": ..., "signals": {...}}
  const signalsRaw = signalsQ.data as Record<string, unknown> | null;
  const signalsObj = (signalsRaw?.signals && typeof signalsRaw.signals === "object"
    ? signalsRaw.signals
    : signalsRaw) as Record<string, unknown> | null;
  const summary = signalsObj?.summary as Record<string, unknown> | undefined;
  const recommendation = summary?.recommendation ? String(summary.recommendation)
    : summary?.signal ? String(summary.signal) : null;

  const handleGenerateReport = useCallback(async () => {
    setAiReportLoading(true);
    setShowAiReport(true);
    setAiReportContent(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/ai/report/${sym}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const json = await res.json() as Record<string, unknown>;
        setAiReportContent(String(json.report ?? json.content ?? json.analysis ?? JSON.stringify(json)));
      } else {
        setAiReportContent(
          `${sym} icin AI rapor servisi su anda kullanilabilir degil. Lutfen daha sonra tekrar deneyin.`
        );
      }
    } catch {
      setAiReportContent(
        `${sym} icin AI rapor servisi su anda kullanilabilir degil. Lutfen daha sonra tekrar deneyin.`
      );
    } finally {
      setAiReportLoading(false);
    }
  }, [sym]);

  const pricePeriods = Object.keys(pricePeriodMap);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{sym.slice(0, 2)}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{sym}</h1>
            </div>
            {lastPrice && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-2xl font-bold font-mono text-foreground">
                  <SlidingNumber value={Math.round(lastClose * 100) / 100} />
                </span>
                <span className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg ${
                  isUp ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                }`}>
                  {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {isUp ? "+" : ""}{formatNumber(change, 2)}%
                </span>
                {recommendation && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg uppercase ${
                    recommendation.includes("BUY") ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : recommendation.includes("SELL") ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}>
                    {formatRecommendation(recommendation, t)}
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
            { label: t("index.open"), val: formatNumber(lastPrice.open) },
            { label: t("index.high"), val: formatNumber(lastPrice.high) },
            { label: t("index.low"), val: formatNumber(lastPrice.low) },
            { label: t("index.close"), val: formatNumber(lastPrice.close) },
            { label: t("index.volume"), val: formatCompact(lastPrice.volume) },
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

      {/* Price Chart with Period Selection */}
      <motion.div custom={6} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground">{t("hisse.priceChart")}</h2>
        </div>
        <div className="flex gap-0 border-b border-border/40 mb-4">
          {pricePeriods.map((p) => (
            <button
              key={p}
              onClick={() => setPricePeriod(p)}
              className={`px-3 py-2 text-xs font-semibold transition-all border-b-2 ${
                p === pricePeriod
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        {historyQ.isLoading ? <LoadingSpinner /> : chartData.length === 0 ? <EmptyState message={t("hisse.noPriceData")} /> : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="var(--color-muted-foreground)" strokeOpacity={0.3} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} interval="equidistantPreserveStart" minTickGap={50} />
              <YAxis tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 10, fontSize: 12, color: "var(--color-card-foreground)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)" }}
              />
              <Area type="monotone" dataKey="close" stroke={isUp ? "rgb(239,68,68)" : "rgb(16,185,129)"} strokeWidth={2} fill="url(#colorClose)" dot={false} activeDot={{ r: 3, fill: isUp ? "rgb(239,68,68)" : "rgb(16,185,129)" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Volume Chart */}
        <motion.div custom={7} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">{t("index.volume")}</h2>
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
          <h2 className="text-sm font-semibold text-foreground mb-4">{t("hisse.financialRatios")}</h2>
          {ratiosLoading ? <LoadingSpinner /> : (ratiosQ.isError && liveRatiosQ.isError) ? <ErrorState message={t("hisse.ratiosLoadError")} onRetry={() => { ratiosQ.refetch(); liveRatiosQ.refetch(); }} /> : !ratios ? <EmptyState message={t("hisse.noRatios")} /> : (
            <div className="space-y-3">
              {[
                { label: t("hisse.grossMargin"), value: ratios.gross_margin, max: 50, unit: "%", color: "from-amber-500 to-amber-400" },
                { label: t("hisse.ebitdaMargin"), value: ratios.ebitda_margin, max: 40, unit: "%", color: "from-violet-500 to-violet-400" },
                { label: t("hisse.netMargin"), value: ratios.net_margin, max: 30, unit: "%", color: "from-blue-500 to-blue-400" },
                { label: "ROE", value: ratios.roe, max: 30, unit: "%", color: "from-emerald-500 to-emerald-400" },
                { label: "ROA", value: ratios.roa, max: 20, unit: "%", color: "from-cyan-500 to-cyan-400" },
                { label: t("hisse.currentRatio"), value: ratios.current_ratio, max: 3, unit: "x", color: "from-teal-500 to-teal-400" },
                { label: t("hisse.netDebtEbitda"), value: ratios.net_debt_ebitda, max: 10, unit: "x", color: "from-red-500 to-red-400" },
                { label: t("hisse.debtToEquity"), value: ratios.debt_to_equity, max: 3, unit: "x", color: "from-orange-500 to-orange-400" },
                { label: t("hisse.peRatio"), value: ratios.pe_ratio, max: 30, unit: "", color: "from-pink-500 to-pink-400" },
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
                { label: t("hisse.grossMargin"), value: ratios.gross_margin },
                { label: t("hisse.ebitdaMargin"), value: ratios.ebitda_margin },
                { label: t("hisse.netMargin"), value: ratios.net_margin },
                { label: "ROE", value: ratios.roe },
                { label: "ROA", value: ratios.roa },
                { label: t("hisse.currentRatio"), value: ratios.current_ratio },
              ].every((r) => r.value == null) && (
                <p className="text-xs text-muted-foreground text-center py-2">{t("hisse.someRatiosMissing")}</p>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* AI Report Button */}
      <motion.div custom={8.5} variants={stagger} initial="hidden" animate="show">
        <button
          onClick={handleGenerateReport}
          disabled={aiReportLoading}
          className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-2xl px-6 py-4 transition-all shadow-lg hover:shadow-xl disabled:opacity-60"
        >
          {aiReportLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
          <div className="text-left">
            <span className="text-sm font-semibold block">{t("ai.reportButton")}</span>
            <span className="text-[11px] text-white/70">{t("ai.reportDesc")}</span>
          </div>
        </button>
      </motion.div>

      {/* AI Report Content */}
      <AnimatePresence>
        {showAiReport && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-card rounded-2xl border border-violet-500/30 overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-foreground">{t("ai.reportTitle")} - {sym}</h2>
              </div>
              <button onClick={() => setShowAiReport(false)} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="p-5">
              {aiReportLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                  <span className="ml-3 text-sm text-muted-foreground">{t("ai.generating")}</span>
                </div>
              ) : aiReportContent ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{aiReportContent}</p>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent Events */}
      <motion.div custom={9} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border/40">
          <h2 className="text-sm font-semibold text-foreground">{t("hisse.recentEvents")}</h2>
        </div>
        {eventsLoading ? <LoadingSpinner /> : events.length === 0 ? <EmptyState message={t("hisse.noEvents")} /> : (
          <div className="divide-y divide-border/30">
            {events.map((e, i) => (
              <div
                key={e.id || i}
                onClick={() => e.id && !String(e.id).startsWith("live-") && setSelectedEventId(e.id)}
                className="px-5 py-3 flex items-center gap-3 hover:bg-muted/20 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">{e.title || "-"}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{formatDate(e.published_at)} &middot; {e.source_code?.toUpperCase()}</div>
                </div>
                <SeverityBadge severity={e.severity} />
              </div>
            ))}
          </div>
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
