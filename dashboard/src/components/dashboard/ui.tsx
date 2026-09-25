"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatChangePercent, formatSigned, TREND_TEXT_CLASS, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Flat panel used by every home-page section. */
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
    <section aria-labelledby={labelledBy} className={cn("card-surface min-w-0 overflow-hidden", className)}>
      {children}
    </section>
  );
}

/** Panel title row: plain text title, optional one-line subtitle and a right-aligned action. */
export function CardHeading({
  id,
  title,
  subtitle,
  action,
  className,
}: {
  id?: string;
  /** @deprecated Card headings are text-only; the icon is ignored. */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-[13px] font-semibold text-foreground">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 text-xs">{action}</div>}
    </div>
  );
}

/** Small-caps label above a group of rows inside a panel ("EN ÇOK YÜKSELENLER"). */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</p>;
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

/** Right-aligned change figure for tables/lists: coloured text on a faint tint. */
export function ChangePill({ value, className }: { value: number | null | undefined; className?: string }) {
  const tone = trendTone(value);
  return (
    <span
      className={cn(
        "inline-flex min-w-[4.25rem] justify-end rounded-sm px-1.5 py-px font-mono text-xs font-medium tabular-nums",
        tone === "up" && "bg-up/10 text-up",
        tone === "down" && "bg-down/10 text-down",
        tone === "flat" && "text-muted-foreground",
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
    <span className={cn("inline-flex items-center gap-1 font-mono text-sm font-medium tabular-nums", TREND_TEXT_CLASS[tone], className)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {formatSigned(change)} ({formatChangePercent(percent)})
    </span>
  );
}

export function StatItem({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-[13px] font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export function RowSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 px-4 py-4", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-sm bg-muted/60 skeleton-shimmer" />
      ))}
    </div>
  );
}
