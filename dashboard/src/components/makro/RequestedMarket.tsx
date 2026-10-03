"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { MARKET_PARAM } from "./links";
import { useMarkets } from "./queries";

/** How long a page opened by the link keeps the chart in place while the page around it loads. */
const HOLD_MS = 4000;
/** Any of these means the reader has taken over the scroll position. */
const TAKEOVER_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Brings `target` to the top of the screen. When the page was opened by the link it jumps,
 * then keeps the target there while the page is still growing: panels above it change height
 * as they load (Safari has no scroll anchoring), and on a phone the first jump can fall short
 * because the sections below are not in yet. A link followed on this page glides there instead.
 */
function reveal(target: HTMLElement, arrival: boolean) {
  const glide = !arrival && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "start", behavior: glide ? "smooth" : "instant" });
  if (!arrival) return;
  const observer = new ResizeObserver(() => target.scrollIntoView({ block: "start", behavior: "instant" }));
  const stop = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, stop, true);
  };
  const timer = window.setTimeout(stop, HOLD_MS);
  for (const type of TAKEOVER_EVENTS) window.addEventListener(type, stop, { capture: true, passive: true });
  observer.observe(document.body);
}

/**
 * `/makro?piyasa=<key>` (the market strip's links): selects that instrument and brings the
 * chart (`targetRef`) into view, then drops the parameter so the next link to the same
 * instrument is a navigation again. Renders nothing; needs a Suspense boundary (search params).
 */
export function RequestedMarket({
  onSelect,
  targetRef,
}: {
  onSelect: (key: string) => void;
  targetRef: RefObject<HTMLElement | null>;
}) {
  const requested = useSearchParams().get(MARKET_PARAM);
  const instruments = useMarkets().data?.instruments;
  /** Whether the page was opened with a request (jump) rather than sent one later (glide). */
  const entry = useRef<boolean | null>(null);
  const handled = useRef<string | null>(null);

  // Layout effect: on arrival the chart is in place before the first paint.
  useLayoutEffect(() => {
    entry.current ??= requested !== null;
    if (requested === null) {
      handled.current = null;
      return;
    }
    // A link opened in a new tab waits for the quote list; a repeated run (Strict Mode) is a no-op.
    if (!instruments || handled.current === requested) return;
    handled.current = requested;
    const arrival = entry.current;
    entry.current = false;
    if (instruments.some((quote) => quote.key === requested)) {
      onSelect(requested);
      if (targetRef.current) reveal(targetRef.current, arrival);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(MARKET_PARAM);
    // `null` state keeps Next.js's router in sync (native history integration).
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [requested, instruments, onSelect, targetRef]);

  return null;
}
