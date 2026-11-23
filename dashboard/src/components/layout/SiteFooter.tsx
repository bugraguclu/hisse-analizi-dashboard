"use client";

import Link from "next/link";
import { useLocale } from "@/lib/locale-context";
import { DataStatus } from "./DataStatus";
import { LegalNoticeLink } from "./LegalNotice";
import { useShell } from "./shell-context";
import { Wordmark } from "./SiteHeader";

/** Legal notice link, discovery links, data sources and ingestion health — shown under every page. */
export function SiteFooter() {
  const { t } = useLocale();
  const { openWorkspaceManager } = useShell();
  return (
    <footer className="border-t border-border px-4 md:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 py-6 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Wordmark className="text-[15px]" />
          <nav aria-label={t("footer.explore")} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href="/atlas" className="transition-colors hover:text-foreground">
              {t("nav.atlas")}
            </Link>
            <Link href="/endeks" className="transition-colors hover:text-foreground">
              {t("nav.indices")}
            </Link>
            <Link href="/sektor" className="transition-colors hover:text-foreground">
              {t("nav.sectors")}
            </Link>
            <Link href="/tarama" className="transition-colors hover:text-foreground">
              {t("nav.screening")}
            </Link>
            <Link href="/rehber" className="transition-colors hover:text-foreground">
              {t("nav.guide")}
            </Link>
          </nav>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LegalNoticeLink />
            <span aria-hidden="true">·</span>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => openWorkspaceManager("backup")}
              className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t("workspace.openManager")}
            </button>
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
