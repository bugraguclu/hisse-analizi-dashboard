"use client";

import { MotionPopoverPopup } from "@/components/ui/motion-surface";
import { useId, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { AlertCircle, Inbox, Info, RefreshCw } from "lucide-react";
import { SegmentBar } from "@/components/charts/mini";
import { PANEL_CONTENT, TRANSIENT, usePanel, usePanelBody } from "@/components/workspace/panel";
import { buttonVariants } from "@/components/ui/button";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api";
import { TREND_PILL_CLASS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SectionHeadingLevel, useSectionHeadingLevel } from "./heading-level";
import { useStockI18n, type StockKey } from "./i18n";
import { signalTone } from "./parsers";
import type { SignalLevel } from "./types";

// ---------------------------------------------------------------------------
// Section chrome
// ---------------------------------------------------------------------------

export { SectionHeadingLevel };

/**
 * The flat panel every stock-page section uses: a text-only title row (actions
 * sit on the right and wrap under the title when the card is narrow), a body that
 * is a size container (children can use `@sm:` / `@md:` / `@lg:` …) and an
 * optional footnote. The body grows, so cards stretched to a shared row height
 * keep their footers on the same line.
 *
 * In a layout slot (see Workspace) the card is as tall as the slot. Its content
 * scrolls with the footnote after it, so a short card shows content rather than
 * small print, and the slot stops growing where the content ends. `stretch` is
 * for content that takes whatever height there is (a chart) instead.
 */
export function SectionCard({
  title,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  stretch = false,
}: {
  title: ReactNode;
  /** @deprecated Section titles are text-only; the icon is no longer rendered. */
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  stretch?: boolean;
}) {
  const headingId = useId();
  const Heading = useSectionHeadingLevel() === 3 ? "h3" : "h2";
  const { fill } = usePanel();
  const bodyRef = usePanelBody();
  const scrolls = fill && !stretch;
  const note = footer ? (
    <footer
      className={cn(
        "shrink-0 border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground",
        scrolls && "mt-auto",
        // A short chart card gives the small print's room to the plot.
        fill && stretch && "slot-short:hidden",
      )}
    >
      {footer}
    </footer>
  ) : null;
  return (
    <section aria-labelledby={headingId} className={cn("card-surface flex min-w-0 flex-col overflow-hidden", fill && "min-h-0", className)}>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2">
        <Heading id={headingId} className="min-w-0 text-[13px] font-semibold leading-5 text-foreground">
          {title}
        </Heading>
        {actions ? <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">{actions}</div> : null}
      </header>
      <div
        ref={stretch ? undefined : bodyRef}
        className={cn("flex min-w-0 grow flex-col", fill && "min-h-0 basis-0", scrolls && "overflow-x-hidden overflow-y-auto scrollbar-thin")}
      >
        <div {...PANEL_CONTENT} className={cn("flex min-w-0 flex-col", scrolls ? "min-h-full shrink-0" : "min-h-0 grow")}>
          <div className={cn("@container min-w-0 p-4", scrolls ? "shrink-0" : "min-h-0 grow", bodyClassName)}>{children}</div>
          {scrolls ? note : null}
        </div>
      </div>
      {scrolls ? null : note}
    </section>
  );
}

/**
 * For a list of ruled rows in a layout slot: a wide card sets the rows in two
 * columns, without rules, instead of stretching each row across the card.
 */
export const SPLIT_ROWS = "@3xl:grid @3xl:grid-cols-2 @3xl:gap-x-10 @3xl:[&>li]:border-t-0 @3xl:[&>li]:py-2!";

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
    <div {...TRANSIENT} className={cn("space-y-3.5 py-1 skeleton-rows", className)} role="status" aria-live="polite">
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
    <div {...TRANSIENT} role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-4 text-center", compact ? "py-4" : "py-8")}>
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
          "inline-flex items-center justify-center rounded-md text-muted-foreground motion-press hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
          trigger ? "gap-1.5" : "h-6 w-6 pointer-coarse:h-8 pointer-coarse:w-8",
          triggerClassName,
        )}
      >
        {trigger ?? <Info aria-hidden className="h-3.5 w-3.5" />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} collisionPadding={12} className="z-50">
          <MotionPopoverPopup className="max-w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-[var(--shadow-popover)] outline-none">
            {children}
          </MotionPopoverPopup>
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
