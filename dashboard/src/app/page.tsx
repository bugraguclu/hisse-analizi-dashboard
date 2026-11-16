import { DashboardWorkspace } from "@/components/dashboard/DashboardWorkspace";

/**
 * Home, most important first: the BIST 100, the visitor's watchlist, market
 * breadth with the day's movers, then the latest KAP disclosures. From lg the
 * watchlist and breadth form a column beside the chart and the disclosures;
 * phones stack the four cards in that same order.
 */
export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <DashboardWorkspace />
    </div>
  );
}
