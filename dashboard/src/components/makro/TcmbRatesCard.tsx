"use client";

import { Landmark } from "lucide-react";
import { formatPercent, formatMarketDate } from "@/lib/format";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { MacroStatCard, SourceFooter } from "./MacroStatCard";

export interface TcmbRateRow {
  type?: unknown;
  date?: unknown;
  borrowing?: unknown;
  lending?: unknown;
}

export interface TcmbData {
  source?: string;
  data?: TcmbRateRow[];
}

const LABELS: Record<string, Record<Locale, string>> = {
  title: { tr: "TCMB Faiz Oranları", en: "CBRT Interest Rates", fr: "Taux d'intérêt CBRT" },
  policyRate: { tr: "Politika Faizi (Haftalık Repo)", en: "Policy Rate (Weekly Repo)", fr: "Taux directeur (Repo hebdo.)" },
  corridor: { tr: "Faiz Koridoru", en: "Interest Rate Corridor", fr: "Corridor de taux" },
  overnightBorrowing: { tr: "Gecelik Borç Alma (taban)", en: "Overnight Borrowing (floor)", fr: "Emprunt au jour le jour (plancher)" },
  overnightLending: { tr: "Gecelik Borç Verme (tavan)", en: "Overnight Lending (ceiling)", fr: "Prêt au jour le jour (plafond)" },
  lateLiquidity: { tr: "Geç Likidite Penceresi", en: "Late Liquidity Window", fr: "Fenêtre de liquidité tardive" },
  lateLiquidityBorrowing: { tr: "Borç Alma", en: "Borrowing", fr: "Emprunt" },
  lateLiquidityLending: { tr: "Borç Verme", en: "Lending", fr: "Prêt" },
};

export function TcmbRatesCard({
  data,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  noDataLabel,
}: {
  data: TcmbData | null | undefined;
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  noDataLabel: string;
}) {
  const { locale } = useLocale();
  const L = (key: keyof typeof LABELS) => LABELS[key][locale];

  const rows = Array.isArray(data?.data) ? data!.data! : [];
  const policy = rows.find((r) => r.type === "policy");
  const overnight = rows.find((r) => r.type === "overnight");
  const lateLiquidity = rows.find((r) => r.type === "late_liquidity");
  const asOfDate = policy?.date ?? overnight?.date ?? rows[0]?.date;

  return (
    <MacroStatCard title={L("title")} icon={Landmark} isLoading={isLoading} isError={isError} errorMessage={errorMessage} onRetry={onRetry}>
      {rows.length === 0 ? (
        <EmptyState message={noDataLabel} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-primary/5 rounded-xl p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{L("policyRate")}</div>
              <div className="text-xl font-bold font-mono text-primary">
                {typeof policy?.lending === "number" ? formatPercent(policy.lending) : "-"}
              </div>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{L("overnightBorrowing")}</div>
              <div className="text-lg font-bold font-mono text-foreground">
                {typeof overnight?.borrowing === "number" ? formatPercent(overnight.borrowing) : "-"}
              </div>
            </div>
            <div className="bg-muted/30 rounded-xl p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{L("overnightLending")}</div>
              <div className="text-lg font-bold font-mono text-foreground">
                {typeof overnight?.lending === "number" ? formatPercent(overnight.lending) : "-"}
              </div>
            </div>
          </div>

          {lateLiquidity && (typeof lateLiquidity.borrowing === "number" || typeof lateLiquidity.lending === "number") && (
            <div className="mt-3 flex items-center justify-between py-2.5 border-t border-border/30 text-xs">
              <span className="text-muted-foreground">{L("lateLiquidity")}</span>
              <span className="font-mono text-foreground space-x-3">
                {typeof lateLiquidity.borrowing === "number" && (
                  <span>{L("lateLiquidityBorrowing")}: {formatPercent(lateLiquidity.borrowing)}</span>
                )}
                {typeof lateLiquidity.lending === "number" && (
                  <span>{L("lateLiquidityLending")}: {formatPercent(lateLiquidity.lending)}</span>
                )}
              </span>
            </div>
          )}

          <SourceFooter source={data?.source} asOf={typeof asOfDate === "string" ? formatMarketDate(asOfDate, "date") : null} />
        </>
      )}
    </MacroStatCard>
  );
}
