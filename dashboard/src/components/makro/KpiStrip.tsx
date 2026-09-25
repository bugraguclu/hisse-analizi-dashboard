"use client";

import { EMPTY_VALUE, formatChangePercent, formatMarketDate, formatPercent } from "@/lib/format";
import { useMakroI18n } from "./i18n";
import { useIndicators, useInflation, useMarkets, usePolicyRate, useTcmbCalendar } from "./queries";
import { formatBp, formatBpValue, formatMarketValue, formatPeriod, formatPp, monthEnd, monthKey } from "./format";
import { policyAt } from "./series";
import { changeFromMeeting } from "./MonetaryPolicy";
import { NeutralChange, PriceChange, StatTile, TileGrid } from "./ui";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function KpiStrip() {
  const { t, locale } = useMakroI18n();
  const policyQ = usePolicyRate();
  const inflationQ = useInflation();
  const marketsQ = useMarkets();
  const indicatorsQ = useIndicators();
  const calendarQ = useTcmbCalendar();

  // Policy rate + what the last MPC meeting did.
  const policy = policyQ.data?.policy_rate?.value ?? null;
  const changes = policyQ.data?.changes;
  const lastMeeting = calendarQ.data?.last?.mpc_decision;
  const nextMeeting = calendarQ.data?.next?.mpc_decision;
  const meetingChange = changeFromMeeting(changes, lastMeeting?.date);
  const lastChange = policyQ.data?.last_change ?? null;

  // Inflation (latest month and the one before, newest-first history).
  const latest = inflationQ.data?.latest;
  const cpi = typeof latest?.yearly_inflation === "number" ? latest.yearly_inflation : null;
  const cpiMonth = monthKey(latest?.date);
  const previousRow = inflationQ.data?.tufe_history?.[1];
  const previousCpi = typeof previousRow?.YearlyInflation === "number" ? previousRow.YearlyInflation : null;
  const previousMonth = monthKey(previousRow?.Date);

  // Real rate: today's policy rate − the latest annual CPI; the change compares
  // with the previous month (month-end policy rate − that month's CPI).
  const real = policy !== null && cpi !== null ? round2(policy - cpi) : null;
  const previousPolicy = changes && previousMonth ? policyAt(changes, monthEnd(previousMonth)) : null;
  const previousReal = previousPolicy !== null && previousCpi !== null ? round2(previousPolicy - previousCpi) : null;
  const realChange = real !== null && previousReal !== null ? round2(real - previousReal) : null;
  const fisher = policy !== null && cpi !== null ? ((1 + policy / 100) / (1 + cpi / 100) - 1) * 100 : null;

  // Markets and growth.
  const quotes = marketsQ.data?.instruments;
  const usd = quotes?.find((quote) => quote.key === "usdtry") ?? null;
  const basket = quotes?.find((quote) => quote.key === "basket") ?? null;
  const tr10 = quotes?.find((quote) => quote.key === "tr10y") ?? null;
  const tr2 = quotes?.find((quote) => quote.key === "tr02y") ?? null;
  const indicators = indicatorsQ.data?.indicators;
  const gdp = indicators?.find((indicator) => indicator.key === "gdp_growth_yoy") ?? null;
  const gdpQoq = indicators?.find((indicator) => indicator.key === "gdp_growth_qoq") ?? null;

  const policyMeta = meetingChange && lastMeeting
    ? formatMarketDate(lastMeeting.date, "dayMonth")
    : lastMeeting
      ? t("kpi.lastMpcHold", { date: formatMarketDate(lastMeeting.date, "dayMonth") })
      : lastChange
        ? t("kpi.sinceChange", { date: formatMarketDate(lastChange.date, "date") })
        : undefined;

  return (
    <TileGrid label={t("kpi.label")} className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <StatTile
        size="lg"
        label={t("kpi.policyRate")}
        loading={policyQ.isPending}
        value={policy !== null ? formatPercent(policy) : EMPTY_VALUE}
        change={
          meetingChange && meetingChange.change_bp !== null ? (
            <NeutralChange value={meetingChange.change_bp} text={formatBpValue(meetingChange.change_bp, locale)} />
          ) : undefined
        }
        meta={policyMeta}
        hint={nextMeeting ? `${t("mp.nextMeeting")}: ${formatMarketDate(nextMeeting.date, "dayMonth")}` : undefined}
      />
      <StatTile
        size="lg"
        label={t("kpi.inflation")}
        loading={inflationQ.isPending}
        value={cpi !== null ? formatPercent(cpi) : EMPTY_VALUE}
        change={
          cpi !== null && previousCpi !== null ? (
            <NeutralChange value={cpi - previousCpi} text={formatPp(round2(cpi - previousCpi), locale)} />
          ) : undefined
        }
        meta={cpiMonth ? formatMarketDate(cpiMonth, "monthYear") : undefined}
        hint={
          typeof latest?.monthly_inflation === "number" ? t("kpi.monthly", { value: formatPercent(latest.monthly_inflation) }) : undefined
        }
      />
      <StatTile
        size="lg"
        label={t("kpi.realRate")}
        loading={policyQ.isPending || inflationQ.isPending}
        value={real !== null ? formatChangePercent(real) : EMPTY_VALUE}
        change={realChange !== null ? <NeutralChange value={realChange} text={formatPp(realChange, locale)} /> : undefined}
        meta={cpiMonth ? formatMarketDate(cpiMonth, "monthYear") : undefined}
        hint={t("kpi.realRateSub")}
        info={{
          label: t("common.info"),
          content: t("kpi.realRateInfo", { fisher: fisher !== null ? formatChangePercent(fisher) : EMPTY_VALUE }),
        }}
      />
      <StatTile
        size="lg"
        label={t("kpi.usdtry")}
        loading={marketsQ.isPending}
        value={usd ? formatMarketValue(usd.last, usd.key, usd.unit) : EMPTY_VALUE}
        change={usd ? <PriceChange value={usd.change_percent} withIcon /> : undefined}
        meta={usd ? t("common.daily") : undefined}
        hint={basket ? t("kpi.basket", { value: formatMarketValue(basket.last, basket.key, basket.unit) }) : undefined}
      />
      <StatTile
        size="lg"
        label={t("kpi.tr10y")}
        loading={marketsQ.isPending}
        value={tr10 ? formatPercent(tr10.last) : EMPTY_VALUE}
        change={tr10 ? <NeutralChange value={tr10.change} text={formatBp(tr10.change, locale)} /> : undefined}
        meta={tr10 ? t("common.daily") : undefined}
        hint={tr2 ? t("kpi.tr2y", { value: formatPercent(tr2.last) }) : undefined}
      />
      <StatTile
        size="lg"
        label={t("kpi.gdp")}
        loading={indicatorsQ.isPending}
        value={gdp ? formatPercent(gdp.value, 1) : EMPTY_VALUE}
        change={gdp?.change != null ? <NeutralChange value={gdp.change} text={formatPp(gdp.change, locale, 1)} /> : undefined}
        meta={gdp ? formatPeriod(gdp.period, gdp.frequency, locale) : undefined}
        hint={gdpQoq ? t("kpi.qoq", { value: formatPercent(gdpQoq.value, 1) }) : undefined}
      />
    </TileGrid>
  );
}
