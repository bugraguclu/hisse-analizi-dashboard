"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { motion } from "framer-motion";
import Link from "next/link";

function SignalCard({ label, signal }: { label: string; signal?: string }) {
  const s = (signal || "NOTR").toUpperCase();
  const config = s === "AL" || s === "BUY" || s === "STRONG_BUY"
    ? { bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400", label: "AL", dot: "bg-emerald-500" }
    : s === "SAT" || s === "SELL" || s === "STRONG_SELL"
    ? { bg: "bg-red-500/10", border: "border-red-500/20", text: "text-red-600 dark:text-red-400", label: "SAT", dot: "bg-red-500" }
    : { bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-600 dark:text-amber-400", label: "NOTR", dot: "bg-amber-500" };

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4 transition-all hover:scale-[1.02]`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${config.dot}`} />
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</div>
      </div>
      <div className={`text-xl font-bold ${config.text}`}>{config.label}</div>
    </div>
  );
}

function IndicatorCard({ label, value, subtitle }: { label: string; value: string | number; subtitle?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 hover:shadow-md transition-all">
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</div>
      <div className="text-lg font-bold font-mono text-foreground">{typeof value === "number" ? formatNumber(value) : value}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
    </div>
  );
}

export default function TeknikPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const signalsQ = useQuery({ queryKey: ["signals", t], queryFn: () => api.signals(t) });
  const rsiQ = useQuery({ queryKey: ["rsi", t], queryFn: () => api.rsi(t) });
  const macdQ = useQuery({ queryKey: ["macd", t], queryFn: () => api.macd(t) });
  const bollingerQ = useQuery({ queryKey: ["bollinger", t], queryFn: () => api.bollinger(t) });
  const supertrendQ = useQuery({ queryKey: ["supertrend", t], queryFn: () => api.supertrend(t) });
  const stochasticQ = useQuery({ queryKey: ["stochastic", t], queryFn: () => api.stochastic(t) });

  const signals = signalsQ.data as Record<string, unknown> | null;
  const signalMap = (signals?.signals || signals) as Record<string, string> | undefined;

  const rsiData = rsiQ.data as Record<string, unknown> | null;
  const rsiArr = rsiData ? (Array.isArray(rsiData.rsi) ? rsiData.rsi : Array.isArray(rsiData.data) ? rsiData.data : Array.isArray(rsiData) ? rsiData : []) : [];
  const rsiVal = rsiArr.length > 0 ? Number(typeof rsiArr[rsiArr.length - 1] === "number" ? rsiArr[rsiArr.length - 1] : (rsiArr[rsiArr.length - 1] as Record<string, unknown>)?.rsi || (rsiArr[rsiArr.length - 1] as Record<string, unknown>)?.value || 0) : null;

  const macdData = macdQ.data as Record<string, unknown> | null;
  const bollingerData = bollingerQ.data as Record<string, unknown> | null;
  const stochasticData = stochasticQ.data as Record<string, unknown> | null;
  const supertrendData = supertrendQ.data as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-xl font-bold text-foreground">Teknik Analiz — {t}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            RSI, MACD, Bollinger, SuperTrend &middot;{" "}
            <Link href={`/hisse/${t}`} className="text-primary hover:underline">Hisse</Link>
            {" "}&middot;{" "}
            <Link href={`/temel/${t}`} className="text-primary hover:underline">Temel</Link>
          </p>
        </motion.div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* Signal Summary */}
      {signalsQ.isLoading ? <LoadingSpinner /> : signalMap && typeof signalMap === "object" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(signalMap).map(([key, val], index) => (
            <motion.div key={key} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * 0.03 }}>
              <SignalCard label={key} signal={String(val)} />
            </motion.div>
          ))}
        </div>
      ) : <EmptyState message="Sinyal verisi alinamadi" />}

      {/* Indicator Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <IndicatorCard label="RSI (14)" value={rsiVal != null ? formatNumber(rsiVal) : "-"} subtitle={rsiVal != null ? (rsiVal > 70 ? "Asiri alim" : rsiVal < 30 ? "Asiri satim" : "Normal bolge") : undefined} />
        <IndicatorCard label="MACD" value={macdData?.macd != null ? formatNumber(Number(macdData.macd)) : "-"} />
        <IndicatorCard label="MACD Signal" value={macdData?.signal != null ? formatNumber(Number(macdData.signal)) : "-"} />
        <IndicatorCard label="MACD Histogram" value={macdData?.histogram != null ? formatNumber(Number(macdData.histogram)) : "-"} />
        <IndicatorCard label="Bollinger Upper" value={bollingerData?.upper != null ? formatNumber(Number(bollingerData.upper)) : "-"} />
        <IndicatorCard label="Bollinger Middle" value={bollingerData?.middle != null ? formatNumber(Number(bollingerData.middle)) : "-"} />
        <IndicatorCard label="Bollinger Lower" value={bollingerData?.lower != null ? formatNumber(Number(bollingerData.lower)) : "-"} />
        <IndicatorCard
          label="SuperTrend"
          value={supertrendData?.direction != null ? (Number(supertrendData.direction) > 0 ? "YUKARI" : "ASAGI") : supertrendData?.value != null ? formatNumber(Number(supertrendData.value)) : "-"}
          subtitle={supertrendData?.value != null ? `Deger: ${formatNumber(Number(supertrendData.value))}` : undefined}
        />
      </div>

      {/* RSI Gauge */}
      {rsiVal != null && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-xl border border-border p-5"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">RSI Gostergesi</h2>
          <div className="relative h-6 bg-gradient-to-r from-emerald-500/20 via-amber-500/20 to-red-500/20 rounded-full overflow-hidden">
            {/* Zone labels */}
            <div className="absolute inset-0 flex">
              <div className="w-[30%] border-r border-border/50" />
              <div className="w-[40%] border-r border-border/50" />
              <div className="w-[30%]" />
            </div>
            {/* Indicator */}
            <motion.div
              initial={{ left: "0%" }}
              animate={{ left: `${Math.min(rsiVal, 100)}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
              className="absolute top-0 h-full w-1.5 bg-foreground rounded-full"
              style={{ transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-muted-foreground font-mono">
            <span>0 (Asiri Satim)</span>
            <span>30</span>
            <span>50</span>
            <span>70</span>
            <span>100 (Asiri Alim)</span>
          </div>
          <div className="mt-3 text-center">
            <span className="text-2xl font-bold font-mono text-foreground">{formatNumber(rsiVal)}</span>
            <span className="text-sm text-muted-foreground ml-2">
              {rsiVal > 70 ? "— Asiri Alim Bolgesi" : rsiVal < 30 ? "— Asiri Satim Bolgesi" : "— Normal Bolge"}
            </span>
          </div>
        </motion.div>
      )}

      {/* Stochastic */}
      {stochasticData && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-3">Stochastic</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[11px] text-muted-foreground uppercase mb-1">%K</div>
              <div className="text-lg font-bold font-mono text-foreground">{stochasticData.k != null ? formatNumber(Number(stochasticData.k)) : "-"}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase mb-1">%D</div>
              <div className="text-lg font-bold font-mono text-foreground">{stochasticData.d != null ? formatNumber(Number(stochasticData.d)) : "-"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
