"use client";

import type { ReactNode } from "react";
import { useLocale } from "@/lib/locale-context";
import { formatMarketDate } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";

/** Home title with the Istanbul date (the session status lives in the market strip). */
export function MarketHeader({ actions }: { actions?: ReactNode }) {
  const { t } = useLocale();
  const now = useNow();
  return (
    <PageHeader
      eyebrow={
        now === null ? (
      <Skeleton as="span" className="inline-block h-3 w-28 origin-left" />
        ) : (
          formatMarketDate(now, "weekdayLong")
        )
      }
      title={t("dashboard.marketOverview")}
      actions={actions}
    />
  );
}
