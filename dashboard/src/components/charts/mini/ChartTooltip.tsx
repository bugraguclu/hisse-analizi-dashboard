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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { TONE_BG, type Tone } from "./tone";

/**
 * Shared tooltip primitive for every mini chart (SegmentBar, RangeGauge,
 * MeterBar, TargetRange, Sparkline). Renders in a portal to `document.body`
 * with `position: fixed` so it always escapes a card's `overflow-hidden`,
 * flips above/below the anchor and clamps to the viewport.
 *
 * Tooltips only ever ENHANCE: the same value must be reachable without one
 * (visible text, list row, aria-label). This primitive just owns the
 * show/hide state machine (hover, keyboard focus, touch tap-to-toggle,
 * Escape/scroll/resize/blur to dismiss) and the floating box itself.
 */

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

interface ActiveTooltip {
  key: string;
  content: ReactNode;
  rect: DOMRect;
}

export interface ChartTooltipTriggerProps {
  tabIndex: 0;
  "aria-describedby": string | undefined;
  "data-tooltip-scope": string;
  onMouseEnter: (event: MouseEvent<Element>) => void;
  onMouseLeave: (event: MouseEvent<Element>) => void;
  onFocus: (event: FocusEvent<Element>) => void;
  onBlur: (event: FocusEvent<Element>) => void;
  onClick: (event: MouseEvent<Element>) => void;
  onKeyDown: (event: KeyboardEvent<Element>) => void;
}

export interface UseChartTooltipResult {
  /** Id of the floating tooltip node; pass into `aria-describedby` yourself for manual (non-trigger-props) wiring. */
  tooltipId: string;
  /** Key of the mark currently shown, or null. */
  activeKey: string | null;
  /** Whether `key` is the mark currently shown (hover, focus or pinned). */
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

export function useChartTooltip(): UseChartTooltipResult {
  const tooltipId = `chart-tooltip-${useId()}`;
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const pinnedRef = useRef(false);

  const hide = useCallback(() => {
    pinnedRef.current = false;
    setActive(null);
  }, []);

  const show = useCallback((key: string, content: ReactNode, rect: DOMRect) => {
    setActive({ key, content, rect });
  }, []);

  // Escape / scroll / resize / outside pointerdown all dismiss — only wired while open.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onScrollOrResize = () => hide();
    const onPointerDown = (event: PointerEvent) => {
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
  }, [active, hide, tooltipId]);

  const getTriggerProps = useCallback(
    (key: string, content: ReactNode): ChartTooltipTriggerProps => ({
      tabIndex: 0,
      "aria-describedby": active?.key === key ? tooltipId : undefined,
      "data-tooltip-scope": tooltipId,
      onMouseEnter: (event) => {
        if (pinnedRef.current) return;
        setActive({ key, content, rect: event.currentTarget.getBoundingClientRect() });
      },
      onMouseLeave: () => {
        if (pinnedRef.current) return;
        setActive((current) => (current?.key === key ? null : current));
      },
      onFocus: (event) => {
        setActive({ key, content, rect: event.currentTarget.getBoundingClientRect() });
      },
      onBlur: () => {
        if (pinnedRef.current) return;
        setActive((current) => (current?.key === key ? null : current));
      },
      onClick: (event) => {
        if (active?.key === key && pinnedRef.current) {
          pinnedRef.current = false;
          setActive(null);
          return;
        }
        pinnedRef.current = true;
        setActive({ key, content, rect: event.currentTarget.getBoundingClientRect() });
      },
      onKeyDown: (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          hide();
        }
      },
    }),
    [active, hide, tooltipId],
  );

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
