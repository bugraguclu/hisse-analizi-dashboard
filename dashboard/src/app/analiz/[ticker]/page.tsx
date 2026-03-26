"use client";

import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { TrendingUp, Building2, BarChart3 } from "lucide-react";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.04, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

type Tab = "teknik" | "temel" | "yan-yana";

function SignalIndicator({ label, signal }: { label: string; signal?: string }) {
  const s = (signal || "NOTR").toUpperCase();
  const isAl = s === "AL" || s === "BUY" || s === "STRONG_BUY";
  const isSat = s === "SAT" || s === "SELL" || s === "STRONG_SELL";
  const color = isAl ? "text-emerald-600 dark:text-emerald-400" : isSat ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400";
  const dot = isAl ? "bg-emerald-500" : isSat ? "bg-red-500" : "bg-amber-500";

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span className={`text-xs font-bold ${color}`}>{isAl ? "AL" : isSat ? "SAT" : "NOTR"}</span>
      </div>
    </div>
  );
}

function TeknikPanel({ ticker }: { ticker: string }) {
  const rsiQ = useQuery({ queryKey: ["rsi", ticker], queryFn: () => api.rsi(ticker) });
  const macdQ = useQuery({ queryKey: ["macd", ticker], queryFn: () => api.macd(ticker) });
  const bollingerQ = useQuery({ queryKey: ["bollinger", ticker], queryFn: () => api.bollinger(ticker) });
  const signalsQ = useQuery({ queryKey: ["signals", ticker], queryFn: () => api.signals(ticker) });

  const isLoading = rsiQ.isLoading || macdQ.isLoading || bollingerQ.isLoading || signalsQ.isLoading;

  const rsiData = rsiQ.data as Record<string, unknown> | null;
  const rsiVal = rsiData?.value != null ? Number(rsiData.value) : null;

  const macdRaw = macdQ.data as Record<string, unknown> | null;
  const macdData = (macdRaw?.data && typeof macdRaw.data === "object" ? macdRaw.data : macdRaw) as Record<string, unknown> | null;

  const bollRaw = bollingerQ.data as Record<string, unknown> | null;
  const bollData = (bollRaw?.data && typeof bollRaw.data === "object" ? bollRaw.data : bollRaw) as Record<string, unknown> | null;

  const signalsRaw = signalsQ.data as Record<string, unknown> | null;
  const signalsObj = (signalsRaw?.signals && typeof signalsRaw.signals === "object"
    ? signalsRaw.signals : signalsRaw) as Record<string, unknown> | null;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* RSI */}
      <div className="bg-card rounded-xl border border-border/60 p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">RSI (14)</h3>
        {rsiVal != null ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold font-mono text-foreground">{formatNumber(rsiVal)}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              rsiVal > 70 ? "bg-red-500/10 text-red-600 dark:text-red-400"
                : rsiVal < 30 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            }`}>
              {rsiVal > 70 ? "Asiri Alim" : rsiVal < 30 ? "Asiri Satim" : "Notr"}
            </span>
          </div>
        ) : <EmptyState message="RSI verisi yok" />}
      </div>

      {/* MACD */}
      <div className="bg-card rounded-xl border border-border/60 p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">MACD</h3>
        {macdData ? (
          <div className="grid grid-cols-3 gap-3">
            {[
              ["MACD", macdData.macd],
              ["Sinyal", macdData.signal],
              ["Histogram", macdData.histogram],
            ].map(([label, val]) => (
              <div key={String(label)}>
                <span className="text-[10px] text-muted-foreground">{String(label)}</span>
                <p className="text-sm font-bold font-mono text-foreground">{val != null ? formatNumber(Number(val)) : "-"}</p>
              </div>
            ))}
          </div>
        ) : <EmptyState message="MACD verisi yok" />}
      </div>

      {/* Bollinger */}
      <div className="bg-card rounded-xl border border-border/60 p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bollinger Bantlari</h3>
        {bollData ? (
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Ust", bollData.upper],
              ["Orta", bollData.middle],
              ["Alt", bollData.lower],
            ].map(([label, val]) => (
              <div key={String(label)}>
                <span className="text-[10px] text-muted-foreground">{String(label)}</span>
                <p className="text-sm font-bold font-mono text-foreground">{val != null ? formatNumber(Number(val)) : "-"}</p>
              </div>
            ))}
          </div>
        ) : <EmptyState message="Bollinger verisi yok" />}
      </div>

      {/* Signals */}
      {signalsObj && (
        <div className="bg-card rounded-xl border border-border/60 p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sinyaller</h3>
          {Object.entries(signalsObj)
            .filter(([key]) => key !== "summary" && typeof signalsObj[key] === "string")
            .map(([key, val]) => (
              <SignalIndicator key={key} label={key} signal={String(val)} />
            ))}
        </div>
      )}
    </div>
  );
}

function TemelPanel({ ticker }: { ticker: string }) {
  const infoQ = useQuery({ queryKey: ["company-info", ticker], queryFn: () => api.companyInfo(ticker) });
  const targetsQ = useQuery({ queryKey: ["targets", ticker], queryFn: () => api.priceTargets(ticker) });
  const holdersQ = useQuery({ queryKey: ["holders", ticker], queryFn: () => api.holders(ticker) });

  const isLoading = infoQ.isLoading || targetsQ.isLoading || holdersQ.isLoading;

  const info = infoQ.data as Record<string, unknown> | null;
  const infoObj = (info?.info || info) as Record<string, unknown> | null;

  const targetsRaw = targetsQ.data as Record<string, unknown> | null;
  const targets = (targetsRaw?.targets && typeof targetsRaw.targets === "object"
    ? targetsRaw.targets : targetsRaw) as Record<string, unknown> | null;

  const holders = holdersQ.data as Record<string, unknown> | null;
  const holdersArr = holders?.holders ? holders.holders
    : Array.isArray(holders) ? holders
    : (holders?.data ? holders.data : null);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Company Info */}
      <div className="bg-card rounded-xl border border-border/60 p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Sirket Bilgileri</h3>
        {infoObj ? (
          <div className="space-y-0">
            {[
              ["Isim", infoObj.longName || infoObj.shortName || infoObj.name || ticker],
              ["Sektor", infoObj.sector || infoObj.industry || "-"],
              ["Piyasa Degeri", formatCompact(Number(infoObj.marketCap || infoObj.market_cap || 0))],
              ["F/K", infoObj.trailingPE != null ? formatNumber(Number(infoObj.trailingPE)) : "-"],
              ["PD/DD", infoObj.priceToBook != null ? formatNumber(Number(infoObj.priceToBook)) : "-"],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between py-2 border-b border-border/30 last:border-0">
                <span className="text-xs text-muted-foreground">{String(label)}</span>
                <span className="text-xs font-semibold text-foreground font-mono">{String(value)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState message="Sirket bilgisi yok" />}
      </div>

      {/* Price Targets */}
      <div className="bg-card rounded-xl border border-border/60 p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Hedef Fiyat</h3>
        {targets ? (
          <div className="space-y-0">
            {[
              ["Dusuk", targets.low || targets.targetLowPrice],
              ["Ortalama", targets.mean || targets.targetMeanPrice || targets.average],
              ["Yuksek", targets.high || targets.targetHighPrice],
            ].filter(([, v]) => v != null).map(([label, value]) => (
              <div key={String(label)} className="flex justify-between py-2 border-b border-border/30 last:border-0">
                <span className="text-xs text-muted-foreground">{String(label)}</span>
                <span className="text-xs font-semibold text-foreground font-mono">
                  {typeof value === "number" ? `${formatNumber(value)} TL` : String(value)}
                </span>
              </div>
            ))}
          </div>
        ) : <EmptyState message="Hedef fiyat yok" />}
      </div>

      {/* Top Holders */}
      {holdersArr && Array.isArray(holdersArr) && holdersArr.length > 0 && (
        <div className="bg-card rounded-xl border border-border/60 p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Buyuk Ortaklar</h3>
          <div className="space-y-2">
            {(holdersArr as Record<string, unknown>[]).slice(0, 5).map((h, i) => {
              const name = String(h.Holder || h.holder || h.name || h.institution || `Ortak ${i + 1}`);
              const pct = Number(h.pctHeld || h.percent || h.share || h.percentage || 0);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-foreground flex-1 truncate">{name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{formatPercent(pct * 100)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalizPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("yan-yana");

  function handleTickerSelect(newTicker: string) {
    router.push(`/analiz/${newTicker.toUpperCase()}`);
  }

  const tabs: { key: Tab; label: string; icon: typeof TrendingUp }[] = [
    { key: "yan-yana", label: "Yan Yana", icon: BarChart3 },
    { key: "teknik", label: "Teknik", icon: TrendingUp },
    { key: "temel", label: "Temel", icon: Building2 },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Kombine Analiz — {t}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Link href={`/hisse/${t}`} className="text-[11px] text-primary hover:underline">Hisse</Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/teknik/${t}`} className="text-[11px] text-primary hover:underline">Teknik</Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/temel/${t}`} className="text-[11px] text-primary hover:underline">Temel</Link>
              </div>
            </div>
          </div>
        </motion.div>
        <div className="w-72 md:w-80"><TickerSearch onSelect={handleTickerSelect} /></div>
      </div>

      {/* Tab Switcher */}
      <motion.div custom={1} variants={stagger} initial="hidden" animate="show">
        <div className="bg-muted/50 rounded-lg p-0.5 flex gap-0.5 w-fit">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-all ${
                  tab === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* Content */}
      <motion.div custom={2} variants={stagger} initial="hidden" animate="show">
        {tab === "yan-yana" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" /> Teknik Analiz
              </h2>
              <TeknikPanel ticker={t} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-500" /> Temel Analiz
              </h2>
              <TemelPanel ticker={t} />
            </div>
          </div>
        ) : tab === "teknik" ? (
          <div className="max-w-2xl">
            <TeknikPanel ticker={t} />
          </div>
        ) : (
          <div className="max-w-2xl">
            <TemelPanel ticker={t} />
          </div>
        )}
      </motion.div>
    </div>
  );
}
