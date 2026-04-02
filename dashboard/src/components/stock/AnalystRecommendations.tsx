"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { ThumbsUp } from "lucide-react";

interface AnalystRecommendationsProps {
  ticker: string;
}

function parseRecommendations(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.recommendations && typeof obj.recommendations === "object") {
    return obj.recommendations as Record<string, unknown>;
  }
  if (obj.data && typeof obj.data === "object") {
    return obj.data as Record<string, unknown>;
  }
  return obj;
}

const REC_COLORS: Record<string, string> = {
  strongBuy: "bg-emerald-500",
  buy: "bg-emerald-400",
  hold: "bg-amber-400",
  sell: "bg-red-400",
  strongSell: "bg-red-500",
};

const REC_LABELS: Record<string, Record<string, string>> = {
  strongBuy: { tr: "Guclu Al", en: "Strong Buy", fr: "Achat fort" },
  buy: { tr: "Al", en: "Buy", fr: "Achat" },
  hold: { tr: "Tut", en: "Hold", fr: "Conserver" },
  sell: { tr: "Sat", en: "Sell", fr: "Vente" },
  strongSell: { tr: "Guclu Sat", en: "Strong Sell", fr: "Vente forte" },
};

export function AnalystRecommendations({ ticker }: AnalystRecommendationsProps) {
  const { locale } = useLocale();
  const recQ = useQuery({
    queryKey: ["recommendations", ticker],
    queryFn: () => api.recommendations(ticker),
  });

  const data = parseRecommendations(recQ.data);

  const labels = {
    title: { tr: "Analist Onerileri", en: "Analyst Recommendations", fr: "Recommandations d'analystes" },
    noData: { tr: "Analist onerisi yok", en: "No analyst recommendations", fr: "Aucune recommandation" },
    analysts: { tr: "analist", en: "analysts", fr: "analystes" },
  };

  // Try to extract recommendation counts
  const recKeys = ["strongBuy", "buy", "hold", "sell", "strongSell"];
  const counts: Record<string, number> = {};
  let total = 0;

  if (data) {
    for (const key of recKeys) {
      const altKeys = [key, key.toLowerCase(), key.replace(/([A-Z])/g, "_$1").toLowerCase()];
      for (const ak of altKeys) {
        if (data[ak] != null) {
          counts[key] = Number(data[ak]);
          total += counts[key];
          break;
        }
      }
    }
    // Also handle array format [{period, strongBuy, buy, ...}]
    if (total === 0 && Array.isArray(data)) {
      const latest = (data as Record<string, unknown>[])[0];
      if (latest) {
        for (const key of recKeys) {
          if (latest[key] != null) {
            counts[key] = Number(latest[key]);
            total += counts[key];
          }
        }
      }
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-xl border border-border/60 p-4"
    >
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
        <ThumbsUp className="h-3.5 w-3.5" />
        {labels.title[locale]}
      </h3>
      {recQ.isLoading ? (
        <LoadingSpinner />
      ) : total === 0 ? (
        <EmptyState message={labels.noData[locale]} />
      ) : (
        <div className="space-y-3">
          {/* Bar chart */}
          <div className="flex h-6 rounded-full overflow-hidden">
            {recKeys.map((key) => {
              const count = counts[key] ?? 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div
                  key={key}
                  className={`${REC_COLORS[key]} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${REC_LABELS[key]?.[locale] ?? key}: ${count}`}
                />
              );
            })}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {recKeys.map((key) => {
              const count = counts[key] ?? 0;
              if (count === 0) return null;
              return (
                <div key={key} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${REC_COLORS[key]}`} />
                  <span className="text-[10px] text-muted-foreground">{REC_LABELS[key]?.[locale] ?? key}</span>
                  <span className="text-[10px] font-bold text-foreground">{count}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">{total} {labels.analysts[locale]}</p>
        </div>
      )}
    </motion.div>
  );
}
