"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Chart conventions of the macro page (one system for every chart):
 * - colour follows the entity on every chart: policy rate = chart-1, CPI = chart-2,
 *   PPI = chart-3; a lone market series uses chart-1; the real rate (a difference,
 *   not an entity) is drawn in the neutral chart-5.
 * - 2 px lines, solid hairline grid in --grid, one y-axis, crosshair tooltip that
 *   lists every series with the value first, legend with line keys for ≥ 2 series,
 *   and a table twin behind the chart/table toggle.
 */
export const SERIES_COLOR = {
  policy: "var(--chart-1)",
  cpi: "var(--chart-2)",
  ppi: "var(--chart-3)",
  market: "var(--chart-1)",
  neutral: "var(--chart-5)",
} as const;

export const AXIS_TICK = { fontSize: 10, fill: "var(--color-muted-foreground)" } as const;
export const GRID_STROKE = "var(--grid)";
export const CURSOR_STYLE = { stroke: "var(--color-muted-foreground)", strokeOpacity: 0.45, strokeWidth: 1 } as const;

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  /** Series colour for the line key; omitted for derived rows (e.g. the real rate). */
  color?: string;
}

/** Crosshair readout: title (date), then one row per series — value strong, name muted. */
export function ChartTooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-36 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1 text-[11px] text-muted-foreground">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            {row.color ? (
              <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            ) : (
              <span aria-hidden="true" className="w-3 shrink-0" />
            )}
            <span className="font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
            <span className="text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Legend with line keys (mirrors the marks: line for lines, square for bars). */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ key: string; label: string; color: string; shape?: "line" | "bar" | "step" }>;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          {item.shape === "bar" ? (
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: item.color }} />
          ) : (
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ backgroundColor: item.color }} />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Table twin of a chart: sticky header, right-aligned tabular numbers, scrolls inside a fixed height. */
export function ChartTable({
  caption,
  columns,
  rows,
  height,
}: {
  caption: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<{ key: string; cells: ReactNode[] }>;
  height: number;
}) {
  return (
    <div className="overflow-auto scrollbar-thin" style={{ maxHeight: height }}>
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap py-1.5 pr-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground last:pr-0",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row) => (
            <tr key={row.key}>
              {row.cells.map((cell, index) => (
                <td
                  key={index}
                  className={cn(
                    "whitespace-nowrap py-1.5 pr-3 last:pr-0",
                    columns[index]?.align === "right" ? "text-right font-mono tabular-nums text-foreground" : "text-muted-foreground",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Round away from zero to one significant step: -76 → -80, 11 → 20, 5.49 → 6. */
function roundAway(value: number): number {
  if (value === 0 || !Number.isFinite(value)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  return Math.sign(value) * Math.ceil(Math.abs(value) / magnitude) * magnitude;
}

/**
 * Domain and ticks for a compact signed series (real rate): the rounded extremes
 * plus zero, so the baseline is always drawn and labels stay round.
 */
export function signedAxis(values: readonly (number | null)[]): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const low = roundAway(Math.min(0, ...finite));
  const high = roundAway(Math.max(0, ...finite));
  const ticks = [...new Set([low, 0, high])].sort((a, b) => a - b);
  return { domain: [low, high === low ? low + 1 : high], ticks };
}

export interface NiceScale {
  domain: [number, number];
  ticks: number[];
  /** Decimals that print every tick exactly (step 0.05 → 2, step 5 → 0). */
  decimals: number;
}

/**
 * Round y-axis for a price/yield series: the smallest 1-2-5 step (2.5 only from 25
 * up, so labels never need an extra decimal) that covers the values in at most
 * `maxTicks` ticks. Returns null when there is nothing finite to scale.
 */
export function niceScale(values: readonly (number | null | undefined)[], maxTicks = 5): NiceScale | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 1;
    min -= pad;
    max += pad;
  }
  let exponent = Math.floor(Math.log10((max - min) / Math.max(1, maxTicks - 1)));
  for (let attempt = 0; attempt < 4; attempt += 1, exponent += 1) {
    for (const mantissa of exponent >= 1 ? [1, 2, 2.5, 5] : [1, 2, 5]) {
      const step = mantissa * 10 ** exponent;
      const low = Math.floor(min / step + 1e-9) * step;
      const high = Math.ceil(max / step - 1e-9) * step;
      const count = Math.round((high - low) / step) + 1;
      if (count > maxTicks) continue;
      const decimals = Math.max(0, -exponent);
      const ticks = Array.from({ length: count }, (_, index) => Number((low + index * step).toFixed(decimals)));
      return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, decimals };
    }
  }
  return null;
}

/**
 * Evenly spaced category ticks for monthly series: every `step` months, aligned to
 * calendar months (January-aligned for yearly steps) so labels read as round dates.
 */
export function monthTicks(months: readonly string[], maxTicks: number): string[] {
  if (months.length === 0) return [];
  const steps = [1, 2, 3, 6, 12, 24, 36, 60];
  const step = steps.find((candidate) => months.length / candidate <= maxTicks) ?? 60;
  return months.filter((month) => {
    const m = Number(month.slice(5, 7)) - 1;
    const y = Number(month.slice(0, 4));
    if (step >= 12) return m === 0 && y % (step / 12) === 0;
    return m % step === 0;
  });
}
