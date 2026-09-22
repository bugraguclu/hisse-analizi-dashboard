"use client";

import { CalendarDays } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { formatDay, formatNumber, formatPercent, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isNotFoundError, useEarningsCalendar } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionEmpty, SectionError, SectionSkeleton } from "./ui";

/**
 * Expected financial-report dates from KAP's disclosure calendar. EPS columns
 * only appear when upstream actually provides them (it usually doesn't for
 * BIST); an empty calendar is "not available", not an error.
 */
export function EarningsCalendar({ ticker }: { ticker: string }) {
  const { t } = useStockI18n();
  const now = useNow();
  const earningsQ = useEarningsCalendar(ticker);
  const items = earningsQ.data ?? [];
  const hasEps = items.some((e) => e.epsEstimate != null || e.epsActual != null);
  // Pick the next date once the clock is known (null during SSR/hydration).
  const nextTime = now !== null ? items.find((e) => e.time >= now - 86_400_000)?.time ?? null : null;

  return (
    <SectionCard title={t("earn.title")} icon={<CalendarDays className="text-indigo-500" />} footer={t("earn.footer")}>
      {earningsQ.isPending ? (
        <SectionSkeleton rows={3} />
      ) : earningsQ.isError && !isNotFoundError(earningsQ.error) ? (
        <SectionError error={earningsQ.error} onRetry={() => void earningsQ.refetch()} />
      ) : items.length === 0 ? (
        <SectionEmpty message={t("earn.empty")} hint={t("earn.emptyHint")} />
      ) : (
        <ul className="divide-y divide-border/30">
          {items.map((item) => {
            const isNext = item.time === nextTime;
            const past = now !== null && item.time < now - 86_400_000;
            return (
              <li key={`${item.date}-${item.epsEstimate}-${item.epsActual}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <span className={cn("font-mono text-sm tabular-nums", past ? "text-muted-foreground" : "font-semibold text-foreground")}>
                  {formatDay(item.date)}
                </span>
                {isNext ? (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{t("earn.next")}</span>
                ) : null}
                {now !== null ? <span className="text-[11px] text-muted-foreground">{formatRelativeTime(item.time, now)}</span> : null}
                {hasEps ? (
                  <span className="ml-auto flex gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                    <span>
                      {t("earn.epsEstimate")}: <span className="text-foreground">{formatNumber(item.epsEstimate)}</span>
                    </span>
                    <span>
                      {t("earn.epsActual")}: <span className="text-foreground">{formatNumber(item.epsActual)}</span>
                    </span>
                    {item.surprisePct != null ? (
                      <span>
                        {t("earn.surprise")}: <span className="text-foreground">{formatPercent(item.surprisePct)}</span>
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
