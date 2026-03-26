"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { TrendingUp, Building2, Activity } from "lucide-react";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.04, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function SignalCard({ label, signal, index }: { label: string; signal?: string; index: number }) {
  const s = (signal || "NOTR").toUpperCase();
  const config = s === "AL" || s === "BUY" || s === "STRONG_BUY"
    ? { bg: "bg-emerald-500/8", border: "border-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", label: "AL", dot: "bg-emerald-500" }
    : s === "SAT" || s === "SELL" || s === "STRONG_SELL"
    ? { bg: "bg-red-500/8", border: "border-red-500/20", text: "text-red-600 dark:text-red-400", label: "SAT", dot: "bg-red-500" }
    : { bg: "bg-amber-500/8", border: "border-amber-500/20", text: "text-amber-600 dark:text-amber-400", label: "NOTR", dot: "bg-amber-500" };

  return (
    <motion.div custom={index + 2} variants={stagger} initial="hidden" animate="show">
      <div className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-all hover:shadow-sm`}>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${config.dot}`} />
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</div>
        </div>
        <div className={`text-xl font-bold ${config.text}`}>{config.label}</div>
      </div>
    </motion.div>
  );
}

function IndicatorCard({ label, value, subtitle, index }: { label: string; value: string | number; subtitle?: string; index: number }) {
  return (
    <motion.div custom={index} variants={stagger} initial="hidden" animate="show">
      <div className="bg-card rounded-xl border border-border/60 p-4 hover:shadow-sm transition-all">
        <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
        <div className="text-lg font-bold font-mono text-foreground">{typeof value === "number" ? formatNumber(value) : value}</div>
        {subtitle && <div className="text-[11px] text-muted-foreground mt-1">{subtitle}</div>}
      </div>
    </motion.div>
  );
}

export default function TeknikPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();
  const router = useRouter();

  const signalsQ = useQuery({ queryKey: ["signals", t], queryFn: () => api.signals(t) });
  const rsiQ = useQuery({ queryKey: ["rsi", t], queryFn: () => api.rsi(t) });
  const macdQ = useQuery({ queryKey: ["macd", t], queryFn: () => api.macd(t) });
  const bollingerQ = useQuery({ queryKey: ["bollinger", t], queryFn: () => api.bollinger(t) });
  const supertrendQ = useQuery({ queryKey: ["supertrend", t], queryFn: () => api.supertrend(t) });
  const stochasticQ = useQuery({ queryKey: ["stochastic", t], queryFn: () => api.stochastic(t) });

  // Backend returns: {"ticker": ..., "signals": {...}}
  const signalsRaw = signalsQ.data as Record<string, unknown> | null;
  const signalMap = (signalsRaw?.signals && typeof signalsRaw.signals === "object"
    ? signalsRaw.signals
    : null) as Record<string, string> | null;

  // Backend returns: {"ticker": ..., "indicator": "RSI", "period": 14, "value": 65.12}
  const rsiData = rsiQ.data as Record<string, unknown> | null;
  const rsiVal = rsiData?.value != null ? Number(rsiData.value) : null;

  // Backend returns: {"ticker": ..., "indicator": "MACD", "data": {"macd": ..., "signal": ..., "histogram": ...}}
  const macdRaw = macdQ.data as Record<string, unknown> | null;
  const macdData = (macdRaw?.data && typeof macdRaw.data === "object" ? macdRaw.data : macdRaw) as Record<string, unknown> | null;

  // Backend returns: {"ticker": ..., "indicator": "BOLLINGER", "data": {"upper": ..., "middle": ..., "lower": ...}}
  const bollingerRaw = bollingerQ.data as Record<string, unknown> | null;
  const bollingerData = (bollingerRaw?.data && typeof bollingerRaw.data === "object" ? bollingerRaw.data : bollingerRaw) as Record<string, unknown> | null;

  // Backend returns: {"ticker": ..., "indicator": "STOCHASTIC", "data": {"k": ..., "d": ...}}
  const stochasticRaw = stochasticQ.data as Record<string, unknown> | null;
  const stochasticData = (stochasticRaw?.data && typeof stochasticRaw.data === "object" ? stochasticRaw.data : stochasticRaw) as Record<string, unknown> | null;

  // Backend returns: {"ticker": ..., "indicator": "SUPERTREND", "data": {"value": ..., "direction": ...}}
  const supertrendRaw = supertrendQ.data as Record<string, unknown> | null;
  const supertrendData = (supertrendRaw?.data && typeof supertrendRaw.data === "object" ? supertrendRaw.data : supertrendRaw) as Record<string, unknown> | null;

  function handleTickerSelect(newTicker: string) {
    router.push(`/teknik/${newTicker.toUpperCase()}`);
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Teknik Analiz — {t}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Link href={`/hisse/${t}`} className="text-[11px] text-primary hover:underline">Hisse</Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/temel/${t}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Temel
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
        <div className="w-72 md:w-80"><TickerSearch onSelect={handleTickerSelect} /></div>
      </div>

      {/* Signal Summary */}
      {signalsQ.isLoading ? <LoadingSpinner /> : signalMap && typeof signalMap === "object" && Object.keys(signalMap).length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(signalMap).map(([key, val], index) => (
            <SignalCard key={key} label={key} signal={String(val)} index={index} />
          ))}
        </div>
      ) : <EmptyState message="Sinyal verisi alinamadi" />}

      {/* Indicator Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <IndicatorCard index={8} label="RSI (14)" value={rsiVal != null ? formatNumber(rsiVal) : "-"} subtitle={rsiVal != null ? (rsiVal > 70 ? "Asiri alim" : rsiVal < 30 ? "Asiri satim" : "Normal bolge") : undefined} />
        <IndicatorCard index={9} label="MACD" value={macdData?.macd != null ? formatNumber(Number(macdData.macd)) : "-"} />
        <IndicatorCard index={10} label="MACD Signal" value={macdData?.signal != null ? formatNumber(Number(macdData.signal)) : "-"} />
        <IndicatorCard index={11} label="MACD Histogram" value={macdData?.histogram != null ? formatNumber(Number(macdData.histogram)) : "-"} />
        <IndicatorCard index={12} label="Bollinger Upper" value={bollingerData?.upper != null ? formatNumber(Number(bollingerData.upper)) : "-"} />
        <IndicatorCard index={13} label="Bollinger Middle" value={bollingerData?.middle != null ? formatNumber(Number(bollingerData.middle)) : "-"} />
        <IndicatorCard index={14} label="Bollinger Lower" value={bollingerData?.lower != null ? formatNumber(Number(bollingerData.lower)) : "-"} />
        <IndicatorCard
          index={15}
          label="SuperTrend"
          value={supertrendData?.direction != null ? (Number(supertrendData.direction) > 0 ? "YUKARI" : "ASAGI") : supertrendData?.value != null ? formatNumber(Number(supertrendData.value)) : "-"}
          subtitle={supertrendData?.value != null ? `Deger: ${formatNumber(Number(supertrendData.value))}` : undefined}
        />
      </div>

      {/* RSI Gauge */}
      {rsiVal != null && (
        <motion.div custom={16} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">RSI Gostergesi</h2>
          </div>
          <div className="relative h-3 bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-red-500/20 rounded-full overflow-hidden">
            <div className="absolute inset-0 flex">
              <div className="w-[30%] border-r border-border/30" />
              <div className="w-[40%] border-r border-border/30" />
              <div className="w-[30%]" />
            </div>
            <motion.div
              initial={{ left: "0%" }}
              animate={{ left: `${Math.min(rsiVal, 100)}%` }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-foreground rounded-full shadow-md border-2 border-card"
              style={{ transform: "translate(-50%, -50%)" }}
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
            <span>0 (Asiri Satim)</span>
            <span>30</span>
            <span>50</span>
            <span>70</span>
            <span>100 (Asiri Alim)</span>
          </div>
          <div className="mt-4 text-center">
            <span className="text-3xl font-bold font-mono text-foreground">{formatNumber(rsiVal)}</span>
            <span className="text-sm text-muted-foreground ml-2">
              {rsiVal > 70 ? "Asiri Alim Bolgesi" : rsiVal < 30 ? "Asiri Satim Bolgesi" : "Normal Bolge"}
            </span>
          </div>
        </motion.div>
      )}

      {/* Stochastic */}
      {stochasticData && (
        <motion.div custom={17} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Stochastic</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">%K</div>
              <div className="text-2xl font-bold font-mono text-foreground">{stochasticData.k != null ? formatNumber(Number(stochasticData.k)) : "-"}</div>
            </div>
            <div className="bg-muted/30 rounded-xl p-4">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">%D</div>
              <div className="text-2xl font-bold font-mono text-foreground">{stochasticData.d != null ? formatNumber(Number(stochasticData.d)) : "-"}</div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
