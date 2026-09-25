"use client";

import { useLocale } from "@/lib/locale-context";
import { formatMarketDate } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { PageHeader } from "@/components/layout/PageHeader";

/** Home title with the Istanbul date (the session status lives in the market strip). */
export function MarketHeader() {
  const { t } = useLocale();
  const now = useNow();
  return (
    <PageHeader
      eyebrow={
        now === null ? (
          <span className="inline-block h-3 w-28 rounded-sm bg-muted skeleton-shimmer" aria-hidden="true" />
        ) : (
          formatMarketDate(now, "weekdayLong")
        )
      }
      title={t("dashboard.marketOverview")}
    />
  );
}
