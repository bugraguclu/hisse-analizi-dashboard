"use client";

import type { WidgetCategory } from "@/components/widgets/catalog";
import type { BuiltInPage } from "@/components/widgets/defaults";
import { EditLayoutButton } from "@/components/widgets/EditBar";
import { useSitePageEditor } from "@/components/widgets/use-site-page";
import { STOCK_WIDGETS } from "@/components/widgets/stock-widgets";
import { WidgetBoard, type Breakpoint } from "@/components/widgets/WidgetBoard";
import { StockShell, type StockView } from "./StockShell";

/** Stock widgets first in the gallery on the stock pages. */
const GALLERY_ORDER: readonly WidgetCategory[] = ["stock", "general", "market", "macro"];

/**
 * A stock page is a widget layout (components/widgets/defaults.ts holds the
 * site's own: what an investor needs first at the top, fundamentals before
 * technicals, the full statement tables last). "Customize" lets the visitor
 * move, resize, hide and add cards; their layout applies to every stock.
 */
function StockBoardPage({
  ticker,
  view,
  page,
  lazyFromRow,
  stackBelow = "lg",
  stackedGap,
}: {
  ticker: string;
  view: StockView;
  page: BuiltInPage;
  /** First row whose cards wait until scrolled near (where the hand-built page started its LazySections). */
  lazyFromRow: number;
  stackBelow?: Breakpoint;
  stackedGap?: number;
}) {
  const editor = useSitePageEditor(page);
  return (
    <StockShell ticker={ticker} view={view} actions={<EditLayoutButton editor={editor} compact />}>
      <WidgetBoard
        editor={editor}
        context={{ ticker, tickerOverrides: true }}
        stackBelow={stackBelow}
        stackedGap={stackedGap}
        lazyFromRow={lazyFromRow}
        galleryCategories={GALLERY_ORDER}
        components={STOCK_WIDGETS}
      />
    </StockShell>
  );
}

/** /hisse/[ticker] — overview. Below-the-fold cards mount when scrolled near. */
export function StockOverviewView({ ticker }: { ticker: string }) {
  return <StockBoardPage ticker={ticker} view="overview" page="stock.overview" lazyFromRow={3} />;
}

/** /temel/[ticker] — fundamentals. */
export function StockFundamentalView({ ticker }: { ticker: string }) {
  return <StockBoardPage ticker={ticker} view="fundamental" page="stock.fundamental" lazyFromRow={1} />;
}

/** /teknik/[ticker] — technical analysis. */
export function StockTechnicalView({ ticker }: { ticker: string }) {
  return <StockBoardPage ticker={ticker} view="technical" page="stock.technical" lazyFromRow={4} />;
}

/**
 * /analiz/[ticker] — fundamental and technical summaries side by side from xl
 * (below that the two columns stack, fundamentals first, so no card is
 * squeezed into ~450px).
 */
export function StockCombinedView({ ticker }: { ticker: string }) {
  return <StockBoardPage ticker={ticker} view="combined" page="stock.combined" lazyFromRow={1} stackBelow="xl" stackedGap={32} />;
}
