"use client";

import { IndexChartCard } from "@/components/dashboard/IndexChartCard";
import { LatestEventsCard } from "@/components/dashboard/LatestEventsCard";
import { MarketBreadthCard } from "@/components/dashboard/MarketBreadthCard";
import { WatchlistCard } from "@/components/dashboard/WatchlistCard";
import type { WidgetComponents } from "./types";

/** The home page cards, bundled with the home page. */
export const MARKET_WIDGETS: WidgetComponents = {
  "market.index": () => <IndexChartCard />,
  "market.watchlist": () => <WatchlistCard />,
  "market.breadth": () => <MarketBreadthCard />,
  "market.events": () => <LatestEventsCard />,
};
