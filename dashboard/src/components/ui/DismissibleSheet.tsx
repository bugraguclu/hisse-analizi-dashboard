"use client";

import { useEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/hooks/use-motion-allowed";
import { cn } from "@/lib/utils";
import { evaluateSheetDragStart, shouldDismissSheet } from "./dismissible-sheet";

const INTERACTIVE_CONTROLS =
  'input, textarea, select, button:not([data-sheet-handle]), a, label, summary, [contenteditable="true"], [role="slider"], [role="listbox"], [role="menu"], [data-swipe-ignore]';

/**
 * Visual grabber handle for mobile bottom sheets. Meets touch target size guidelines and can be
 * tapped or pulled down to dismiss.
 */
export function SheetHandle({
  onClose,
  label,
  disabled = false,
  className,
}: {
  onClose: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-sheet-handle=""
      aria-label={label}
      onClick={onClose}
      disabled={disabled}
      className={cn(
        "flex w-full shrink-0 touch-none select-none items-center justify-center py-2.5 text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring disabled:cursor-default pointer-coarse:min-h-11",
        className,
      )}
    >
      <span aria-hidden="true" className="h-1 w-9 rounded-full bg-current" />
    </button>
  );
}

interface GestureState {
  kind: "touch" | "pointer";
  id: number;
  x: number;
  y: number;
  distance: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  dragging: boolean;
}

/**
 * Separates a sheet's pull-down dismiss gesture from inner scrolling and form interaction.
 * Adapted from Yemek Takibi's `useSheetDismiss` so scrolling inside search results or filter
 * forms never dismisses the sheet by accident.
 */
export function useSheetDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void | Promise<void>,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    element.setAttribute("data-dismiss-sheet", "");
    let gesture: GestureState | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressUntil = 0;
    let mounted = true;

    const reset = () => {
      clearTimeout(timer);
      gesture = null;
      element.removeAttribute("data-sheet-state");
      element.style.removeProperty("--sheet-offset");
    };

    const settle = () => {
      gesture = null;
      element.dataset.sheetState = "settling";
      element.style.setProperty("--sheet-offset", "0px");
      clearTimeout(timer);
      timer = setTimeout(reset, prefersReducedMotion() ? 0 : 260);
    };

    const canStart = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element) || target.closest("[data-dismiss-sheet]") !== element) return false;
      const control = target.closest(INTERACTIVE_CONTROLS);
      if (element.dataset.sheetState === "dismissing" || (control && element.contains(control))) return false;
      if (target.closest('dialog, [role="dialog"]') !== element.closest('dialog, [role="dialog"]')) return false;
      for (let node: Element | null = target; node && node !== element; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/auto|scroll/.test(style.overflowY) && node.scrollTop > 1) return false;
        if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return false;
      }
      // The sheet may sit inside its own scroll container (e.g. the mobile search overlay).
      // If that container is scrolled down, a downward drag means "scroll back up", not "dismiss".
      const boundary = element.closest('dialog, [role="dialog"]');
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollTop > 1) return false;
        if (node === boundary) break;
      }
      return true;
    };

    const start = (point: { clientX: number; clientY: number }, kind: "touch" | "pointer", id: number) => {
      reset();
      suppressUntil = 0;
      gesture = {
        kind,
        id,
        x: point.clientX,
        y: point.clientY,
        distance: 0,
        lastY: point.clientY,
        lastTime: performance.now(),
        velocity: 0,
        dragging: false,
      };
    };

    const move = (point: { clientX: number; clientY: number }, event: Event) => {
      if (!gesture) return;
      const dx = point.clientX - gesture.x;
      const dy = point.clientY - gesture.y;
      if (!gesture.dragging) {
        const decision = evaluateSheetDragStart(dx, dy, event.cancelable);
        if (decision === "pending") return;
        if (decision === "reject") {
          reset();
          return;
        }
        gesture.dragging = true;
        element.dataset.sheetState = "dragging";
      }
      if (event.cancelable) event.preventDefault();
      const now = performance.now();
      gesture.velocity = (point.clientY - gesture.lastY) / Math.max(1, now - gesture.lastTime);
      gesture.lastY = point.clientY;
      gesture.lastTime = now;
      gesture.distance = Math.max(0, dy);
      element.style.setProperty("--sheet-offset", `${gesture.distance}px`);
    };

    const finish = (cancelled = false) => {
      if (!gesture) return;
      const active = gesture;
      gesture = null;
      if (!active.dragging) return;
      suppressUntil = performance.now() + 500;
      const dismiss = shouldDismissSheet({
        distance: active.distance,
        velocity: active.velocity,
        sheetHeight: element.clientHeight,
        msSinceLastMove: performance.now() - active.lastTime,
        cancelled,
      });
      if (!dismiss) {
        settle();
        return;
      }
      const distance = Math.max(
        active.distance,
        window.innerHeight - element.getBoundingClientRect().top + active.distance + 24,
      );
      element.dataset.sheetState = "dismissing";
      element.style.setProperty("--sheet-offset", `${distance}px`);
      timer = setTimeout(async () => {
        try {
          await closeRef.current?.();
        } finally {
          if (mounted && element.isConnected) settle();
        }
      }, prefersReducedMotion() ? 0 : 260);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finish(true);
        return;
      }
      if (event.target instanceof Element && event.target.closest("[data-dismiss-sheet]") === element) {
        suppressUntil = 0;
      }
      if (canStart(event.target)) {
        const touch = event.touches[0];
        start(touch, "touch", touch.identifier);
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (gesture?.kind !== "touch") return;
      if (event.touches.length !== 1) {
        finish(true);
        return;
      }
      const point = Array.from(event.touches).find((touch) => touch.identifier === gesture?.id);
      if (point) move(point, event);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (
        gesture?.kind === "touch" &&
        Array.from(event.changedTouches).some((touch) => touch.identifier === gesture?.id)
      ) {
        finish(false);
      }
    };

    const onTouchCancel = () => finish(true);

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0 || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-dismiss-sheet]") === element) suppressUntil = 0;
      if (!target.closest("[data-sheet-handle], [data-sheet-header]") || !canStart(target)) return;
      start(event, "pointer", event.pointerId);
      target.setPointerCapture?.(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (gesture?.kind === "pointer" && gesture.id === event.pointerId) move(event, event);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (gesture?.kind === "pointer" && gesture.id === event.pointerId) finish(false);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (gesture?.kind === "pointer" && gesture.id === event.pointerId) finish(true);
    };

    const onClick = (event: MouseEvent) => {
      if (event.detail > 0 && performance.now() < suppressUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const onTouchStartOutside = (event: TouchEvent) => {
      if (event.touches.length > 1) finish(true);
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd, { passive: true });
    element.addEventListener("touchcancel", onTouchCancel, { passive: true });
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);
    element.addEventListener("lostpointercapture", onPointerCancel);
    element.addEventListener("click", onClick, true);
    document.addEventListener("touchstart", onTouchStartOutside, { passive: true });

    return () => {
      mounted = false;
      reset();
      element.removeAttribute("data-dismiss-sheet");
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchCancel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
      element.removeEventListener("lostpointercapture", onPointerCancel);
      element.removeEventListener("click", onClick, true);
      document.removeEventListener("touchstart", onTouchStartOutside);
    };
  }, [ref, enabled]);
}
