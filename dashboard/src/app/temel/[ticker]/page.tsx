"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { motion } from "framer-motion";
import Link from "next/link";

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground font-mono">{String(value)}</span>
    </div>
  );
}

export default function TemelPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const infoQ = useQuery({ queryKey: ["company-info", t], queryFn: () => api.companyInfo(t) });
  const recsQ = useQuery({ queryKey: ["recs", t], queryFn: () => api.recommendations(t) });
  const targetsQ = useQuery({ queryKey: ["targets", t], queryFn: () => api.priceTargets(t) });
  const holdersQ = useQuery({ queryKey: ["holders", t], queryFn: () => api.holders(t) });

  const info = infoQ.data as Record<string, unknown> | null;
  const infoObj = (info?.info || info) as Record<string, unknown> | null;

  // Parse recommendations
  const recs = recsQ.data;
  const recsArr = Array.isArray(recs) ? recs : (recs && typeof recs === "object" && "data" in (recs as Record<string,unknown>)) ? (recs as Record<string,unknown>).data : Array.isArray((recs as Record<string,unknown>)?.recommendations) ? (recs as Record<string,unknown>).recommendations : null;

  // Parse holders
  const holders = holdersQ.data;
  const holdersArr = Array.isArray(holders) ? holders : (holders && typeof holders === "object" && "data" in (holders as Record<string,unknown>)) ? (holders as Record<string,unknown>).data : Array.isArray((holders as Record<string,unknown>)?.holders) ? (holders as Record<string,unknown>).holders : null;

  // Parse targets
  const targets = targetsQ.data as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-xl font-bold text-foreground">Temel Analiz — {t}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sirket bilgileri, finansallar, analist tavsiyeleri &middot;{" "}
            <Link href={`/hisse/${t}`} className="text-primary hover:underline">Hisse</Link>
            {" "}&middot;{" "}
            <Link href={`/teknik/${t}`} className="text-primary hover:underline">Teknik</Link>
          </p>
        </motion.div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Info */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Sirket Bilgileri</h2>
          {infoQ.isLoading ? <LoadingSpinner /> : !infoObj ? <EmptyState /> : (
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

        {/* Recommendations */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Analist Tavsiyeleri</h2>
          {recsQ.isLoading ? <LoadingSpinner /> : !recsArr || !Array.isArray(recsArr) || recsArr.length === 0 ? <EmptyState message="Tavsiye verisi yok" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    <th className="pb-2 text-[11px] text-muted-foreground uppercase font-semibold">Donem</th>
                    <th className="pb-2 text-[11px] text-muted-foreground uppercase font-semibold">AL</th>
                    <th className="pb-2 text-[11px] text-muted-foreground uppercase font-semibold">TUT</th>
                    <th className="pb-2 text-[11px] text-muted-foreground uppercase font-semibold">SAT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {(recsArr as Record<string, unknown>[]).slice(0, 8).map((rec, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="py-2 text-muted-foreground text-xs font-mono">{String(rec.period || rec.date || rec.month || i + 1)}</td>
                      <td className="py-2 text-emerald-600 dark:text-emerald-400 font-semibold">{String(rec.strongBuy || rec.buy || rec.Buy || rec.strong_buy || 0)}</td>
                      <td className="py-2 text-amber-600 dark:text-amber-400 font-semibold">{String(rec.hold || rec.Hold || 0)}</td>
                      <td className="py-2 text-red-600 dark:text-red-400 font-semibold">{String(rec.strongSell || rec.sell || rec.Sell || rec.strong_sell || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

        {/* Price Targets */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Hedef Fiyat</h2>
          {targetsQ.isLoading ? <LoadingSpinner /> : !targets ? <EmptyState message="Hedef fiyat yok" /> : (
            <div>
              {[
                ["Dusuk", targets.low || targets.targetLowPrice],
                ["Ortalama", targets.mean || targets.targetMeanPrice || targets.average],
                ["Medyan", targets.median || targets.targetMedianPrice],
                ["Yuksek", targets.high || targets.targetHighPrice],
                ["Analist Sayisi", targets.numberOfAnalystOpinions || targets.number_of_analysts || targets.count],
              ].filter(([, v]) => v != null).map(([label, value]) => (
                <InfoRow key={String(label)} label={String(label)} value={typeof value === "number" ? `₺${formatNumber(value)}` : String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Holders */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Buyuk Ortaklar</h2>
          {holdersQ.isLoading ? <LoadingSpinner /> : !holdersArr || !Array.isArray(holdersArr) || holdersArr.length === 0 ? <EmptyState message="Ortaklik verisi yok" /> : (
            <div className="space-y-2">
              {(holdersArr as Record<string, unknown>[]).slice(0, 10).map((h, i) => {
                const name = String(h.Holder || h.holder || h.name || h.institution || `Ortak ${i + 1}`);
                const pct = Number(h.pctHeld || h.percent || h.share || h.percentage || 0);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-foreground flex-1 truncate">{name}</span>
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground w-14 text-right">{formatPercent(pct * 100)}</span>
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
