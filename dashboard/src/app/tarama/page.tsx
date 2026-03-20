"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import Link from "next/link";

export default function TaramaPage() {
  const [scanCondition, setScanCondition] = useState("");

  const screenerQ = useQuery({ queryKey: ["screener"], queryFn: () => api.screener() });
  const scannerQ = useQuery({
    queryKey: ["scanner", scanCondition],
    queryFn: () => api.scanner(scanCondition || undefined),
    enabled: true,
  });
  const indicesQ = useQuery({ queryKey: ["indices"], queryFn: () => api.indices() });

  const screenerData = screenerQ.data;
  const stocks = Array.isArray(screenerData) ? screenerData : (screenerData && typeof screenerData === "object" && "data" in (screenerData as Record<string, unknown>)) ? ((screenerData as Record<string, unknown>).data as Record<string, unknown>[]) : [];

  const scannerData = scannerQ.data;
  const scanResults = Array.isArray(scannerData) ? scannerData : (scannerData && typeof scannerData === "object" && "data" in (scannerData as Record<string, unknown>)) ? ((scannerData as Record<string, unknown>).data as Record<string, unknown>[]) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Hisse Tarama</h1>
          <p className="text-sm text-slate-400 mt-0.5">Screener, sinyal tarama ve endeks verileri</p>
        </div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* Indices */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">BIST Endeksleri</h2>
        {indicesQ.isLoading ? <LoadingSpinner /> : !indicesQ.data ? <EmptyState /> : (
          <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-48">{JSON.stringify(indicesQ.data, null, 2)}</pre>
        )}
      </div>

      {/* Screener */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Hisse Tarama Sonuclari</h2>
          <span className="text-[11px] font-mono text-slate-400">{Array.isArray(stocks) ? stocks.length : 0} hisse</span>
        </div>
        {screenerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(stocks) || stocks.length === 0 ? <EmptyState message="Sonuc yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase">Ticker</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase">Fiyat</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase">Degisim</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400 uppercase">Hacim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(stocks as Record<string, unknown>[]).slice(0, 50).map((s, i) => {
                  const tk = String(s.ticker || s.symbol || s.code || "");
                  const price = Number(s.close || s.price || s.last || 0);
                  const change = Number(s.change_pct || s.change_percent || 0);
                  const vol = Number(s.volume || 0);
                  const isUp = change >= 0;
                  return (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <Link href={`/hisse/${tk}`} className="font-semibold text-teal-600 hover:underline text-xs">{tk}</Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{formatNumber(price)}</td>
                      <td className={`px-4 py-3 font-mono text-xs font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
                        {isUp ? "+" : ""}{formatNumber(change)}%
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatCompact(vol)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scanner */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Teknik Sinyal Tarama</h2>
          <select
            value={scanCondition}
            onChange={(e) => setScanCondition(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-600"
          >
            <option value="">Tumu</option>
            <option value="rsi_oversold">RSI Asiri Satim</option>
            <option value="rsi_overbought">RSI Asiri Alim</option>
            <option value="golden_cross">Golden Cross</option>
          </select>
        </div>
        {scannerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(scanResults) || scanResults.length === 0 ? <EmptyState message="Tarama sonucu yok" /> : (
          <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-80">{JSON.stringify(scanResults, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
