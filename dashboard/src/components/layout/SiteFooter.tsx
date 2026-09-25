"use client";

import { useLocale } from "@/lib/locale-context";
import { DataStatus } from "./DataStatus";
import { Wordmark } from "./SiteHeader";

/** Disclaimer, data sources and ingestion health — shown under every page. */
export function SiteFooter() {
  const { t } = useLocale();
  return (
    <footer className="border-t border-border px-4 md:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 py-6 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <Wordmark className="text-[15px]" />
          <p className="max-w-md">{t("footer.disclaimer")}</p>
        </div>
        <div className="space-y-1 md:text-right">
          <DataStatus variant="inline" className="md:justify-end" />
          <p>{t("footer.sources")}</p>
        </div>
      </div>
    </footer>
  );
}
