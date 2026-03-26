"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Building2, TrendingUp, Users, Target } from "lucide-react";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground font-mono">{String(value)}</span>
    </div>
  );
}

export default function TemelPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();
  const router = useRouter();

  const infoQ = useQuery({ queryKey: ["company-info", t], queryFn: () => api.companyInfo(t) });
  const targetsQ = useQuery({ queryKey: ["targets", t], queryFn: () => api.priceTargets(t) });
  const holdersQ = useQuery({ queryKey: ["holders", t], queryFn: () => api.holders(t) });

  const info = infoQ.data as Record<string, unknown> | null;
  const infoObj = (info?.info || info) as Record<string, unknown> | null;

  // Backend returns: {"ticker": ..., "holders": [...]}
  const holders = holdersQ.data as Record<string, unknown> | null;
  const holdersArr = holders?.holders ? holders.holders
    : Array.isArray(holders) ? holders
    : (holders?.data ? holders.data : null);

  // Backend returns: {"ticker": ..., "targets": {...}}
  const targetsRaw = targetsQ.data as Record<string, unknown> | null;
  const targets = (targetsRaw?.targets && typeof targetsRaw.targets === "object"
    ? targetsRaw.targets
    : targetsRaw) as Record<string, unknown> | null;

  function handleTickerSelect(newTicker: string) {
    router.push(`/temel/${newTicker.toUpperCase()}`);
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">Temel Analiz — {t}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Link href={`/hisse/${t}`} className="text-[11px] text-primary hover:underline">Hisse</Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/teknik/${t}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Teknik
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
        <div className="w-72 md:w-80"><TickerSearch onSelect={handleTickerSelect} /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Company Info */}
        <motion.div custom={1} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Sirket Bilgileri</h2>
          </div>
          {infoQ.isLoading ? <LoadingSpinner /> : !infoObj || Object.keys(infoObj).length === 0 ? <EmptyState message="Sirket bilgisi bulunamadi — bu hisse icin yfinance verisi mevcut olmayabilir" /> : (
            <div>
              {[
                ["Isim", infoObj.longName || infoObj.shortName || infoObj.name || t],
                ["Sektor", infoObj.sector || infoObj.industry || "-"],
                ["Piyasa Degeri", formatCompact(Number(infoObj.marketCap || infoObj.market_cap || 0))],
                ["F/K", infoObj.trailingPE != null ? formatNumber(Number(infoObj.trailingPE)) : "-"],
                ["PD/DD", infoObj.priceToBook != null ? formatNumber(Number(infoObj.priceToBook)) : "-"],
                ["Temettu Verimi", infoObj.dividendYield != null ? formatPercent(Number(infoObj.dividendYield) * 100) : "-"],
                ["Calisan", formatCompact(Number(infoObj.fullTimeEmployees || 0))],
                ["Web", infoObj.website || "-"],
              ].map(([label, value]) => (
                <InfoRow key={String(label)} label={String(label)} value={String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Price Targets */}
        <motion.div custom={3} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-foreground">Hedef Fiyat</h2>
          </div>
          {targetsQ.isLoading ? <LoadingSpinner /> : !targets ? <EmptyState message="Hedef fiyat yok" /> : (
            <div>
              {[
                ["Mevcut Fiyat", targets.current || targets.currentPrice],
                ["Dusuk Hedef", targets.low || targets.targetLowPrice],
                ["Ortalama Hedef", targets.mean || targets.targetMeanPrice || targets.average],
                ["Medyan Hedef", targets.median || targets.targetMedianPrice],
                ["Yuksek Hedef", targets.high || targets.targetHighPrice],
                ["Analist Sayisi", targets.numberOfAnalysts || targets.numberOfAnalystOpinions || targets.number_of_analysts || targets.count],
              ].filter(([, v]) => v != null).map(([label, value]) => (
                <InfoRow key={String(label)} label={String(label)} value={typeof value === "number" ? `₺${formatNumber(value)}` : String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Holders */}
        <motion.div custom={4} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-teal-500" />
            <h2 className="text-sm font-semibold text-foreground">Buyuk Ortaklar</h2>
          </div>
          {holdersQ.isLoading ? <LoadingSpinner /> : !holdersArr || !Array.isArray(holdersArr) || holdersArr.length === 0 ? <EmptyState message="Ortaklik verisi yok" /> : (
            <div className="space-y-2.5">
              {(holdersArr as Record<string, unknown>[]).slice(0, 10).map((h, i) => {
                const name = String(h.Holder || h.holder || h.name || h.institution || `Ortak ${i + 1}`);
                const rawPct = h.Percentage ?? h.pctHeld ?? h.percent ?? h.share ?? h.percentage ?? 0;
                const pct = Number(rawPct);
                // Backend returns percentage as 49.12 (not 0.4912)
                const barWidth = Math.min(pct, 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-foreground flex-1 truncate">{name}</span>
                    <div className="w-20 h-2 bg-muted/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + i * 0.05 }}
                        className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground w-12 text-right">%{formatNumber(pct)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
