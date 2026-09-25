"use client";

import { useEffect, useState } from "react";
import { animate } from "framer-motion";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { cn } from "@/lib/utils";

type FlashTone = "up" | "down";

interface Tween {
  id: number;
  from: number;
  to: number;
}

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A number that tweens to its new value instead of jumping (index levels, prices,
 * KPI tiles). SSR/hydration render the final value, so markup always matches; the
 * tween only runs when motion is allowed (not "reduce motion", tab visible).
 *
 *   <AnimatedNumber value={quote.last} format={formatPrice} flash />
 *
 * `format` receives every intermediate frame and `null` for missing values, so the
 * usual helpers from lib/format (formatNumber, formatPrice, formatChangePercent…)
 * can be passed directly. `flash` tints the background green/red for a moment when
 * a live value rises/falls.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.6,
  flash = false,
  className,
}: {
  value: number | null | undefined;
  format: (value: number | null) => string;
  /** Tween length in seconds. */
  duration?: number;
  flash?: boolean;
  className?: string;
}) {
  const target = finite(value);
  const motionAllowed = useMotionAllowed();
  const [last, setLast] = useState<number | null>(target);
  const [tween, setTween] = useState<Tween | null>(null);
  const [frame, setFrame] = useState<{ id: number; value: number } | null>(null);
  const [flashState, setFlashState] = useState<{ id: number; tone: FlashTone } | null>(null);

  // React to a new value during render ("adjusting state when a prop changes"), so the
  // first frame after the change already starts from what was on screen.
  if (target !== last) {
    setLast(target);
    const onScreen = tween && frame?.id === tween.id ? frame.value : last;
    const id = (tween?.id ?? 0) + 1;
    setTween(motionAllowed && onScreen !== null && target !== null && onScreen !== target ? { id, from: onScreen, to: target } : null);
    if (flash && last !== null && target !== null) {
      setFlashState({ id: (flashState?.id ?? 0) + 1, tone: target > last ? "up" : "down" });
    }
  }

  useEffect(() => {
    if (!tween) return;
    const controls = animate(tween.from, tween.to, {
      duration,
      ease: EASE_OUT,
      onUpdate: (latest) => setFrame({ id: tween.id, value: latest }),
    });
    return () => controls.stop();
  }, [tween, duration]);

  const shown = tween ? (frame?.id === tween.id ? frame.value : tween.from) : target;

  return (
    <span
      key={flashState?.id ?? 0}
      className={cn(
        "tabular-nums",
        flash && "-mx-1 rounded-md px-1",
        flashState && (flashState.tone === "up" ? "animate-flash-up" : "animate-flash-down"),
        className,
      )}
    >
      {format(shown)}
    </span>
  );
}
