"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, ArrowUpRight, Paperclip, X } from "lucide-react";
import { categoryKeys, severityKeys, toCategoryKey, toSeverity, type SeverityKey } from "@/components/shared/SeverityBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { safeExternalUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { asObj } from "./parsers";
import { isNotFoundError, useEventDetail, useKapItems } from "./hooks";
import { useStockI18n } from "./i18n";
import type { KapItem } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

const WEEK_MS = 7 * 86_400_000;

/** Severity is a thin rule at the row's edge plus a word; routine (INFO) items stay unmarked. */
const SEVERITY_RULE: Record<SeverityKey, string | null> = { HIGH: "bg-destructive", WATCH: "bg-warn", INFO: null };
const SEVERITY_TEXT: Record<SeverityKey, string> = { HIGH: "text-destructive", WATCH: "text-warn", INFO: "text-muted-foreground" };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Optional disclosure details (newer backends only) shared by the rows and the dialog. */
interface Extras {
  severity: SeverityKey;
  categoryCode?: string | null;
  isCorrection?: boolean;
  tickerCount?: number | null;
  attachmentCount?: number | null;
}

/** Meta line pieces joined by "·": category, severity (when notable), correction, collective notice, attachments. */
function useMetaParts({ severity, categoryCode, isCorrection, tickerCount, attachmentCount }: Extras): ReactNode[] {
  const { t } = useStockI18n();
  const { t: tGlobal } = useLocale();
  const parts: ReactNode[] = [];
  const category = toCategoryKey(categoryCode);
  if (category && category !== "OTHER") parts.push(<span key="category">{tGlobal(categoryKeys[category])}</span>);
  if (severity !== "INFO") {
    parts.push(
      <span key="severity" className={cn("font-medium", SEVERITY_TEXT[severity])}>
        {tGlobal(severityKeys[severity])}
      </span>,
    );
  }
  if (isCorrection) {
    parts.push(
      <span key="correction" className="font-medium text-warn">
        {t("kap.correction")}
      </span>,
    );
  }
  if (tickerCount != null && tickerCount > 1) parts.push(<span key="companies">{t("kap.companies", { count: tickerCount })}</span>);
  if (attachmentCount != null && attachmentCount > 0) {
    parts.push(
      <span key="attachments" className="inline-flex items-center gap-0.5" title={t("kap.attachments", { count: attachmentCount })}>
        <Paperclip aria-hidden className="h-3 w-3" />
        <span className="sr-only">{t("kap.attachments", { count: attachmentCount })}</span>
        <span aria-hidden className="tabular-nums">
          {attachmentCount}
        </span>
      </span>,
    );
  }
  return parts;
}

function Dotted({ parts }: { parts: ReactNode[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <span aria-hidden>·</span> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** "3 saat önce" for the last week (exact time in the tooltip), the date itself for older items. */
function ItemTime({ value, now }: { value: string | number | null; now: number | null }) {
  const date = parseDate(value);
  if (!date) return null;
  const relative = now !== null && Math.abs(now - date.getTime()) < WEEK_MS ? formatRelativeTime(date, now) : null;
  return (
    <time dateTime={date.toISOString()} title={formatMarketDate(date, "dateTime")} className="whitespace-nowrap tabular-nums">
      {relative ?? formatMarketDate(date, "date")}
    </time>
  );
}

function EventDetailDialog({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  const { t } = useStockI18n();
  const detailQ = useEventDetail(eventId);
  const detail = asObj(detailQ.data);
  const title = text(detail?.title);
  const summary = text(detail?.summary) ?? text(detail?.excerpt);
  const body = text(detail?.body_text);
  const url = safeExternalUrl(detail?.event_url);
  const source = text(detail?.source_code)?.toUpperCase() ?? "KAP";
  const published = text(detail?.published_at);
  const tickers = detail?.tickers;
  const attachments = detail?.attachment_count;
  const meta = useMetaParts({
    severity: toSeverity(text(detail?.severity)),
    categoryCode: text(detail?.category_code),
    isCorrection: detail?.is_correction === true,
    tickerCount: Array.isArray(tickers) ? tickers.length : null,
    attachmentCount: typeof attachments === "number" && Number.isFinite(attachments) ? attachments : null,
  });

  return (
    <Dialog.Root open={eventId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="card-surface fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden shadow-[0_24px_48px_-16px_rgb(0_0_0/0.4)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0">
          <div className="flex items-center justify-between gap-3 border-b border-border py-2 pl-5 pr-3">
            <Dialog.Title className="text-[13px] font-semibold text-foreground">{t("kap.detailTitle")}</Dialog.Title>
            <Dialog.Close
              aria-label={t("common.close")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="space-y-4 overflow-y-auto p-5 scrollbar-thin">
            {detailQ.isPending ? (
              <SectionSkeleton rows={5} />
            ) : detailQ.isError ? (
              isNotFoundError(detailQ.error) ? (
                <SectionEmpty message={t("kap.detailNotFound")} />
              ) : (
                <SectionError error={detailQ.error} onRetry={() => void detailQ.refetch()} />
              )
            ) : (
              <>
                <div className="space-y-1.5">
                  <h3 className="break-words text-base font-semibold leading-snug text-foreground">{title ?? t("kap.untitled")}</h3>
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                    <Dotted
                      parts={[
                        <span key="time" className="tabular-nums">
                          {formatMarketDate(published, "dateTime")}
                        </span>,
                        <span key="source">{source}</span>,
                        ...meta,
                      ]}
                    />
                  </p>
                </div>
                {summary && summary !== title ? (
                  <div className="rounded-lg bg-surface p-4">
                    <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("kap.summary")}</h4>
                    <p className="break-words text-sm leading-relaxed text-foreground">{summary}</p>
                  </div>
                ) : null}
                {body ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{body}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{t("kap.noBody")}</p>
                )}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {t("kap.openOnKap")}
                    <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                    <span className="sr-only">{t("common.opensInNewTab")}</span>
                  </a>
                ) : null}
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * One disclosure: title (two lines at most, full text in the tooltip), optional
 * summary line and meta; opens the stored detail, or KAP itself for live-only items.
 */
function KapRow({ item, now, onOpen }: { item: KapItem; now: number | null; onOpen: (id: string) => void }) {
  const { t } = useStockI18n();
  const title = item.title || t("kap.untitled");
  const severity = item.id ? toSeverity(item.severity) : "INFO";
  const rule = SEVERITY_RULE[severity];
  const summary = item.summary && item.summary !== item.title ? item.summary : null;
  const meta = useMetaParts({
    severity,
    categoryCode: item.categoryCode,
    isCorrection: item.isCorrection,
    tickerCount: item.tickerCount,
    attachmentCount: item.attachmentCount,
  });

  const content = (
    <>
      {rule ? <span aria-hidden className={cn("absolute inset-y-3 left-0 w-0.5", rule)} /> : null}
      <span className="min-w-0">
        <span className="line-clamp-2 text-[13px] leading-snug text-foreground" title={title}>
          {title}
        </span>
        {summary ? (
          <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={summary}>
            {summary}
          </span>
        ) : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <Dotted parts={[<ItemTime key="time" value={item.time || item.publishedAt} now={now} />, ...meta]} />
        </span>
      </span>
      {!item.id && item.url ? (
        <ArrowUpRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      ) : null}
    </>
  );

  const rowClass = "group relative grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-left";
  const interactiveClass =
    "transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

  if (item.id) {
    const id = item.id;
    return (
      <button type="button" className={cn(rowClass, interactiveClass)} onClick={() => onOpen(id)} aria-haspopup="dialog">
        {content}
      </button>
    );
  }
  if (item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" className={cn(rowClass, interactiveClass)}>
        {content}
        <span className="sr-only">{t("common.opensInNewTab")}</span>
      </a>
    );
  }
  return <div className={rowClass}>{content}</div>;
}

/** Row-shaped placeholder: a title line and a meta line per disclosure. */
function KapSkeleton() {
  const { t } = useStockI18n();
  return (
    <div role="status" className="divide-y divide-border">
      <span className="sr-only">{t("state.loading")}</span>
      {[72, 56, 84, 64, 76, 60].map((width, i) => (
        <div key={i} aria-hidden className="space-y-2 px-4 py-3.5">
          <Skeleton className="h-3" style={{ width: `${width}%` }} />
          <Skeleton className="h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/**
 * KAP disclosures: DB events (with severity and a detail view) merged with
 * the live KAP feed, which also covers disclosures the poller has not stored.
 */
export function KapEventsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const now = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const kap = useKapItems(ticker, 10);

  return (
    <SectionCard
      title={t("kap.title")}
      actions={
        <Link
          href={`/events?ticker=${ticker}`}
          className="inline-flex h-8 items-center gap-1 rounded-sm text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {t("kap.viewAll")}
          <ArrowRight aria-hidden className="h-3 w-3" />
        </Link>
      }
      footer={kap.partialError ? t("kap.partialError") : t("kap.footer")}
      bodyClassName="p-0"
    >
      {kap.isPending ? (
        <KapSkeleton />
      ) : kap.isError ? (
        <SectionError error={kap.error} onRetry={kap.refetch} />
      ) : kap.items.length === 0 ? (
        <SectionEmpty message={t("kap.empty")} />
      ) : (
        <ul className="divide-y divide-border">
          {kap.items.map((item, index) => (
            <li key={item.id ?? item.url ?? `${item.time}-${index}`}>
              <KapRow item={item} now={now} onOpen={setSelected} />
            </li>
          ))}
        </ul>
      )}
      <EventDetailDialog eventId={selected} onClose={() => setSelected(null)} />
    </SectionCard>
  );
}
