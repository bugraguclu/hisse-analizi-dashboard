"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type Ref, type RefObject } from "react";
import { useLocale } from "@/lib/locale-context";
import { TickerSearch, type TickerSearchHandle } from "../TickerSearch";

/**
 * The small-screen search sheet (below md), after the belif site's overlay:
 *
 * - Non-modal and starts where the header ends, so the header stays usable; a
 *   press on it closes the sheet on the way past (the trigger excepted — its own
 *   click toggles, or the press would close and the click reopen it).
 * - Everything outside the panel dismisses, but only when both ends of the press
 *   land outside, so selecting text in the field and releasing over the veil
 *   does not close it.
 * - Escape closes; Tab stays inside (the rows, the field, the ✕).
 * - The page behind does not scroll while it is open.
 *
 * `onClose` owns focus: it hands focus back to where the search was opened from.
 */
export function SearchOverlay({
  id,
  onClose,
  triggerRef,
  searchRef,
}: {
  id: string;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  searchRef?: Ref<TickerSearchHandle>;
}) {
  const { t } = useLocale();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedOutside = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Measured rather than hard-coded, so the sheet follows the header if it changes.
  useLayoutEffect(() => {
    function syncTop() {
      const header = triggerRef.current?.closest("header");
      const bottom = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
      if (bottom > 0) overlayRef.current?.style.setProperty("--search-top", `${bottom}px`);
    }
    syncTop();
    window.addEventListener("resize", syncTop);
    return () => window.removeEventListener("resize", syncTop);
  }, [triggerRef]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (overlayRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeRef.current();
    }
    document.addEventListener("pointerdown", handlePointerDown);

    // md:hidden — widening the viewport (rotating a tablet) would hide the sheet
    // while the page stays scroll-locked, so close it instead.
    const wide = window.matchMedia("(min-width: 48rem)");
    function handleViewportChange() {
      if (wide.matches) closeRef.current();
    }
    wide.addEventListener("change", handleViewportChange);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("pointerdown", handlePointerDown);
      wide.removeEventListener("change", handleViewportChange);
    };
  }, [triggerRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab" || !overlayRef.current) return;
    // Without this Tab runs out of the sheet into the page behind the veil.
    const stops = Array.from(overlayRef.current.querySelectorAll<HTMLElement>("input, button"));
    if (stops.length === 0) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
    event.preventDefault();
    stops[next].focus();
  }

  return (
    <div
      ref={overlayRef}
      id={id}
      role="dialog"
      aria-label={t("search.label")}
      onKeyDown={handleKeyDown}
      className="fixed inset-x-0 bottom-0 top-[var(--search-top,57px)] z-40 md:hidden"
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/40 dark:bg-black/60" />
      <div
        className="relative h-full overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-8 pt-3"
        onPointerDown={(event) => {
          pressedOutside.current = !panelRef.current?.contains(event.target as Node);
        }}
        onClick={(event) => {
          if (pressedOutside.current && !panelRef.current?.contains(event.target as Node)) closeRef.current();
          pressedOutside.current = false;
        }}
      >
        <div ref={panelRef} className="mx-auto max-w-2xl">
          <TickerSearch ref={searchRef} variant="overlay" autoFocus onClose={() => closeRef.current()} />
        </div>
      </div>
    </div>
  );
}
