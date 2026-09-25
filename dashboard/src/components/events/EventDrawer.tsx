"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { Dialog } from "@base-ui/react/dialog";
import { Check, ChevronDown, ChevronUp, ExternalLink, LineChart, Link2, ListFilter, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { categoryKeys, SEVERITY_TEXT_CLASS, severityKeys } from "@/components/shared/SeverityBadge";
import { useNow } from "@/hooks/use-now";
import { isApiError } from "@/lib/api";
import { formatMarketDate, formatRelativeTime } from "@/lib/format";
import { safeExternalUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import type { Company, EventOut } from "@/types";
import { EventContentBody } from "./EventContent";
import { rowButtonId } from "./EventRow";
import { useEventsI18n } from "./i18n";
import {
  titleCaseAllCaps,
  eventCategory,
  eventCompanyName,
  eventDate,
  eventFormName,
  eventHeadline,
  eventSeverity,
  eventTickers,
  isEventId,
} from "./model";
import { useEventContent, useEventDetail } from "./queries";
import { ACTION_CLASS, IconButton, SeverityMarker } from "./ui";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function Lines({ widths }: { widths: string[] }) {
  return (
    <div aria-hidden="true" className="space-y-2.5">
      {widths.map((width, index) => (
        <div key={index} className="h-3.5 rounded-sm bg-muted/50 skeleton-shimmer" style={{ width }} />
      ))}
    </div>
  );
}

function ContentSection({ id, event, open }: { id: string; event: EventOut; open: boolean }) {
  const { t } = useEventsI18n();
  const headingId = useId();
  const contentQ = useEventContent(id, open);
  const kapUrl = safeExternalUrl(event.event_url) ?? safeExternalUrl(contentQ.data?.source_url);

  let body;
  if (contentQ.isPending) {
    body = (
      <div role="status">
        <span className="sr-only">{t("drawer.contentLoading")}</span>
        <Lines widths={["92%", "100%", "86%", "64%", "0%", "96%", "78%"]} />
      </div>
    );
  } else if (contentQ.isError) {
    const missing = isApiError(contentQ.error) && contentQ.error.status === 404;
    body = (
      <div className="rounded-md border border-border bg-surface px-4 py-4">
        <p className="text-[13px] font-medium text-foreground">{missing ? t("drawer.contentMissing") : t("drawer.contentUnavailable")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{missing ? t("drawer.contentMissingHint") : t("drawer.contentUnavailableHint")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {kapUrl ? (
            <a href={kapUrl} target="_blank" rel="noopener noreferrer" className={ACTION_CLASS}>
              <ExternalLink aria-hidden="true" />
              {t("drawer.openOnKap")}
              <span className="sr-only">{t("common.opensInNewTab")}</span>
            </a>
          ) : null}
          {!missing ? (
            <button type="button" className={ACTION_CLASS} onClick={() => void contentQ.refetch()} disabled={contentQ.isFetching}>
              <RefreshCw aria-hidden="true" className={cn(contentQ.isFetching && "animate-spin")} />
              {t("common.retry")}
            </button>
          ) : null}
        </div>
      </div>
    );
  } else {
    body = <EventContentBody content={contentQ.data} kapUrl={kapUrl} />;
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("drawer.content")}
      </h3>
      {body}
    </section>
  );
}

function EventDetailBody({
  event,
  open,
  companies,
  onFocusTicker,
}: {
  event: EventOut;
  open: boolean;
  companies: ReadonlyMap<string, Company> | null;
  onFocusTicker: (ticker: string) => void;
}) {
  const { t } = useEventsI18n();
  const now = useNow();
  const date = eventDate(event);
  const headline = eventHeadline(event) ?? t("row.untitled");
  const formName = eventFormName(event);
  const tickers = eventTickers(event);
  const primary = tickers[0] ?? null;
  const publisher = event.publisher?.trim() ? titleCaseAllCaps(event.publisher.trim()) : null;
  const kapUrl = safeExternalUrl(event.event_url);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const nameFor = (ticker: string) =>
    companies?.get(ticker)?.display_name ?? (ticker === primary ? eventCompanyName(event, companies) : null) ?? "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
      toast.success(t("drawer.copied"));
    } catch {
      toast.error(t("drawer.copyFailed"));
    }
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {date ? (
          <time className="font-mono" dateTime={date.toISOString()} title={formatMarketDate(date, "dateTime")}>
            {formatMarketDate(date, "dateTime")}
          </time>
        ) : null}
        {date && now !== null ? <span> · {formatRelativeTime(date, now)}</span> : null}
      </p>
      <Dialog.Title className="mt-2 text-lg font-semibold leading-snug text-foreground sm:text-xl">{headline}</Dialog.Title>
      {formName ? <p className="mt-1.5 text-[13px] text-muted-foreground">{formName}</p> : null}

      {tickers.length > 0 || publisher ? (
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-border py-3 text-[13px]">
          {tickers.length > 0 ? (
            <>
              <dt className="text-muted-foreground">{t("drawer.companies")}</dt>
              <dd className="min-w-0">
                <ul className="space-y-1">
                  {tickers.map((ticker) => (
                    <li key={ticker} className="flex min-w-0 items-baseline gap-2">
                      <Link
                        href={`/hisse/${encodeURIComponent(ticker)}`}
                        className="shrink-0 rounded-sm font-mono text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {ticker}
                      </Link>
                      <span className="min-w-0 truncate text-foreground">{nameFor(ticker)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {publisher ? (
            <>
              <dt className="text-muted-foreground">{t("drawer.publisher")}</dt>
              <dd className="min-w-0 break-words text-foreground">{publisher}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {kapUrl ? (
          <a href={kapUrl} target="_blank" rel="noopener noreferrer" className={ACTION_CLASS}>
            <ExternalLink aria-hidden="true" />
            {t("drawer.openOnKap")}
            <span className="sr-only">{t("common.opensInNewTab")}</span>
          </a>
        ) : null}
        {primary ? (
          <Link href={`/hisse/${encodeURIComponent(primary)}`} className={ACTION_CLASS}>
            <LineChart aria-hidden="true" />
            {t("drawer.stockPage")}
          </Link>
        ) : null}
        <button type="button" className={ACTION_CLASS} onClick={() => void copyLink()}>
          {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
          {copied ? t("drawer.copied") : t("drawer.copyLink")}
        </button>
        {primary ? (
          <button type="button" className={ACTION_CLASS} onClick={() => onFocusTicker(primary)}>
            <ListFilter aria-hidden="true" />
            {t("drawer.allForTicker", { ticker: primary })}
          </button>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? t("drawer.copied") : ""}
      </span>

      <ContentSection key={event.id} id={event.id} event={event} open={open} />
    </>
  );
}

/**
 * Disclosure detail as a modal sheet (`?event=<id>`): right side on md+,
 * full screen below. j/k (or ↓/↑ outside text fields) step through the
 * current page; focus returns to the row on close.
 */
export function EventDrawer({
  eventId,
  rows,
  companies,
  onNavigate,
  onClose,
  onFocusTicker,
}: {
  eventId: string | null;
  /** Rows of the current page, in display order. */
  rows: readonly EventOut[];
  companies: ReadonlyMap<string, Company> | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onFocusTicker: (ticker: string) => void;
}) {
  const { t, tShared } = useEventsI18n();
  const open = eventId !== null;
  // Keep the last disclosure rendered while the sheet animates out.
  const [shownId, setShownId] = useState<string | null>(eventId);
  if (eventId !== null && eventId !== shownId) setShownId(eventId);
  const id = eventId ?? shownId;

  const index = id ? rows.findIndex((row) => row.id === id) : -1;
  const row = index >= 0 ? rows[index] : null;
  const validId = isEventId(id);
  const detailQ = useEventDetail(id, open && validId && row === null);
  const event: EventOut | null = row ?? (detailQ.data && detailQ.data.id === id ? detailQ.data : null);
  const prevId = index > 0 ? rows[index - 1].id : null;
  const nextId = index >= 0 && index < rows.length - 1 ? rows[index + 1].id : null;

  const bodyRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const lastId = useRef(id);
  useEffect(() => {
    lastId.current = id;
  }, [id]);

  const go = useCallback(
    (targetId: string | null) => {
      if (!targetId) return;
      const targetIndex = rows.findIndex((item) => item.id === targetId);
      const target = rows[targetIndex];
      if (!target) return;
      onNavigate(targetId);
      bodyRef.current?.scrollTo({ top: 0 });
      setAnnouncement(
        t("drawer.navAnnouncement", {
          index: targetIndex + 1,
          count: rows.length,
          title: eventHeadline(target) ?? t("row.untitled"),
        }),
      );
    },
    [rows, onNavigate, t],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    if ((event.key === "j" || event.key === "ArrowDown") && nextId) {
      event.preventDefault();
      go(nextId);
    } else if ((event.key === "k" || event.key === "ArrowUp") && prevId) {
      event.preventDefault();
      go(prevId);
    }
  }

  const finalFocus = useCallback(() => {
    const target = lastId.current ? document.getElementById(rowButtonId(lastId.current)) : null;
    return target ?? true;
  }, []);

  const severity = event ? eventSeverity(event) : "INFO";
  const category = event ? eventCategory(event) : null;
  const notFound =
    !validId || (!event && detailQ.isError && isApiError(detailQ.error) && detailQ.error.status === 404);

  let body;
  if (notFound) {
    body = (
      <div className="py-12 text-center">
        <Dialog.Title className="text-base font-semibold text-foreground">{t("drawer.notFound")}</Dialog.Title>
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted-foreground">{t("drawer.notFoundHint")}</p>
      </div>
    );
  } else if (!event && detailQ.isError) {
    body = (
      <div className="py-12 text-center">
        <Dialog.Title className="text-base font-semibold text-foreground">{t("drawer.loadError")}</Dialog.Title>
        <button type="button" className={cn(ACTION_CLASS, "mt-4")} onClick={() => void detailQ.refetch()}>
          <RefreshCw aria-hidden="true" />
          {t("common.retry")}
        </button>
      </div>
    );
  } else if (!event) {
    body = (
      <div role="status">
        <Dialog.Title className="sr-only">{t("drawer.label")}</Dialog.Title>
        <Lines widths={["30%", "0%", "90%", "70%", "0%", "45%", "0%", "100%", "95%", "80%"]} />
      </div>
    );
  } else {
    body = <EventDetailBody event={event} open={open} companies={companies} onFocusTicker={onFocusTicker} />;
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          initialFocus={bodyRef}
          finalFocus={finalFocus}
          onKeyDown={handleKeyDown}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-card text-foreground outline-none",
            "transition-transform duration-200 ease-out data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
            "md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-[44rem] md:border-l md:border-border",
            "md:data-[ending-style]:translate-x-full md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-full md:data-[starting-style]:translate-y-0",
          )}
        >
          <div className="flex items-center gap-1 border-b border-border py-2 pl-4 pr-2 sm:pl-6 sm:pr-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              {event && severity !== "INFO" ? (
                <span className={cn("inline-flex items-center gap-1.5 font-medium", SEVERITY_TEXT_CLASS[severity])}>
                  <SeverityMarker level={severity} />
                  {tShared(severityKeys[severity])}
                </span>
              ) : null}
              {category ? <span className="text-muted-foreground">{tShared(categoryKeys[category])}</span> : null}
              {event?.is_correction ? <span className="font-medium text-warn">{t("row.correction")}</span> : null}
            </div>
            {index >= 0 && rows.length > 1 ? (
              <span className="mr-1 hidden font-mono text-[11px] text-muted-foreground sm:inline">
                {t("drawer.position", { index: index + 1, count: rows.length })}
              </span>
            ) : null}
            <IconButton
              aria-label={t("drawer.prev")}
              aria-keyshortcuts="k"
              title={`${t("drawer.prev")} (k)`}
              disabled={!prevId}
              onClick={() => go(prevId)}
            >
              <ChevronUp aria-hidden="true" className="h-4 w-4" />
            </IconButton>
            <IconButton
              aria-label={t("drawer.next")}
              aria-keyshortcuts="j"
              title={`${t("drawer.next")} (j)`}
              disabled={!nextId}
              onClick={() => go(nextId)}
            >
              <ChevronDown aria-hidden="true" className="h-4 w-4" />
            </IconButton>
            <Dialog.Close render={<IconButton aria-label={t("drawer.close")} title={`${t("drawer.close")} (Esc)`} />}>
              <X aria-hidden="true" className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div ref={bodyRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none scrollbar-thin">
            <article className="px-4 py-5 sm:px-6 sm:py-6">
              {body}
              {rows.length > 1 && index >= 0 ? (
                <p className="mt-10 hidden text-[11px] text-muted-foreground md:block">{t("drawer.keysHint")}</p>
              ) : null}
            </article>
            <p className="sr-only" aria-live="polite">
              {announcement}
            </p>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
