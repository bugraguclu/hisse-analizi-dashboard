"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Landmark, BarChart3, Globe, DollarSign } from "lucide-react";

function MacroCard({ title, icon: Icon, children, isLoading: loading }: { title: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; isLoading?: boolean }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 hover:shadow-md transition-all">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {loading ? <LoadingSpinner /> : children}
    </div>
  );
}

function FxCard({ label, data, isLoading }: { label: string; data: Record<string, unknown> | null; isLoading: boolean }) {
  if (isLoading) return <MacroCard title={label} icon={DollarSign} isLoading={true}><span /></MacroCard>;
  if (!data) return <MacroCard title={label} icon={DollarSign}><EmptyState message="Veri yok" /></MacroCard>;

  const price = data.close || data.price || data.rate || data.value;
  const change = Number(data.change_pct || data.change_percent || 0);
  const isUp = change >= 0;

  return (
    <MacroCard title={label} icon={DollarSign}>
      <div className="text-3xl font-bold font-mono text-foreground">{price != null ? formatNumber(Number(price), 4) : "-"}</div>
      <div className={`flex items-center gap-1 text-sm font-semibold mt-2 ${isUp ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {isUp ? "+" : ""}{formatNumber(change)}%
      </div>
    </MacroCard>
  );
}

export default function MakroPage() {
  const rateQ = useQuery({ queryKey: ["policy-rate"], queryFn: () => api.policyRate() });
  const infQ = useQuery({ queryKey: ["inflation"], queryFn: () => api.inflation() });
  const usdQ = useQuery({ queryKey: ["fx-usd"], queryFn: () => api.fx("USD") });
  const eurQ = useQuery({ queryKey: ["fx-eur"], queryFn: () => api.fx("EUR") });
  const gbpQ = useQuery({ queryKey: ["fx-gbp"], queryFn: () => api.fx("GBP") });
  const calQ = useQuery({ queryKey: ["calendar"], queryFn: () => api.calendar() });

  const rate = rateQ.data as Record<string, unknown> | null;
  const rateVal = rate?.rate || rate?.policy_rate || rate?.value;
  const inf = infQ.data as Record<string, unknown> | null;

  const calData = calQ.data;
  const calArr = Array.isArray(calData) ? calData : (calData && typeof calData === "object" && "data" in (calData as Record<string,unknown>)) ? (calData as Record<string,unknown>).data : null;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-xl font-bold text-foreground">Makro Ekonomi</h1>
        <p className="text-sm text-muted-foreground mt-0.5">TCMB, enflasyon, doviz kurlari, ekonomik takvim</p>
      </motion.div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
          <MacroCard title="Politika Faizi" icon={Landmark}>
            <div className="text-3xl font-bold font-mono text-primary">
              {rateVal != null ? formatPercent(Number(rateVal)) : rateQ.isLoading ? "..." : "-"}
            </div>
          </MacroCard>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <MacroCard title="Enflasyon (TUFE)" icon={BarChart3}>
            <div className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400">
              {inf ? formatPercent(Number(inf.rate || inf.value || inf.cpi || 0)) : infQ.isLoading ? "..." : "-"}
            </div>
          </MacroCard>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <FxCard label="USD/TRY" data={usdQ.data as Record<string, unknown> | null} isLoading={usdQ.isLoading} />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <FxCard label="EUR/TRY" data={eurQ.data as Record<string, unknown> | null} isLoading={eurQ.isLoading} />
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <FxCard label="GBP/TRY" data={gbpQ.data as Record<string, unknown> | null} isLoading={gbpQ.isLoading} />
        </motion.div>

        {/* Economic Calendar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <MacroCard title="Ekonomik Takvim" icon={Globe} isLoading={calQ.isLoading}>
            {!calArr || !Array.isArray(calArr) || calArr.length === 0 ? (
              <EmptyState message="Takvim verisi yok" />
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(calArr as Record<string, unknown>[]).slice(0, 10).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">{String(item.event || item.title || item.name || "-")}</div>
                      <div className="text-xs text-muted-foreground">{String(item.date || item.time || "")}</div>
                    </div>
                    {(item.actual || item.forecast) ? (
                      <div className="text-xs font-mono text-muted-foreground ml-2">
                        {item.actual ? `G: ${String(item.actual)}` : ""} {item.forecast ? `T: ${String(item.forecast)}` : ""}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </MacroCard>
        </motion.div>
      </div>
    </div>
  );
}
