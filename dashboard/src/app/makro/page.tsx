"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Landmark, BarChart3, Globe } from "lucide-react";
import { api, isApiError } from "@/lib/api";
import { formatPercent, formatMarketDate, toFiniteNumber } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { MacroStatCard, SourceFooter } from "@/components/makro/MacroStatCard";
import { FxCard, type FxData } from "@/components/makro/FxCard";
import { HistoryChart, type HistoryPoint } from "@/components/makro/HistoryChart";
import { EconomicCalendar, type CalendarItem } from "@/components/makro/EconomicCalendar";
import { TcmbRatesCard, type TcmbData } from "@/components/makro/TcmbRatesCard";

const stagger = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: Math.min(i * 0.04, 0.12), duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

interface PolicyRateOut {
  source?: string;
  policy_rate?: { value?: number; date?: string };
  history?: Array<{ date?: string; lending?: number | null }>;
}

interface InflationOut {
  source?: string;
  latest?: { year_month?: string; yearly_inflation?: number; monthly_inflation?: number };
  tufe_history?: Array<{ Date?: string; YearlyInflation?: number }>;
}

interface CalendarOut {
  calendar?: CalendarItem[];
}

export default function MakroPage() {
  const { t } = useLocale();

  const rateQ = useQuery({ queryKey: ["policy-rate"], queryFn: () => api.policyRate() as Promise<PolicyRateOut> });
  const infQ = useQuery({ queryKey: ["inflation"], queryFn: () => api.inflation() as Promise<InflationOut> });
  const usdQ = useQuery({ queryKey: ["fx-usd"], queryFn: () => api.fx("USD") as Promise<FxData> });
  const eurQ = useQuery({ queryKey: ["fx-eur"], queryFn: () => api.fx("EUR") as Promise<FxData> });
  const gbpQ = useQuery({ queryKey: ["fx-gbp"], queryFn: () => api.fx("GBP") as Promise<FxData> });
  const calQ = useQuery({ queryKey: ["calendar"], queryFn: () => api.calendar() as Promise<CalendarOut> });
  const tcmbQ = useQuery({ queryKey: ["tcmb-detail"], queryFn: () => api.tcmb() as Promise<TcmbData> });

  const rate = rateQ.data;
  const rateValue = toFiniteNumber(rate?.policy_rate?.value);
  const rateDate = rate?.policy_rate?.date;
  const rateHistory: HistoryPoint[] = (rate?.history ?? [])
    .map((h) => ({ date: String(h.date ?? ""), value: Number(h.lending) }))
    .filter((p) => p.date && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  const inf = infQ.data;
  const yearlyInflation = toFiniteNumber(inf?.latest?.yearly_inflation);
  const monthlyInflation = toFiniteNumber(inf?.latest?.monthly_inflation);
  const inflationHistory: HistoryPoint[] = (inf?.tufe_history ?? [])
    .map((h) => ({ date: String(h.Date ?? ""), value: Number(h.YearlyInflation) }))
    .filter((p) => p.date && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-36);

  const calData = calQ.data;
  const calItems = Array.isArray(calData?.calendar) ? calData.calendar : [];

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

      {/* Rate/FX cards share one row; items-start keeps a shorter card from
          being stretched into an empty box by a taller sibling (e.g. once a
          trend chart renders). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
        <motion.div custom={1} variants={stagger} initial="hidden" animate="show">
          <MacroStatCard
            title={t("makro.policyRate")}
            icon={Landmark}
            isLoading={rateQ.isLoading}
            isError={rateQ.isError}
            errorMessage={isApiError(rateQ.error) ? rateQ.error.detail : undefined}
            onRetry={() => { void rateQ.refetch(); }}
          >
            <div className="text-3xl font-bold font-mono text-primary tracking-tight">
              {rateValue != null ? formatPercent(rateValue) : "-"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{t("makro.weeklyRepo")}</p>
            {rateHistory.length >= 2 && (
              <HistoryChart data={rateHistory} color="var(--chart-1)" valueFormatter={(v) => formatPercent(v, 1)} height={80} />
            )}
            <SourceFooter
              source={rate?.source}
              asOf={rateDate ? `${t("makro.lastDecisionDate")}: ${formatMarketDate(rateDate, "date")}` : null}
            />
          </MacroStatCard>
        </motion.div>

        <motion.div custom={2} variants={stagger} initial="hidden" animate="show">
          <MacroStatCard
            title={t("makro.inflation")}
            icon={BarChart3}
            isLoading={infQ.isLoading}
            isError={infQ.isError}
            errorMessage={isApiError(infQ.error) ? infQ.error.detail : undefined}
            onRetry={() => { void infQ.refetch(); }}
          >
            {inf?.latest ? (
              <>
                <div className="text-3xl font-bold font-mono text-amber-600 dark:text-amber-400 tracking-tight">
                  {yearlyInflation != null ? formatPercent(yearlyInflation) : "-"}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{t("makro.yearlyCpi")}</p>
                {monthlyInflation != null && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">{t("makro.monthly")}</span>
                    <span className="text-sm font-bold font-mono text-foreground">{formatPercent(monthlyInflation)}</span>
                  </div>
                )}
                {inflationHistory.length >= 2 && (
                  <HistoryChart data={inflationHistory} color="var(--chart-3)" valueFormatter={(v) => formatPercent(v, 0)} height={80} />
                )}
                <SourceFooter
                  source={inf?.source}
                  asOf={inf?.latest?.year_month ? formatMarketDate(inf.latest.year_month, "monthYear") : null}
                />
              </>
            ) : (
              <div className="text-3xl font-bold font-mono tracking-tight">-</div>
            )}
          </MacroStatCard>
        </motion.div>

        <motion.div custom={3} variants={stagger} initial="hidden" animate="show">
          <FxCard
            label="USD/TRY"
            data={usdQ.data}
            isLoading={usdQ.isLoading}
            isError={usdQ.isError}
            errorMessage={isApiError(usdQ.error) ? usdQ.error.detail : undefined}
            onRetry={() => { void usdQ.refetch(); }}
            noDataLabel={t("makro.noData")}
          />
        </motion.div>
        <motion.div custom={4} variants={stagger} initial="hidden" animate="show">
          <FxCard
            label="EUR/TRY"
            data={eurQ.data}
            isLoading={eurQ.isLoading}
            isError={eurQ.isError}
            errorMessage={isApiError(eurQ.error) ? eurQ.error.detail : undefined}
            onRetry={() => { void eurQ.refetch(); }}
            noDataLabel={t("makro.noData")}
          />
        </motion.div>
        <motion.div custom={5} variants={stagger} initial="hidden" animate="show">
          <FxCard
            label="GBP/TRY"
            data={gbpQ.data}
            isLoading={gbpQ.isLoading}
            isError={gbpQ.isError}
            errorMessage={isApiError(gbpQ.error) ? gbpQ.error.detail : undefined}
            onRetry={() => { void gbpQ.refetch(); }}
            noDataLabel={t("makro.noData")}
          />
        </motion.div>
      </div>

      <motion.div custom={6} variants={stagger} initial="hidden" animate="show">
        <EconomicCalendar
          items={calItems}
          isLoading={calQ.isLoading}
          isError={calQ.isError}
          errorMessage={isApiError(calQ.error) ? calQ.error.detail : undefined}
          onRetry={() => { void calQ.refetch(); }}
          noDataLabel={t("makro.noCalendar")}
        />
      </motion.div>

      <motion.div custom={7} variants={stagger} initial="hidden" animate="show">
        <TcmbRatesCard
          data={tcmbQ.data}
          isLoading={tcmbQ.isLoading}
          isError={tcmbQ.isError}
          errorMessage={isApiError(tcmbQ.error) ? tcmbQ.error.detail : undefined}
          onRetry={() => { void tcmbQ.refetch(); }}
          noDataLabel={t("makro.noData")}
        />
      </motion.div>
    </div>
  );
}
