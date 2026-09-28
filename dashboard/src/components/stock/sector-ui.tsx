"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { sectorHref, sectorLabel } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { useStockI18n } from "./i18n";
import type { CompanySector, SectorMetricKey } from "./sector";

/** The sector's name in the UI language. */
export function useSectorName(sector: CompanySector | null | undefined): string | null {
  const { locale } = useStockI18n();
  return sector ? sectorLabel(sector.key, locale, sector.kapName) : null;
}

/**
 * "Sektör: 9,91" under a figure (a Stat's `sub`): the sector median in the
 * figure's own format, with who it is the median of on hover. Nothing when the
 * sector has too few companies for a median.
 */
export function SectorMedianSub({
  sector,
  metric,
  format,
  pending = false,
}: {
  sector: CompanySector | null | undefined;
  metric: SectorMetricKey;
  format: (value: number) => string;
  /** Hold the line's place while the sector data loads (the figure's layout must not jump). */
  pending?: boolean;
}) {
  const { t } = useStockI18n();
  const name = useSectorName(sector);
  const stat = sector?.metrics[metric];
  if (pending) return <Skeleton className="my-0.5 h-3 w-20" />;
  if (!name || stat?.median == null) return null;
  const title = t(metric === "dividend_yield" ? "sector.subTitlePayers" : "sector.subTitle", { sector: name, count: stat.count });
  return (
    <span title={title} className="tabular-nums">
      {t("sector.sub", { value: format(stat.median) })}
    </span>
  );
}

/**
 * The sector's name linking to Hisse Tarama narrowed to it (where the table
 * opens with the sector's medians on top).
 */
export function SectorLink({
  sector,
  view,
  className,
}: {
  sector: CompanySector;
  view?: "fundamentals";
  className?: string;
}) {
  const { t } = useStockI18n();
  const name = useSectorName(sector) ?? sector.key;
  return (
    <Link
      href={sectorHref(sector.key, view)}
      title={t("sector.open", { sector: name })}
      className={cn(
        "rounded-sm underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {name}
    </Link>
  );
}
