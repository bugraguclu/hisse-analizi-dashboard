"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cubicBezier, motionCurve, motionDuration } from "@/lib/motion";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Native tooltip, e.g. the long form of "1A" → "1 ay". */
  title?: string;
  disabled?: boolean;
}

const SIZE_CLASS = {
  xs: "h-6 px-2 text-[10px] pointer-coarse:min-h-11",
  sm: "h-7 px-2 sm:px-2.5 text-[11px] pointer-coarse:min-h-11",
  md: "h-8 px-2.5 sm:px-3 text-xs pointer-coarse:min-h-11",
} as const;

const SCROLL_CLEARANCE = 24;

/**
 * Single-choice control (period / range / view pickers, filter chips). The active
 * option gets a sliding indicator; it is a WAI-ARIA radiogroup, so Tab focuses the
 * selected option and ←/→/↑/↓/Home/End move and select.
 *
 * - variant "pill" (default): hairline-framed group, active option on a muted fill.
 * - variant "underline": tab-style row with an ink underline (card headers).
 */
export function SegmentedControl<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "sm",
  variant = "pill",
  className,
}: {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: keyof typeof SIZE_CLASS;
  variant?: "pill" | "underline";
  className?: string;
}) {
  const motionAllowed = useMotionAllowed();
  const groupRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const prevValueRef = useRef(value);
  const wasVisibleRef = useRef(false);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = options.findIndex((option) => option.value === value);
  const focusIndex = activeIndex >= 0 ? activeIndex : options.findIndex((option) => !option.disabled);
  const pill = variant === "pill";

  useEffect(() => {
    if (!motionAllowed) {
      animationRef.current?.cancel();
      animationRef.current = null;
    }
  }, [motionAllowed]);

  useEffect(() => () => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const container = groupRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const changed = prevValueRef.current !== value;
    prevValueRef.current = value;

    const positionIndicator = (animateChange: boolean) => {
      const selected = activeIndex >= 0 ? buttons.current[activeIndex] : null;
      const before = indicator.getBoundingClientRect();
      const wasVisible = wasVisibleRef.current && !indicator.hidden;

      animationRef.current?.cancel();
      animationRef.current = null;

      if (!selected || !selected.offsetWidth) {
        indicator.hidden = true;
        wasVisibleRef.current = false;
        return;
      }

      const inset = pill ? 0 : Math.min(6, Math.floor(selected.offsetWidth / 4));
      const x = selected.offsetLeft + inset;
      const y = pill ? selected.offsetTop : selected.offsetTop + selected.offsetHeight - 2;
      const w = pill ? selected.offsetWidth : Math.max(0, selected.offsetWidth - inset * 2);
      const h = pill ? selected.offsetHeight : 2;

      indicator.style.setProperty("--indicator-x", `${x}px`);
      indicator.style.setProperty("--indicator-y", `${y}px`);
      indicator.style.setProperty("--indicator-width", `${w}px`);
      indicator.style.setProperty("--indicator-height", `${h}px`);
      indicator.hidden = false;
      wasVisibleRef.current = true;

      if (animateChange && wasVisible && motionAllowed && typeof indicator.animate === "function") {
        // Measure after before scrolling the horizontal container so scrollLeft stays constant.
        const after = indicator.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        const sx = after.width > 0 ? before.width / after.width : 1;
        const sy = after.height > 0 ? before.height / after.height : 1;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 || Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
          const anim = indicator.animate(
            [
              { transform: `translate3d(${x + dx}px, ${y + dy}px, 0) scale(${sx}, ${sy})` },
              { transform: `translate3d(${x}px, ${y}px, 0) scale(1, 1)` },
            ],
            {
              duration: motionDuration.move,
              easing: cubicBezier(motionCurve.easeInOut),
            },
          );
          animationRef.current = anim;
          anim.onfinish = () => {
            if (animationRef.current === anim) animationRef.current = null;
          };
          anim.oncancel = () => {
            if (animationRef.current === anim) animationRef.current = null;
          };
        }
      }

      if (animateChange && container.scrollWidth > container.clientWidth) {
        const left = selected.offsetLeft;
        const right = left + selected.offsetWidth;
        const viewStart = container.scrollLeft;
        const viewEnd = viewStart + container.clientWidth;
        const isRtl = getComputedStyle(container).direction === "rtl";
        const maxScroll = container.scrollWidth - container.clientWidth;
        const minBound = isRtl ? -maxScroll : 0;
        const maxBound = isRtl ? 0 : maxScroll;
        const clampScroll = (target: number) => Math.max(minBound, Math.min(maxBound, target));

        if (left < viewStart + SCROLL_CLEARANCE) {
          container.scrollTo({
            left: clampScroll(left - SCROLL_CLEARANCE),
            behavior: motionAllowed ? "smooth" : "instant",
          });
        } else if (right > viewEnd - SCROLL_CLEARANCE) {
          container.scrollTo({
            left: clampScroll(right - container.clientWidth + SCROLL_CLEARANCE),
            behavior: motionAllowed ? "smooth" : "instant",
          });
        }
      }
    };

    positionIndicator(changed);

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => positionIndicator(false));
    observer.observe(container);
    for (const btn of buttons.current) {
      if (btn) observer.observe(btn);
    }
    return () => observer.disconnect();
  }, [activeIndex, value, options, variant, size, motionAllowed, pill]);

  useEffect(() => {
    const container = groupRef.current;
    if (!container) return;
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("animation-timeline", "scroll()")) {
      container.removeAttribute("data-fade-start");
      container.removeAttribute("data-fade-end");
      return;
    }
    const syncFade = () => {
      const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
      const offset = Math.abs(container.scrollLeft);
      if (maxScroll <= 1) {
        container.removeAttribute("data-fade-start");
        container.removeAttribute("data-fade-end");
        return;
      }
      container.dataset.fadeStart = offset > 1 ? "true" : "false";
      container.dataset.fadeEnd = offset < maxScroll - 1 ? "true" : "false";
    };
    syncFade();
    container.addEventListener("scroll", syncFade, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncFade) : null;
    observer?.observe(container);
    return () => {
      container.removeEventListener("scroll", syncFade);
      observer?.disconnect();
    };
  }, [options, size, variant]);

  function select(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    buttons.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  }

  function step(from: number, delta: number): number {
    for (let i = 1; i <= options.length; i += 1) {
      const next = (from + delta * i + options.length) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return from;
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = step(index, 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = step(index, -1);
    else if (event.key === "Home") next = step(-1, 1);
    else if (event.key === "End") next = step(options.length, -1);
    if (next === null) return;
    event.preventDefault();
    select(next);
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative isolate flex max-w-full overflow-x-auto scrollbar-none scroll-fade-x",
        pill ? "w-fit gap-0.5 rounded-md border border-border p-0.5" : "gap-0.5 sm:gap-1 border-b border-border",
        className,
      )}
    >
      <span
        ref={indicatorRef}
        aria-hidden="true"
        hidden
        style={{
          width: "var(--indicator-width, 0px)",
          height: "var(--indicator-height, 0px)",
          transform: "translate3d(var(--indicator-x, 0px), var(--indicator-y, 0px), 0)",
          transformOrigin: "0 0",
        } as CSSProperties}
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-0 will-change-transform",
          pill ? "rounded-[calc(var(--radius)-1px)] bg-muted" : "bg-foreground",
        )}
      />
      {options.map((option, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={String(option.value)}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === focusIndex ? 0 : -1}
            title={option.title}
            disabled={option.disabled}
            onClick={() => select(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative z-[1] inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium outline-none motion-press-subtle",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40",
              SIZE_CLASS[size],
              pill ? "rounded-[3px]" : "rounded-t-sm",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
