import { formatCompact, formatNumber } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { SERIES_CSS_VAR, type ChartPalette, type Rgb } from "./colors";
import { priceDecimals } from "./format";
import { computeIndicator, INDICATORS, indicatorLabel } from "./indicator-catalog";
import type { IndicatorDef, IndicatorInput, IndicatorLine, IndicatorOutput, IndicatorTone } from "./indicator-types";
import type { IndicatorConfig } from "./types";

/** Why an indicator in the prefs is not drawn right now. */
export type IndicatorStatus = "ok" | "hidden" | "needsVolume" | "needsIntraday" | "suspended";

/** One configured indicator, computed and ready for the canvas and the legend. */
export interface IndicatorView {
  config: IndicatorConfig;
  def: IndicatorDef;
  label: string;
  status: IndicatorStatus;
  /** Null unless `status` is "ok". */
  output: IndicatorOutput | null;
  format: (value: number) => string;
  /** Price-axis step matching `format`. */
  minMove: number;
}

export interface IndicatorContext {
  input: IndicatorInput;
  hasVolume: boolean;
  /** Price overlays are off (comparison / percent scale): percentages of an SMA would read as nonsense. */
  overlaysSuspended: boolean;
  priceFormat: (value: number) => string;
}

function peakOf(output: IndicatorOutput): number {
  let peak = 0;
  const scan = (values: ReadonlyArray<number | null>) => {
    for (const value of values) if (value !== null && Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
  };
  output.lines.forEach((line) => scan(line.values));
  if (output.histogram) scan(output.histogram.values);
  return peak;
}

export function statusOf(def: IndicatorDef, config: IndicatorConfig, context: Omit<IndicatorContext, "priceFormat">): IndicatorStatus {
  if (config.hidden) return "hidden";
  if (def.requires?.intraday && context.input.interval !== "intraday") return "needsIntraday";
  if (def.requires?.volume && !context.hasVolume) return "needsVolume";
  if (def.placement === "overlay" && context.overlaysSuspended) return "suspended";
  return "ok";
}

export function buildIndicatorView(config: IndicatorConfig, context: IndicatorContext): IndicatorView {
  const def = INDICATORS[config.kind];
  const status = statusOf(def, config, context);
  const output = status === "ok" ? computeIndicator(config, context.input) : null;
  let format: (value: number) => string;
  let minMove: number;
  switch (def.format) {
    case "price":
      format = context.priceFormat;
      minMove = 0.01;
      break;
    case "fixed2":
      format = (value) => formatNumber(value, 2);
      minMove = 0.01;
      break;
    case "compact":
      format = (value) => formatCompact(value);
      minMove = 1;
      break;
    default: {
      const decimals = output ? priceDecimals(peakOf(output) || 1) : 2;
      format = (value) => formatNumber(value, decimals);
      minMove = 10 ** -decimals;
    }
  }
  return { config, def, label: indicatorLabel(config), status, output, format, minMove };
}

export function toneCss(tone: IndicatorTone): string {
  return tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : "var(--muted-foreground)";
}

export function toneRgb(palette: ChartPalette, tone: IndicatorTone): Rgb {
  return tone === "up" ? palette.up : tone === "down" ? palette.down : palette.muted;
}

function slotOf(config: IndicatorConfig, line: Pick<IndicatorLine, "colorOffset">): number {
  return (((config.color + (line.colorOffset ?? 0)) % 5) + 5) % 5;
}

/** CSS colour of a line for HTML keys; per-point tones fall back to the instance colour. */
export function lineCss(config: IndicatorConfig, line: Pick<IndicatorLine, "colorOffset" | "tone">): string {
  return line.tone ? toneCss(line.tone) : SERIES_CSS_VAR[slotOf(config, line)];
}

export function lineRgb(palette: ChartPalette, config: IndicatorConfig, line: Pick<IndicatorLine, "colorOffset" | "tone">): Rgb {
  return line.tone ? toneRgb(palette, line.tone) : palette.series[slotOf(config, line)];
}

export function localize(text: Record<Locale, string> | null | undefined, locale: Locale): string | null {
  return text ? (text[locale] ?? text.tr) : null;
}
