"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EMPTY_VALUE, formatMarketDate, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { useMakroI18n } from "./i18n";
import { useIndicators, useMarkets, usePolicyRate } from "./queries";
import { formatBp } from "./format";
import { AXIS_TICK, CURSOR_STYLE, GRID_STROKE, SERIES_COLOR, ChartTooltipBox, niceScale } from "./chart-kit";
import { DataLabel, NeutralChange, Panel, PanelEmpty, PanelError, SourceLine } from "./ui";
import type { MarketQuote } from "./types";

const CURVE_HEIGHT = 180;

interface CurvePoint {
  key: string;
  tenor: string;
  years: number;
  yield: number;
  change: number | null;
}

export function YieldCurvePanel({ selected, onSelect, className }: { selected: string; onSelect: (key: string) => void; className?: string }) {
  const { t, locale } = useMakroI18n();
  const marketsQ = useMarkets();
  const policyQ = usePolicyRate();
  const indicatorsQ = useIndicators();

  const instruments = marketsQ.data?.instruments;
  const points: CurvePoint[] = useMemo(
    () =>
      (instruments ?? [])
        .filter((quote): quote is MarketQuote & { tenor_years: number } => quote.group === "bond" && typeof quote.tenor_years === "number")
        .sort((a, b) => a.tenor_years - b.tenor_years)
        .map((quote) => ({
          key: quote.key,
          tenor: t("yc.years", { n: quote.tenor_years }),
          years: quote.tenor_years,
          yield: quote.last,
          change: quote.change,
        })),
    [instruments, t],
  );
  const us10y = instruments?.find((quote) => quote.key === "us10y") ?? null;
  const policy = policyQ.data?.policy_rate?.value ?? null;
  const fed = indicatorsQ.data?.indicators?.find((indicator) => indicator.key === "fed_rate") ?? null;
  const two = points.find((point) => point.years === 2);
  const ten = points.find((point) => point.years === 10);
  const spread2s10s = two && ten ? ten.yield - two.yield : null;
  const spreadUs = ten && us10y ? ten.yield - us10y.last : null;
  const bondUpdated = (instruments ?? []).filter((quote) => quote.group === "bond").map((quote) => quote.updated_at ?? "").sort().pop();

  const scale = niceScale(points.map((point) => point.yield).concat(policy !== null ? [policy] : []), 5);
  // Policy-rate label: over the end of the curve that sits farther from the line, on
  // the far side of the line from the curve there, so the two never overlap. (On a
  // zero-height reference line recharts' "insideBottom*" is above it, "insideTop*" below.)
  const first = points[0]?.yield ?? null;
  const last = points[points.length - 1]?.yield ?? null;
  const labelRight = policy !== null && first !== null && last !== null && Math.abs(last - policy) >= Math.abs(first - policy);
  const endYield = labelRight ? last : first;
  const labelAbove = policy !== null && endYield !== null ? endYield <= policy : true;
  const policyLabelPosition = `inside${labelAbove ? "Bottom" : "Top"}${labelRight ? "Right" : "Left"}` as const;

  return (
    <Panel
      className={className}
      title={t("yc.title")}
      subtitle={t("yc.desc")}
      footer={
        <>
          <SourceLine
            source={marketsQ.data?.source ?? "TradingView"}
            parts={[bondUpdated ? t("common.updated", { time: formatMarketDate(bondUpdated, "dayMonthTime") }) : null]}
          />
          <p className="mt-1">{t("mk.yieldNote")}</p>
        </>
      }
    >
      {marketsQ.isPending ? (
        <ChartSkeleton height={CURVE_HEIGHT} />
      ) : marketsQ.isError && !marketsQ.data ? (
        <PanelError error={marketsQ.error} onRetry={() => void marketsQ.refetch()} />
      ) : points.length < 2 ? (
        <PanelEmpty />
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div
              role="img"
              aria-label={t("yc.aria", { points: points.map((point) => `${point.tenor} ${formatPercent(point.yield)}`).join(", ") })}
              style={{ height: CURVE_HEIGHT }}
            >
              <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 480, height: CURVE_HEIGHT }}>
                <LineChart data={points} margin={{ top: 18, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="tenor" axisLine={false} tickLine={false} tick={AXIS_TICK} tickMargin={6} padding={{ left: 8, right: 8 }} />
                  <YAxis
                    orientation="right"
                    width={42}
                    axisLine={false}
                    tickLine={false}
                    tick={AXIS_TICK}
                    domain={scale?.domain ?? ["auto", "auto"]}
                    ticks={scale?.ticks}
                    interval={0}
                    tickFormatter={(value) => formatPercent(Number(value), scale?.decimals ?? 0)}
                  />
                  {policy !== null ? (
                    <ReferenceLine
                      y={policy}
                      stroke="var(--color-muted-foreground)"
                      strokeOpacity={0.7}
                      label={{
                        value: t("yc.policyLine", { value: formatPercent(policy) }),
                        position: policyLabelPosition,
                        fontSize: 10,
                        fill: "var(--color-muted-foreground)",
                      }}
                    />
                  ) : null}
                  <Tooltip
                    isAnimationActive={false}
                    cursor={CURSOR_STYLE}
                    content={({ active, payload }) => {
                      const point = active ? (payload?.[0]?.payload as CurvePoint | undefined) : undefined;
                      if (!point) return null;
                      return (
                        <ChartTooltipBox
                          title={point.tenor}
                          rows={[
                            { key: "yield", label: t("yc.yield"), value: formatPercent(point.yield), color: SERIES_COLOR.market },
                            { key: "change", label: t("yc.dailyBp"), value: formatBp(point.change, locale) },
                          ]}
                        />
                      );
                    }}
                  />
                  <Line
                    type="linear"
                    dataKey="yield"
                    stroke={SERIES_COLOR.market}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    dot={{ r: 4, fill: SERIES_COLOR.market, stroke: "var(--card)", strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: SERIES_COLOR.market, stroke: "var(--card)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <table className="w-full self-start text-xs">
              <caption className="sr-only">{t("yc.title")}</caption>
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-1.5 text-left font-medium">{t("yc.tenor")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{t("yc.yield")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{t("yc.dailyBp")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {points.map((point) => {
                  const active = point.key === selected;
                  return (
                    <tr key={point.key} className={cn(active && "bg-muted/60")}>
                      <th scope="row" className="py-0 text-left font-normal">
                        <button
                          type="button"
                          onClick={() => onSelect(point.key)}
                          aria-pressed={active}
                          aria-label={t("mk.select", { name: t("yc.years", { n: point.years }) })}
                          className="w-full py-1.5 text-left text-foreground underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {point.tenor}
                        </button>
                      </th>
                      <td className="py-1.5 text-right font-mono tabular-nums text-foreground">{formatPercent(point.yield)}</td>
                      <td className="py-1.5 text-right">
                        <NeutralChange value={point.change} text={formatBp(point.change, locale)} className="justify-end" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 sm:grid-cols-3">
            <div>
              <dt>
                <DataLabel>{t("yc.spread2s10s")}</DataLabel>
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-foreground">
                {spread2s10s !== null ? formatBp(spread2s10s, locale) : EMPTY_VALUE}
                {spread2s10s !== null ? (
                  <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">{spread2s10s < 0 ? t("yc.inverted") : t("yc.normal")}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>
                <DataLabel>{t("yc.spreadUs")}</DataLabel>
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-foreground">{spreadUs !== null ? formatBp(spreadUs, locale) : EMPTY_VALUE}</dd>
            </div>
            <div>
              <dt>
                <DataLabel>{t("ind.fed_rate")}</DataLabel>
              </dt>
              <dd className="font-mono text-[13px] tabular-nums text-foreground">
                {fed ? formatPercent(fed.value) : EMPTY_VALUE}
                {us10y ? (
                  <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">
                    {t("mk.code.us10y")} {formatPercent(us10y.last)}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Panel>
  );
}
