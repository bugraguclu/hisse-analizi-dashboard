"use client";

import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { HeadingWidget, NoteWidget } from "./basic";
import type { WidgetComponentProps, WidgetComponents } from "./types";

export type { WidgetComponentProps, WidgetComponents };

/**
 * Every widget, for cards a page doesn't bundle itself (a macro panel added to
 * a stock page, anything on a custom page). Each category's cards load on
 * demand and only in the browser: a lazily hydrated card could otherwise meet
 * data the rest of the page already fetched and render differently from the
 * server's HTML. Site pages pass their own cards (`components` on the board),
 * which render on the server as before.
 */

/** Stand-in while a card's code loads: a card-shaped skeleton. */
function Loading() {
  return (
    <div aria-hidden className="card-surface flex min-h-48 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-3.5 p-4">
        {[46, 62, 38].map((width) => (
          <Skeleton key={width} className="h-3" style={{ width: `${width}%` }} />
        ))}
      </div>
    </div>
  );
}

type Loader = () => Promise<WidgetComponents>;

function lazyWidget(load: Loader, type: string): ComponentType<WidgetComponentProps> {
  return dynamic(
    () =>
      load().then((widgets) => {
        const Widget = widgets[type];
        return function LazyWidget(props: WidgetComponentProps) {
          return <Widget {...props} />;
        };
      }),
    { ssr: false, loading: Loading },
  );
}

const stock: Loader = () => import("./stock-widgets").then((m) => m.STOCK_WIDGETS);
const market: Loader = () => import("./market-widgets").then((m) => m.MARKET_WIDGETS);
const macro: Loader = () => import("./macro-widgets").then((m) => m.MACRO_WIDGETS);

const LAZY_TYPES: ReadonlyArray<[Loader, readonly string[]]> = [
  [
    stock,
    [
      "stock.quote",
      "stock.chart",
      "stock.scorecard",
      "stock.analysts",
      "stock.kap",
      "stock.news",
      "stock.ratios",
      "stock.signals",
      "stock.sector",
      "stock.similar",
      "stock.dividends",
      "stock.earnings",
      "stock.statements",
      "stock.profile",
      "stock.holders",
      "stock.technicalSummary",
      "stock.movingAverages",
      "stock.indicators",
      "stock.pivots",
    ],
  ],
  [market, ["market.index", "market.watchlist", "market.breadth", "market.events"]],
  [
    macro,
    [
      "macro.kpis",
      "macro.corridor",
      "macro.policyInflation",
      "macro.inflationTiles",
      "macro.inflationTrend",
      "macro.monthlyCpi",
      "macro.markets",
      "macro.fxBulletin",
      "macro.calendar",
      "macro.activity",
      "macro.external",
    ],
  ],
];

export const LAZY_WIDGETS: WidgetComponents = {
  ...Object.fromEntries(LAZY_TYPES.flatMap(([load, types]) => types.map((type) => [type, lazyWidget(load, type)]))),
  "general.heading": ({ options }) => <HeadingWidget options={options} />,
  "general.note": ({ options }) => <NoteWidget options={options} />,
};
