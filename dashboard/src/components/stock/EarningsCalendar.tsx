"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { CalendarDays } from "lucide-react";

interface EarningsCalendarProps {
  ticker: string;
}

function parseEarnings(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown>;
  if (obj.data && Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  if (obj.earnings && Array.isArray(obj.earnings)) return obj.earnings as Record<string, unknown>[];
  // DataFrame format: {col: {idx: val}}
  const keys = Object.keys(obj);
  if (keys.length > 0 && typeof obj[keys[0]] === "object" && obj[keys[0]] !== null) {
    const firstCol = obj[keys[0]] as Record<string, unknown>;
    const indices = Object.keys(firstCol);
    return indices.map((idx) => {
      const row: Record<string, unknown> = { date: idx };
      for (const col of keys) {
        const colData = obj[col] as Record<string, unknown>;
        row[col] = colData?.[idx] ?? null;
      }
      return row;
    });
  }
  return [];
}

export function EarningsCalendar({ ticker }: EarningsCalendarProps) {
  const { locale } = useLocale();
  const earningsQ = useQuery({
    queryKey: ["earnings", ticker],
    queryFn: () => api.earningsDates(ticker),
  });

  const earnings = parseEarnings(earningsQ.data);

  const labels = {
    title: { tr: "Kazanc Takvimleri", en: "Earnings Calendar", fr: "Calendrier des resultats" },
    date: { tr: "Tarih", en: "Date", fr: "Date" },
    epsEstimate: { tr: "HBK Tahmini", en: "EPS Estimate", fr: "BPA Estime" },
    epsActual: { tr: "HBK Gerceklesen", en: "EPS Actual", fr: "BPA Reel" },
    revenue: { tr: "Gelir Tahmini", en: "Revenue Estimate", fr: "Revenu Estime" },
    noData: { tr: "Kazanc takvimi verisi yok", en: "No earnings data", fr: "Aucune donnee" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-indigo-500" />
        <h2 className="text-sm font-semibold text-foreground">{labels.title[locale]}</h2>
      </div>
      <div className="p-5">
        {earningsQ.isLoading ? (
          <LoadingSpinner />
        ) : earnings.length === 0 ? (
          <EmptyState message={labels.noData[locale]} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{labels.date[locale]}</th>
                  <th className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{labels.epsEstimate[locale]}</th>
                  <th className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{labels.epsActual[locale]}</th>
                  <th className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{labels.revenue[locale]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {earnings.slice(0, 12).map((e, i) => {
                  const date = String(e.date ?? e.earningsDate ?? e.Date ?? "");
                  const epsEst = e["EPS Estimate"] ?? e.epsEstimate ?? e.eps_estimate;
                  const epsAct = e["Reported EPS"] ?? e.epsActual ?? e.eps_actual ?? e.reportedEPS;
                  const revEst = e["Revenue Estimate"] ?? e.revenueEstimate ?? e.revenue_estimate;
                  const beat = epsEst != null && epsAct != null && Number(epsAct) > Number(epsEst);
                  return (
                    <tr key={i} className="hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 text-xs text-muted-foreground font-mono">
                        {date.length > 10 ? date.substring(0, 10) : date}
                      </td>
                      <td className="py-2.5 text-right text-xs font-mono text-foreground">
                        {epsEst != null ? formatNumber(Number(epsEst)) : "-"}
                      </td>
                      <td className={`py-2.5 text-right text-xs font-mono font-semibold ${beat ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                        {epsAct != null ? formatNumber(Number(epsAct)) : "-"}
                      </td>
                      <td className="py-2.5 text-right text-xs font-mono text-muted-foreground">
                        {revEst != null ? formatNumber(Number(revEst)) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
