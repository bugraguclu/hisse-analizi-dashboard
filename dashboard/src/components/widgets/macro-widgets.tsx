"use client";

import { EconomicCalendar } from "@/components/makro/EconomicCalendar";
import { FxBulletinPanel } from "@/components/makro/FxBulletinPanel";
import { useMakroI18n } from "@/components/makro/i18n";
import { ACTIVITY_KEYS, EXTERNAL_KEYS, IndicatorGrid } from "@/components/makro/IndicatorGrid";
import { InflationTiles, InflationTrendPanel, MonthlyCpiPanel } from "@/components/makro/InflationSection";
import { KpiStrip } from "@/components/makro/KpiStrip";
import { MarketsSection } from "@/components/makro/MarketsSection";
import { CorridorPanel, PolicyInflationPanel } from "@/components/makro/MonetaryPolicy";
import type { WidgetComponents } from "./types";

/** Growth and labour indicator tiles (the /makro "Büyüme ve istihdam" block). */
function ActivityIndicators() {
  const { t } = useMakroI18n();
  return <IndicatorGrid keys={ACTIVITY_KEYS} label={t("section.activity")} />;
}

/** External balance, reserves and fiscal tiles (the /makro "Dış denge" block). */
function ExternalIndicators() {
  const { t } = useMakroI18n();
  return <IndicatorGrid keys={EXTERNAL_KEYS} label={t("section.external")} />;
}

/** The /makro panels, bundled with the macro page. */
export const MACRO_WIDGETS: WidgetComponents = {
  "macro.kpis": () => <KpiStrip />,
  "macro.corridor": () => <CorridorPanel />,
  "macro.policyInflation": () => <PolicyInflationPanel />,
  "macro.inflationTiles": () => <InflationTiles />,
  "macro.inflationTrend": () => <InflationTrendPanel />,
  "macro.monthlyCpi": () => <MonthlyCpiPanel />,
  // The CBRT rates table is a widget of its own.
  "macro.markets": () => <MarketsSection bulletin={false} />,
  "macro.fxBulletin": () => <FxBulletinPanel />,
  "macro.calendar": () => <EconomicCalendar />,
  "macro.activity": () => <ActivityIndicators />,
  "macro.external": () => <ExternalIndicators />,
};
