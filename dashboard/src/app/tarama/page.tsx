"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Filter, Search, ArrowUpRight, ArrowDownRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

export default function TaramaPage() {
  const { t } = useLocale();
  const [scanCondition, setScanCondition] = useState("");
  const [stockPage, setStockPage] = useState(0);
  const stocksPerPage = 25;

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
    : Array.isArray(screenerData) ? screenerData : [];

  const scannerData = scannerQ.data;
  const scanResults = scannerData && typeof scannerData === "object" && "results" in (scannerData as Record<string, unknown>)
    ? ((scannerData as Record<string, unknown>).results as Record<string, unknown>[])
    : scannerData && typeof scannerData === "object" && "data" in (scannerData as Record<string, unknown>)
    ? ((scannerData as Record<string, unknown>).data as Record<string, unknown>[])
    : Array.isArray(scannerData) ? scannerData : [];

  const indexQueries = [xu100Q, xu030Q, xusinQ, xbankQ];
  const indicesLoading = indexQueries.some((q) => q.isLoading);
  const indexNames = ["XU100", "XU030", "XUSIN", "XBANK"];
  const indicesArr = [xu100Q.data, xu030Q.data, xusinQ.data, xbankQ.data]
    .map((d, idx) => {
      if (!d) return { symbol: indexNames[idx], close: 0, change_pct: 0 };
      const raw = d as { symbol: string; data: Array<Record<string, unknown>> };
      const arr = raw?.data ?? [];
      if (arr.length === 0) return { symbol: raw?.symbol ?? indexNames[idx], close: 0, change_pct: 0 };
      const last = arr[arr.length - 1];
      const prev = arr.length > 1 ? arr[arr.length - 2] : last;
      const close = Number(last.Close ?? 0);
      const prevClose = Number(prev.Close ?? close);
      const change_pct = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
      return { symbol: raw.symbol || indexNames[idx], close, change_pct };
    });

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Search className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">{t("nav.screening")}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{t("tarama.screenerDesc")}</p>
            </div>
          </div>
        </motion.div>
        <div className="w-64"><TickerSearch /></div>
      </div>

      {/* Indices */}
      <motion.div custom={1} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">{t("tarama.bistIndices")}</h2>
        {indicesLoading ? <LoadingSpinner /> : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {indicesArr.map((idx, i) => {
              const isUp = idx.change_pct >= 0;
              return (
                <motion.div key={i} custom={i + 2} variants={stagger} initial="hidden" animate="show">
                  <div className="bg-muted/30 rounded-xl p-4 hover:bg-muted/50 transition-colors">
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{idx.symbol}</div>
                    <div className="text-xl font-bold font-mono text-foreground">{idx.close > 0 ? formatCompact(idx.close) : "-"}</div>
                    {idx.change_pct !== 0 && (
                      <div className={`flex items-center gap-1 text-xs font-semibold mt-1.5 ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {isUp ? "+" : ""}{formatNumber(idx.change_pct)}%
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Screener Table */}
      <motion.div custom={6} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("tarama.results")}</h2>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">{Array.isArray(stocks) ? stocks.length : 0} {t("common.stocks")}</span>
        </div>
        {screenerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(stocks) || stocks.length === 0 ? <EmptyState message={t("tarama.noResults")} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20">
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ticker</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.price")}</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.change")}</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("index.volume")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {(stocks as Record<string, unknown>[]).slice(stockPage * stocksPerPage, (stockPage + 1) * stocksPerPage).map((s, i) => {
                    const tk = String(s.symbol || s.ticker || s.code || "");
                    const name = String(s.name || "");
                    const price = Number(s.criteria_7 || s.close || s.price || s.last || 0);
                    const change = Number(s.change_pct || s.change_percent || 0);
                    const vol = Number(s.volume || 0);
                    const isUp = change >= 0;
                    return (
                      <tr key={i} className="hover:bg-muted/15 transition-colors">
                        <td className="px-5 py-3">
                          <Link href={`/hisse/${tk}`} className="font-semibold text-primary hover:underline text-xs">{tk}</Link>
                          {name && <p className="text-[10px] text-muted-foreground truncate max-w-[150px] mt-0.5">{name}</p>}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-foreground">{price > 0 ? formatNumber(price) : "-"}</td>
                        <td className={`px-5 py-3 font-mono text-xs font-semibold ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          <span className="flex items-center gap-1">
                            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {isUp ? "+" : ""}{formatNumber(change)}%
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{formatCompact(vol)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {stocks.length > stocksPerPage && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-border/40">
                <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
                  {t("tarama.page")} {stockPage + 1} / {Math.ceil(stocks.length / stocksPerPage)}
                </span>
                <div className="flex gap-1.5">
                  <button
                    disabled={stockPage === 0}
                    onClick={() => setStockPage(Math.max(0, stockPage - 1))}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-3 w-3" /> {t("common.previous")}
                  </button>
                  <button
                    disabled={(stockPage + 1) * stocksPerPage >= stocks.length}
                    onClick={() => setStockPage(stockPage + 1)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/60 text-foreground hover:bg-muted/30 disabled:opacity-30 transition-colors"
                  >
                    {t("common.next")} <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* Scanner */}
      <motion.div custom={7} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{t("tarama.signalScanning")}</h2>
          </div>
          <select
            value={scanCondition}
            onChange={(e) => setScanCondition(e.target.value)}
            className="text-xs border border-border/60 rounded-lg px-3 py-1.5 bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none"
          >
            <option value="">{t("common.all")}</option>
            <option value="rsi_oversold">{t("tarama.rsiOversold")}</option>
            <option value="rsi_overbought">{t("tarama.rsiOverbought")}</option>
            <option value="golden_cross">Golden Cross</option>
          </select>
        </div>
        {scannerQ.isLoading ? <LoadingSpinner /> : !Array.isArray(scanResults) || scanResults.length === 0 ? <EmptyState message={t("tarama.scanNoResults")} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Ticker</th>
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.signal")}</th>
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("teknik.value")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {(scanResults as Record<string, unknown>[]).slice(0, 30).map((r, i) => {
                  const tk = String(r.ticker || r.symbol || "");
                  const signal = String(r.signal || r.condition || r.type || "-");
                  const value = r.value != null ? formatNumber(Number(r.value)) : "-";
                  return (
                    <tr key={i} className="hover:bg-muted/15 transition-colors">
                      <td className="py-2.5">
                        <Link href={`/hisse/${tk}`} className="font-semibold text-primary hover:underline text-xs">{tk}</Link>
                      </td>
                      <td className="py-2.5 text-xs text-foreground">{signal}</td>
                      <td className="py-2.5 text-xs font-mono text-muted-foreground">{value}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
