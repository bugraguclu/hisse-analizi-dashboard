"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { EMPTY_VALUE, formatChangePercent, formatMarketDate, formatPercent } from "@/lib/format";
import { useNow } from "@/hooks/use-now";
import { istanbulClock } from "@/lib/market-hours";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { useMakroI18n, type MakroKey } from "./i18n";
import { usePolicyRate, useInflation, useTcmbCalendar, useTcmbRates } from "./queries";
import { daysUntil, formatBpValue, formatPp } from "./format";
import { inflationSeries, lastMonths, policyInflationSeries, type PolicyInflationPoint } from "./series";
import {
  AXIS_TICK,
  CURSOR_STYLE,
  GRID_STROKE,
  SERIES_COLOR,
  ChartLegend,
  ChartTable,
  ChartTooltipBox,
  monthTicks,
  signedAxis,
} from "./chart-kit";
import { DataLabel, Panel, PanelEmpty, PanelError, RangePicker, Shimmer, SourceLine, ViewToggle, type ChartView } from "./ui";
import type { PolicyRateChange, TcmbEvent, TcmbEventType, TcmbRateRow } from "./types";

// ---------------------------------------------------------------------------
// Corridor + meetings + decisions
// ---------------------------------------------------------------------------

function rateOf(rows: readonly TcmbRateRow[] | undefined, type: string, side: "borrowing" | "lending"): number | null {
  const value = rows?.find((row) => row.type === type)?.[side];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The change that the given MPC meeting produced (effective within a few days after it), if any. */
export function changeFromMeeting(changes: readonly PolicyRateChange[] | undefined, meetingDay: string | undefined): PolicyRateChange | null {
  if (!changes || !meetingDay) return null;
  const start = Date.parse(`${meetingDay}T00:00:00Z`);
  return (
    changes.find((change) => {
      const at = Date.parse(`${change.date}T00:00:00Z`);
      return at >= start && at - start <= 5 * 86_400_000;
    }) ?? null
  );
}

function CorridorTrack({ floor, policy, ceiling, late }: { floor: number; policy: number; ceiling: number; late: number | null }) {
  const { t } = useMakroI18n();
  const top = Math.max(ceiling, late ?? ceiling);
  const min = Math.floor(floor - 1);
  const max = Math.ceil(top + 1);
  const pos = (value: number) => `${((value - min) / (max - min)) * 100}%`;
  const bandWidth = `${((ceiling - floor) / (max - min)) * 100}%`;
  return (
    <div
      role="img"
      aria-label={t("mp.corridorAria", { floor: formatPercent(floor), policy: formatPercent(policy), ceiling: formatPercent(ceiling) })}
      className="relative h-9"
    >
      <div aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <div
        aria-hidden
        className="absolute top-1/2 h-2 -translate-y-1/2 rounded-sm"
        style={{ left: pos(floor), width: bandWidth, backgroundColor: "color-mix(in oklab, var(--chart-1) 22%, transparent)" }}
      />
      {late !== null ? (
        <span aria-hidden className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-muted-foreground" style={{ left: pos(late) }} />
      ) : null}
      <span
        aria-hidden
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
        style={{ left: pos(policy), backgroundColor: SERIES_COLOR.policy }}
      />
      <span aria-hidden className="absolute bottom-0 left-0 font-mono text-[10px] text-muted-foreground">
        {formatPercent(min, 0)}
      </span>
      <span aria-hidden className="absolute bottom-0 right-0 font-mono text-[10px] text-muted-foreground">
        {formatPercent(max, 0)}
      </span>
    </div>
  );
}

function RateRow({ label, value, marker }: { label: string; value: number | null; marker?: "policy" | "band" | "late" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="flex w-3 shrink-0 justify-center">
          {marker === "policy" ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SERIES_COLOR.policy }} /> : null}
          {marker === "band" ? <span className="h-2 w-3 rounded-[2px]" style={{ backgroundColor: "color-mix(in oklab, var(--chart-1) 22%, transparent)" }} /> : null}
          {marker === "late" ? <span className="h-2.5 w-0.5 bg-muted-foreground" /> : null}
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="font-mono text-[13px] font-medium tabular-nums text-foreground">{value !== null ? formatPercent(value) : EMPTY_VALUE}</dd>
    </div>
  );
}

const PUBLICATION_ORDER: TcmbEventType[] = ["mpc_summary", "inflation_report", "financial_stability_report"];

function whenLabel(event: TcmbEvent, now: number | null, t: ReturnType<typeof useMakroI18n>["t"]): string {
  const date = formatMarketDate(event.date, "date");
  const days = now !== null ? daysUntil(event.date, now) : null;
  const at = event.time ? t("mp.at", { date, time: event.time }) : date;
  if (days === null || days < 0) return at;
  if (days === 0) return event.time ? t("mp.todayAt", { time: event.time }) : `${date} · ${t("common.today")}`;
  if (days === 1) return `${at} · ${t("mp.tomorrow")}`;
  return `${at} · ${t("mp.inDays", { days })}`;
}

export function CorridorPanel({ className }: { className?: string }) {
  const { t, locale } = useMakroI18n();
  const now = useNow();
  const ratesQ = useTcmbRates();
  const policyQ = usePolicyRate();
  const calendarQ = useTcmbCalendar();
  const [showAllDecisions, setShowAllDecisions] = useState(false);

  const rows = ratesQ.data?.data;
  const policy = rateOf(rows, "policy", "lending") ?? policyQ.data?.policy_rate?.value ?? null;
  const floor = rateOf(rows, "overnight", "borrowing");
  const ceiling = rateOf(rows, "overnight", "lending");
  const late = rateOf(rows, "late_liquidity", "lending");

  const changes = policyQ.data?.changes;
  const lastChange = policyQ.data?.last_change ?? null;
  const lastMeeting = calendarQ.data?.last?.mpc_decision;
  const nextMeeting = calendarQ.data?.next?.mpc_decision;
  const meetingChange = changeFromMeeting(changes, lastMeeting?.date);
  const publications = PUBLICATION_ORDER.map((type) => calendarQ.data?.next?.[type])
    .filter((event): event is TcmbEvent => Boolean(event))
    .sort((a, b) => a.date.localeCompare(b.date));

  const decisions = useMemo(() => [...(changes ?? [])].reverse().filter((c) => c.change_bp !== null), [changes]);
  const shownDecisions = showAllDecisions ? decisions : decisions.slice(0, 6);

  return (
    <Panel
      className={className}
      title={t("mp.corridor")}
      subtitle={t("mp.corridorDesc")}
      footer={
        <>
          <SourceLine source="TCMB" />
          <ApiDataMeta path="/macro/policy-rate" className="mt-1" />
        </>
      }
    >
      {ratesQ.isPending ? (
        <div className="space-y-2">
          <Shimmer className="h-9" />
          <Shimmer className="h-24" />
        </div>
      ) : ratesQ.isError && !ratesQ.data ? (
        <PanelError error={ratesQ.error} onRetry={() => void ratesQ.refetch()} />
      ) : (
        <>
          {policy !== null && floor !== null && ceiling !== null ? (
            <CorridorTrack floor={floor} policy={policy} ceiling={ceiling} late={late} />
          ) : null}
          <dl className="mt-2 divide-y divide-border/60">
            <RateRow label={t("mp.policy")} value={policy} marker="policy" />
            <RateRow label={t("mp.onBorrowing")} value={floor} marker="band" />
            <RateRow label={t("mp.onLending")} value={ceiling} marker="band" />
            {late !== null ? <RateRow label={t("mp.lateLending")} value={late} marker="late" /> : null}
          </dl>
        </>
      )}

      <div className="mt-4 space-y-2.5 border-t border-border pt-3">
        <DataLabel>{t("mp.meetings")}</DataLabel>
        {calendarQ.isPending ? (
          <Shimmer className="h-16" />
        ) : (
          <dl className="space-y-2 text-xs">
            {lastMeeting ? (
              <div>
                <dt className="text-muted-foreground">{t("mp.lastMeeting")}</dt>
                <dd className="text-foreground">
                  <span className="font-medium">{formatMarketDate(lastMeeting.date, "date")}</span>
                  {" — "}
                  {meetingChange && meetingChange.previous !== null
                    ? t("mp.moved", {
                        from: formatPercent(meetingChange.previous),
                        to: formatPercent(meetingChange.rate),
                        change: formatBpValue(meetingChange.change_bp, locale),
                      })
                    : policy !== null
                      ? t("mp.hold", { rate: formatPercent(policy) })
                      : EMPTY_VALUE}
                </dd>
              </div>
            ) : null}
            {nextMeeting ? (
              <div>
                <dt className="text-muted-foreground">{t("mp.nextMeeting")}</dt>
                <dd className="font-medium text-foreground">{whenLabel(nextMeeting, now, t)}</dd>
              </div>
            ) : null}
            {lastChange && lastChange.previous !== null ? (
              <div>
                <dt className="text-muted-foreground">{t("mp.lastChange")}</dt>
                <dd className="text-foreground">
                  <span className="font-medium">{formatMarketDate(lastChange.date, "date")}</span>
                  {" — "}
                  {t("mp.moved", {
                    from: formatPercent(lastChange.previous),
                    to: formatPercent(lastChange.rate),
                    change: formatBpValue(lastChange.change_bp, locale),
                  })}
                </dd>
              </div>
            ) : null}
            {calendarQ.isError && !calendarQ.data ? (
              <div className="text-muted-foreground">
                {t("common.loadError")} ·{" "}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void calendarQ.refetch()}>
                  {t("common.retry")}
                </button>
              </div>
            ) : null}
          </dl>
        )}
        {publications.length > 0 ? (
          <div className="pt-1">
            <p className="mb-1 text-[11px] text-muted-foreground">{t("mp.upcoming")}</p>
            <ul className="space-y-1 text-xs">
              {publications.map((event) => (
                <li key={`${event.type}-${event.date}`} className="flex items-baseline justify-between gap-3">
                  <span className="text-foreground">{t(`mp.event.${event.type}` as MakroKey)}</span>
                  <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatMarketDate(event.date, "dayMonth")}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <DataLabel>{t("mp.decisions")}</DataLabel>
        </div>
        {policyQ.isPending ? (
          <Shimmer className="h-28" />
        ) : decisions.length === 0 ? (
          <PanelEmpty className="py-4" />
        ) : (
          <>
            <div className={cn(showAllDecisions && "max-h-64 overflow-y-auto scrollbar-thin")}>
              <table className="w-full text-xs">
                <caption className="sr-only">{t("mp.decisionsDesc")}</caption>
                <thead className="sticky top-0 bg-card">
                  <tr className="text-[11px] text-muted-foreground">
                    <th scope="col" className="py-1 text-left font-normal">{t("mp.effective")}</th>
                    <th scope="col" className="py-1 text-right font-normal">{t("mp.rate")}</th>
                    <th scope="col" className="py-1 text-right font-normal">{t("common.change")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {shownDecisions.map((change) => (
                    <tr key={change.date}>
                      <td className="py-1 text-muted-foreground">{formatMarketDate(change.date, "date")}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-foreground">{formatPercent(change.rate)}</td>
                      <td className="py-1 text-right font-mono tabular-nums text-muted-foreground">{formatBpValue(change.change_bp, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {decisions.length > 6 ? (
              <button
                type="button"
                onClick={() => setShowAllDecisions((value) => !value)}
                aria-expanded={showAllDecisions}
                className="mt-1.5 text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {showAllDecisions ? t("common.showLess") : t("common.showAll", { count: decisions.length })}
              </button>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Policy rate vs inflation chart
// ---------------------------------------------------------------------------

type PolicyRange = "1y" | "3y" | "5y" | "10y" | "all";
const POLICY_RANGES: Record<PolicyRange, number | null> = { "1y": 12, "3y": 36, "5y": 60, "10y": 120, all: null };
const MAIN_HEIGHT = 230;
const REAL_HEIGHT = 92;
const Y_WIDTH = 46;

export function PolicyInflationPanel({ className }: { className?: string }) {
  const { t, locale } = useMakroI18n();
  const now = useNow();
  const policyQ = usePolicyRate();
  const inflationQ = useInflation();
  const [range, setRange] = useState<PolicyRange>("5y");
  const [view, setView] = useState<ChartView>("chart");

  // useNow() is null during SSR/hydration; the chart waits for the client clock.
  const today = now !== null ? istanbulClock(now).dateKey : null;
  const series = useMemo(
    () => (today ? policyInflationSeries(policyQ.data?.changes, inflationSeries(inflationQ.data?.tufe_history), today) : []),
    [policyQ.data?.changes, inflationQ.data?.tufe_history, today],
  );
  // The repo rate became the policy rate in May 2010 — start at its first full month.
  const points = useMemo(() => lastMonths(series.slice(1), POLICY_RANGES[range]), [series, range]);
  const ticks = useMemo(() => monthTicks(points.map((p) => p.month), 7), [points]);
  const realAxis = useMemo(() => signedAxis(points.map((p) => p.real)), [points]);
  const latestWithCpi = [...points].reverse().find((p) => p.cpi !== null) ?? null;
  const latest = points.length > 0 ? points[points.length - 1] : null;

  // January-only ticks read best as bare years; finer ticks need the month.
  const tickStyle = range !== "1y" && ticks.length > 0 && ticks.every((month) => month.endsWith("-01")) ? "year" : "monthYear";
  const rowsFor = (point: PolicyInflationPoint) => [
    { key: "policy", label: t("mp.series.policy"), value: point.policy !== null ? formatPercent(point.policy) : EMPTY_VALUE, color: SERIES_COLOR.policy },
    { key: "cpi", label: t("mp.series.cpi"), value: point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE, color: SERIES_COLOR.cpi },
    { key: "real", label: t("mp.series.real"), value: formatPp(point.real, locale), color: SERIES_COLOR.neutral },
  ];

  const pending = policyQ.isPending || inflationQ.isPending || today === null;
  const failed = (policyQ.isError && !policyQ.data) || (inflationQ.isError && !inflationQ.data);
  const rangeLabel = t(`range.${range}.long` as MakroKey);

  return (
    <Panel
      className={className}
      bodyClassName="flex flex-col"
      title={t("mp.chartTitle")}
      subtitle={t("mp.chartDesc")}
      actions={
        <>
          <RangePicker
            value={range}
            onChange={setRange}
            options={(Object.keys(POLICY_RANGES) as PolicyRange[]).map((key) => ({
              value: key,
              label: t(`range.${key}` as MakroKey),
              title: t(`range.${key}.long` as MakroKey),
            }))}
          />
          <ViewToggle value={view} onChange={setView} />
        </>
      }
      footer={
        <>
          <SourceLine
            source={`TCMB, ${inflationQ.data?.source ?? "TÜİK"}`}
            parts={[latestWithCpi ? t("common.asOf", { date: formatMarketDate(latestWithCpi.month, "monthYear") }) : null]}
          />
          <p className="mt-1">{t("mp.noteEffective")}</p>
        </>
      }
    >
      {pending ? (
        <ChartSkeleton height={MAIN_HEIGHT + REAL_HEIGHT + 28} />
      ) : failed ? (
        <PanelError
          error={policyQ.error ?? inflationQ.error}
          onRetry={() => {
            void policyQ.refetch();
            void inflationQ.refetch();
          }}
        />
      ) : points.length < 2 ? (
        <PanelEmpty />
      ) : view === "table" ? (
        <ChartTable
          caption={t("mp.chartTitle")}
          height={MAIN_HEIGHT + REAL_HEIGHT + 28}
          columns={[
            { key: "month", label: t("inf.month") },
            { key: "policy", label: t("mp.series.policy"), align: "right" },
            { key: "cpi", label: t("mp.series.cpi"), align: "right" },
            { key: "real", label: t("mp.series.real"), align: "right" },
          ]}
          rows={[...points].reverse().map((point) => ({
            key: point.month,
            cells: [
              formatMarketDate(point.month, "monthYear"),
              point.policy !== null ? formatPercent(point.policy) : EMPTY_VALUE,
              point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE,
              formatPp(point.real, locale),
            ],
          }))}
        />
      ) : (
        <div
          role="img"
          className="flex flex-1 flex-col"
          aria-label={t("mp.chartAria", {
            range: rangeLabel,
            policy: latest?.policy != null ? formatPercent(latest.policy) : EMPTY_VALUE,
            cpi: latestWithCpi?.cpi != null ? formatPercent(latestWithCpi.cpi) : EMPTY_VALUE,
            real: formatPp(latestWithCpi?.real, locale),
          })}
        >
          <ChartLegend
            className="mb-2"
            items={[
              { key: "policy", label: t("mp.series.policy"), color: SERIES_COLOR.policy },
              { key: "cpi", label: t("mp.series.cpi"), color: SERIES_COLOR.cpi },
              { key: "real", label: t("mp.series.real"), color: SERIES_COLOR.neutral, shape: "bar" },
            ]}
          />
          <div className="min-h-0 flex-1" style={{ minHeight: MAIN_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 600, height: MAIN_HEIGHT }}>
              <LineChart data={points} syncId="macro-policy-inflation" margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="month" hide />
                <YAxis
                  orientation="right"
                  width={Y_WIDTH}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  tickCount={5}
                  domain={[0, "auto"]}
                  tickFormatter={(value) => formatPercent(Number(value), 0)}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={CURSOR_STYLE}
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as PolicyInflationPoint | undefined) : undefined;
                    if (!point) return null;
                    return <ChartTooltipBox title={formatMarketDate(point.month, "monthYear")} rows={rowsFor(point)} />;
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey="policy"
                  name={t("mp.series.policy")}
                  stroke={SERIES_COLOR.policy}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={{ r: 4, fill: SERIES_COLOR.policy, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="cpi"
                  name={t("mp.series.cpi")}
                  stroke={SERIES_COLOR.cpi}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, fill: SERIES_COLOR.cpi, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <DataLabel>{`${t("mp.series.real")} (${t("common.pp")})`}</DataLabel>
          </div>
          <div style={{ height: REAL_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 600, height: REAL_HEIGHT }}>
              <AreaChart data={points} syncId="macro-policy-inflation" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis
                  dataKey="month"
                  ticks={ticks}
                  interval="equidistantPreserveStart"
                  minTickGap={10}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  tickMargin={6}
                  tickFormatter={(value) => formatMarketDate(String(value), tickStyle)}
                />
                <YAxis
                  orientation="right"
                  width={Y_WIDTH}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  domain={realAxis.domain}
                  ticks={realAxis.ticks}
                  interval={0}
                  tickFormatter={(value) => formatChangePercent(Number(value), 0)}
                />
                <ReferenceLine y={0} stroke="var(--color-muted-foreground)" strokeOpacity={0.6} />
                <Tooltip isAnimationActive={false} cursor={CURSOR_STYLE} content={() => null} />
                <Area
                  type="linear"
                  dataKey="real"
                  stroke={SERIES_COLOR.neutral}
                  strokeWidth={1.5}
                  fill={SERIES_COLOR.neutral}
                  fillOpacity={0.18}
                  baseValue={0}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}
