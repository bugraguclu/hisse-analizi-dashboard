"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatCompact, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Building2, TrendingUp, Users, Target, BarChart3 } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { AnalystRecommendations } from "@/components/stock/AnalystRecommendations";
import { EarningsCalendar } from "@/components/stock/EarningsCalendar";
import { CompanyRiskScores } from "@/components/stock/CompanyRiskScores";

const stagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.06, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
  }),
};

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground font-mono">{String(value)}</span>
    </div>
  );
}

export default function TemelPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const tk = ticker.toUpperCase();
  const router = useRouter();
  const { t } = useLocale();

  const infoQ = useQuery({ queryKey: ["company-info", tk], queryFn: () => api.companyInfo(tk) });
  const fastInfoQ = useQuery({ queryKey: ["fast-info", tk], queryFn: () => api.fastInfo(tk) });
  const liveRatiosQ = useQuery({ queryKey: ["live-ratios", tk], queryFn: () => api.liveRatios(tk) });
  const targetsQ = useQuery({ queryKey: ["targets", tk], queryFn: () => api.priceTargets(tk) });
  const holdersQ = useQuery({ queryKey: ["holders", tk], queryFn: () => api.holders(tk) });

  const info = infoQ.data as Record<string, unknown> | null;
  const fastInfo = fastInfoQ.data as Record<string, unknown> | null;
  const liveRatios = liveRatiosQ.data as { ratios?: Record<string, number | null> } | null;
  const liveRatioObj = liveRatios?.ratios || {};

  const fastInfoObj = (fastInfo?.fast_info && typeof fastInfo.fast_info === "object" ? fastInfo.fast_info : fastInfo) as Record<string, unknown> | null;
  const rawInfoObj = (info?.info || info) as Record<string, unknown> | null;
  // Merge fast_info & rawInfoObj
  const infoObj = rawInfoObj && fastInfoObj
    ? { ...fastInfoObj, ...rawInfoObj }
    : rawInfoObj || fastInfoObj;

  // Backend returns: {"ticker": ..., "holders": [...]}
  const holders = holdersQ.data as Record<string, unknown> | null;
  const holdersArr = holders?.holders ? holders.holders
    : Array.isArray(holders) ? holders
    : (holders?.data ? holders.data : null);

  // Backend returns: {"ticker": ..., "targets": {...}}
  const targetsRaw = targetsQ.data as Record<string, unknown> | null;
  const targets = (targetsRaw?.targets && typeof targetsRaw.targets === "object"
    ? targetsRaw.targets
    : targetsRaw) as Record<string, unknown> | null;

  function handleTickerSelect(newTicker: string) {
    router.push(`/temel/${newTicker.toUpperCase()}`);
  }

  // Extract variables safely
  const marketCap = Number(infoObj?.marketCap || infoObj?.market_cap || infoObj?.marketCapitalization || 0);
  const sharesOutstanding = Number(infoObj?.sharesOutstanding || infoObj?.shares_outstanding || infoObj?.shares || 0);
  const floatShares = Number(infoObj?.floatShares || infoObj?.float_shares || 0);
  const freeFloatPct = sharesOutstanding > 0 && floatShares > 0 ? (floatShares / sharesOutstanding) * 100 : null;

  const peRatio = liveRatioObj.pe_ratio ?? infoObj?.trailingPE ?? infoObj?.trailing_pe ?? infoObj?.pe_ratio;
  const pbRatio = liveRatioObj.pb_ratio ?? infoObj?.priceToBook ?? infoObj?.price_to_book ?? infoObj?.pb_ratio;
  const psRatio = liveRatioObj.ps_ratio ?? infoObj?.priceToSalesTrailing12Months ?? infoObj?.ps_ratio;
  const netDebtEbitda = liveRatioObj.net_debt_ebitda ?? infoObj?.netDebtToEBITDA ?? infoObj?.net_debt_ebitda;

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <motion.div custom={0} variants={stagger} initial="hidden" animate="show">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Building2 className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground tracking-tight">{t("nav.fundamentalAnalysis")} — {tk}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <Link href={`/hisse/${tk}`} className="text-[11px] text-primary hover:underline">{t("nav.stockAnalysis")}</Link>
                <span className="text-muted-foreground text-[11px]">&middot;</span>
                <Link href={`/teknik/${tk}`} className="text-[11px] text-primary hover:underline flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> {t("nav.technical")}
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
        <div className="w-72 md:w-80"><TickerSearch onSelect={handleTickerSelect} /></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Company Info & Capital Structure */}
        <motion.div custom={1} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{t("temel.companyInfo")}</h2>
          </div>
          {(infoQ.isLoading || fastInfoQ.isLoading) ? <LoadingSpinner /> : !infoObj || Object.keys(infoObj).length === 0 ? <EmptyState message={t("temel.noCompanyInfo")} /> : (
            <div>
              {[
                [t("temel.name"), infoObj.longName || infoObj.shortName || infoObj.name || infoObj.long_name || infoObj.short_name || tk],
                [t("temel.sector"), infoObj.sector || infoObj.industry || infoObj.sectorDisp || infoObj.industryDisp || "-"],
                [t("temel.exchange"), infoObj.exchange || infoObj.fullExchangeName || infoObj.market || "BİST"],
                [t("temel.marketCap"), marketCap > 0 ? formatCompact(marketCap) : "-"],
                [t("temel.freeFloat"), freeFloatPct != null ? formatPercent(freeFloatPct) : "-"],
                [t("temel.freeFloatShares"), floatShares > 0 ? formatCompact(floatShares) : "-"],
                [t("temel.sharesOutstanding"), sharesOutstanding > 0 ? formatCompact(sharesOutstanding) : "-"],
                [t("temel.beta"), infoObj.beta != null ? formatNumber(Number(infoObj.beta)) : "-"],
                [t("temel.lastPrice"), (infoObj.currentPrice ?? infoObj.current_price ?? infoObj.regularMarketPrice ?? infoObj.last_price ?? infoObj.previousClose) != null ? `₺${formatNumber(Number(infoObj.currentPrice ?? infoObj.current_price ?? infoObj.regularMarketPrice ?? infoObj.last_price ?? infoObj.previousClose))}` : "-"],
                [t("temel.52wHighLow"), (infoObj.fiftyTwoWeekHigh ?? infoObj.fifty_two_week_high ?? infoObj.yearHigh ?? infoObj.year_high) != null ? `₺${formatNumber(Number(infoObj.fiftyTwoWeekHigh ?? infoObj.fifty_two_week_high ?? infoObj.yearHigh ?? infoObj.year_high))} / ₺${formatNumber(Number(infoObj.fiftyTwoWeekLow ?? infoObj.fifty_two_week_low ?? infoObj.yearLow ?? infoObj.year_low ?? 0))}` : "-"],
                [t("temel.employees"), Number(infoObj.fullTimeEmployees || infoObj.full_time_employees || 0) > 0 ? formatCompact(Number(infoObj.fullTimeEmployees || infoObj.full_time_employees || 0)) : "-"],
                [t("temel.website"), infoObj.website || infoObj.web_site || "-"],
              ].filter(([, value]) => value !== "-").map(([label, value]) => (
                <InfoRow key={String(label)} label={String(label)} value={String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Valuation Multiples & Ratios */}
        <motion.div custom={2} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">{t("temel.valuationMultiples")}</h2>
          </div>
          {(infoQ.isLoading || liveRatiosQ.isLoading) ? <LoadingSpinner /> : !infoObj ? <EmptyState message={t("temel.noCompanyInfo")} /> : (
            <div>
              {[
                [t("hisse.peRatio"), peRatio != null ? formatNumber(Number(peRatio)) : "-"],
                [t("temel.forwardPE"), (infoObj.forwardPE ?? infoObj.forward_pe) != null ? formatNumber(Number(infoObj.forwardPE ?? infoObj.forward_pe)) : "-"],
                [t("temel.pegRatio"), infoObj.pegRatio != null ? formatNumber(Number(infoObj.pegRatio)) : "-"],
                ["PD/DD (P/B)", pbRatio != null ? formatNumber(Number(pbRatio)) : "-"],
                [t("temel.bookValue"), (infoObj.bookValue ?? infoObj.book_value) != null ? `₺${formatNumber(Number(infoObj.bookValue ?? infoObj.book_value))}` : "-"],
                [t("temel.psRatio"), psRatio != null ? formatNumber(Number(psRatio)) : "-"],
                [t("temel.enterpriseValue"), (infoObj.enterpriseValue ?? infoObj.enterprise_value) != null ? formatCompact(Number(infoObj.enterpriseValue ?? infoObj.enterprise_value)) : "-"],
                [t("temel.evEbitda"), (infoObj.enterpriseToEbitda ?? infoObj.enterprise_to_ebitda) != null ? formatNumber(Number(infoObj.enterpriseToEbitda ?? infoObj.enterprise_to_ebitda)) : "-"],
                [t("temel.evRevenue"), (infoObj.enterpriseToRevenue ?? infoObj.enterprise_to_revenue) != null ? formatNumber(Number(infoObj.enterpriseToRevenue ?? infoObj.enterprise_to_revenue)) : "-"],
                [t("temel.netDebtEbitda"), netDebtEbitda != null ? formatNumber(Number(netDebtEbitda)) : "-"],
                [t("temel.epsTrailing"), (infoObj.trailingEps ?? infoObj.trailing_eps) != null ? `₺${formatNumber(Number(infoObj.trailingEps ?? infoObj.trailing_eps))}` : "-"],
                [t("temel.epsForward"), (infoObj.forwardEps ?? infoObj.forward_eps) != null ? `₺${formatNumber(Number(infoObj.forwardEps ?? infoObj.forward_eps))}` : "-"],
                [t("temel.dividendYield"), (infoObj.dividendYield ?? infoObj.dividend_yield ?? infoObj.lastDividendValue) != null ? formatPercent(Number(infoObj.dividendYield ?? infoObj.dividend_yield ?? 0) * 100) : "-"],
              ].filter(([, value]) => value !== "-").map(([label, value]) => (
                <InfoRow key={String(label)} label={String(label)} value={String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Corporate Risk Scores */}
        <motion.div custom={2.5} variants={stagger} initial="hidden" animate="show" className="lg:col-span-2">
          <CompanyRiskScores info={infoObj} />
        </motion.div>

        {/* Price Targets */}
        <motion.div custom={3} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-foreground">{t("temel.priceTarget")}</h2>
          </div>
          {targetsQ.isLoading ? <LoadingSpinner /> : !targets ? <EmptyState message={t("temel.noPriceTarget")} /> : (
            <div>
              {[
                [t("temel.currentPrice"), targets.current ?? targets.currentPrice, true],
                [t("temel.lowTarget"), targets.low ?? targets.targetLowPrice, true],
                [t("temel.avgTarget"), targets.mean ?? targets.targetMeanPrice ?? targets.average, true],
                [t("temel.medianTarget"), targets.median ?? targets.targetMedianPrice, true],
                [t("temel.highTarget"), targets.high ?? targets.targetHighPrice, true],
                [t("temel.analystCount"), targets.numberOfAnalysts ?? targets.numberOfAnalystOpinions ?? targets.number_of_analysts ?? targets.count, false],
              ].filter(([, v]) => v != null).map(([label, value, currency]) => (
                <InfoRow key={String(label)} label={String(label)} value={typeof value === "number" ? `${currency ? "₺" : ""}${formatNumber(value, currency ? 2 : 0)}` : String(value)} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Analyst Recommendations */}
        <motion.div custom={3.5} variants={stagger} initial="hidden" animate="show">
          <AnalystRecommendations ticker={tk} />
        </motion.div>

        {/* Holders */}
        <motion.div custom={4} variants={stagger} initial="hidden" animate="show" className="bg-card rounded-2xl border border-border/60 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-teal-500" />
            <h2 className="text-sm font-semibold text-foreground">{t("temel.majorHolders")}</h2>
          </div>
          {holdersQ.isLoading ? <LoadingSpinner /> : !holdersArr || !Array.isArray(holdersArr) || holdersArr.length === 0 ? <EmptyState message={t("temel.noHolders")} /> : (
            <div className="space-y-2.5">
              {(holdersArr as Record<string, unknown>[]).slice(0, 10).map((h, i) => {
                const name = String(h.Holder || h.holder || h.name || h.institution || `Ortak ${i + 1}`);
                const rawPct = h.Percentage ?? h.pctHeld ?? h.percent ?? h.share ?? h.percentage ?? 0;
                const pct = Number(rawPct);
                // Backend returns percentage as 49.12 (not 0.4912)
                const barWidth = Math.min(pct, 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm text-foreground flex-1 truncate">{name}</span>
                    <div className="w-20 h-2 bg-muted/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${barWidth}%` }}
                        transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 + i * 0.05 }}
                        className="h-full bg-gradient-to-r from-teal-500 to-teal-400 rounded-full"
                      />
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground w-12 text-right">%{formatNumber(pct)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Earnings Calendar */}
        <motion.div custom={4.5} variants={stagger} initial="hidden" animate="show" className="lg:col-span-2">
          <EarningsCalendar ticker={tk} />
        </motion.div>
      </div>
    </div>
  );
}
