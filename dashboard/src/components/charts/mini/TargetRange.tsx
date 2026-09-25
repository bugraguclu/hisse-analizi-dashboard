"use client";

import type { CSSProperties, ReactNode } from "react";
import { formatChangePercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TooltipNote, TooltipValueRow, useChartTooltip, type ChartTooltipTriggerProps } from "./ChartTooltip";
import { TONE_TEXT } from "./tone";

export interface TargetRangeLabels {
  current: string;
  mean: string;
  median: string;
  low: string;
  high: string;
}

export interface TargetRangeProps {
  low: number;
  high: number;
  mean?: number | null;
  median?: number | null;
  current?: number | null;
  formatPrice: (value: number) => string;
  /** Localized legend/marker names — reuse the caller's existing i18n strings, don't retranslate here. */
  labels: TargetRangeLabels;
  className?: string;
}

/** Mean and median markers closer than this (pct of the track) are drawn as one. */
const MARKER_MIN_GAP_PCT = 3;
/** Low/high axis labels closer than this (pct of the track) merge into one "low–high" label. */
const AXIS_LABEL_MIN_GAP_PCT = 18;

/**
 * Centres a monospace label on `pct` but keeps it inside the track, without
 * measuring: every glyph of a mono label is 1ch wide, so its width is known in
 * CSS (`chars`ch + horizontal padding/border).
 */
function clampedLabelStyle(pct: number, chars: number, extraPx: number, marginPx = 0): CSSProperties {
  const width = `(${chars}ch + ${extraPx}px)`;
  return {
    left: `clamp(${marginPx}px, calc(${pct}% - ${width} / 2), calc(100% - ${width} - ${marginPx}px))`,
  };
}

function Marker({
  trigger,
  ariaLabel,
  leftPct,
  className,
  children,
}: {
  trigger: ChartTooltipTriggerProps;
  ariaLabel: string;
  leftPct: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      tabIndex={trigger.tabIndex}
      aria-describedby={trigger["aria-describedby"]}
      data-tooltip-scope={trigger["data-tooltip-scope"]}
      onMouseEnter={trigger.onMouseEnter}
      onMouseLeave={trigger.onMouseLeave}
      onFocus={trigger.onFocus}
      onBlur={trigger.onBlur}
      onClick={trigger.onClick}
      onKeyDown={trigger.onKeyDown}
      className={cn(
        "absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
      style={{ left: `${leftPct}%` }}
    >
      {children}
    </div>
  );
}

/**
 * Analyst price-target chart: low-high range, mean/median markers and the
 * current price against them. Every mark is individually focusable with a
 * tooltip; the current-price tag and the axis labels stay inside the track
 * (pure CSS clamp) and everything above the track fits in the top padding, so
 * nothing reaches into the heading above.
 */
export function TargetRange({ low, high, mean, median, current, formatPrice, labels, className }: TargetRangeProps) {
  const { getTriggerProps, tooltip } = useChartTooltip();

  const rawMin = Math.min(low, current ?? low);
  const rawMax = Math.max(high, current ?? high);
  const rawSpan = rawMax - rawMin || 1;
  const pad = rawSpan * 0.06;
  const domainMin = rawMin - pad;
  const domainMax = rawMax + pad;
  const domainSpan = domainMax - domainMin || 1;
  const pct = (v: number) => ((v - domainMin) / domainSpan) * 100;

  const lowPct = pct(low);
  const highPct = pct(high);
  const meanPct = mean != null ? pct(mean) : null;
  const medianPct = median != null ? pct(median) : null;
  const currentPct = current != null ? pct(current) : null;
  // Markers closer than this would overlap: the median then moves into the mean's tooltip.
  const medianFoldedIntoMean = meanPct != null && medianPct != null && Math.abs(medianPct - meanPct) < MARKER_MIN_GAP_PCT;

  const vsCurrent = (value: number): number | null => (current != null && current > 0 ? (value / current - 1) * 100 : null);
  const toneTextClass = (value: number) => (value === 0 ? "text-muted-foreground" : TONE_TEXT[value > 0 ? "up" : "down"]);

  function toneNote(value: number) {
    const vs = vsCurrent(value);
    if (vs == null) return null;
    return <TooltipNote className={toneTextClass(vs)}>{formatChangePercent(vs)}</TooltipNote>;
  }

  const upsideToMean = mean != null ? vsCurrent(mean) : null;
  const lowLabel = formatPrice(low);
  const highLabel = formatPrice(high);
  const mergeAxisLabels = highPct - lowPct < AXIS_LABEL_MIN_GAP_PCT;
  const currentLabel = current != null ? formatPrice(current) : "";

  return (
    <div className={cn("pt-8 pb-1", className)}>
      <div className="relative h-2">
        {/* Full-width hairline scale. */}
        <div aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {/* Analyst low-high range. */}
        <div
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/25"
          style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 0)}%` }}
        />

        {/* Current price → mean target: the gap the header's upside figure describes, tinted by its direction. */}
        {currentPct != null && meanPct != null && upsideToMean != null ? (
          <div
            aria-hidden
            className={cn("absolute bottom-full mb-1.5 h-0 border-t border-dashed", upsideToMean >= 0 ? "border-up/60" : "border-down/60")}
            style={{ left: `${Math.min(currentPct, meanPct)}%`, width: `${Math.abs(meanPct - currentPct)}%` }}
          />
        ) : null}

        {current != null && currentPct != null ? (
          <span
            aria-hidden
            className="absolute bottom-full mb-2.5 whitespace-nowrap rounded-sm border border-foreground bg-foreground px-1.5 py-[3px] font-mono text-[9px] font-semibold leading-none tabular-nums text-background"
            style={clampedLabelStyle(currentPct, currentLabel.length, 14)}
          >
            {currentLabel}
          </span>
        ) : null}

        <Marker trigger={getTriggerProps("low", <><TooltipValueRow value={formatPrice(low)} label={labels.low} />{toneNote(low)}</>)} ariaLabel={`${labels.low}: ${formatPrice(low)}`} leftPct={lowPct} />
        <Marker trigger={getTriggerProps("high", <><TooltipValueRow value={formatPrice(high)} label={labels.high} />{toneNote(high)}</>)} ariaLabel={`${labels.high}: ${formatPrice(high)}`} leftPct={highPct} />

        {mean != null && meanPct != null ? (
          <Marker
            trigger={getTriggerProps(
              "mean",
              <>
                <TooltipValueRow value={formatPrice(mean)} label={labels.mean} tone="primary" />
                {toneNote(mean)}
                {medianFoldedIntoMean && median != null ? <TooltipNote>{labels.median}: {formatPrice(median)}</TooltipNote> : null}
              </>,
            )}
            ariaLabel={`${labels.mean}: ${formatPrice(mean)}`}
            leftPct={meanPct}
          >
            <span aria-hidden className="block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-primary ring-2 ring-card" />
          </Marker>
        ) : null}

        {median != null && medianPct != null && !medianFoldedIntoMean ? (
          <Marker
            trigger={getTriggerProps(
              "median",
              <>
                <TooltipValueRow value={formatPrice(median)} label={labels.median} tone="primary" />
                {toneNote(median)}
              </>,
            )}
            ariaLabel={`${labels.median}: ${formatPrice(median)}`}
            leftPct={medianPct}
          >
            <span aria-hidden className="block h-2.5 w-2.5 rounded-full border-2 border-primary bg-card" />
          </Marker>
        ) : null}

        {current != null && currentPct != null ? (
          <Marker
            trigger={getTriggerProps("current", <TooltipValueRow value={formatPrice(current)} label={labels.current} />)}
            ariaLabel={`${labels.current}: ${formatPrice(current)}`}
            leftPct={currentPct}
          >
            <span aria-hidden className="block h-4 w-[3px] rounded-full bg-foreground" />
          </Marker>
        ) : null}
      </div>

      <div aria-hidden className="relative mt-2 h-3.5 font-mono text-[10px] tabular-nums text-muted-foreground">
        {mergeAxisLabels ? (
          <span className="absolute whitespace-nowrap" style={clampedLabelStyle((lowPct + highPct) / 2, lowLabel.length + highLabel.length + 1, 0)}>
            {lowLabel}–{highLabel}
          </span>
        ) : (
          <>
            <span className="absolute whitespace-nowrap" style={clampedLabelStyle(lowPct, lowLabel.length, 0)}>
              {lowLabel}
            </span>
            <span className="absolute whitespace-nowrap" style={clampedLabelStyle(highPct, highLabel.length, 0)}>
              {highLabel}
            </span>
          </>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {current != null ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="h-3 w-[3px] rounded-full bg-foreground" /> {labels.current}
          </span>
        ) : null}
        {mean != null ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="h-2 w-2 rotate-45 rounded-[1px] bg-primary" /> {labels.mean}
          </span>
        ) : null}
        {median != null && !medianFoldedIntoMean ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="h-2 w-2 rounded-full border-2 border-primary" /> {labels.median}
          </span>
        ) : null}
      </div>
      {tooltip}
    </div>
  );
}
