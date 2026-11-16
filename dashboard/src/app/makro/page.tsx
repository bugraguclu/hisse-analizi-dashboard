"use client";

import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Hourglass, RefreshCw } from "lucide-react";
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
import { Tile, TileGroup, Workspace, WorkspaceControls, WorkspaceGrid } from "@/components/workspace/Workspace";
import { motionScrollBehavior } from "@/hooks/use-motion-allowed";

/**
 * Page order, most important for an investor first: the policy rate and
 * inflation drive valuations, markets and the release calendar move every day,
 * growth and the external balance change slowly.
 */
const SECTIONS: Array<{ id: string; title: MakroKey }> = [
  { id: "para-politikasi", title: "section.monetary" },
  { id: "enflasyon", title: "section.inflation" },
  { id: "piyasalar", title: "section.markets" },
  { id: "takvim", title: "section.calendar" },
  { id: "buyume", title: "section.activity" },
  { id: "dis-denge", title: "section.external" },
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
      aria-busy={fetching}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {fetching ? <Hourglass className="h-3.5 w-3.5" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
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
              onClick={(event) => {
                // On a page the visitor arranged, a section is no longer a box: go to its first card.
                const target = document.getElementById(section.id);
                if (!target || target.getClientRects().length > 0) return;
                event.preventDefault();
                target.querySelector("[data-tile]")?.scrollIntoView({ behavior: motionScrollBehavior(), block: "start" });
              }}
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
    <Workspace
      page="macro"
      cards={{
        // Strips, tile grids and the markets and calendar blocks are as tall as their content:
        // they can be moved, and stay full width because their columns follow the screen.
        kpi: { label: t("kpi.label"), hug: true, minW: 6 },
        // Rates and the last decisions: a fixed set of figures, as tall as they are.
        corridor: { label: t("mp.corridor"), hug: true },
        policy: { label: t("mp.chartTitle"), minW: 3, minH: 12 },
        inflation: { label: t("section.inflation"), hug: true, minW: 6 },
        trend: { label: t("inf.trendTitle"), minW: 3, minH: 10 },
        monthly: { label: t("inf.monthlyTitle"), minH: 8 },
        markets: { label: t("section.markets"), hug: true, minW: 6 },
        calendar: { label: t("section.calendar"), hug: true, minW: 6 },
        activity: { label: t("section.activity"), hug: true, minW: 6 },
        external: { label: t("section.external"), hug: true, minW: 6 },
      }}
    >
      <div className="mx-auto max-w-7xl space-y-8 pb-6">
        <div className="space-y-3">
          <PageHeader
            eyebrow={t("page.eyebrow")}
            title={t("page.title")}
            actions={
              <>
                <WorkspaceControls />
                <RefreshButton />
              </>
            }
          />
          <SectionNav />
        </div>

        <WorkspaceGrid className="space-y-8">
          <Tile id="kpi">
            <KpiStrip />
          </Tile>

          <MacroSection id="para-politikasi" title={t("section.monetary")}>
            {/* Panels stretch to one row height; the chart grows to fill it. */}
            <TileGroup className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Tile id="corridor">
                <CorridorPanel />
              </Tile>
              <Tile id="policy" className="lg:col-span-2">
                <PolicyInflationPanel />
              </Tile>
            </TileGroup>
          </MacroSection>

          <MacroSection id="enflasyon" title={t("section.inflation")}>
            <Tile id="inflation">
              <InflationTiles />
            </Tile>
            <TileGroup className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Tile id="trend" className="lg:col-span-2">
                <InflationTrendPanel />
              </Tile>
              <Tile id="monthly">
                <MonthlyCpiPanel />
              </Tile>
            </TileGroup>
          </MacroSection>

          <MacroSection id="piyasalar" title={t("section.markets")}>
            <Tile id="markets">
              <MarketsSection />
            </Tile>
          </MacroSection>

          <MacroSection id="takvim" title={t("section.calendar")}>
            <Tile id="calendar">
              <EconomicCalendar />
            </Tile>
          </MacroSection>

          <MacroSection id="buyume" title={t("section.activity")}>
            <Tile id="activity">
              <IndicatorGrid keys={ACTIVITY_KEYS} label={t("section.activity")} />
            </Tile>
          </MacroSection>

          <MacroSection id="dis-denge" title={t("section.external")}>
            <Tile id="external">
              <IndicatorGrid keys={EXTERNAL_KEYS} label={t("section.external")} />
            </Tile>
          </MacroSection>
        </WorkspaceGrid>
      </div>
    </Workspace>
  );
}
