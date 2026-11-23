import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertsView } from "@/components/alerts/AlertsView";
import { IS_DEMO } from "@/lib/demo";
import { t } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: t("alerts.title", locale),
    description: t("alerts.description", locale),
    // Personal, device-bound page: nothing to index.
    robots: { index: false, follow: false },
  };
}

export default function AlarmlarPage() {
  // Alerts live on the server; the static demo has none.
  if (IS_DEMO) notFound();
  return <AlertsView />;
}
