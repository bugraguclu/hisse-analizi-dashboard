"use client";

import { FlaskConical } from "lucide-react";
import { DEMO_CAPTURED_AT, IS_DEMO, LIVE_SITE_URL } from "@/lib/demo";
import { formatMarketDate } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";

const LIVE_SITE_LABEL = LIVE_SITE_URL.replace(/^https?:\/\//, "");

/** Static demo only (lib/demo.ts): says the data is a recorded snapshot and links the live site. */
export function DemoBanner() {
  const { t } = useLocale();
  if (!IS_DEMO) return null;
  return (
    <div role="note" className="border-b border-border bg-muted/40 px-4 py-2 text-xs md:px-6">
      <p className="mx-auto max-w-7xl text-pretty text-muted-foreground">
        <FlaskConical className="mr-1.5 inline-block h-3.5 w-3.5 align-[-2px] text-foreground" aria-hidden="true" />
        <span className="text-foreground">
          {t("demo.notice", { date: formatMarketDate(DEMO_CAPTURED_AT, "dateTime") })}{" "}
          <a
            href={LIVE_SITE_URL}
            className="font-medium underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
          >
            {LIVE_SITE_LABEL}
          </a>
        </span>
        <span className="hidden sm:inline"> · {t("demo.noticeDetail")}</span>
      </p>
    </div>
  );
}
