/**
 * Price-direction colours. Convention (since ac17eaa): up = green, down = red,
 * flat/unknown = muted. The actual colours live in the `--up` / `--down` CSS
 * tokens (app/globals.css), so the convention can be switched in one place;
 * these helpers only map a signed value to the token-based classes/colours.
 * (lib/format.ts exposes the same tokens as trendTone/TREND_* for new code.)
 */

export type Trend = "up" | "down" | "flat";

export function trendOf(val?: number | null): Trend {
  if (val === null || val === undefined || !Number.isFinite(val) || val === 0) return "flat";
  return val > 0 ? "up" : "down";
}

/** Text colour for a signed change. */
export function trendText(val?: number | null): string {
  const trend = trendOf(val);
  if (trend === "up") return "text-up";
  if (trend === "down") return "text-down";
  return "text-muted-foreground";
}

/** Tinted pill (background + text) for a signed change. */
export function trendPill(val?: number | null): string {
  const trend = trendOf(val);
  if (trend === "up") return "bg-up/10 text-up";
  if (trend === "down") return "bg-down/10 text-down";
  return "bg-muted text-muted-foreground";
}

/** Colours for SVG/recharts strokes and gradients (SVG attributes accept CSS variables). */
export const CHART_UP = "var(--up)";
export const CHART_DOWN = "var(--down)";
export const CHART_FLAT = "var(--muted-foreground)";

export function trendStroke(val?: number | null): string {
  const trend = trendOf(val);
  return trend === "up" ? CHART_UP : trend === "down" ? CHART_DOWN : CHART_FLAT;
}
