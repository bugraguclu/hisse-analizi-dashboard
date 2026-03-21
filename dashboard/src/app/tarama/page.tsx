"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Filter } from "lucide-react";
import Link from "next/link";

export default function TaramaPage() {
  const [scanCondition, setScanCondition] = useState("");

  const screenerQ = useQuery({ queryKey: ["screener"], queryFn: () => api.screener() });
  const scannerQ = useQuery({
    queryKey: ["scanner", scanCondition],
    queryFn: () => api.scanner(scanCondition || undefined),
    enabled: true,
  });
  const xu100Q = useQuery({ queryKey: ["indexData", "XU100"], queryFn: () => api.indexData("XU100", "1ay") });
  const xu030Q = useQuery({ queryKey: ["indexData", "XU030"], queryFn: () => api.indexData("XU030", "1ay") });
  const xusinQ = useQuery({ queryKey: ["indexData", "XUSIN"], queryFn: () => api.indexData("XUSIN", "1ay") });
  const xbankQ = useQuery({ queryKey: ["indexData", "XBANK"], queryFn: () => api.indexData("XBANK", "1ay") });

  const screenerData = screenerQ.data;
  const stocks = screenerData && typeof screenerData === "object" && "results" in (screenerData as Record<string, unknown>)
    ? ((screenerData as Record<string, unknown>).results as Record<string, unknown>[])
    : Array.isArray(screenerData)
      ? screenerData
      : [];

  const scannerData = scannerQ.data;
  const scanResults = scannerData && typeof scannerData === "object" && "results" in (scannerData as Record<string, unknown>)
    ? ((scannerData as Record<string, unknown>).results as Record<string, unknown>[])
    : scannerData && typeof scannerData === "object" && "data" in (scannerData as Record<string, unknown>)
    ? ((scannerData as Record<string, unknown>).data as Record<string, unknown>[])
    : Array.isArray(scannerData)
      ? scannerData
      : [];

  // Build index summary from OHLCV data
  const indexQueries = [xu100Q, xu030Q, xusinQ, xbankQ];
  const indicesLoading = indexQueries.some((q) => q.isLoading);
  const indicesArr = [xu100Q.data, xu030Q.data, xusinQ.data, xbankQ.data]
    .filter(Boolean)
    .map((d) => {
      const raw = d as { symbol: string; data: Array<Record<string, unknown>> };
      const arr = raw?.data ?? [];
      if (arr.length === 0) return { symbol: raw?.symbol ?? "", close: 0, change_pct: 0 };
      const last = arr[arr.length - 1];
      const prev = arr.length > 1 ? arr[arr.length - 2] : last;
      const close = Number(last.Close ?? 0);
      const prevClose = Number(prev.Close ?? close);
      const change_pct = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
      return { symbol: raw.symbol, close, change_pct };
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="text-xl font-bold text-foreground">Hisse Tarama</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Screener, sinyal tarama ve endeks verileri</p>
        </motion.div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* Indices */}
      <div className="bg-card rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">BIST Endeksleri</h2>
        {indicesLoading ? <LoadingSpinner /> : indicesArr.length === 0 ? (
          <EmptyState message="Endeks verisi yok" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {indicesArr.map((idx, i) => {
              const name = idx.symbol;
              const value = idx.close;
              const change = idx.change_pct;
              const isUp = change >= 0;
              return (
                <div key={i} className="bg-muted/50 rounded-lg p-3">
                  <div className="text-xs font-semibold text-muted-foreground mb-1">{name}</div>
                  <div className="text-lg font-bold font-mono text-foreground">{value > 0 ? formatCompact(value) : "-"}</div>
                  {change !== 0 && (
                    <div className={`flex items-center gap-1 text-xs font-semibold mt-1 ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {isUp ? "+" : ""}{formatNumber(change)}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Screener Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Hisse Tarama Sonuclari</h2>
          <span className="text-[11px] font-mono text-muted-foreground">{Array.isArray(stocks) ? stocks.length : 0} hisse</span>
        </div>
        {screenerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(stocks) || stocks.length === 0 ? <EmptyState message="Sonuc yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase">Ticker</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase">Fiyat</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase">Degisim</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase">Hacim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {(stocks as Record<string, unknown>[]).slice(0, 50).map((s, i) => {
                  const tk = String(s.symbol || s.ticker || s.code || "");
                  const name = String(s.name || "");
                  const price = Number(s.criteria_7 || s.close || s.price || s.last || 0);
                  const change = Number(s.change_pct || s.change_percent || 0);
                  const vol = Number(s.volume || 0);
                  const isUp = change >= 0;
                  return (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/hisse/${tk}`} className="font-semibold text-primary hover:underline text-xs">{tk}</Link>
                        {name && <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{name}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{price > 0 ? `${formatNumber(price)}` : "-"}</td>
                      <td className={`px-4 py-3 font-mono text-xs font-semibold ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {isUp ? "+" : ""}{formatNumber(change)}%
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{formatCompact(vol)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scanner */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Teknik Sinyal Tarama</h2>
          </div>
          <select
            value={scanCondition}
            onChange={(e) => setScanCondition(e.target.value)}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-background text-foreground"
          >
            <option value="">Tumu</option>
            <option value="rsi_oversold">RSI Asiri Satim</option>
            <option value="rsi_overbought">RSI Asiri Alim</option>
            <option value="golden_cross">Golden Cross</option>
          </select>
        </div>
        {scannerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(scanResults) || scanResults.length === 0 ? <EmptyState message="Tarama sonucu yok" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-left text-[11px] font-semibold text-muted-foreground uppercase">Ticker</th>
                  <th className="pb-2 text-left text-[11px] font-semibold text-muted-foreground uppercase">Sinyal</th>
                  <th className="pb-2 text-left text-[11px] font-semibold text-muted-foreground uppercase">Deger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {(scanResults as Record<string, unknown>[]).slice(0, 30).map((r, i) => {
                  const tk = String(r.ticker || r.symbol || "");
                  const signal = String(r.signal || r.condition || r.type || "-");
                  const value = r.value != null ? formatNumber(Number(r.value)) : "-";
                  return (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="py-2">
                        <Link href={`/hisse/${tk}`} className="font-semibold text-primary hover:underline text-xs">{tk}</Link>
                      </td>
                      <td className="py-2 text-xs text-foreground">{signal}</td>
                      <td className="py-2 text-xs font-mono text-muted-foreground">{value}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
