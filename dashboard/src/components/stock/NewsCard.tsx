"use client";

import { useState, type ReactNode } from "react";
import { Newspaper } from "lucide-react";
import { formatMarketDate, formatRelativeTime } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { isNotFoundError, useTickerNews } from "./hooks";
import { useStockI18n, type StockKey } from "./i18n";
import { useShellIdentity } from "./StockShell";
import type { Impact, Sentiment } from "./types";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton, Segmented } from "./ui";

const WINDOWS: Array<{ hours: number; label: StockKey }> = [
  { hours: 48, label: "news.window48h" },
  { hours: 168, label: "news.window7d" },
  { hours: 720, label: "news.window30d" },
];

const SENTIMENT: Record<Sentiment, { label: StockKey; className: string }> = {
  positive: { label: "news.positive", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  neutral: { label: "news.neutral", className: "bg-muted text-muted-foreground" },
  negative: { label: "news.negative", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

const IMPACT: Record<Impact, StockKey> = { low: "news.impactLow", medium: "news.impactMedium", high: "news.impactHigh" };

/** Google News items with AI sentiment/impact labels (tracked companies only). */
export function NewsCard({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const now = useNow();
  const identity = useShellIdentity();
  const [hours, setHours] = useState(48);
  const tracked = identity.status === "found" ? identity.identity.tracked : identity.status === "unknown";
  const newsQ = useTickerNews(ticker, hours, tracked);
  const windowLabel = t(WINDOWS.find((w) => w.hours === hours)?.label ?? "news.window48h");

  let body: ReactNode;
  if (!tracked && identity.status !== "loading") {
    body = <SectionEmpty message={t("news.notTracked")} />;
  } else if (newsQ.isPending) {
    body = <SectionSkeleton rows={5} className="p-4 sm:p-5" />;
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
    body = (
      <ul className="divide-y divide-border/30">
        {newsQ.data.map((item, index) => {
          const sentiment = item.sentiment ? SENTIMENT[item.sentiment] : null;
          const inner = (
            <>
              <span className="block text-sm leading-snug text-foreground">{item.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {item.publishedAt ? (
                  <time dateTime={item.publishedAt} title={formatMarketDate(item.publishedAt, "dateTime")}>
                    {now ? formatRelativeTime(item.publishedAt, now) : formatMarketDate(item.publishedAt, "dateTime")}
                  </time>
                ) : null}
                {item.source ? <span>· {item.source}</span> : null}
                {sentiment ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", sentiment.className)}>
                    {t(sentiment.label)}
                    {item.impact ? ` · ${t(IMPACT[item.impact])}` : ""}
                  </span>
                ) : null}
              </span>
              {item.rationale ? <span className="mt-1 block text-[11px] italic text-muted-foreground">{item.rationale}</span> : null}
            </>
          );
          const rowClass = "block px-4 py-3 sm:px-5";
          return (
            <li key={item.url ?? `${item.title}-${index}`}>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(rowClass, "transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 focus-visible:outline-none")}
                >
                  {inner}
                  <span className="sr-only">{t("common.opensInNewTab")}</span>
                </a>
              ) : (
                <div className={rowClass}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <SectionCard
      title={t("news.title")}
      icon={<Newspaper />}
      actions={
        <Segmented
          label={t("news.windowLabel")}
          value={hours}
          onChange={setHours}
          size="xs"
          options={WINDOWS.map((w) => ({ value: w.hours, label: t(w.label) }))}
        />
      }
      footer={t("news.footer")}
      bodyClassName="p-0 sm:p-0"
    >
      {body}
    </SectionCard>
  );
}
