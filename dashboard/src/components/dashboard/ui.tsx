"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatChangePercent, formatSigned, TREND_PILL_CLASS, TREND_TEXT_CLASS, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DashboardCard({
  className,
  children,
  labelledBy,
}: {
  className?: string;
  children: ReactNode;
  /** id of the heading that names this region. */
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn("overflow-hidden rounded-2xl border border-border/60 bg-card", className)}>
      {children}
    </section>
  );
}

export function CardHeading({
  id,
  icon,
  title,
  subtitle,
  action,
  className,
}: {
  id?: string;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {icon && <span className="text-muted-foreground" aria-hidden="true">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/** Signed percent change in the up/down colour, e.g. "+%1,51". Missing → "—". */
export function ChangePercent({ value, className, withIcon = false }: { value: number | null | undefined; className?: string; withIcon?: boolean }) {
  const tone = trendTone(value);
  const Icon = TREND_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono tabular-nums", TREND_TEXT_CLASS[tone], className)}>
      {withIcon && value !== null && value !== undefined && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {formatChangePercent(value)}
    </span>
  );
}

/** Tinted pill variant for tables/lists. */
export function ChangePill({ value, className }: { value: number | null | undefined; className?: string }) {
  const tone = trendTone(value);
  return (
    <span
      className={cn(
        "inline-flex min-w-[4.5rem] justify-end rounded-md px-2 py-0.5 font-mono text-xs font-semibold tabular-nums",
        TREND_PILL_CLASS[tone],
        className,
      )}
    >
      {formatChangePercent(value)}
    </span>
  );
}

/** Signed absolute change + percent: "+104,11 (+%0,78)". */
export function ChangeLine({ change, percent, className }: { change: number | null | undefined; percent: number | null | undefined; className?: string }) {
  const tone = trendTone(percent ?? change);
  const Icon = TREND_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums", TREND_TEXT_CLASS[tone], className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {formatSigned(change)} ({formatChangePercent(percent)})
    </span>
  );
}

export function StatItem({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-xs font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function RowSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 px-5 pb-5", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/40" />
      ))}
    </div>
  );
}
