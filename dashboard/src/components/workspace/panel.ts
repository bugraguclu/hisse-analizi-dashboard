"use client";

import { createContext, useCallback, useContext, useState } from "react";

/** The slot a card occupies on a customized page. */
export type PanelState = Readonly<{
  /** The card has a fixed size to fill: its body scrolls and its lists show what fits. */
  fill: boolean;
  /** Slot width in grid columns (0 on a page that keeps its default layout). */
  columns: number;
  /** Slot height in grid rows (0 on a page that keeps its default layout). */
  rows: number;
}>;

const NATURAL: PanelState = { fill: false, columns: 0, rows: 0 };
const PanelContext = createContext<PanelState>(NATURAL);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelState {
  return useContext(PanelContext);
}

/**
 * How many rows of a known height to show. A card in its default place shows
 * `natural` rows; a card that fills a slot shows as many as its body has room
 * for, so making the card taller lengthens the list. Attach the returned ref
 * to the element whose height is the room available.
 *
 * `reserve` is the height taken by anything else inside that element.
 */
export function useFitCount(rowHeight: number, natural: number, reserve = 0) {
  const { fill } = usePanel();
  const [fit, setFit] = useState<number | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element || !fill) return;
    const measure = () => setFit(Math.max(1, Math.floor((element.clientHeight - reserve) / rowHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill, rowHeight, reserve]);
  return [ref, fill && fit !== null ? fit : natural] as const;
}
