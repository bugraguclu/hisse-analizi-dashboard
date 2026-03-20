"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";

export default function TemelPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const t = ticker.toUpperCase();

  const infoQ = useQuery({ queryKey: ["company-info", t], queryFn: () => api.companyInfo(t) });
  const recsQ = useQuery({ queryKey: ["recs", t], queryFn: () => api.recommendations(t) });
  const targetsQ = useQuery({ queryKey: ["targets", t], queryFn: () => api.priceTargets(t) });
  const holdersQ = useQuery({ queryKey: ["holders", t], queryFn: () => api.holders(t) });
  const earningsQ = useQuery({ queryKey: ["earnings", t], queryFn: () => api.earningsDates(t) });

  const info = infoQ.data as Record<string, unknown> | null;
  const infoObj = (info?.info || info) as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Temel Analiz — {t}</h1>
          <p className="text-sm text-slate-400 mt-0.5">Sirket bilgileri, finansallar, analist tavsiyeleri</p>
        </div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company info */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Sirket Bilgileri</h2>
          {infoQ.isLoading ? <LoadingSpinner /> : !infoObj ? <EmptyState /> : (
            <div className="space-y-3">
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
                <div key={String(label)} className="flex justify-between py-2 border-b border-slate-50 last:border-0">
                  <span className="text-xs text-slate-400">{String(label)}</span>
                  <span className="text-xs font-semibold text-slate-700 font-mono">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommendations */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Analist Tavsiyeleri</h2>
          {recsQ.isLoading ? <LoadingSpinner /> : !recsQ.data ? <EmptyState message="Tavsiye verisi yok" /> : (
            <div className="text-sm text-slate-600">
              <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(recsQ.data, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Price targets */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Hedef Fiyat</h2>
          {targetsQ.isLoading ? <LoadingSpinner /> : !targetsQ.data ? <EmptyState message="Hedef fiyat yok" /> : (
            <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(targetsQ.data, null, 2)}</pre>
          )}
        </div>

        {/* Holders */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Buyuk Ortaklar</h2>
          {holdersQ.isLoading ? <LoadingSpinner /> : !holdersQ.data ? <EmptyState message="Ortaklik verisi yok" /> : (
            <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(holdersQ.data, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
