export const motionDuration = {
  press: 150,
  popover: 200,
  panel: 260,
  move: 250,
  fade: 220,
  reveal: 420,
  pulse: 1760,
} as const;

export const motionCurve = {
  easeOut: [0.23, 1, 0.32, 1],
  easeInOut: [0.77, 0, 0.175, 1],
} as const;

export const motionScale = { press: 0.97, popover: 0.95, pulse: 0.96 } as const;
export const motionStagger = { interval: 30, steps: 6 } as const;
export const motionExitRatio = 0.8;
export const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function exitDuration(duration: number): number {
  return Math.round(duration * motionExitRatio);
}

export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), motionStagger.steps - 1) * motionStagger.interval;
}

export function criticalDamping(stiffness: number, mass: number): number {
  return 2 * Math.sqrt(stiffness * mass);
}

/** Signed overscroll displacement, bounded by the supplied distance. */
export function rubberBand(displacement: number, distance: number): number {
  if (distance <= 0) return 0;
  const resistance = Math.abs(displacement) * 0.55 / distance;
  return Math.sign(displacement) * (1 - 1 / (resistance + 1)) * distance || 0;
}

export function cubicBezier(curve: readonly [number, number, number, number]): string {
  return `cubic-bezier(${curve.join(", ")})`;
}

/** Applied at the document root so portaled surfaces share the same CSS tokens. */
export const motionCss = {
  "--motion-press": `${motionDuration.press}ms`,
  "--motion-popover": `${motionDuration.popover}ms`,
  "--motion-row": `${motionDuration.popover - staggerDelay(motionStagger.steps - 1)}ms`,
  "--motion-popover-exit": `${exitDuration(motionDuration.popover)}ms`,
  "--motion-panel": `${motionDuration.panel}ms`,
  "--motion-panel-exit": `${exitDuration(motionDuration.panel)}ms`,
  "--motion-move": `${motionDuration.move}ms`,
  "--motion-fade": `${motionDuration.fade}ms`,
  "--motion-fade-exit": `${exitDuration(motionDuration.fade)}ms`,
  "--motion-reveal": `${motionDuration.reveal}ms`,
  "--motion-pulse": `${motionDuration.pulse}ms`,
  "--motion-pulse-step": "90ms",
  "--motion-scale-press": motionScale.press,
  "--motion-scale-popover": motionScale.popover,
  "--motion-scale-pulse": motionScale.pulse,
  "--motion-ease-out": cubicBezier(motionCurve.easeOut),
  "--motion-ease-in-out": cubicBezier(motionCurve.easeInOut),
};

/** Sample the same cubic Bézier as CSS when driving a Canvas data range. */
export function moveProgress(progress: number): number {
  if (progress <= 0 || progress >= 1) return Math.min(1, Math.max(0, progress));
  const [x1, y1, x2, y2] = motionCurve.easeInOut;
  const sample = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 18; iteration++) {
    const mid = (low + high) / 2;
    if (sample(mid, x1, x2) < progress) low = mid;
    else high = mid;
  }
  return sample((low + high) / 2, y1, y2);
}
