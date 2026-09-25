"use client";

import { EMPTY_VALUE, formatNumber, formatPercent, formatSigned } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useMakroI18n, type MakroKey } from "./i18n";
import { useIndicators } from "./queries";
import { formatMoneyCompact, formatPeriod, formatPp } from "./format";
import { NeutralChange, PanelError, SourceLine, StatTile, TileGrid } from "./ui";
import type { MacroIndicator } from "./types";

type Translate = ReturnType<typeof useMakroI18n>["t"];

/** Balances are signed (a deficit reads "-$5,2 Mr"); stocks and flows like exports are not. */
const SIGNED_MONEY = new Set(["current_account", "trade_balance", "budget_balance"]);

export function formatIndicatorValue(indicator: Pick<MacroIndicator, "key" | "unit" | "value">, t: Translate): string {
  const { unit, value } = indicator;
  switch (unit) {
    case "percent":
      return formatPercent(value, 1);
    case "index":
      return formatNumber(value, 1);
    case "USD":
    case "TRY":
      return formatMoneyCompact(value, unit, SIGNED_MONEY.has(indicator.key));
    case "tonnes":
      return t("ind.tonnes", { value: formatNumber(value, 1) });
    default:
      return formatNumber(value, 2);
  }
}

function formatIndicatorChange(indicator: MacroIndicator, locale: Locale, t: Translate): string {
  const { unit, change } = indicator;
  if (change === null) return EMPTY_VALUE;
  switch (unit) {
    case "percent":
      return formatPp(change, locale, 1);
    case "index":
      return formatSigned(change, 1);
    case "USD":
    case "TRY":
      return formatMoneyCompact(change, unit, true);
    case "tonnes":
      return t("ind.tonnes", { value: formatSigned(change, 1) });
    default:
      return formatSigned(change, 2);
  }
}

function hintFor(indicator: MacroIndicator, all: readonly MacroIndicator[], t: Translate): string | undefined {
  const find = (key: string) => all.find((item) => item.key === key);
  switch (indicator.key) {
    case "trade_balance": {
      const exports = find("exports");
      const imports = find("imports");
      if (!exports || !imports) break;
      return t("ind.hint.trade", { exports: formatIndicatorValue(exports, t), imports: formatIndicatorValue(imports, t) });
    }
    case "consumer_confidence":
      return t("ind.hint.consumer_confidence");
    case "budget_balance":
      return t("ind.hint.budget_balance");
    default:
      break;
  }
  return indicator.previous !== null
    ? t("ind.previous", { value: formatIndicatorValue({ ...indicator, value: indicator.previous }, t) })
    : undefined;
}

export const ACTIVITY_KEYS = [
  "gdp_growth_yoy",
  "gdp_growth_qoq",
  "industrial_production_yoy",
  "retail_sales_yoy",
  "capacity_utilization",
  "consumer_confidence",
  "unemployment",
  "labor_force_participation",
] as const;

export const EXTERNAL_KEYS = [
  "current_account",
  "current_account_gdp",
  "trade_balance",
  "fdi",
  "fx_reserves",
  "gold_reserves",
  "budget_balance",
  "government_debt_gdp",
] as const;

export function IndicatorGrid({ keys, label }: { keys: readonly string[]; label: string }) {
  const { t, locale } = useMakroI18n();
  const indicatorsQ = useIndicators();
  const all = indicatorsQ.data?.indicators ?? [];

  if (indicatorsQ.isError && !indicatorsQ.data) {
    return (
      <div className="card-surface">
        <PanelError error={indicatorsQ.error} onRetry={() => void indicatorsQ.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <TileGrid label={label} className="grid-cols-2 md:grid-cols-4">
        {keys.map((key) => {
          const indicator = all.find((item) => item.key === key);
          const title = t(`ind.${key}` as MakroKey);
          if (!indicatorsQ.isPending && !indicator) {
            return <StatTile key={key} label={title} value={EMPTY_VALUE} hint={t("ind.missing")} />;
          }
          return (
            <StatTile
              key={key}
              label={title}
              loading={indicatorsQ.isPending}
              value={indicator ? formatIndicatorValue(indicator, t) : EMPTY_VALUE}
              change={
                indicator && indicator.change !== null ? (
                  <NeutralChange value={indicator.change} text={formatIndicatorChange(indicator, locale, t)} />
                ) : undefined
              }
              meta={indicator ? formatPeriod(indicator.period, indicator.frequency, locale) : undefined}
              hint={indicator ? hintFor(indicator, all, t) : undefined}
            />
          );
        })}
      </TileGrid>
      <p className="px-1 text-[11px] text-muted-foreground">
        <SourceLine source={indicatorsQ.data?.source ?? "TradingView"} parts={[t("common.vsPrevious")]} />
      </p>
    </div>
  );
}
