"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Native tooltip, e.g. the long form of "1A" → "1 ay". */
  title?: string;
  disabled?: boolean;
}

const SIZE_CLASS = {
  xs: "h-6 px-2 text-[10px]",
  sm: "h-7 px-2.5 text-[11px]",
  md: "h-8 px-3 text-xs",
} as const;

/**
 * Single-choice control (period / range / view pickers, filter chips). The active
 * option gets a sliding indicator; it is a WAI-ARIA radiogroup, so Tab focuses the
 * selected option and ←/→/↑/↓/Home/End move and select.
 *
 * - variant "pill" (default): options on a muted track, active one raised.
 * - variant "underline": tab-style row with a primary underline (card headers).
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
  const indicatorId = `segmented-${useId()}`;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = options.findIndex((option) => option.value === value);
  const focusIndex = activeIndex >= 0 ? activeIndex : options.findIndex((option) => !option.disabled);

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

  const pill = variant === "pill";

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "relative flex max-w-full overflow-x-auto scrollbar-none",
        pill ? "w-fit gap-0.5 rounded-lg bg-muted/60 p-0.5 ring-1 ring-inset ring-border/40" : "gap-1 border-b border-border/50",
        className,
      )}
    >
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
              "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold outline-none transition-colors duration-150",
              "focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40",
              SIZE_CLASS[size],
              pill ? "rounded-md" : "rounded-t-md",
              active
                ? pill
                  ? "text-foreground"
                  : "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={indicatorId}
                aria-hidden
                className={cn(
                  "absolute",
                  pill
                    ? "inset-0 rounded-md bg-background shadow-sm ring-1 ring-border/60 dark:bg-card"
                    : "inset-x-1.5 bottom-0 h-0.5 rounded-full bg-primary",
                )}
                transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.8 }}
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
