import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { IndexChartCard } from "@/components/dashboard/IndexChartCard";
import { MarketBreadthCard } from "@/components/dashboard/MarketBreadthCard";
import { LatestEventsCard } from "@/components/dashboard/LatestEventsCard";
import { WatchlistCard } from "@/components/dashboard/WatchlistCard";

/** Home: BIST 100 chart with breadth/movers, then the latest KAP events and the watchlist. */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <MarketHeader />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <IndexChartCard className="lg:col-span-2" />
        <MarketBreadthCard />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <LatestEventsCard className="lg:col-span-2" />
        <WatchlistCard />
      </div>
    </div>
  );
}
