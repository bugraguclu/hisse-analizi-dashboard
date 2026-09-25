"use client";

import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder shaped like a chart (gridlines + a ghost series + moving
 * highlight). Give it the chart's exact height so nothing shifts when data lands.
 */
export function ChartSkeleton({
  height = 240,
  className,
  label,
}: {
  height?: number;
  className?: string;
  /** Screen-reader text; defaults to "Loading…" in the UI language. */
  label?: string;
}) {
  const { t } = useLocale();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("relative overflow-hidden rounded-md", className)}
      style={{ height }}
    >
      <span className="sr-only">{label ?? t("common.loading")}</span>
      <div aria-hidden className="absolute inset-x-3 inset-y-4 flex flex-col justify-between">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-px bg-grid/60" />
        ))}
      </div>
      <svg
        aria-hidden
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
        className="absolute inset-x-3 inset-y-6 h-[calc(100%-3rem)] w-[calc(100%-1.5rem)] text-muted-foreground/25"
      >
        <path
          d="M0,72 C30,66 48,78 78,60 S128,34 168,46 S228,74 270,52 S336,20 400,30"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div aria-hidden className="skeleton-shimmer absolute inset-0" />
    </div>
  );
}
