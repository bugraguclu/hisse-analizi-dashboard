"use client";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TooltipNote, TooltipValueRow, useChartTooltip } from "./ChartTooltip";
import { useMiniChartI18n } from "./i18n";
import { TONE_WASH, type Tone } from "./tone";

export interface RangeGaugeZone {
  from: number;
  to: number;
  tone: Tone;
  label: string;
}

export interface RangeGaugeProps {
  value: number | null;
  min?: number;
  max?: number;
  /** Shaded, labelled, hoverable bands (e.g. oversold/neutral/overbought). Pass the full track coverage you want washed. */
  zones?: RangeGaugeZone[];
  /** Extra tick marks under the track, e.g. the zone boundaries. */
  ticks?: number[];
  ariaLabel: string;
  formatValue?: (value: number) => string;
  className?: string;
}

/** Interactive band height — bigger than the painted 8px track so hover/tap targets stay >=24px tall. */
const HIT_HEIGHT = 24;

/** Horizontal 0-100 (or min-max) oscillator gauge with shaded zones and a value marker that glides on updates. */
export function RangeGauge({ value, min = 0, max = 100, zones = [], ticks = [], ariaLabel, formatValue, className }: RangeGaugeProps) {
  const { t } = useMiniChartI18n();
  const { getTriggerProps, tooltip } = useChartTooltip();
  const fmt = formatValue ?? ((v: number) => formatNumber(v, 0));

  const span = max - min || 1;
  const clamp = (v: number) => Math.min(Math.max(v, min), max);
  const pct = (v: number) => ((clamp(v) - min) / span) * 100;

  const valuePct = value == null ? 0 : pct(value);

  const isBelow = value != null && value < min;
  const isAbove = value != null && value > max;
  const currentZone = value == null ? undefined : zones.find((zone) => value >= zone.from && value <= zone.to);
  const valueTrigger =
    value == null
      ? null
      : getTriggerProps(
          "value",
          <>
            <TooltipValueRow value={fmt(value)} label={currentZone?.label} tone={currentZone?.tone} />
            {isBelow ? <TooltipNote>{t("belowRange")}</TooltipNote> : null}
            {isAbove ? <TooltipNote>{t("aboveRange")}</TooltipNote> : null}
          </>,
        );

  return (
    <div className={cn("w-full", className)}>
      <div role="group" aria-label={ariaLabel} className="relative" style={{ height: HIT_HEIGHT }}>
        {/* Visual track + zone washes, clipped to a crisp 8px pill. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          {zones.map((zone, i) => (
            <div
              key={i}
              className={cn("absolute inset-y-0", TONE_WASH[zone.tone])}
              style={{ left: `${pct(zone.from)}%`, width: `${Math.max(pct(zone.to) - pct(zone.from), 0)}%` }}
            />
          ))}
        </div>

        {/* Zone hit areas — full band height, sit above the visual layer. */}
        {zones.map((zone, i) => {
          const key = `zone-${i}`;
          const trigger = getTriggerProps(
            key,
            <TooltipValueRow value={`${fmt(zone.from)}–${fmt(zone.to)}`} label={zone.label} tone={zone.tone} />,
          );
          return (
            <div
              key={key}
              role="img"
              aria-label={`${zone.label} (${fmt(zone.from)}–${fmt(zone.to)})`}
              tabIndex={trigger.tabIndex}
              aria-describedby={trigger["aria-describedby"]}
              data-tooltip-scope={trigger["data-tooltip-scope"]}
              onMouseEnter={trigger.onMouseEnter}
              onMouseLeave={trigger.onMouseLeave}
              onFocus={trigger.onFocus}
              onBlur={trigger.onBlur}
              onClick={trigger.onClick}
              onKeyDown={trigger.onKeyDown}
              className="absolute inset-y-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              style={{ left: `${pct(zone.from)}%`, width: `${Math.max(pct(zone.to) - pct(zone.from), 0)}%` }}
            />
          );
        })}

        {/* Value marker. */}
        {value != null && valueTrigger ? (
          <div
            role="img"
            aria-label={`${ariaLabel}: ${fmt(value)}${currentZone ? ` · ${currentZone.label}` : ""}`}
            tabIndex={valueTrigger.tabIndex}
            aria-describedby={valueTrigger["aria-describedby"]}
            data-tooltip-scope={valueTrigger["data-tooltip-scope"]}
            onMouseEnter={valueTrigger.onMouseEnter}
            onMouseLeave={valueTrigger.onMouseLeave}
            onFocus={valueTrigger.onFocus}
            onBlur={valueTrigger.onBlur}
            onClick={valueTrigger.onClick}
            onKeyDown={valueTrigger.onKeyDown}
            className="absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-out"
            style={{ left: `${valuePct}%` }}
          >
            {isBelow ? (
              <span aria-hidden className="text-[10px] font-bold leading-none text-foreground">
                ◂
              </span>
            ) : isAbove ? (
              <span aria-hidden className="text-[10px] font-bold leading-none text-foreground">
                ▸
              </span>
            ) : (
              <span aria-hidden className="block h-3.5 w-[3px] rounded-full bg-foreground" />
            )}
          </div>
        ) : null}
      </div>

      <div aria-hidden className="relative mt-0.5 h-3 font-mono text-[9px] tabular-nums text-muted-foreground">
        <span className="absolute left-0">{fmt(min)}</span>
        {ticks.map((tick) => (
          <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${pct(tick)}%` }}>
            {fmt(tick)}
          </span>
        ))}
        <span className="absolute right-0">{fmt(max)}</span>
      </div>
      {tooltip}
    </div>
  );
}
