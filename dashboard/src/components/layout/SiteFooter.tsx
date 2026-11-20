"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { DataStatus } from "./DataStatus";
import { LegalNoticeLink } from "./LegalNotice";
import { Wordmark } from "./SiteHeader";

/** Legal notice link, data sources and ingestion health — shown under every page. */
export function SiteFooter() {
  const { t } = useLocale();
  return (
    <footer className="border-t border-border px-4 md:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 py-6 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <Wordmark className="text-[15px]" />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LegalNoticeLink />
            <span aria-hidden="true">·</span>
            <Link href="/cihazlar" className="underline-offset-4 hover:text-foreground hover:underline">
              {t("widgetPairing.footerLink")}
            </Link>
          </p>
        </div>
        <div className="space-y-1 md:text-right">
          <DataStatus variant="inline" className="md:justify-end" />
          <p>{t("footer.sources")}</p>
        </div>
      </div>
    </footer>
  );
}
