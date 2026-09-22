"use client";

import { Gauge } from "lucide-react";
import { useSignals } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import type { SignalGroup } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, SignalBadge, VoteBar } from "./ui";

const GROUPS: Array<{ key: "summary" | "oscillators" | "movingAverages"; label: StockKey; hint: StockKey }> = [
  { key: "summary", label: "tech.summary", hint: "tech.summaryHint" },
  { key: "oscillators", label: "tech.oscillators", hint: "tech.oscillatorsHint" },
  { key: "movingAverages", label: "tech.movingAverages", hint: "tech.movingAveragesHint" },
];

function GroupTile({ label, hint, group }: { label: string; hint: string; group: SignalGroup | null }) {
  const { t } = useStockI18n();
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{label}</h3>
        {group ? <SignalBadge level={group.level} raw={group.raw} size="md" /> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      {group ? (
        <VoteBar buy={group.buy} neutral={group.neutral} sell={group.sell} className="mt-3" />
      ) : (
        <p className="mt-3 text-[11px] text-muted-foreground">{t("tech.noGroup")}</p>
      )}
    </div>
  );
}

/** TradingView daily technical summary: overall, oscillators and moving averages votes. */
export function TechnicalSummary({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const signalsQ = useSignals(ticker);
  const signals = signalsQ.data ?? null;

  return (
    <SectionCard title={t("tech.summaryTitle")} icon={<Gauge />} footer={t("tech.summaryFooter")}>
      {signalsQ.isPending ? (
        <SectionSkeleton rows={3} />
      ) : signalsQ.isError ? (
        <SectionError error={signalsQ.error} onRetry={() => void signalsQ.refetch()} />
      ) : !signals ? (
        <SectionEmpty message={t("tech.empty")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {GROUPS.map((group) => (
            <GroupTile key={group.key} label={t(group.label)} hint={t(group.hint)} group={signals[group.key]} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
