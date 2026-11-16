"use client";

import { Tile, TileGroup, Workspace, WorkspaceControls, WorkspaceGrid } from "@/components/workspace/Workspace";
import { useLocale } from "@/lib/locale-context";
import { IndexChartCard } from "./IndexChartCard";
import { LatestEventsCard } from "./LatestEventsCard";
import { MarketBreadthCard } from "./MarketBreadthCard";
import { MarketHeader } from "./MarketHeader";
import { WatchlistCard } from "./WatchlistCard";

/** The home page's cards, which the visitor can rearrange and resize. */
export function DashboardView() {
  const { t } = useLocale();
  return (
    <Workspace
      page="home"
      storageKey="hisse.dashboard.layout"
      cards={{
        // Shorter than this, the chart's own controls leave no room for the plot.
        index: { label: "BIST 100", minW: 3, minH: 15 },
        watchlist: { label: t("dashboard.watchlist"), minH: 8 },
        breadth: { label: t("dashboard.breadth"), minH: 8 },
        events: { label: t("dashboard.latestDevelopments"), minH: 6 },
      }}
    >
      <MarketHeader actions={<WorkspaceControls />} />

      <WorkspaceGrid className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <Tile id="index" className="lg:col-span-2">
          <IndexChartCard />
        </Tile>
        {/* Spans both rows. The second row is 1fr, so a long watchlist lengthens that row, never the chart's. */}
        <TileGroup className="flex min-w-0 flex-col gap-4 lg:row-span-2">
          <Tile id="watchlist">
            <WatchlistCard />
          </Tile>
          <Tile id="breadth" className="grow">
            <MarketBreadthCard />
          </Tile>
        </TileGroup>
        <Tile id="events" className="lg:col-span-2 lg:self-start">
          <LatestEventsCard />
        </Tile>
      </WorkspaceGrid>
    </Workspace>
  );
}
