"use client";

import { useState } from "react";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TooltipNote, TooltipValueRow, useChartTooltip } from "./ChartTooltip";
import { useMiniChartI18n } from "./i18n";
import { TONE_BG, type Tone } from "./tone";

export interface SegmentBarSegment {
  key: string;
  label: string;
  value: number;
  tone: Tone;
}

export interface SegmentBarProps {
  segments: SegmentBarSegment[];
  /** Accessible name for the whole bar (used when `interactive`). */
  ariaLabel: string;
  /** Track height in px. */
  height?: number;
  formatValue?: (value: number) => string;
  /** Tooltip also shows each segment's share of the total. */
  showPercent?: boolean;
  /** Controlled highlight (sync with an external list). Omit for uncontrolled. */
  highlightKey?: string | null;
  onHighlightChange?: (key: string | null) => void;
  /** false renders a purely decorative, aria-hidden bar (no focus, no tooltip). */
  interactive?: boolean;
  className?: string;
}

/**
 * 100%-stacked horizontal bar. Segments grow from the left on mount, the
 * hovered/focused segment gets a hairline outline while the rest dim, and
 * every non-zero segment carries a hover+focus tooltip (value leads, label
 * and share% follow) on top of its own accessible name.
 */
export function SegmentBar({
  segments,
  ariaLabel,
  height = 8,
  formatValue,
  showPercent = true,
  highlightKey,
  onHighlightChange,
  interactive = true,
  className,
}: SegmentBarProps) {
  const { t } = useMiniChartI18n();
  const motionAllowed = useMotionAllowed();
  const { getTriggerProps, tooltip } = useChartTooltip();
  const [internalHighlight, setInternalHighlight] = useState<string | null>(null);

  const controlled = highlightKey !== undefined;
  const effectiveHighlight = controlled ? highlightKey : internalHighlight;
  const fmt = formatValue ?? ((value: number) => formatNumber(value, 0));

  function setHighlight(key: string | null) {
    if (!controlled) setInternalHighlight(key);
    onHighlightChange?.(key);
  }

  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);

  if (total <= 0) {
    return <div aria-hidden className="w-full rounded-full bg-surface" style={{ height }} />;
  }

  return (
    <div className={cn("w-full", className)}>
      <div
        {...(interactive ? { role: "group" as const, "aria-label": ariaLabel } : { "aria-hidden": true as const })}
        className="flex w-full gap-[2px] overflow-hidden rounded-full bg-surface"
        style={{ height }}
      >
        {visible.map((segment) => {
          const share = (segment.value / total) * 100;
          const dimmed = interactive && effectiveHighlight != null && effectiveHighlight !== segment.key;
          const lifted = interactive && effectiveHighlight === segment.key;
          const segClassName = cn(
            "h-full transition-opacity duration-150",
            TONE_BG[segment.tone],
            motionAllowed && "origin-left animate-grow-x",
            dimmed && "opacity-40",
            lifted && "outline outline-1 -outline-offset-1 outline-foreground/40",
          );
          const style = { flex: `${segment.value} 0 0%` };

          if (!interactive) {
            return <div key={segment.key} className={segClassName} style={style} />;
          }

          const trigger = getTriggerProps(
            segment.key,
            <>
              <TooltipValueRow value={fmt(segment.value)} label={segment.label} tone={segment.tone} />
              {showPercent ? <TooltipNote>{t("shareOfTotal", { value: formatPercent(share, 1) })}</TooltipNote> : null}
            </>,
          );
          return (
            <div
              key={segment.key}
              role="img"
              aria-label={`${segment.label}: ${fmt(segment.value)} (${formatPercent(share, 1)})`}
              tabIndex={trigger.tabIndex}
              aria-describedby={trigger["aria-describedby"]}
              data-tooltip-scope={trigger["data-tooltip-scope"]}
              onMouseEnter={(event) => {
                trigger.onMouseEnter(event);
                setHighlight(segment.key);
              }}
              onMouseLeave={(event) => {
                trigger.onMouseLeave(event);
                setHighlight(null);
              }}
              onFocus={(event) => {
                trigger.onFocus(event);
                setHighlight(segment.key);
              }}
              onBlur={(event) => {
                trigger.onBlur(event);
                setHighlight(null);
              }}
              onClick={trigger.onClick}
              onKeyDown={trigger.onKeyDown}
              className={segClassName}
              style={style}
            />
          );
        })}
      </div>
      {interactive ? tooltip : null}
    </div>
  );
}
