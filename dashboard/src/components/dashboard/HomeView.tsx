"use client";

import type { WidgetCategory } from "@/components/widgets/catalog";
import { EditLayoutButton } from "@/components/widgets/EditBar";
import { useSitePageEditor } from "@/components/widgets/use-site-page";
import { MARKET_WIDGETS } from "@/components/widgets/market-widgets";
import { WidgetBoard } from "@/components/widgets/WidgetBoard";
import { MarketHeader } from "./MarketHeader";

const GALLERY_ORDER: readonly WidgetCategory[] = ["market", "stock", "macro", "general"];

/**
 * Home, most important first: the BIST 100 with the latest KAP disclosures
 * under it, beside the visitor's watchlist over market breadth (the default
 * layout in components/widgets/defaults.ts). "Customize" makes it theirs.
 */
export function HomeView() {
  const editor = useSitePageEditor("home");
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <MarketHeader actions={<EditLayoutButton editor={editor} />} />
      <WidgetBoard editor={editor} context={{ ticker: null, tickerOverrides: true }} components={MARKET_WIDGETS} galleryCategories={GALLERY_ORDER} />
    </div>
  );
}
