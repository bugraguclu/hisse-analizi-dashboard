"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { Layers } from "lucide-react";

interface AllTimeframeSignalsProps {
  ticker: string;
}

function parseTimeframes(raw: unknown): Record<string, Record<string, unknown>> {
  if (!raw) return {};
  const obj = raw as Record<string, unknown>;
  if (obj.timeframes && typeof obj.timeframes === "object") {
    return obj.timeframes as Record<string, Record<string, unknown>>;
  }
  if (obj.data && typeof obj.data === "object") {
    return obj.data as Record<string, Record<string, unknown>>;
  }
  // Check if it's directly a timeframe map
  const keys = Object.keys(obj);
  const isTimeframeMap = keys.some((k) => typeof obj[k] === "object" && obj[k] !== null);
  if (isTimeframeMap) return obj as Record<string, Record<string, unknown>>;
  return {};
}

function getSignalColor(signal: string): string {
  const s = signal.toUpperCase();
  if (s.includes("STRONG") && s.includes("BUY")) return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  if (s.includes("BUY") || s === "AL") return "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10";
  if (s.includes("STRONG") && s.includes("SELL")) return "text-red-600 dark:text-red-400 bg-red-500/10";
  if (s.includes("SELL") || s === "SAT") return "text-red-600 dark:text-red-400 bg-red-500/10";
  return "text-amber-600 dark:text-amber-400 bg-amber-500/10";
}

function translateSignal(signal: string, locale: string): string {
  const s = signal.toUpperCase();
  if (locale === "tr") {
    if (s.includes("STRONG") && s.includes("BUY")) return "Guclu Al";
    if (s.includes("BUY")) return "Al";
    if (s.includes("STRONG") && s.includes("SELL")) return "Guclu Sat";
    if (s.includes("SELL")) return "Sat";
    return "Notr";
  }
  if (s.includes("STRONG") && s.includes("BUY")) return "Strong Buy";
  if (s.includes("BUY")) return "Buy";
  if (s.includes("STRONG") && s.includes("SELL")) return "Strong Sell";
  if (s.includes("SELL")) return "Sell";
  return "Neutral";
}

const TIMEFRAME_LABELS: Record<string, Record<string, string>> = {
  "1m": { tr: "1 Dakika", en: "1 Minute", fr: "1 Minute" },
  "5m": { tr: "5 Dakika", en: "5 Minutes", fr: "5 Minutes" },
  "15m": { tr: "15 Dakika", en: "15 Minutes", fr: "15 Minutes" },
  "1h": { tr: "1 Saat", en: "1 Hour", fr: "1 Heure" },
  "4h": { tr: "4 Saat", en: "4 Hours", fr: "4 Heures" },
  "1d": { tr: "Gunluk", en: "Daily", fr: "Quotidien" },
  "1W": { tr: "Haftalik", en: "Weekly", fr: "Hebdomadaire" },
  "1M": { tr: "Aylik", en: "Monthly", fr: "Mensuel" },
};

export function AllTimeframeSignals({ ticker }: AllTimeframeSignalsProps) {
  const { locale } = useLocale();
  const sigQ = useQuery({
    queryKey: ["signalsAllTF", ticker],
    queryFn: () => api.signalsAllTimeframes(ticker),
  });

  const timeframes = parseTimeframes(sigQ.data);
  const tfKeys = Object.keys(timeframes);

  const labels = {
    title: { tr: "Tum Zaman Dilimleri", en: "All Timeframes", fr: "Tous les horizons" },
    noData: { tr: "Zaman dilimi verisi yok", en: "No timeframe data", fr: "Aucune donnee" },
    timeframe: { tr: "Zaman Dilimi", en: "Timeframe", fr: "Horizon" },
    signal: { tr: "Sinyal", en: "Signal", fr: "Signal" },
    buy: { tr: "Al", en: "Buy", fr: "Achat" },
    sell: { tr: "Sat", en: "Sell", fr: "Vente" },
    neutral: { tr: "Notr", en: "Neutral", fr: "Neutre" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-xl border border-border/60 p-4"
    >
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5" />
        {labels.title[locale]}
      </h3>
      {sigQ.isLoading ? (
        <LoadingSpinner />
      ) : tfKeys.length === 0 ? (
        <EmptyState message={labels.noData[locale]} />
      ) : (
        <div className="space-y-2">
          {tfKeys.map((tf) => {
            const tfData = timeframes[tf];
            const summary = tfData?.summary as Record<string, unknown> | undefined;
            const rec = String(summary?.recommendation ?? summary?.signal ?? tfData?.recommendation ?? tfData?.signal ?? "NEUTRAL");
            const buyCount = Number(summary?.buy ?? tfData?.buy ?? 0);
            const sellCount = Number(summary?.sell ?? tfData?.sell ?? 0);
            const neutralCount = Number(summary?.neutral ?? tfData?.neutral ?? 0);
            const total = buyCount + sellCount + neutralCount;
            const label = TIMEFRAME_LABELS[tf]?.[locale] ?? tf;

            return (
              <div key={tf} className="flex items-center gap-3 py-2 border-b border-border/20 last:border-0">
                <span className="text-[11px] font-medium text-muted-foreground w-20 flex-shrink-0">{label}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getSignalColor(rec)}`}>
                  {translateSignal(rec, locale)}
                </span>
                {total > 0 && (
                  <div className="flex-1 flex items-center gap-2 ml-auto">
                    <div className="flex h-1.5 flex-1 rounded-full overflow-hidden bg-muted/30">
                      {buyCount > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${(buyCount / total) * 100}%` }} />}
                      {neutralCount > 0 && <div className="bg-amber-400 h-full" style={{ width: `${(neutralCount / total) * 100}%` }} />}
                      {sellCount > 0 && <div className="bg-red-500 h-full" style={{ width: `${(sellCount / total) * 100}%` }} />}
                    </div>
                    <div className="flex gap-1.5 text-[9px] font-mono text-muted-foreground shrink-0">
                      <span className="text-emerald-500">{buyCount}</span>
                      <span className="text-amber-500">{neutralCount}</span>
                      <span className="text-red-500">{sellCount}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
