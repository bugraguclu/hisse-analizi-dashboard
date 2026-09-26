import { MarketHeader } from "@/components/dashboard/MarketHeader";
import { IndexChartCard } from "@/components/dashboard/IndexChartCard";
import { MarketBreadthCard } from "@/components/dashboard/MarketBreadthCard";
import { LatestEventsCard } from "@/components/dashboard/LatestEventsCard";
import { WatchlistCard } from "@/components/dashboard/WatchlistCard";

/**
 * Home, most important first: the BIST 100, the visitor's watchlist, market
 * breadth with the day's movers, then the latest KAP disclosures. From lg the
 * watchlist and breadth form a column beside the chart and the disclosures;
 * phones stack the four cards in that same order.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <MarketHeader />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <IndexChartCard className="lg:col-span-2" />
        {/* Spans both rows. The second row is 1fr, so a long watchlist lengthens that row, never the chart's. */}
        <div className="flex min-w-0 flex-col gap-4 lg:row-span-2">
          <WatchlistCard />
          <MarketBreadthCard className="grow" />
        </div>
        <LatestEventsCard className="lg:col-span-2 lg:self-start" />
      </div>
    </div>
  );
}
