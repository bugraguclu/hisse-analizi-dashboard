"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";

function SignalCard({ label, signal }: { label: string; signal?: string }) {
  const s = (signal || "NOTR").toUpperCase();
  const config = s === "AL" || s === "BUY" || s === "STRONG_BUY"
    ? { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "AL" }
    : s === "SAT" || s === "SELL" || s === "STRONG_SELL"
    ? { bg: "bg-red-50", border: "border-red-200", text: "text-red-600", label: "SAT" }
    : { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", label: "NOTR" };

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4`}>
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{label}</div>
      <div className={`text-xl font-bold ${config.text}`}>{config.label}</div>
    </div>
  );
}

function IndicatorCard({ label, value, subtitle }: { label: string; value: string | number; subtitle?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{label}</div>
      <div className="text-lg font-bold font-mono text-slate-800">{typeof value === "number" ? formatNumber(value) : value}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
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
  const tfQ = useQuery({ queryKey: ["tf", t], queryFn: () => api.signalsAllTimeframes(t) });

  const signals = signalsQ.data as Record<string, unknown> | null;
  const signalMap = (signals?.signals || signals) as Record<string, string> | undefined;

  const rsiData = rsiQ.data as Record<string, unknown> | null;
  const rsiArr = rsiData ? (Array.isArray(rsiData.rsi) ? rsiData.rsi : Array.isArray(rsiData.data) ? rsiData.data : Array.isArray(rsiData) ? rsiData : []) : [];
  const rsiVal = rsiArr.length > 0 ? Number(typeof rsiArr[rsiArr.length - 1] === "number" ? rsiArr[rsiArr.length - 1] : (rsiArr[rsiArr.length - 1] as Record<string, unknown>)?.rsi || (rsiArr[rsiArr.length - 1] as Record<string, unknown>)?.value || 0) : null;

  const macdData = macdQ.data as Record<string, unknown> | null;
  const bollingerData = bollingerQ.data as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Teknik Analiz — {t}</h1>
          <p className="text-sm text-slate-400 mt-0.5">RSI, MACD, Bollinger, SuperTrend, Stochastic</p>
        </div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* Signal summary */}
      {signalsQ.isLoading ? <LoadingSpinner /> : signalMap && typeof signalMap === "object" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Object.entries(signalMap).map(([key, val]) => (
            <SignalCard key={key} label={key} signal={String(val)} />
          ))}
        </div>
      ) : <EmptyState message="Sinyal verisi alinamadi" />}

      {/* Indicator cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <IndicatorCard
          label="RSI (14)"
          value={rsiVal != null ? formatNumber(rsiVal) : "-"}
          subtitle={rsiVal != null ? (rsiVal > 70 ? "Asiri alim" : rsiVal < 30 ? "Asiri satim" : "Normal") : undefined}
        />
        <IndicatorCard label="MACD" value={macdData?.macd != null ? formatNumber(Number(macdData.macd)) : "-"} />
        <IndicatorCard label="MACD Signal" value={macdData?.signal != null ? formatNumber(Number(macdData.signal)) : "-"} />
        <IndicatorCard label="MACD Histogram" value={macdData?.histogram != null ? formatNumber(Number(macdData.histogram)) : "-"} />
        <IndicatorCard label="Bollinger Upper" value={bollingerData?.upper != null ? formatNumber(Number(bollingerData.upper)) : "-"} />
        <IndicatorCard label="Bollinger Middle" value={bollingerData?.middle != null ? formatNumber(Number(bollingerData.middle)) : "-"} />
        <IndicatorCard label="Bollinger Lower" value={bollingerData?.lower != null ? formatNumber(Number(bollingerData.lower)) : "-"} />
        <IndicatorCard label="SuperTrend" value={supertrendQ.data ? JSON.stringify(supertrendQ.data).substring(0, 30) : "-"} />
      </div>

      {/* RSI Progress */}
      {rsiVal != null && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">RSI Gostergesi</h2>
          <div className="relative h-4 bg-gradient-to-r from-emerald-100 via-amber-100 to-red-100 rounded-full overflow-hidden">
            <div
              className="absolute top-0 h-full w-1.5 bg-slate-800 rounded-full"
              style={{ left: `${Math.min(rsiVal, 100)}%`, transform: "translateX(-50%)" }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-slate-400 font-mono">
            <span>0 (Asiri Satim)</span>
            <span>50</span>
            <span>100 (Asiri Alim)</span>
          </div>
        </div>
      )}
    </div>
  );
}
