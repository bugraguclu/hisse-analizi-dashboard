import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AlertsView } from "@/components/alerts/AlertsView";
import { LOCALE_COOKIE, parseLocale, t } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? "tr";
  return {
    title: t("alerts.title", locale),
    description: t("alerts.description", locale),
    // Personal, device-bound page: nothing to index.
    robots: { index: false, follow: false },
  };
}

export default function AlarmlarPage() {
  return <AlertsView />;
}
