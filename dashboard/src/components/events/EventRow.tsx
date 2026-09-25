"use client";

import { memo, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { categoryKeys, SEVERITY_RULE_CLASS, SEVERITY_TEXT_CLASS, severityKeys } from "@/components/shared/SeverityBadge";
import { Badge } from "@/components/ui/badge";
import { formatMarketDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Company, EventOut } from "@/types";
import { useEventsI18n } from "./i18n";
import {
  eventCategory,
  eventCompanyName,
  eventDate,
  eventForeignPublisher,
  eventFormName,
  eventHeadline,
  eventSeverity,
  eventTickers,
  istanbulDayKey,
} from "./model";

const MAX_VISIBLE_TICKERS = 3;

/** DOM id of a row's open button (focus returns here when the drawer closes). */
export function rowButtonId(eventId: string): string {
  return `event-row-${eventId}`;
}

function Separated({ items }: { items: ReactNode[] }) {
  return (
    <>
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 ? (
            <span aria-hidden="true" className="px-1 text-muted-foreground/60">
              ·
            </span>
          ) : null}
          {item}
        </span>
      ))}
    </>
  );
}

function RowTickers({
  tickers,
  activeTickers,
  onAddTicker,
  className,
}: {
  tickers: string[];
  activeTickers: ReadonlySet<string>;
  onAddTicker: (ticker: string) => void;
  className?: string;
}) {
  const { t } = useEventsI18n();
  if (tickers.length === 0) return null;
  const shown = tickers.slice(0, MAX_VISIBLE_TICKERS);
  const rest = tickers.slice(MAX_VISIBLE_TICKERS);
  return (
    // Sits above the row's stretched button; the gaps stay click-through.
    <span className={cn("pointer-events-none relative z-10 shrink-0 items-center gap-0.5", className)}>
      {shown.map((ticker) => (
        <button
          key={ticker}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddTicker(ticker);
          }}
          aria-label={t("row.addTicker", { ticker })}
          title={t("row.addTicker", { ticker })}
          className={cn(
            "pointer-events-auto rounded-sm px-1 py-px font-mono text-xs font-semibold leading-tight text-foreground transition-colors hover:bg-muted",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            // Already in the filter: neutral selected tint (primary is for links only).
            activeTickers.has(ticker) && "bg-muted",
          )}
        >
          {ticker}
        </button>
      ))}
      {rest.length > 0 ? (
        <span className="px-0.5 font-mono text-[11px] text-muted-foreground" title={rest.join(", ")}>
          <span aria-hidden="true">+{rest.length}</span>
          <span className="sr-only">{t("row.moreTickers", { count: rest.length, list: rest.join(", ") })}</span>
        </span>
      ) : null}
    </span>
  );
}

export interface EventRowProps {
  event: EventOut;
  /** Day headers carry the date: show the time only. */
  grouped: boolean;
  /** Istanbul year of "today" — older rows show their year. */
  currentYear: string | null;
  selected: boolean;
  /** Arrived with the last live refresh: flash once. */
  fresh: boolean;
  /** Published within the last minutes. */
  isNew: boolean;
  activeTickers: ReadonlySet<string>;
  companies: ReadonlyMap<string, Company> | null;
  onOpen: (id: string) => void;
  onAddTicker: (ticker: string) => void;
}

export const EventRow = memo(function EventRow({
  event,
  grouped,
  currentYear,
  selected,
  fresh,
  isNew,
  activeTickers,
  companies,
  onOpen,
  onAddTicker,
}: EventRowProps) {
  const { t, tp, tShared } = useEventsI18n();
  const date = eventDate(event);
  const severity = eventSeverity(event);
  const category = eventCategory(event);
  const tickers = eventTickers(event);
  const headline = eventHeadline(event) ?? t("row.untitled");
  const formName = eventFormName(event);
  const companyName = eventCompanyName(event, companies);
  const publisher = eventForeignPublisher(event, companies);
  const attachments = typeof event.attachment_count === "number" && event.attachment_count > 0 ? event.attachment_count : 0;
  const rule = SEVERITY_RULE_CLASS[severity];
  // "Diğer" on most rows is noise; the drawer still names it.
  const categoryLabel = category && category !== "OTHER" ? tShared(categoryKeys[category]) : null;
  const severityWord = severity === "INFO" ? null : tShared(severityKeys[severity]);
  const eventYear = date ? istanbulDayKey(date).slice(0, 4) : null;
  const buttonId = rowButtonId(event.id);
  const metaId = `${buttonId}-meta`;
  const timeId = `${buttonId}-time`;

  const meta: ReactNode[] = [];
  if (companyName) meta.push(<span className="text-foreground/75">{companyName}</span>);
  if (formName) meta.push(formName);
  if (publisher) meta.push(publisher);
  if (event.is_correction) meta.push(<span className="font-medium text-warn">{t("row.correction")}</span>);
  if (attachments > 0) {
    meta.push(
      <span className="inline-flex items-center gap-0.5 align-bottom">
        <Paperclip aria-hidden="true" className="h-3 w-3" />
        <span aria-hidden="true" className="font-mono">
          {attachments}
        </span>
        <span className="sr-only">{tp("row.attachments", attachments)}</span>
      </span>,
    );
  }

  return (
    <li
      className={cn(
        // overflow-hidden: the sr-only notes in the truncated meta line are positioned
        // against this row (not the truncating <p>), so without it they widen the page.
        "group relative overflow-hidden transition-colors",
        selected ? "bg-muted/70" : "hover:bg-muted/40",
        fresh && "animate-flash-up",
      )}
    >
      {rule ? <span aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 left-0 w-0.5", rule)} /> : null}
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] gap-y-1 px-4 py-2.5 sm:gap-x-3 sm:px-5",
          grouped ? "sm:grid-cols-[6rem_minmax(0,1fr)_auto]" : "sm:grid-cols-[9rem_minmax(0,1fr)_auto]",
        )}
      >
        {/* Mobile first line: time · severity · tickers. From sm up time + severity are the first column. */}
        <div className="flex min-w-0 items-center gap-2 sm:contents">
          <span className="flex shrink-0 items-baseline gap-2 sm:col-start-1 sm:row-start-1 sm:pt-0.5">
            {date ? (
              <time
                id={timeId}
                dateTime={date.toISOString()}
                title={formatMarketDate(date, "dateTime")}
                className={cn("shrink-0 font-mono text-xs text-muted-foreground", grouped ? "sm:w-10" : "sm:w-[5.5rem]")}
              >
                {grouped ? (
                  formatMarketDate(date, "time")
                ) : (
                  <>
                    <span className="sm:block">{formatMarketDate(date, eventYear === currentYear ? "dayMonth" : "date")}</span>{" "}
                    <span className="sm:block">{formatMarketDate(date, "time")}</span>
                  </>
                )}
              </time>
            ) : (
              <span id={timeId} className={cn("shrink-0 font-mono text-xs text-muted-foreground", grouped ? "sm:w-10" : "sm:w-[5.5rem]")}>
                —
              </span>
            )}
            {/* Fixed slot, empty on routine rows, so the tickers line up; the word is centred in it.
                The meta line reads the word to screen readers. */}
            <span aria-hidden="true" className={cn("w-12 shrink-0 whitespace-nowrap text-center text-xs font-medium", SEVERITY_TEXT_CLASS[severity])}>
              {severityWord}
            </span>
          </span>
          <RowTickers className="flex sm:hidden" tickers={tickers} activeTickers={activeTickers} onAddTicker={onAddTicker} />
        </div>

        <div className="flex min-w-0 items-baseline gap-1.5 sm:col-start-2 sm:row-start-1">
          <RowTickers className="hidden sm:flex" tickers={tickers} activeTickers={activeTickers} onAddTicker={onAddTicker} />
          {isNew ? (
            <Badge variant="secondary" className="self-center">
              {t("row.new")}
            </Badge>
          ) : null}
          <button
            id={buttonId}
            type="button"
            onClick={() => onOpen(event.id)}
            aria-haspopup="dialog"
            aria-describedby={`${timeId} ${metaId}`}
            title={headline}
            className={cn(
              "min-w-0 flex-1 text-left text-sm leading-snug text-foreground outline-none",
              // Stretched hit area: the whole row opens the disclosure.
              "after:absolute after:inset-0 after:content-['']",
              "focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring",
              severity === "HIGH" && "font-medium",
            )}
          >
            <span className="line-clamp-2 break-words sm:line-clamp-1">{headline}</span>
          </button>
        </div>

        {/* Category leads the meta line on mobile; from sm up it moves to the right column (kept here for screen readers). */}
        <p id={metaId} className="min-w-0 truncate text-xs text-muted-foreground sm:col-start-2 sm:row-start-2">
          {categoryLabel ? (
            <span className="sm:sr-only">
              {categoryLabel}
              {meta.length > 0 ? (
                <span aria-hidden="true" className="px-1 text-muted-foreground/60">
                  ·
                </span>
              ) : null}
            </span>
          ) : null}
          <Separated items={meta} />
          {severityWord ? <span className="sr-only">, {severityWord}</span> : null}
        </p>

        {categoryLabel ? (
          <span className="hidden whitespace-nowrap pt-px text-right text-xs text-muted-foreground sm:col-start-3 sm:row-start-1 sm:block" aria-hidden="true">
            {categoryLabel}
          </span>
        ) : null}
      </div>
    </li>
  );
});
