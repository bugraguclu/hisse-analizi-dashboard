"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { WidgetPairingPanel } from "@/components/widget-pairing/WidgetPairingPanel";
import { useLocale } from "@/lib/locale-context";

export default function DevicesPage() {
  const { t } = useLocale();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("widgetPairing.pageTitle")}
        description={t("widgetPairing.pageSubtitle")}
      />
      <WidgetPairingPanel />
    </div>
  );
}
