"use client";

import { isFeatureEnabled } from "@/lib/demo";
import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { DataStatus } from "./DataStatus";
import { LegalNoticeLink } from "./LegalNotice";
import { useShell } from "./shell-context";
import { Wordmark } from "./SiteHeader";

const FOOTER_LINK_CLASS =
  "inline-flex items-center rounded-sm py-1 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/** Legal notice link, discovery links, data sources and ingestion health — shown under every page. */
export function SiteFooter() {
  const { t } = useLocale();
  const { openWorkspaceManager } = useShell();
  return (
    <footer className="border-t border-border px-4 md:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 py-6 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Wordmark className="text-[15px]" />
          <nav aria-label={t("footer.explore")} className="flex flex-wrap items-center gap-x-4 gap-y-1 pointer-coarse:gap-y-1.5">
            <Link href="/atlas" className={FOOTER_LINK_CLASS}>
              {t("nav.atlas")}
            </Link>
            <Link href="/endeks" className={FOOTER_LINK_CLASS}>
              {t("nav.indices")}
            </Link>
            <Link href="/sektor" className={FOOTER_LINK_CLASS}>
              {t("nav.sectors")}
            </Link>
            <Link href="/tarama" className={FOOTER_LINK_CLASS}>
              {t("nav.screening")}
            </Link>
            <Link href="/rehber" className={FOOTER_LINK_CLASS}>
              {t("nav.guide")}
            </Link>
            {isFeatureEnabled("pushNotifications") ? (
              <Link href="/alarmlar" className="transition-colors hover:text-foreground">
                {t("nav.alerts")}
              </Link>
            ) : null}
          </nav>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pointer-coarse:gap-y-1.5">
            <LegalNoticeLink />
            <span aria-hidden="true">·</span>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openWorkspaceManager("backup")}
              className="inline-flex items-center rounded-sm py-1 underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              {t("workspace.openManager")}
            </button>
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
