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
  /**
   * Optional reference tick (e.g. the sector median), in the same units as `value`.
   * The bar shows a magnitude, so a reference on the other side of zero has no place
   * on it and is not drawn (the row prints it instead).
   */
  reference?: number | null;
  /** Stagger the mount animation, e.g. `index * 40`. */
  delayMs?: number;
  className?: string;
}

/** Whether a reference can sit on the bar: same side of zero as the value (an empty bar reads as positive). */
function onBarSide(value: number | null, reference: number): boolean {
  return value != null && value < 0 ? reference < 0 : reference >= 0;
}

/**
 * Single horizontal magnitude bar for a list row (RatiosCard). Purely
 * presentational — the enclosing row owns the hover/focus tooltip, this just
 * paints the fill. Tone follows the sign of `value` (primary / down), never
 * price-direction up/down since a ratio bar isn't a price move. The reference
 * tick is ink and a little taller than the track, so it reads over any fill.
 */
export function MeterBar({ value, scale, height = 6, reference, delayMs, className }: MeterBarProps) {
  const motionAllowed = useMotionAllowed();
  const width = value == null || scale <= 0 ? 0 : Math.min((Math.abs(value) / scale) * 100, 100);
  const refPct =
    reference != null && Number.isFinite(reference) && scale > 0 && onBarSide(value, reference)
      ? Math.min((Math.abs(reference) / scale) * 100, 100)
      : null;

  return (
    <div className={cn("relative", className)} style={{ height }} aria-hidden>
      <div className="h-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            value != null && value < 0 ? "bg-down/70" : "bg-primary/70",
            motionAllowed && "origin-left animate-grow-x",
          )}
          style={{ width: `${width}%`, animationDelay: delayMs ? `${delayMs}ms` : undefined }}
        />
      </div>
      {refPct != null ? (
        <div
          data-meter-reference=""
          className="absolute -inset-y-[3px] w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--card)]"
          style={{ left: `${refPct}%` }}
        />
      ) : null}
    </div>
  );
}
