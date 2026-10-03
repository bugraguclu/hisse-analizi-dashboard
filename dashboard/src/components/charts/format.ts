import { formatNumber, formatPrice, formatSigned } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { chartText } from "./i18n";
import type { ChartUnit, IntervalKind } from "./types";
import { isLiraScale } from "./units";

/** Decimals needed to print `step` exactly (0–4), e.g. 25 → 0, 2.5 → 1, 0.25 → 2. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  for (let decimals = 0; decimals <= 4; decimals += 1) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 4;
}

/** Axis tick labels share one decimal count derived from the tick step. */
export function formatTicks(values: readonly number[], format: (value: number, decimals: number) => string): string[] {
  const sorted = [...values].sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > 1e-9) step = Math.min(step, diff);
  }
  const decimals = Number.isFinite(step) ? decimalsForStep(Number(step.toPrecision(6))) : 2;
  return values.map((value) => format(value, decimals));
}

/** Price precision: more decimals for low-priced symbols (penny stocks, FX). */
export function priceDecimals(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  if (abs >= 0.1) return 3;
  return 4;
}

/**
 * Bar price: 2 decimals like quotes, but split/redenomination-adjusted history below 0,1
 * (1990s bars of the "Tümü" period, e.g. THYAO 0,0025) keeps 2 significant digits
 * instead of rounding to "0,00".
 */
export function formatChartPrice(value: number): string {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs) || abs === 0 || abs >= 0.1) return formatPrice(value);
  return formatNumber(value, Math.min(6, 1 - Math.floor(Math.log10(abs))));
}

/**
 * Decimals of a price in `unit`. Lira (also real lira) keeps the quotes' 2; dollar and euro
 * prices of BIST shares run from cents to tens and grams of gold per share from thousandths
 * to tens, so they keep 4 significant digits (5,942 · 0,4127 · 0,04590), levels in the
 * hundreds 2.
 */
export function chartPriceDecimals(value: number, unit: ChartUnit): number {
  const abs = Math.abs(value);
  if (isLiraScale(unit) || !Number.isFinite(abs) || abs === 0 || abs >= 100) return 2;
  if (abs >= 1) return 3;
  return Math.min(6, 3 - Math.floor(Math.log10(abs)));
}

/** Bar price in dollars, euros or grams of gold (see `chartPriceDecimals`). */
export function formatFineChartPrice(value: number): string {
  return formatNumber(value, chartPriceDecimals(value, "USD"));
}

/** A unit's bar price formatter; module-level functions, so stable enough for a chart `valueFormatter`. */
export function chartPriceFormatter(unit: ChartUnit): (value: number) => string {
  return isLiraScale(unit) ? formatChartPrice : formatFineChartPrice;
}

/** Signed change with the decimals of the price it moves (`level`): "+2,25" for a lira quote, "+0,043" for a 5,94 $ share. */
export function formatChartChange(change: number | null | undefined, level: number, unit: ChartUnit): string {
  return formatSigned(change, chartPriceDecimals(level, unit));
}

/** Price step of a series' scale: dollar, euro and gold prices tick below a cent. */
export function chartMinMove(bars: readonly { close: number }[], unit: ChartUnit): number {
  if (isLiraScale(unit)) return 0.01;
  const top = bars.reduce((max, bar) => Math.max(max, Math.abs(bar.close)), 0);
  return 10 ** -chartPriceDecimals(top, unit);
}

/** Human span between two bar instants, e.g. "3 sa 30 dk", "26 gün", "1,4 yıl". */
export function formatSpan(fromMs: number, toMs: number, interval: IntervalKind, locale: Locale): string {
  const minutes = Math.max(0, Math.round((toMs - fromMs) / 60_000));
  if (interval === "intraday" && minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(chartText("span.hours", locale, { n: hours }));
    if (rest > 0 || hours === 0) parts.push(chartText("span.minutes", locale, { n: rest }));
    return parts.join(" ");
  }
  const days = Math.round(minutes / (24 * 60));
  if (days < 62) return chartText("span.days", locale, { n: days });
  const months = days / 30.44;
  if (months < 24) return chartText("span.months", locale, { n: formatNumber(months, months < 10 ? 1 : 0) });
  return chartText("span.years", locale, { n: formatNumber(days / 365.25, 1) });
}
