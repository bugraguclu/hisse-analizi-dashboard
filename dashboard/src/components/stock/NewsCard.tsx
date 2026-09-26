"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { formatMarketDate, formatRelativeTime, parseDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNotFoundError, useTickerNews } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { useShellIdentity } from "./StockShell";
import type { NewsItem } from "./types";
import { SectionCard, SectionEmpty, SectionError, Segmented } from "./ui";

const WINDOWS: Array<{ hours: number; label: StockKey }> = [
  { hours: 48, label: "news.window48h" },
  { hours: 168, label: "news.window7d" },
  { hours: 720, label: "news.window30d" },
];

/** A week by default: 48 hours is often empty (weekends, mid caps), which left a blank card beside the KAP list. */
const DEFAULT_HOURS = 168;
/** Same length as the KAP card beside it; the rest opens on request. */
const VISIBLE_ITEMS = 10;

function NewsRow({ item, now }: { item: NewsItem; now: number | null }) {
  const { t } = useStockI18n();
  const published = parseDate(item.publishedAt);

  const content = (
    <>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[13px] leading-snug text-foreground" title={item.title}>
          {item.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          {published ? (
            <time dateTime={published.toISOString()} title={formatMarketDate(published, "dateTime")} className="whitespace-nowrap tabular-nums">
              {now !== null ? formatRelativeTime(published, now) : formatMarketDate(published, "dayMonthTime")}
            </time>
          ) : null}
          {published && item.source ? <span aria-hidden>·</span> : null}
          {item.source ? (
            <span className="max-w-[14rem] truncate" title={item.source}>
              {item.source}
            </span>
          ) : null}
        </span>
      </span>
      {item.url ? (
        <ArrowUpRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
      ) : null}
    </>
  );

  const rowClass = "group grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3";
  if (!item.url) return <div className={rowClass}>{content}</div>;
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(rowClass, "transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring")}
    >
      {content}
      <span className="sr-only">{t("common.opensInNewTab")}</span>
    </a>
  );
}

/** Row-shaped placeholder: two title lines and a meta line per article. */
function NewsSkeleton() {
  const { t } = useStockI18n();
  return (
    <div role="status" className="divide-y divide-border">
      <span className="sr-only">{t("state.loading")}</span>
      {[88, 70, 80, 64, 76].map((width, i) => (
        <div key={i} aria-hidden className="space-y-2 px-4 py-3.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3" style={{ width: `${width}%` }} />
          <Skeleton className="h-2.5 w-36" />
        </div>
      ))}
    </div>
  );
}

/** Google News items (tracked companies only). */
export function NewsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const now = useNow();
  const identity = useShellIdentity();
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [expanded, setExpanded] = useState(false);
  const tracked = identity.status === "found" ? identity.identity.tracked : identity.status === "unknown";
  const newsQ = useTickerNews(ticker, hours, tracked);
  const windowLabel = t(WINDOWS.find((w) => w.hours === hours)?.label ?? "news.window48h");

  let body: ReactNode;
  if (!tracked && identity.status !== "loading") {
    body = <SectionEmpty message={t("news.notTracked")} />;
  } else if (newsQ.isPending) {
    body = <NewsSkeleton />;
  } else if (newsQ.isError) {
    body = isNotFoundError(newsQ.error) ? (
      <SectionEmpty message={t("news.notTracked")} />
    ) : (
      <SectionError error={newsQ.error} onRetry={() => void newsQ.refetch()} />
    );
  } else if (newsQ.data.length === 0) {
    body = (
      <SectionEmpty
        message={t("news.empty", { window: windowLabel })}
        hint={hours < 720 ? t("news.emptyHint") : undefined}
      />
    );
  } else {
    const items = expanded ? newsQ.data : newsQ.data.slice(0, VISIBLE_ITEMS);
    body = (
      <>
        <ul className="divide-y divide-border">
          {items.map((item, index) => (
            <li key={item.url ?? `${item.title}-${index}`}>
              <NewsRow item={item} now={now} />
            </li>
          ))}
        </ul>
        {newsQ.data.length > VISIBLE_ITEMS ? (
          <div className="border-t border-border px-4 py-2.5">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {expanded ? t("common.showLess") : t("common.showAllCount", { count: newsQ.data.length })}
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <SectionCard
      title={t("news.title")}
      actions={
        tracked || identity.status === "loading" ? (
          <Segmented
            label={t("news.windowLabel")}
            value={hours}
            onChange={(value) => {
              setHours(value);
              setExpanded(false);
            }}
            size="xs"
            options={WINDOWS.map((w) => ({ value: w.hours, label: t(w.label) }))}
          />
        ) : null
      }
      footer={t("news.footer")}
      bodyClassName="p-0"
    >
      {body}
    </SectionCard>
  );
}
