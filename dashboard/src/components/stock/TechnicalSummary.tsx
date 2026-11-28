"use client";

import { useSignals } from "./hooks";
import { cn } from "@/lib/utils";
import { useSlotted } from "@/components/workspace/panel";
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
    <div className="flex flex-col rounded-md border border-border bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-xs font-semibold text-foreground">{label}</h3>
        {group ? <SignalBadge level={group.level} raw={group.raw} size="md" className="shrink-0" /> : null}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      <div className="mt-auto pt-3">
        {group ? (
          <VoteBar buy={group.buy} neutral={group.neutral} sell={group.sell} />
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("tech.noGroup")}</p>
        )}
      </div>
    </div>
  );
}

/** TradingView daily technical summary: overall, oscillators and moving averages votes. */
export function TechnicalSummary({ ticker }: { ticker: string }) {
  const slotted = useSlotted();
  const { t } = useStockI18n();
  const signalsQ = useSignals(ticker);
  const signals = signalsQ.data ?? null;

  return (
    <SectionCard title={t("tech.summaryTitle")} footer={t("tech.summaryFooter")}>
      {signalsQ.isPending ? (
        <SectionSkeleton rows={3} />
      ) : signalsQ.isError ? (
        <SectionError error={signalsQ.error} onRetry={() => void signalsQ.refetch()} />
      ) : !signals ? (
        <SectionEmpty message={t("tech.empty")} />
      ) : (
        <div className="@container">
          <div className={cn("grid grid-cols-1 gap-3", slotted ? "@xl:grid-cols-3" : "@4xl:grid-cols-3")}>
            {GROUPS.map((group) => (
              <GroupTile key={group.key} label={t(group.label)} hint={t(group.hint)} group={signals[group.key]} />
            ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
