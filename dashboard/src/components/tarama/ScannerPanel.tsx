"use client";

import Link from "next/link";
import { Filter, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { formatNumber, formatChangePercent, EMPTY_VALUE } from "@/lib/format";
import { trendText } from "@/lib/trend";
import { TableSkeleton } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";

export interface ScannerRow {
  symbol?: string;
  ticker?: string;
  name?: string;
  close?: number;
  change?: number;
  volume?: number;
  market_cap?: number;
  signal?: string;
  value?: number;
}

const CONDITIONS = ["", "rsi_oversold", "rsi_overbought", "golden_cross", "death_cross"] as const;

export function ScannerPanel({
  condition,
  onConditionChange,
  rows,
  isLoading,
  isError,
  errorMessage,
  onRetry,
}: {
  condition: string;
  onConditionChange: (v: string) => void;
  rows: ScannerRow[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">{t("tarama.signalScanning")}</h2>
        </div>
        <select
          value={condition}
          onChange={(e) => onConditionChange(e.target.value)}
          aria-label={t("tarama.signalScanning")}
          className="text-xs border border-border/60 rounded-lg px-3 py-1.5 bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all outline-none"
        >
          {CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {c === "" ? t("common.all") : c === "rsi_oversold" ? t("tarama.rsiOversold") : c === "rsi_overbought" ? t("tarama.rsiOverbought") : c === "golden_cross" ? "Golden Cross" : "Death Cross"}
            </option>
          ))}
        </select>
      </div>
      {isError ? (
        <ErrorState message={errorMessage || t("common.loadError")} onRetry={onRetry} />
      ) : isLoading ? (
        <TableSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState message={t("tarama.scanNoResults")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40">
                <th scope="col" className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("events.ticker")}</th>
                <th scope="col" className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.signal")}</th>
                <th scope="col" className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.price")}</th>
                <th scope="col" className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("tarama.change")}</th>
                <th scope="col" className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("teknik.value")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {rows.slice(0, 30).map((r, i) => {
                const ticker = String(r.ticker || r.symbol || "");
                const signal = r.signal || EMPTY_VALUE;
                const close = typeof r.close === "number" ? r.close : null;
                const change = typeof r.change === "number" ? r.change : null;
                const value = typeof r.value === "number" ? formatNumber(r.value) : EMPTY_VALUE;
                return (
                  <tr key={`${ticker}-${i}`} className="hover:bg-muted/15 transition-colors">
                    <td className="py-2.5">
                      <Link href={`/hisse/${ticker}`} className="font-semibold text-primary hover:underline text-xs">{ticker}</Link>
                    </td>
                    <td className="py-2.5 text-xs text-foreground">{signal}</td>
                    <td className="py-2.5 text-xs font-mono text-muted-foreground">{close != null ? formatNumber(close) : EMPTY_VALUE}</td>
                    <td className={`py-2.5 text-xs font-mono font-semibold ${change == null ? "text-muted-foreground" : trendText(change)}`}>
                      {change == null ? EMPTY_VALUE : (
                        <span className="flex items-center gap-1">
                          {change >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {formatChangePercent(change)}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs font-mono text-muted-foreground">{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
