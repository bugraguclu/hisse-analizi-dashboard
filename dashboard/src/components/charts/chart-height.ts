"use client";

import { createContext, useContext } from "react";

/** Plot heights (main pane, px) of the chart cards as the pages show them. */
export const CARD_CHART_HEIGHT = { stock: 300, stockTechnical: 340, index: 240 } as const;

/** The smallest plot a card is squeezed to; below that the card scrolls. */
export const MIN_CARD_CHART_HEIGHT = 160;

/**
 * Plot height set from outside the card: a widget given a fixed height grows
 * or shrinks its chart to fit (components/widgets). null = the card's own.
 */
export const ChartHeightContext = createContext<number | null>(null);

export function useCardChartHeight(base: number): number {
  return useContext(ChartHeightContext) ?? base;
}
