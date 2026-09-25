/**
 * Shared color vocabulary for the mini charts. Every mark is painted through
 * one of these tokens — never a raw hex/rgb or a Tailwind palette color — so
 * charts stay inside the "paper" design system (see globals.css).
 */
export type Tone = "up" | "down" | "warn" | "muted" | "primary" | "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5";

export const TONE_BG: Record<Tone, string> = {
  up: "bg-up",
  down: "bg-down",
  warn: "bg-warn",
  muted: "bg-muted-foreground/35",
  primary: "bg-primary",
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
};

export const TONE_TEXT: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  warn: "text-warn",
  muted: "text-muted-foreground",
  primary: "text-primary",
  "chart-1": "text-chart-1",
  "chart-2": "text-chart-2",
  "chart-3": "text-chart-3",
  "chart-4": "text-chart-4",
  "chart-5": "text-chart-5",
};

/** Light wash for zone backgrounds (gauges) — kept subtle via opacity modifiers. */
export const TONE_WASH: Record<Tone, string> = {
  up: "bg-up/15",
  down: "bg-down/15",
  warn: "bg-warn/15",
  muted: "bg-muted",
  primary: "bg-primary/15",
  "chart-1": "bg-chart-1/15",
  "chart-2": "bg-chart-2/15",
  "chart-3": "bg-chart-3/15",
  "chart-4": "bg-chart-4/15",
  "chart-5": "bg-chart-5/15",
};

/** Fixed categorical order — never cycle/reassign per render. */
export const CATEGORICAL_TONES: readonly Tone[] = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];
