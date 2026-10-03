"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { TONE_BG, type Tone } from "./tone";

/**
 * Shared tooltip primitive for the mini charts (SegmentBar, RangeGauge,
 * TargetRange, Sparkline) and the RatiosCard rows. Renders in a portal to
 * `document.body` with `position: fixed` so it always escapes a card's
 * `overflow-hidden`, flips above/below the anchor and clamps to the viewport.
 *
 * Tooltips only ever ENHANCE: the same value must be reachable without one
 * (visible text, list row, aria-label). This primitive just owns the
 * show/hide state machine and the floating box itself. There is one tooltip
 * per chart and it always belongs to the mark the user is on:
 * - mouse: entering a mark shows it, leaving hides it, entering another mark
 *   switches to that one. A click never pins, so a clicked mark can't keep its
 *   tooltip up while the pointer is on another mark or off the chart.
 * - touch / pen (no hover): a tap shows the mark, a second tap hides it, a tap
 *   on another mark switches to it.
 * - keyboard: focus shows, blur hides; leaving a hovered mark falls back to
 *   the keyboard-focused one.
 * Escape, scroll, resize and a press outside the chart dismiss it.
 */

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/** What brought the tooltip up, which decides what takes it down again. */
type TooltipSource = "hover" | "focus" | "tap";

interface ActiveTooltip {
  key: string;
  content: ReactNode;
  rect: DOMRect;
  source: TooltipSource;
}

interface FocusedMark {
  key: string;
  content: ReactNode;
  element: Element;
}

export interface ChartTooltipTriggerProps {
  tabIndex: 0;
  "aria-describedby": string | undefined;
  "data-tooltip-scope": string;
  onPointerEnter: (event: PointerEvent<Element>) => void;
  onPointerLeave: (event: PointerEvent<Element>) => void;
  onPointerDown: (event: PointerEvent<Element>) => void;
  onFocus: (event: FocusEvent<Element>) => void;
  onBlur: (event: FocusEvent<Element>) => void;
  onClick: (event: MouseEvent<Element>) => void;
  onKeyDown: (event: KeyboardEvent<Element>) => void;
}

export interface UseChartTooltipOptions {
  /** Called when the tooltip moves to another mark or closes (null), e.g. to keep a highlight on the mark it shows. */
  onActiveKeyChange?: (key: string | null) => void;
}

export interface UseChartTooltipResult {
  /** Id of the floating tooltip node; pass into `aria-describedby` yourself for manual (non-trigger-props) wiring. */
  tooltipId: string;
  /** Key of the mark currently shown, or null. */
  activeKey: string | null;
  /** Whether `key` is the mark currently shown (hover, focus or tap). */
  isActive: (key: string) => boolean;
  /** Build hover/focus/click/keyboard wiring for one discrete interactive mark. Spread onto the DOM element. */
  getTriggerProps: (key: string, content: ReactNode) => ChartTooltipTriggerProps;
  /** Imperative show, for marks driven by continuous pointer movement (Sparkline's crosshair). */
  show: (key: string, content: ReactNode, rect: DOMRect) => void;
  hide: () => void;
  /** Scope marker — put on the chart's hit-surface so outside-click detection knows this click was "inside". */
  scopeProp: { "data-tooltip-scope": string };
  /** Render once per chart, anywhere in the tree. Portals to document.body when open. */
  tooltip: ReactNode;
}

export function useChartTooltip({ onActiveKeyChange }: UseChartTooltipOptions = {}): UseChartTooltipResult {
  const tooltipId = `chart-tooltip-${useId()}`;
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  // The handlers read the latest tooltip here, not the one of the render that created them.
  const activeRef = useRef<ActiveTooltip | null>(null);
  /** The mark with keyboard focus: the tooltip goes back to it when the mouse leaves another mark. */
  const focusedRef = useRef<FocusedMark | null>(null);
  /** Pointer type of the press before a click; null when a keyboard or assistive technology clicked. */
  const pressRef = useRef<string | null>(null);
  const onActiveKeyChangeRef = useRef(onActiveKeyChange);
  useLayoutEffect(() => {
    onActiveKeyChangeRef.current = onActiveKeyChange;
  });

  const commit = useCallback((next: ActiveTooltip | null) => {
    const previousKey = activeRef.current?.key ?? null;
    activeRef.current = next;
    setActive(next);
    const nextKey = next?.key ?? null;
    if (nextKey !== previousKey) onActiveKeyChangeRef.current?.(nextKey);
  }, []);

  const hide = useCallback(() => {
    focusedRef.current = null;
    commit(null);
  }, [commit]);

  const show = useCallback(
    (key: string, content: ReactNode, rect: DOMRect) => commit({ key, content, rect, source: "hover" }),
    [commit],
  );

  // Escape / scroll / resize / outside pointerdown all dismiss — only wired while open.
  const open = active !== null;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onScrollOrResize = () => hide();
    const onPointerDown = (event: globalThis.PointerEvent) => {
      let node = event.target instanceof Node ? event.target : null;
      while (node) {
        if (node instanceof Element && node.getAttribute("data-tooltip-scope") === tooltipId) return;
        node = node.parentNode;
      }
      hide();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, hide, tooltipId]);

  function getTriggerProps(key: string, content: ReactNode): ChartTooltipTriggerProps {
    const showOn = (element: Element, source: TooltipSource) =>
      commit({ key, content, rect: element.getBoundingClientRect(), source });
    return {
      tabIndex: 0,
      "aria-describedby": active?.key === key ? tooltipId : undefined,
      "data-tooltip-scope": tooltipId,
      // Touch and pen fire enter/leave around every tap as well: their taps go through onClick.
      onPointerEnter: (event) => {
        if (event.pointerType === "mouse") showOn(event.currentTarget, "hover");
      },
      onPointerLeave: (event) => {
        const current = activeRef.current;
        if (event.pointerType !== "mouse" || current?.key !== key || current.source !== "hover") return;
        const focused = focusedRef.current;
        commit(
          focused?.element.isConnected
            ? { key: focused.key, content: focused.content, rect: focused.element.getBoundingClientRect(), source: "focus" }
            : null,
        );
      },
      onPointerDown: (event) => {
        pressRef.current = event.pointerType;
        // Mousing on the chart drops the keyboard fallback, so a clicked mark never comes back on its own.
        if (event.pointerType === "mouse") focusedRef.current = null;
      },
      onFocus: (event) => {
        // A click or tap focuses the mark too; only keyboard focus shows the tooltip.
        if (!event.currentTarget.matches(":focus-visible")) return;
        focusedRef.current = { key, content, element: event.currentTarget };
        showOn(event.currentTarget, "focus");
      },
      onBlur: () => {
        if (focusedRef.current?.key === key) focusedRef.current = null;
        const current = activeRef.current;
        if (current?.key === key && current.source === "focus") commit(null);
      },
      onClick: (event) => {
        const pointerType = pressRef.current;
        pressRef.current = null;
        const current = activeRef.current;
        if (pointerType === "mouse") {
          // Hovering already shows it; a click only brings it back after Escape or a scroll.
          if (current?.key !== key) showOn(event.currentTarget, "hover");
          return;
        }
        // Touch, pen, or a click from the keyboard or assistive technology: tap to toggle.
        if (current?.key === key && current.source !== "hover") commit(null);
        else showOn(event.currentTarget, "tap");
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          hide();
        }
      },
    };
  }

  return {
    tooltipId,
    activeKey: active?.key ?? null,
    isActive: (key: string) => active?.key === key,
    getTriggerProps,
    show,
    hide,
    scopeProp: { "data-tooltip-scope": tooltipId },
    tooltip: active ? (
      <ChartTooltipPortal id={tooltipId} anchor={active.rect}>
        {active.content}
      </ChartTooltipPortal>
    ) : null,
  };
}

function ChartTooltipPortal({ id, anchor, children }: { id: string; anchor: DOMRect; children: ReactNode }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    let top = anchor.top - box.height - ANCHOR_GAP;
    if (top < VIEWPORT_MARGIN) top = anchor.bottom + ANCHOR_GAP;
    top = Math.min(top, window.innerHeight - box.height - VIEWPORT_MARGIN);
    top = Math.max(top, VIEWPORT_MARGIN);
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - box.width - VIEWPORT_MARGIN);
    setStyle({ position: "fixed", top, left, opacity: 1 });
    // `anchor` is a fresh DOMRect on every show()/reposition, so this re-measures exactly then.
  }, [anchor]);

  return createPortal(
    <div
      id={id}
      ref={nodeRef}
      role="tooltip"
      style={style ?? { position: "fixed", top: anchor.top, left: anchor.left, opacity: 0 }}
      className="pointer-events-none z-50 max-w-[13rem] rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-none transition-opacity duration-150 ease-out"
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Shared tooltip content pieces — value leads (strong/mono/foreground), the
// label follows (muted); a series key is a short colored line, never a box.
// ---------------------------------------------------------------------------

export function TooltipValueRow({ value, label, tone }: { value: ReactNode; label?: ReactNode; tone?: Tone }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {tone ? <span aria-hidden className={cn("h-[2px] w-2.5 shrink-0 rounded-full", TONE_BG[tone])} /> : null}
      <span className="font-mono font-semibold tabular-nums text-foreground">{value}</span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </div>
  );
}

export function TooltipNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-0.5 text-muted-foreground", className)}>{children}</div>;
}
