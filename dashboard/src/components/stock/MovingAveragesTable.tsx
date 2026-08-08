"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { LineChart, Sparkles, ArrowUpRight, ArrowDownRight, Layers } from "lucide-react";

interface MovingAveragesTableProps {
  ticker: string;
}

export function MovingAveragesTable({ ticker }: MovingAveragesTableProps) {
  const { t } = useLocale();

  const maQ = useQuery({
    queryKey: ["moving-averages", ticker],
    queryFn: () => api.movingAverages(ticker),
  });

  const pivotsQ = useQuery({
    queryKey: ["pivots", ticker],
    queryFn: () => api.pivots(ticker),
  });

  const maData = maQ.data;
  const pivotsData = pivotsQ.data?.pivots;

  const periods = [10, 20, 50, 100, 200];
  const smaObj = maData?.sma || {};
  const emaObj = maData?.ema || {};
  const goldenCross = maData?.golden_cross;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-4"
    >
      {/* Moving Averages Card */}
      <div className="bg-card rounded-2xl border border-border/60 overflow-hidden p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-foreground">
              {t("ma.title")}
            </h2>
          </div>
          {goldenCross != null && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                goldenCross
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
              }`}
            >
              <Sparkles className="h-3 w-3" />
              {goldenCross ? t("ma.goldenCross") : t("ma.deathCross")}
            </span>
          )}
        </div>

        {maQ.isLoading ? (
          <LoadingSpinner />
        ) : maQ.isError ? (
          <ErrorState message={t("common.noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="pb-2 text-left">{t("ma.period")}</th>
                  <th className="pb-2 text-right">SMA</th>
                  <th className="pb-2 text-right">EMA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {periods.map((p) => {
                  const smaVal = smaObj[`sma_${p}`];
                  const emaVal = emaObj[`ema_${p}`];
                  return (
                    <tr key={p} className="hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 text-xs font-medium text-foreground">
                        {p} {t("ma.daily")}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-foreground">
                        {smaVal != null ? `₺${formatNumber(smaVal)}` : "-"}
                      </td>
                      <td className="py-2.5 text-right font-mono text-xs text-foreground">
                        {emaVal != null ? `₺${formatNumber(emaVal)}` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pivot Points Card */}
      <div className="bg-card rounded-2xl border border-border/60 overflow-hidden p-5">
        <div className="flex items-center gap-2 mb-4">
          <Layers className="h-4 w-4 text-cyan-500" />
          <h2 className="text-sm font-semibold text-foreground">
            {t("pivots.title")}
          </h2>
        </div>

        {pivotsQ.isLoading ? (
          <LoadingSpinner />
        ) : !pivotsData ? (
          <EmptyState message={t("pivots.noData")} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Destekler */}
            <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/20 space-y-2">
              <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <ArrowDownRight className="h-3.5 w-3.5" />
                {t("pivots.support")}
              </div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">S1:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.s1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">S2:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.s2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">S3:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.s3)}</span>
                </div>
              </div>
            </div>

            {/* Pivot Noktası */}
            <div className="bg-primary/5 rounded-xl p-3 border border-primary/20 flex flex-col justify-center items-center text-center">
              <span className="text-xs font-bold text-primary mb-1">
                {t("pivots.main")}
              </span>
              <span className="text-lg font-bold font-mono text-foreground">₺{formatNumber(pivotsData.pivot)}</span>
            </div>

            {/* Dirençler */}
            <div className="bg-rose-500/5 rounded-xl p-3 border border-rose-500/20 space-y-2">
              <div className="flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400">
                <ArrowUpRight className="h-3.5 w-3.5" />
                {t("pivots.resistance")}
              </div>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R1:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.r1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R2:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.r2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R3:</span>
                  <span className="font-semibold text-foreground">₺{formatNumber(pivotsData.r3)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
