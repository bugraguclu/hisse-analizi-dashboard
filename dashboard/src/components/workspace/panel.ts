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
  /**
   * Tells the slot how much room its card leaves unused, in pixels (negative
   * when the content overflows and scrolls). `null` while that is unknown.
   */
  reportSpare: (spare: number | null) => void;
}>;

const NATURAL: PanelState = { fill: false, columns: 0, rows: 0, reportSpare: () => {} };
const PanelContext = createContext<PanelState>(NATURAL);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelState {
  return useContext(PanelContext);
}

/**
 * Marks loading placeholders and error messages: content that stands in for
 * the real thing and says nothing about how tall the card will be.
 */
export const TRANSIENT = { "data-transient": "" } as const;

/** Wraps everything a card's scrolling body shows, so its full height can be read. */
export const PANEL_CONTENT = { "data-panel-content": "" } as const;

/**
 * Ref for the scrolling body of a card whose content has an end (a list, a
 * table, a set of figures). The body holds one element marked `PANEL_CONTENT`,
 * whose children are the content. In a layout slot the body reports the room
 * that content leaves unused, so the slot is never taller than the card can fill.
 */
export function usePanelBody() {
  const { fill, reportSpare } = usePanel();
  return useCallback((body: HTMLElement | null) => {
    if (!body || !fill) return;
    const content = body.querySelector<HTMLElement>(":scope > [data-panel-content]");
    if (!content) return;
    const measure = () => {
      if (content.querySelector("[data-transient]")) {
        reportSpare(null);
        return;
      }
      const style = getComputedStyle(body);
      let used = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      for (const child of content.children) used += (child as HTMLElement).offsetHeight;
      reportSpare(body.clientHeight - used);
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(body);
      for (const child of content.children) resize.observe(child);
    };
    // The wrapper is at least as tall as the body, so its children are what changes size.
    const swap = new MutationObserver(() => {
      watch();
      measure();
    });
    watch();
    measure();
    swap.observe(content, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      swap.disconnect();
      reportSpare(null);
    };
  }, [fill, reportSpare]);
}

/** The size of an element in a layout slot, followed live while the card is resized. */
export function usePanelSize() {
  const { fill } = usePanel();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element || !fill) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fill]);
  return [ref, fill ? size : null] as const;
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
  const [ref, size] = usePanelSize();
  return [ref, size ? Math.max(1, Math.floor((size.height - reserve) / rowHeight)) : natural] as const;
}
