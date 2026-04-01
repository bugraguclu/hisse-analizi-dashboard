"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Landmark, BarChart3, Globe, DollarSign, Calendar } from "lucide-react";
import { useLocale } from "@/lib/locale-context";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function MacroCard({ title, icon: Icon, children, isLoading: loading, index = 0 }: { title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; isLoading?: boolean; index?: number }) {
  return (
    <motion.div custom={index} variants={stagger} initial="hidden" animate="show">
      <div className="bg-card rounded-2xl border border-border/60 p-5 hover:shadow-sm transition-all h-full">
        <div className="flex items-center gap-2 mb-4">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {loading ? <LoadingSpinner /> : children}
      </div>
    </motion.div>
  );
}

function FxCard({ label, data, isLoading, index, noDataLabel }: { label: string; data: Record<string, unknown> | null; isLoading: boolean; index: number; noDataLabel: string }) {
  if (isLoading) return <MacroCard title={label} icon={DollarSign} isLoading={true} index={index}><span /></MacroCard>;
  if (!data) return <MacroCard title={label} icon={DollarSign} index={index}><EmptyState message={noDataLabel} /></MacroCard>;

  // Backend returns: {"currency": ..., "info": {...}, "history": [...]}
  const info = (data.info && typeof data.info === "object" ? data.info : data) as Record<string, unknown>;
  const historyArr = Array.isArray(data.history) ? data.history as Record<string, unknown>[] : [];
  const lastHist = historyArr.length > 0 ? historyArr[historyArr.length - 1] : null;
  const prevHist = historyArr.length > 1 ? historyArr[historyArr.length - 2] : null;

  const price = info.close ?? info.price ?? info.rate ?? info.value ?? (lastHist ? lastHist.Close ?? lastHist.close : null);
  const prevPrice = prevHist ? Number(prevHist.Close ?? prevHist.close ?? 0) : 0;
  const curPrice = price != null ? Number(price) : 0;
  const change = prevPrice > 0 ? ((curPrice - prevPrice) / prevPrice) * 100 : Number(info.change_pct ?? info.change_percent ?? 0);
  const isUp = change >= 0;

  return (
    <MacroCard title={label} icon={DollarSign} index={index}>
      <div className="text-3xl font-bold font-mono text-foreground tracking-tight">{price != null ? formatNumber(Number(price), 4) : "-"}</div>
      <div className={`flex items-center gap-1.5 text-sm font-semibold mt-2 ${isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
        {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {isUp ? "+" : ""}{formatNumber(change)}%
      </div>
    </MacroCard>
  );
}

export default function MakroPage() {
  const { t } = useLocale();

  const rateQ = useQuery({ queryKey: ["policy-rate"], queryFn: () => api.policyRate() });
  const infQ = useQuery({ queryKey: ["inflation"], queryFn: () => api.inflation() });
  const usdQ = useQuery({ queryKey: ["fx-usd"], queryFn: () => api.fx("USD") });
  const eurQ = useQuery({ queryKey: ["fx-eur"], queryFn: () => api.fx("EUR") });
  const gbpQ = useQuery({ queryKey: ["fx-gbp"], queryFn: () => api.fx("GBP") });
  const calQ = useQuery({ queryKey: ["calendar"], queryFn: () => api.calendar() });

  // Backend returns: {"source": "TCMB", "policy_rate": ...}
  const rate = rateQ.data as Record<string, unknown> | null;
  const policyRateRaw = rate?.policy_rate;
  const rateVal = typeof policyRateRaw === "object" && policyRateRaw != null
    ? (policyRateRaw as Record<string, unknown>).value ?? (policyRateRaw as Record<string, unknown>).rate
    : policyRateRaw ?? rate?.rate ?? rate?.value;

  // Backend returns: {"source": "TCMB", "latest": {...}, "tufe_history": [...]}
  const infRaw = infQ.data as Record<string, unknown> | null;
  const inf = (infRaw?.latest && typeof infRaw.latest === "object" ? infRaw.latest : infRaw) as Record<string, unknown> | null;

  // Backend returns: {"calendar": [...]}
  const calData = calQ.data as Record<string, unknown> | null;
  const calArr = calData?.calendar ? calData.calendar
    : Array.isArray(calData) ? calData
    : (calData && typeof calData === "object" && "data" in calData) ? calData.data
    : null;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Globe className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">{t("nav.macroEconomy")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("makro.tcmbFx")}</p>
          </div>
        </div>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MacroCard title={t("makro.policyRate")} icon={Landmark} index={1}>
          <div className="text-3xl font-bold font-mono text-primary tracking-tight">
            {rateVal != null ? formatPercent(Number(rateVal)) : rateQ.isLoading ? "..." : "-"}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{t("makro.weeklyRepo")}</p>
        </MacroCard>
        <MacroCard title={t("makro.inflation")} icon={BarChart3} index={2}>
          {inf ? (
            <>
              <div className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400 tracking-tight">
                {formatPercent(Number(inf.yearly_inflation ?? inf.rate ?? inf.value ?? inf.cpi ?? 0))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{t("makro.yearlyCpi")}</p>
              {inf.monthly_inflation != null && (
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground">{t("makro.monthly")}</span>
                  <span className="text-sm font-bold font-mono text-foreground">{formatPercent(Number(inf.monthly_inflation))}</span>
                </div>
              )}
              {inf.year_month && (
                <p className="text-[10px] text-muted-foreground mt-1">{String(inf.year_month)}</p>
              )}
            </>
          ) : infQ.isLoading ? (
            <div className="text-3xl font-bold font-mono tracking-tight">...</div>
          ) : (
            <div className="text-3xl font-bold font-mono tracking-tight">-</div>
          )}
        </MacroCard>
        <FxCard label="USD/TRY" data={usdQ.data as Record<string, unknown> | null} isLoading={usdQ.isLoading} index={3} noDataLabel={t("makro.noData")} />
        <FxCard label="EUR/TRY" data={eurQ.data as Record<string, unknown> | null} isLoading={eurQ.isLoading} index={4} noDataLabel={t("makro.noData")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FxCard label="GBP/TRY" data={gbpQ.data as Record<string, unknown> | null} isLoading={gbpQ.isLoading} index={5} noDataLabel={t("makro.noData")} />

        {/* Economic Calendar */}
        <MacroCard title={t("makro.calendar")} icon={Calendar} isLoading={calQ.isLoading} index={6}>
          {!calArr || !Array.isArray(calArr) || calArr.length === 0 ? (
            <EmptyState message={t("makro.noCalendar")} />
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
              {(calArr as Record<string, unknown>[]).slice(0, 10).map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground truncate">{String(item.event || item.title || item.name || "-")}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{String(item.date || item.time || "")}</div>
                  </div>
                  {(item.actual || item.forecast) ? (
                    <div className="text-[11px] font-mono text-muted-foreground ml-3 shrink-0 space-x-2">
                      {item.actual != null && <span className="text-foreground font-semibold">G: {String(item.actual)}</span>}
                      {item.forecast != null && <span>T: {String(item.forecast)}</span>}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </MacroCard>
      </div>
    </div>
  );
}
