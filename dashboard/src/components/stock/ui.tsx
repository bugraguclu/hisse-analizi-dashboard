"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertCircle, Inbox, Info, RefreshCw } from "lucide-react";
import { SegmentBar } from "@/components/charts/mini";
import { buttonVariants } from "@/components/ui/button";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
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

/**
 * Heading level of SectionCard titles: h2 directly on a page, h3 when the cards
 * sit under a column heading (the combined view's technical/fundamental columns).
 */
const SectionHeadingLevelContext = createContext<2 | 3>(2);

export function SectionHeadingLevel({ level, children }: { level: 2 | 3; children: ReactNode }) {
  return <SectionHeadingLevelContext.Provider value={level}>{children}</SectionHeadingLevelContext.Provider>;
}

/**
 * The flat panel every stock-page section uses: a text-only title row (actions
 * sit on the right and wrap under the title when the card is narrow), a body that
 * is a size container (children can use `@sm:` / `@md:` / `@lg:` …) and an
 * optional footnote. The body grows, so cards stretched to a shared row height
 * keep their footers on the same line.
 */
export function SectionCard({
  title,
  actions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  /** @deprecated Section titles are text-only; the icon is no longer rendered. */
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  const Heading = useContext(SectionHeadingLevelContext) === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={headingId} className={cn("card-surface flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
        <Heading id={headingId} className="min-w-0 text-[13px] font-semibold leading-5 text-foreground">
          {title}
        </Heading>
        {actions ? <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </header>
      <div className={cn("@container min-w-0 grow p-4", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">{footer}</footer>
      ) : null}
    </section>
  );
}

/**
 * Single-choice picker for card headers: the design-system SegmentedControl
 * (radiogroup with arrow-key navigation), with a 32px target on touch screens.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "sm",
  variant = "pill",
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  size?: "xs" | "sm" | "md";
  variant?: "pill" | "underline";
  className?: string;
}) {
  return (
    <SegmentedControl
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      size={size}
      variant={variant}
      className={cn("pointer-coarse:[&>button]:h-8", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Loading / error / empty states
// ---------------------------------------------------------------------------

/** Label widths (%) of the skeleton rows — varied so the placeholder reads like a list, not a block. */
const SKELETON_LABEL_WIDTHS = [46, 62, 38, 56, 42, 58, 50];

/** Loading placeholder shaped like the label / value rows most sections render. */
export function SectionSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  const { t } = useStockI18n();
  return (
    <div className={cn("space-y-3.5 py-1", className)} role="status" aria-live="polite">
      <span className="sr-only">{t("state.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center justify-between gap-6">
          <Skeleton className="h-3" style={{ width: `${SKELETON_LABEL_WIDTHS[i % SKELETON_LABEL_WIDTHS.length]}%` }} />
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
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
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-4 text-center", compact ? "py-4" : "py-8")}>
      <p className="flex items-start gap-1.5 text-[13px] leading-5 text-foreground">
        <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>{message ?? t(errorKey(error))}</span>
      </p>
      {detail ? <p className="max-w-md break-words text-xs text-muted-foreground">{detail}</p> : null}
      {onRetry ? (
        <button type="button" onClick={onRetry} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1 pointer-coarse:h-8")}>
          <RefreshCw aria-hidden />
          {t("state.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function SectionEmpty({ message, hint, compact = false }: { message: string; hint?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-4 text-center", compact ? "py-4" : "py-8")}>
      <p className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
        <Inbox aria-hidden className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
        <span>{message}</span>
      </p>
      {hint ? <div className="max-w-sm text-xs text-muted-foreground">{hint}</div> : null}
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
          "inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
          trigger ? "gap-1.5" : "h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8",
          triggerClassName,
        )}
      >
        {trigger ?? <Info aria-hidden className="h-3.5 w-3.5" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-50">
          <Popover.Popup className="max-w-[min(22rem,calc(100vw-2rem))] origin-[var(--transform-origin)] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
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

/**
 * Buy/sell badge. Bullish/bearish use the up/down price tokens, a neutral vote the
 * warn tone and an unrecognised upstream value stays muted.
 */
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
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-sm font-semibold uppercase leading-none tracking-wide",
        size === "sm" ? "h-[18px] px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
        level === null ? TREND_PILL_CLASS.flat : tone === "flat" ? "bg-warn/10 text-warn" : TREND_PILL_CLASS[tone],
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
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <SegmentBar
        segments={[
          { key: "buy", label: t("signal.buy"), value: b, tone: "up" },
          { key: "neutral", label: t("signal.neutral"), value: n, tone: "warn" },
          { key: "sell", label: t("signal.sell"), value: s, tone: "down" },
        ]}
        ariaLabel={t("signal.votes", { buy: b, neutral: n, sell: s })}
        height={6}
        className="min-w-12 flex-1"
      />
      <span aria-hidden className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        <span className="text-up">{b}</span>
        {" · "}
        <span className="text-warn">{n}</span>
        {" · "}
        <span className="text-down">{s}</span>
      </span>
    </div>
  );
}

/**
 * Label/value pair for use inside a <dl>. The value sits on the bottom line, so
 * a grid row of stats stays aligned when one label wraps.
 */
export function Stat({
  label,
  value,
  sub,
  pending = false,
  valueClassName,
  wrapLabel = false,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  pending?: boolean;
  valueClassName?: string;
  /** Let a long label wrap onto a second line (between words) instead of truncating. The value
   *  then sits at the bottom of the cell, so a grid row's values stay level when only some labels
   *  wrap. Without it values sit right under their label (a wrapping value never pushes its
   *  neighbours' values away from their labels). */
  wrapLabel?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt
        title={typeof label === "string" ? label : undefined}
        className={cn(
          "text-[11px] font-medium uppercase leading-4 tracking-wide text-muted-foreground",
          wrapLabel ? "line-clamp-2" : "truncate",
        )}
      >
        {label}
      </dt>
      <dd className={cn("truncate pt-1 font-mono text-sm font-medium leading-5 tabular-nums text-foreground", wrapLabel && "mt-auto", valueClassName)}>
        {pending ? <Skeleton className="my-1 h-3 w-16" /> : value}
      </dd>
      {sub ? <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

/** Card-shaped stand-in for a section that has not mounted yet, so the page keeps its rhythm. */
function LazyPlaceholder({ minHeight, columns }: { minHeight: number; columns: 1 | 2 }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-1 gap-4", columns === 2 && "lg:grid-cols-2")}>
      {Array.from({ length: columns }, (_, card) => (
        <div key={card} className="card-surface flex flex-col overflow-hidden" style={{ minHeight }}>
          <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="space-y-3.5 p-4">
            {SKELETON_LABEL_WIDTHS.slice(0, 4).map((width, row) => (
              <div key={row} className="flex items-center justify-between gap-6">
                <Skeleton className="h-3" style={{ width: `${width}%` }} />
                <Skeleton className="h-3 w-14 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Mounts its children only once they approach the viewport, so below-the-fold
 * sections don't compete with the header/chart for the browser's connection
 * pool (several fundamentals endpoints take 6-20 s when cold). Until then a
 * card-shaped placeholder holds the space (`columns={2}` for a pair of cards).
 */
export function LazySection({
  children,
  minHeight = 320,
  className,
  columns = 1,
}: {
  children: ReactNode;
  minHeight?: number;
  className?: string;
  columns?: 1 | 2;
}) {
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
      {visible ? children : <LazyPlaceholder minHeight={minHeight} columns={columns} />}
    </div>
  );
}
