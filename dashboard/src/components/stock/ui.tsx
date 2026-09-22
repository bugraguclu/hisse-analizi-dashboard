"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertCircle, Inbox, Info, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { TREND_PILL_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStockI18n, type StockKey } from "./i18n";
import { signalTone } from "./parsers";
import type { SignalLevel } from "./types";

// ---------------------------------------------------------------------------
// Section chrome
// ---------------------------------------------------------------------------

export function SectionCard({
  title,
  icon,
  actions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card", className)}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border/40 px-4 py-3 sm:px-5">
        {icon ? <span aria-hidden className="flex shrink-0 items-center text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h2>
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="border-t border-border/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

/** Segmented control (radio-like buttons). */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "sm",
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  size?: "xs" | "sm";
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted/50 p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              size === "xs" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error / empty states
// ---------------------------------------------------------------------------

export function SectionSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  const { t } = useStockI18n();
  return (
    <div className={cn("space-y-2.5", className)} role="status" aria-live="polite">
      <span className="sr-only">{t("state.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

function errorKey(error: unknown): StockKey {
  if (isApiError(error)) {
    if (error.code === "timeout") return "error.timeout";
    if (error.status === null) return "error.network";
    if (error.status === 429) return "error.rateLimited";
    if (error.status === 503) return "error.unavailable";
    if (error.status >= 500) return "error.upstream";
  }
  return "error.generic";
}

export function SectionError({
  error,
  message,
  onRetry,
  compact = false,
  showDetail = false,
}: {
  error?: unknown;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
  /** Also show the backend's explanation (e.g. "no KAP page for this company"). */
  showDetail?: boolean;
}) {
  const { t } = useStockI18n();
  const detail = showDetail && isApiError(error) && error.status !== null ? error.detail : null;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-2 text-center", compact ? "py-4" : "py-8")}>
      <AlertCircle aria-hidden className="h-5 w-5 text-destructive/80" />
      <p className="text-sm font-medium text-destructive/90">{message ?? t(errorKey(error))}</p>
      {detail ? <p className="max-w-md text-[11px] text-muted-foreground">{detail}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <RefreshCw aria-hidden className="h-3 w-3" />
          {t("state.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function SectionEmpty({ message, hint, compact = false }: { message: string; hint?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-2 text-center text-muted-foreground", compact ? "py-4" : "py-8")}>
      <Inbox aria-hidden className="h-5 w-5 opacity-60" />
      <p className="text-sm font-medium">{message}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** Click/tap popover with explanatory content (keyboard + screen-reader accessible). */
export function InfoPopover({
  label,
  children,
  trigger,
  triggerClassName,
}: {
  label: string;
  children: ReactNode;
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={trigger ? undefined : label}
        className={cn(
          "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          trigger ? "gap-1" : "h-6 w-6",
          triggerClassName,
        )}
      >
        {trigger ?? <Info aria-hidden className="h-3.5 w-3.5" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="max-w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border/60 bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-xl outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const SIGNAL_LABEL: Record<SignalLevel, StockKey> = {
  strongBuy: "signal.strongBuy",
  buy: "signal.buy",
  neutral: "signal.neutral",
  sell: "signal.sell",
  strongSell: "signal.strongSell",
};

export function useSignalLabel() {
  const { t } = useStockI18n();
  return (level: SignalLevel | null, raw?: string | null) => (level ? t(SIGNAL_LABEL[level]) : raw || t("signal.unknown"));
}

/** Buy/sell badge. Bullish/bearish use the up/down price tokens; neutral is amber. */
export function SignalBadge({
  level,
  raw,
  size = "sm",
  className,
}: {
  level: SignalLevel | null;
  raw?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const label = useSignalLabel();
  const tone = signalTone(level);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md font-bold uppercase tracking-wide",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        tone === "flat" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : TREND_PILL_CLASS[tone],
        className,
      )}
    >
      {label(level, raw)}
    </span>
  );
}

/** Stacked buy / neutral / sell vote bar with counts. */
export function VoteBar({
  buy,
  neutral,
  sell,
  className,
}: {
  buy: number | null;
  neutral: number | null;
  sell: number | null;
  className?: string;
}) {
  const { t } = useStockI18n();
  const b = buy ?? 0;
  const n = neutral ?? 0;
  const s = sell ?? 0;
  const total = b + n + s;
  if (total <= 0) return null;
  const width = (count: number) => `${(count / total) * 100}%`;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div
        role="img"
        aria-label={t("signal.votes", { buy: b, neutral: n, sell: s })}
        className="flex h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-muted/40"
      >
        {b > 0 ? <div className="h-full bg-up" style={{ width: width(b) }} /> : null}
        {n > 0 ? <div className="h-full bg-amber-400" style={{ width: width(n) }} /> : null}
        {s > 0 ? <div className="h-full bg-down" style={{ width: width(s) }} /> : null}
      </div>
      <span aria-hidden className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        <span className="text-up">{b}</span>
        {" · "}
        <span className="text-amber-600 dark:text-amber-400">{n}</span>
        {" · "}
        <span className="text-down">{s}</span>
      </span>
    </div>
  );
}

/** Label/value pair for use inside a <dl>. */
export function Stat({
  label,
  value,
  sub,
  pending = false,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  pending?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 truncate font-mono text-sm font-bold tabular-nums text-foreground", valueClassName)}>
        {pending ? <Skeleton className="h-4 w-16" /> : value}
      </dd>
      {sub ? <dd className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

/**
 * Mounts its children only once they approach the viewport, so below-the-fold
 * sections don't compete with the header/chart for the browser's connection
 * pool (several fundamentals endpoints take 6-20 s when cold).
 */
export function LazySection({ children, minHeight = 320, className }: { children: ReactNode; minHeight?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className={cn("min-w-0", className)}>
      {visible ? (
        children
      ) : (
        <div aria-hidden className="rounded-2xl border border-border/40 bg-card/60 motion-safe:animate-pulse" style={{ minHeight }} />
      )}
    </div>
  );
}
