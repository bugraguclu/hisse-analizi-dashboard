import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { IndexChartCard } from "@/components/dashboard/IndexChartCard";
import { MarketBreadthCard } from "@/components/dashboard/MarketBreadthCard";
import { LatestEventsCard } from "@/components/dashboard/LatestEventsCard";
import { WatchlistCard } from "@/components/dashboard/WatchlistCard";
import { IndicesGrid } from "@/components/dashboard/IndicesGrid";
import { DashboardFooter } from "@/components/dashboard/DashboardFooter";

/** Home: market summary (BIST 100 + breadth/movers), latest KAP events, watchlist and all indices. */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <MarketHeader />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <IndexChartCard className="lg:col-span-2" />
        <MarketBreadthCard />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <LatestEventsCard className="lg:col-span-2" />
        <WatchlistCard />
      </div>

      <IndicesGrid />

      <DashboardFooter />
    </div>
  );
}
