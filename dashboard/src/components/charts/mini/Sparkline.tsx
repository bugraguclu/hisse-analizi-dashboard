"use client";

import { useRef, useState } from "react";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { formatMarketDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TooltipNote, TooltipValueRow, useChartTooltip } from "./ChartTooltip";
import type { Tone } from "./tone";

export interface SparklinePoint {
  /** Epoch ms. */
  t: number;
  v: number;
}

export type SparklineTone = Tone | "flat";

export interface SparklineProps {
  data: SparklinePoint[];
  /** Dashed reference hairline (e.g. previous close). */
  baseline?: number | null;
  tone?: SparklineTone;
  height?: number;
  formatValue?: (value: number) => string;
  formatTime?: (time: number) => string;
  ariaLabel: string;
  className?: string;
}

const VIEW_W = 300;
const VIEW_H = 100;
const PAD_Y = 8;

const STROKE_CLASS: Record<SparklineTone, string> = {
  up: "stroke-up",
  down: "stroke-down",
  flat: "stroke-muted-foreground",
  warn: "stroke-warn",
  muted: "stroke-muted-foreground",
  primary: "stroke-primary",
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  "chart-3": "stroke-chart-3",
  "chart-4": "stroke-chart-4",
  "chart-5": "stroke-chart-5",
};

const FILL_CLASS: Record<SparklineTone, string> = {
  up: "fill-up",
  down: "fill-down",
  flat: "fill-muted-foreground",
  warn: "fill-warn",
  muted: "fill-muted-foreground",
  primary: "fill-primary",
  "chart-1": "fill-chart-1",
  "chart-2": "fill-chart-2",
  "chart-3": "fill-chart-3",
  "chart-4": "fill-chart-4",
  "chart-5": "fill-chart-5",
};

/**
 * Responsive line for a small time series. Hover/touch/keyboard-focus shows a
 * crosshair that snaps to the nearest point (value leads in the tooltip, time
 * follows); the line reveals left-to-right on mount when motion is allowed.
 * Not wired into any card yet — built ahead of that integration.
 */
export function Sparkline({ data, baseline, tone = "primary", height = 32, formatValue, formatTime, ariaLabel, className }: SparklineProps) {
  const motionAllowed = useMotionAllowed();
  const { show, hide, activeKey, tooltipId, scopeProp, tooltip } = useChartTooltip();
  const svgRef = useRef<SVGSVGElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const fmtValue = formatValue ?? ((v: number) => formatNumber(v));
  const fmtTime = formatTime ?? ((t: number) => formatMarketDate(t, "dayMonthTime"));
  const n = data.length;

  if (n === 0) {
    return <div aria-hidden className="w-full" style={{ height }} />;
  }

  let minV = Infinity;
  let maxV = -Infinity;
  for (const point of data) {
    if (point.v < minV) minV = point.v;
    if (point.v > maxV) maxV = point.v;
  }
  if (baseline != null) {
    if (baseline < minV) minV = baseline;
    if (baseline > maxV) maxV = baseline;
  }
  if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
    minV = 0;
    maxV = 1;
  }
  const span = maxV - minV || 1;
  const xAt = (i: number) => (n <= 1 ? VIEW_W / 2 : (i / (n - 1)) * VIEW_W);
  const yAt = (v: number) => VIEW_H - PAD_Y - ((v - minV) / span) * (VIEW_H - PAD_Y * 2);

  const lineD = data.map((point, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(point.v)}`).join(" ");
  const areaD = `${lineD} L${xAt(n - 1)},${VIEW_H} L${xAt(0)},${VIEW_H} Z`;

  function indexFromClientX(clientX: number): number | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.min(Math.max(Math.round(ratio * (n - 1)), 0), n - 1);
  }

  function showAt(index: number) {
    setActiveIndex(index);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRatio = n <= 1 ? 0.5 : index / (n - 1);
    const yRatio = yAt(data[index].v) / VIEW_H;
    const x = rect.left + xRatio * rect.width;
    const y = rect.top + yRatio * rect.height;
    show(
      "point",
      <>
        <TooltipValueRow value={fmtValue(data[index].v)} tone={tone === "flat" ? undefined : tone} />
        <TooltipNote>{fmtTime(data[index].t)}</TooltipNote>
      </>,
      new DOMRect(x, y, 1, 1),
    );
  }

  function clearActive() {
    setActiveIndex(null);
    hide();
  }

  return (
    <div className={cn("relative w-full", className)} style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        aria-describedby={activeKey === "point" ? tooltipId : undefined}
        {...scopeProp}
        className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onMouseMove={(event) => {
          const idx = indexFromClientX(event.clientX);
          if (idx != null) showAt(idx);
        }}
        onMouseLeave={clearActive}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          const idx = touch ? indexFromClientX(touch.clientX) : null;
          if (idx != null) showAt(idx);
        }}
        onTouchMove={(event) => {
          const touch = event.touches[0];
          const idx = touch ? indexFromClientX(touch.clientX) : null;
          if (idx != null) showAt(idx);
        }}
        onFocus={() => showAt(activeIndex ?? n - 1)}
        onBlur={clearActive}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            showAt(activeIndex == null ? n - 1 : Math.max(activeIndex - 1, 0));
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            showAt(activeIndex == null ? 0 : Math.min(activeIndex + 1, n - 1));
          } else if (event.key === "Escape") {
            clearActive();
          }
        }}
      >
        {baseline != null ? (
          <line
            x1={0}
            x2={VIEW_W}
            y1={yAt(baseline)}
            y2={yAt(baseline)}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <g className={motionAllowed ? "animate-reveal-x" : undefined}>
          <path d={areaD} className={FILL_CLASS[tone]} opacity={0.08} stroke="none" />
          <path
            d={lineD}
            className={STROKE_CLASS[tone]}
            fill="none"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        {activeIndex != null ? (
          <>
            <line
              x1={xAt(activeIndex)}
              x2={xAt(activeIndex)}
              y1={0}
              y2={VIEW_H}
              className="stroke-muted-foreground/40"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={xAt(activeIndex)} cy={yAt(data[activeIndex].v)} r={3} className={FILL_CLASS[tone]} vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      {tooltip}
    </div>
  );
}
