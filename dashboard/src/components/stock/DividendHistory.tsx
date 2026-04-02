"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatDate } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { Coins } from "lucide-react";

interface DividendHistoryProps {
  ticker: string;
}

function parseDividends(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown>;
  if (obj.data && Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  if (obj.dividends && Array.isArray(obj.dividends)) return obj.dividends as Record<string, unknown>[];
  // DataFrame format: {"Dividends": {"2024-05-10": 3.5, ...}}
  if (obj.Dividends && typeof obj.Dividends === "object") {
    return Object.entries(obj.Dividends as Record<string, unknown>).map(([date, val]) => ({
      date, amount: val,
    }));
  }
  // Generic {date: value} pairs
  const entries = Object.entries(obj).filter(([, v]) => typeof v === "number");
  if (entries.length > 0) {
    return entries.map(([date, amount]) => ({ date, amount }));
  }
  return [];
}

export function DividendHistory({ ticker }: DividendHistoryProps) {
  const { locale } = useLocale();
  const divQ = useQuery({
    queryKey: ["dividends", ticker],
    queryFn: () => api.dividends(ticker),
  });

  const dividends = parseDividends(divQ.data);

  const labels = {
    title: { tr: "Temettu Gecmisi", en: "Dividend History", fr: "Historique des dividendes" },
    date: { tr: "Tarih", en: "Date", fr: "Date" },
    amount: { tr: "Tutar (TL)", en: "Amount (TRY)", fr: "Montant (TRY)" },
    noData: { tr: "Temettu verisi yok", en: "No dividend data", fr: "Aucune donnee de dividende" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
        <Coins className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-foreground">{labels.title[locale]}</h2>
        {dividends.length > 0 && (
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded ml-auto">
            {dividends.length} {locale === "en" ? "records" : locale === "fr" ? "enregistrements" : "kayit"}
          </span>
        )}
      </div>
      <div className="p-5">
        {divQ.isLoading ? (
          <LoadingSpinner />
        ) : dividends.length === 0 ? (
          <EmptyState message={labels.noData[locale]} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {labels.date[locale]}
                  </th>
                  <th className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {labels.amount[locale]}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {dividends.slice(0, 20).map((d, i) => {
                  const date = String(d.date ?? d.ex_date ?? d.payDate ?? d.Date ?? "");
                  const amount = Number(d.amount ?? d.Dividends ?? d.value ?? d.dividend ?? 0);
                  return (
                    <tr key={i} className="hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 text-xs text-muted-foreground font-mono">
                        {date.length > 10 ? date.substring(0, 10) : date}
                      </td>
                      <td className="py-2.5 text-right text-xs font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                        {formatNumber(amount, 2)} TL
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
