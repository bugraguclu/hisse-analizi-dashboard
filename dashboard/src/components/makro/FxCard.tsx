"use client";

import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { formatNumber, formatChangePercent, formatMarketDate, toFiniteNumber, EMPTY_VALUE } from "@/lib/format";
import { trendOf, trendText } from "@/lib/trend";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { MacroStatCard, SourceFooter } from "./MacroStatCard";
import { HistoryChart, type HistoryPoint } from "./HistoryChart";

export interface FxHistoryPoint {
  Date?: unknown;
  Close?: unknown;
}

export interface FxData {
  currency?: string;
  source?: string;
  rate_type?: string;
  as_of?: string;
  info?: Record<string, unknown> | null;
  history?: FxHistoryPoint[];
}

const RATE_TYPE_LABELS: Record<string, Record<Locale, string>> = {
  forex_selling: { tr: "Döviz Satış", en: "Forex Selling", fr: "Vente devises" },
  forex_buying: { tr: "Döviz Alış", en: "Forex Buying", fr: "Achat devises" },
  banknote_selling: { tr: "Efektif Satış", en: "Banknote Selling", fr: "Vente billets" },
  banknote_buying: { tr: "Efektif Alış", en: "Banknote Buying", fr: "Achat billets" },
};

export function FxCard({
  label,
  data,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  noDataLabel,
}: {
  label: string;
  data: FxData | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  noDataLabel: string;
}) {
  const { locale } = useLocale();

  if (isError) return <MacroStatCard title={label} icon={DollarSign} isError errorMessage={errorMessage} onRetry={onRetry}><span /></MacroStatCard>;
  if (isLoading) return <MacroStatCard title={label} icon={DollarSign} isLoading><span /></MacroStatCard>;
  if (!data) return <MacroStatCard title={label} icon={DollarSign}><EmptyState message={noDataLabel} /></MacroStatCard>;

  const info = data.info ?? {};
  const price = toFiniteNumber(info.close ?? info.last);

  const points: HistoryPoint[] = (Array.isArray(data.history) ? data.history : [])
    .map((h) => ({ date: String(h.Date ?? ""), value: Number(h.Close) }))
    .filter((p) => p.date && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const prevPoint = points.length > 1 ? points[points.length - 2] : null;
  const change = prevPoint && prevPoint.value > 0 && price != null
    ? ((price - prevPoint.value) / prevPoint.value) * 100
    : null;

  const rateType = typeof data.rate_type === "string" ? data.rate_type : "";
  const rateTypeLabel = RATE_TYPE_LABELS[rateType]?.[locale] ?? rateType;
  const sourceLabel = [data.source, rateTypeLabel].filter(Boolean).join(" · ");
  const asOfLabel = data.as_of ? formatMarketDate(data.as_of, "date") : "";

  return (
    <MacroStatCard title={label} icon={DollarSign}>
      <div className="text-3xl font-bold font-mono text-foreground tracking-tight">
        {price != null ? formatNumber(price, 4) : EMPTY_VALUE}
      </div>
      {change != null && Number.isFinite(change) && (
        <div className={`flex items-center gap-1.5 text-sm font-semibold mt-2 ${trendText(change)}`}>
          {trendOf(change) === "down" ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
          {formatChangePercent(change)}
        </div>
      )}
      {points.length >= 2 && (
        <HistoryChart data={points} color="var(--chart-1)" valueFormatter={(v) => formatNumber(v, 2)} height={72} />
      )}
      <SourceFooter source={sourceLabel} asOf={asOfLabel} />
    </MacroStatCard>
  );
}
