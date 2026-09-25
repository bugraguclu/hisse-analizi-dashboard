"use client";

import { useId, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ArrowDownRight, ArrowUpRight, Info, Minus, RefreshCw } from "lucide-react";
import { isApiError } from "@/lib/api";
import { formatChangePercent, TREND_TEXT_CLASS, trendTone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/segmented-control";
import { useMakroI18n, type MakroKey } from "./i18n";

// ---------------------------------------------------------------------------
// Page structure
// ---------------------------------------------------------------------------

/** One titled block of the page ("Para politikası", "Enflasyon" …) with an anchor id. */
export function MacroSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-24 space-y-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id={headingId} className="text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Flat panel with a text title row, optional right-aligned actions and a footnote. */
export function Panel({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("card-surface flex min-w-0 flex-col overflow-hidden", className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-[13px] font-semibold text-foreground">
            {title}
          </h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("flex-1 px-4 py-3", bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="border-t border-border px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">{footer}</footer>
      ) : null}
    </section>
  );
}

/** Small-caps data label ("POLİTİKA FAİZİ"). */
export function DataLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</span>;
}

const SOURCE_KEYS: Record<string, MakroKey> = {
  TCMB: "src.tcmb",
  "TÜİK": "src.tuik",
  "TÜİK (TCMB veri tablosu)": "src.tuikTable",
  "TradingView ekonomik veri": "src.tvEconomics",
};

/** Display name of an API source ("TCMB, TÜİK" → "CBRT, TurkStat" in English); unknown names pass through. */
export function sourceLabel(source: string, t: (key: MakroKey) => string): string {
  return source
    .split(/,\s*/)
    .map((part) => (SOURCE_KEYS[part] ? t(SOURCE_KEYS[part]) : part))
    .join(", ");
}

/** "Kaynak: TCMB · 22 Eyl 2026 itibarıyla" line; empty parts are dropped. */
export function SourceLine({ source, parts }: { source?: string | null; parts?: Array<ReactNode | null | undefined | false> }) {
  const { t } = useMakroI18n();
  const items = [source ? `${t("common.source")}: ${sourceLabel(source, t)}` : null, ...(parts ?? [])].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <span>
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 ? " · " : null}
          {item}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) && error.detail ? error.detail : fallback;
}

export function PanelError({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useMakroI18n();
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 py-8 text-center", className)}>
      <p className="text-[13px] text-foreground">{errorMessage(error, t("common.loadError"))}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          {t("common.retry")}
        </button>
      ) : null}
    </div>
  );
}

export function PanelEmpty({ message, className }: { message?: string; className?: string }) {
  const { t } = useMakroI18n();
  return <p className={cn("py-8 text-center text-[13px] text-muted-foreground", className)}>{message ?? t("common.noData")}</p>;
}

/** Shimmer block sized like the content it stands in for. */
export function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" style={style} className={cn("rounded-sm bg-muted/60 skeleton-shimmer", className)} />;
}

// ---------------------------------------------------------------------------
// Numbers and changes
// ---------------------------------------------------------------------------

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

/**
 * Price change in the site's direction colours (up = green, down = red). Only for
 * market prices — rates, yields and macro releases use {@link NeutralChange}.
 */
export function PriceChange({ value, className, withIcon = false }: { value: number | null | undefined; className?: string; withIcon?: boolean }) {
  const tone = trendTone(value);
  const Icon = TREND_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono tabular-nums", TREND_TEXT_CLASS[tone], className)}>
      {withIcon && value !== null && value !== undefined ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {formatChangePercent(value)}
    </span>
  );
}

/**
 * Direction-only change for rates and macro releases: an arrow glyph in the muted
 * ink, because "up" is neither good nor bad for inflation, yields or unemployment.
 */
export function NeutralChange({ value, text, className }: { value: number | null | undefined; text: string; className?: string }) {
  const tone = trendTone(value);
  const glyph = tone === "up" ? "▲" : tone === "down" ? "▼" : "■";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono tabular-nums text-muted-foreground", className)}>
      <span aria-hidden="true" className="text-[8px] leading-none">
        {glyph}
      </span>
      {text}
    </span>
  );
}

/**
 * Grid of stat tiles inside one flat panel, separated by hairlines at every
 * breakpoint: each tile draws its right/bottom rule and the outer ones are
 * clipped, so incomplete last rows leave no stray borders or grey cells.
 */
export function TileGrid({ className, children, label }: { className?: string; children: ReactNode; label?: string }) {
  return (
    <div className="card-surface overflow-hidden" role={label ? "group" : undefined} aria-label={label}>
      <div className={cn("-mb-px -mr-px grid [&>*]:border-b [&>*]:border-r [&>*]:border-border", className)}>{children}</div>
    </div>
  );
}

/**
 * Stat tile: label, value, then one line with the change and the reference period.
 * `size="lg"` is the headline KPI variant.
 */
export function StatTile({
  label,
  value,
  change,
  meta,
  hint,
  info,
  loading = false,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  change?: ReactNode;
  meta?: ReactNode;
  hint?: ReactNode;
  /** Optional explanation behind an (i) button next to the label. */
  info?: { label: string; content: ReactNode };
  loading?: boolean;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    // Four subgrid rows — label, value, change, hint — shared by every tile in the same
    // TileGrid row: labels wrap instead of being cut, and values stay on one line.
    <div className={cn("row-span-4 grid min-w-0 grid-rows-subgrid px-4 py-3", className)}>
      <div className="flex min-h-5 items-center gap-1 self-start">
        <DataLabel className="min-w-0">{label}</DataLabel>
        {info ? <InfoPopover label={info.label}>{info.content}</InfoPopover> : null}
      </div>
      {loading ? (
        <>
          <Shimmer className={cn("mt-1.5", size === "lg" ? "h-7 w-24" : "h-6 w-20")} />
          <Shimmer className="mt-2 h-3 w-28" />
          <span />
        </>
      ) : (
        <>
          <div
            className={cn(
              "mt-1 truncate font-mono font-semibold tabular-nums text-foreground",
              size === "lg" ? "text-[22px] leading-7" : "text-lg leading-6",
            )}
          >
            {value}
          </div>
          {change || meta ? (
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start text-[11px]">
              {change}
              {meta ? <span className="text-muted-foreground">{meta}</span> : null}
            </div>
          ) : (
            <span />
          )}
          {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : <span />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** Range/period picker (pill segmented control) used by every chart panel. */
export function RangePicker<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  label?: string;
}) {
  const { t } = useMakroI18n();
  return <SegmentedControl label={label ?? t("common.range")} value={value} options={options} onChange={onChange} size="xs" />;
}

export type ChartView = "chart" | "table";

/** Chart ⇄ table switch — every chart has a table twin (accessibility, exact values). */
export function ViewToggle({ value, onChange }: { value: ChartView; onChange: (value: ChartView) => void }) {
  const { t } = useMakroI18n();
  return (
    <SegmentedControl
      label={t("common.view")}
      value={value}
      onChange={onChange}
      size="xs"
      options={[
        { value: "chart", label: t("common.chart") },
        { value: "table", label: t("common.table") },
      ]}
    />
  );
}

/** Click/tap popover with an explanation (keyboard and screen-reader accessible). */
export function InfoPopover({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          className,
        )}
      >
        <Info aria-hidden className="h-3.5 w-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-50">
          <Popover.Popup className="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-lg outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
