"use client";

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMakroI18n, type MakroKey } from "@/components/makro/i18n";
import { MACRO_QUERY_ROOT } from "@/components/makro/queries";
import { MacroSection } from "@/components/makro/ui";
import { KpiStrip } from "@/components/makro/KpiStrip";
import { CorridorPanel, PolicyInflationPanel } from "@/components/makro/MonetaryPolicy";
import { InflationTiles, InflationTrendPanel, MonthlyCpiPanel } from "@/components/makro/InflationSection";
import { ACTIVITY_KEYS, EXTERNAL_KEYS, IndicatorGrid } from "@/components/makro/IndicatorGrid";
import { MarketsSection } from "@/components/makro/MarketsSection";
import { EconomicCalendar } from "@/components/makro/EconomicCalendar";

const SECTIONS: Array<{ id: string; title: MakroKey }> = [
  { id: "para-politikasi", title: "section.monetary" },
  { id: "enflasyon", title: "section.inflation" },
  { id: "buyume", title: "section.activity" },
  { id: "dis-denge", title: "section.external" },
  { id: "piyasalar", title: "section.markets" },
  { id: "takvim", title: "section.calendar" },
];

function RefreshButton() {
  const { t } = useMakroI18n();
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: MACRO_QUERY_ROOT }) > 0;
  return (
    <button
      type="button"
      onClick={() => void queryClient.invalidateQueries({ queryKey: MACRO_QUERY_ROOT })}
      disabled={fetching}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", fetching && "animate-spin")} aria-hidden="true" />
      {fetching ? t("page.refreshing") : t("page.refresh")}
    </button>
  );
}

function SectionNav() {
  const { t } = useMakroI18n();
  return (
    <nav aria-label={t("page.sections")} className="-mx-1 overflow-x-auto scrollbar-none">
      <ul className="flex w-max gap-1 px-1">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t(section.title)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function MakroPage() {
  const { t } = useMakroI18n();

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-6">
      <div className="space-y-3">
        <PageHeader eyebrow={t("page.eyebrow")} title={t("page.title")} description={t("page.description")} actions={<RefreshButton />} />
        <SectionNav />
      </div>

      <KpiStrip />

      <MacroSection id="para-politikasi" title={t("section.monetary")} description={t("section.monetary.desc")}>
        {/* Panels stretch to one row height; the chart grows to fill it. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CorridorPanel />
          <PolicyInflationPanel className="lg:col-span-2" />
        </div>
      </MacroSection>

      <MacroSection id="enflasyon" title={t("section.inflation")} description={t("section.inflation.desc")}>
        <InflationTiles />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <InflationTrendPanel className="lg:col-span-2" />
          <MonthlyCpiPanel />
        </div>
      </MacroSection>

      <MacroSection id="buyume" title={t("section.activity")} description={t("section.activity.desc")}>
        <IndicatorGrid keys={ACTIVITY_KEYS} label={t("section.activity")} />
      </MacroSection>

      <MacroSection id="dis-denge" title={t("section.external")} description={t("section.external.desc")}>
        <IndicatorGrid keys={EXTERNAL_KEYS} label={t("section.external")} />
      </MacroSection>

      <MacroSection id="piyasalar" title={t("section.markets")} description={t("section.markets.desc")}>
        <MarketsSection />
      </MacroSection>

      <MacroSection id="takvim" title={t("section.calendar")} description={t("section.calendar.desc")}>
        <EconomicCalendar />
      </MacroSection>
    </div>
  );
}
