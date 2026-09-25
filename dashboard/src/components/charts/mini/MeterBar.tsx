"use client";

import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { cn } from "@/lib/utils";

export interface MeterBarProps {
  /** null renders an empty track. */
  value: number | null;
  /** Magnitude (of `value`) that fills the bar completely. */
  scale: number;
  /** Track height in px. */
  height?: number;
  /** Optional reference tick, in the same units as `value`. */
  reference?: number | null;
  /** Stagger the mount animation, e.g. `index * 40`. */
  delayMs?: number;
  className?: string;
}

/**
 * Single horizontal magnitude bar for a list row (RatiosCard). Purely
 * presentational — the enclosing row owns the hover/focus tooltip, this just
 * paints the fill. Tone follows the sign of `value` (primary / down), never
 * price-direction up/down since a ratio bar isn't a price move.
 */
export function MeterBar({ value, scale, height = 6, reference, delayMs, className }: MeterBarProps) {
  const motionAllowed = useMotionAllowed();
  const width = value == null || scale <= 0 ? 0 : Math.min((Math.abs(value) / scale) * 100, 100);
  const refPct = reference != null && scale > 0 ? Math.min(Math.max((Math.abs(reference) / scale) * 100, 0), 100) : null;

  return (
    <div className={cn("relative overflow-hidden rounded-full bg-muted", className)} style={{ height }} aria-hidden>
      <div
        className={cn(
          "h-full rounded-full",
          value != null && value < 0 ? "bg-down/70" : "bg-primary/70",
          motionAllowed && "origin-left animate-grow-x",
        )}
        style={{ width: `${width}%`, animationDelay: delayMs ? `${delayMs}ms` : undefined }}
      />
      {refPct != null ? <div className="absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${refPct}%` }} /> : null}
    </div>
  );
}
