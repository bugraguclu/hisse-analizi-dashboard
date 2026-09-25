"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EMPTY_VALUE, formatMarketDate, formatPercent } from "@/lib/format";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { useMakroI18n, type MakroKey } from "./i18n";
import { useIndicators, useInflation } from "./queries";
import { formatPeriod, formatPp } from "./format";
import { inflationSeries, lastMonths, type MonthlyInflation } from "./series";
import { AXIS_TICK, CURSOR_STYLE, GRID_STROKE, SERIES_COLOR, ChartLegend, ChartTable, ChartTooltipBox, monthTicks } from "./chart-kit";
import { ApiDataMeta } from "@/components/shared/DataMeta";
import { NeutralChange, Panel, PanelEmpty, PanelError, RangePicker, SourceLine, StatTile, TileGrid, ViewToggle, sourceLabel, type ChartView } from "./ui";
import type { InflationLatest, InflationRow } from "./types";

type TrendRange = "1y" | "3y" | "5y" | "10y" | "all";
const TREND_RANGES: Record<TrendRange, number | null> = { "1y": 12, "3y": 36, "5y": 60, "10y": 120, all: null };
const TREND_HEIGHT = 250;
const MONTHLY_HEIGHT = 250;

interface TrendPoint {
  month: string;
  cpi: number | null;
  ppi: number | null;
}

interface MonthlyPoint {
  month: string;
  cpi: number | null;
  ppi: number | null;
}

/** Previous month's value of `field` from newest-first rows (row 1). */
function previousValue(rows: readonly InflationRow[] | undefined, field: "YearlyInflation" | "MonthlyInflation"): number | null {
  const value = rows?.[1]?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function difference(current: number | null | undefined, previous: number | null): number | null {
  return typeof current === "number" && previous !== null ? Math.round((current - previous) * 100) / 100 : null;
}

/** Advance width of the 10 px mono label font (IBM Plex Mono is 0.6 em per glyph). */
const LABEL_CHAR_WIDTH = 6;

/**
 * Baseline of the latest bar's value label. The label is right-aligned to the last bar,
 * so it stays clear of the right-hand axis, and it may reach over the previous bars —
 * it is lifted above the tallest bar it spans. Bars start at the left plot edge (no left
 * axis or margin), so one category is the last bar's right edge divided by the count.
 */
function lastBarLabelY(
  points: readonly MonthlyPoint[],
  bar: { x: number; y: number; width: number; height?: number },
  chars: number,
): number {
  const last = points[points.length - 1]?.cpi ?? null;
  if (last === null || last <= 0 || !bar.height || bar.height <= 0) return Math.max(bar.y - 5, 10);
  const band = (bar.x + bar.width) / points.length;
  const spanned = Math.max(1, Math.ceil((chars * LABEL_CHAR_WIDTH - bar.width) / band) + 1);
  const tallest = Math.max(...points.slice(-spanned).map((point) => point.cpi ?? 0));
  const pxPerUnit = bar.height / last;
  return Math.max(bar.y + bar.height - tallest * pxPerUnit - 5, 10);
}

function mergeByMonth(cpi: MonthlyInflation[], ppi: MonthlyInflation[], field: "yearly" | "monthly"): TrendPoint[] {
  const ppiByMonth = new Map(ppi.map((row) => [row.month, row[field]]));
  // Month axis follows CPI (the headline series); PPI is added where published.
  return cpi.map((row) => ({ month: row.month, cpi: row[field], ppi: ppiByMonth.get(row.month) ?? null }));
}

export function InflationTiles() {
  const { t, locale } = useMakroI18n();
  const inflationQ = useInflation();
  const indicatorsQ = useIndicators();
  const data = inflationQ.data;
  const loading = inflationQ.isPending;
  const core = indicatorsQ.data?.indicators?.find((indicator) => indicator.key === "core_inflation_yoy");

  const tile = (
    label: string,
    latest: InflationLatest | null | undefined,
    rows: readonly InflationRow[] | undefined,
    field: "yearly_inflation" | "monthly_inflation",
  ) => {
    const value = latest?.[field];
    const previous = previousValue(rows, field === "yearly_inflation" ? "YearlyInflation" : "MonthlyInflation");
    const change = difference(value, previous);
    return (
      <StatTile
        key={label}
        label={label}
        loading={loading}
        value={typeof value === "number" ? formatPercent(value) : EMPTY_VALUE}
        change={change !== null ? <NeutralChange value={change} text={formatPp(change, locale)} /> : undefined}
        meta={latest?.date ? formatMarketDate(latest.date.slice(0, 7), "monthYear") : undefined}
      />
    );
  };

  if (inflationQ.isError && !data) {
    return (
      <div className="card-surface">
        <PanelError error={inflationQ.error} onRetry={() => void inflationQ.refetch()} />
      </div>
    );
  }

  return (
    <TileGrid className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      {tile(t("inf.cpiYearly"), data?.latest, data?.tufe_history, "yearly_inflation")}
      {tile(t("inf.cpiMonthly"), data?.latest, data?.tufe_history, "monthly_inflation")}
      <StatTile
        label={t("inf.coreYearly")}
        loading={indicatorsQ.isPending}
        value={core ? formatPercent(core.value) : EMPTY_VALUE}
        change={core?.change != null ? <NeutralChange value={core.change} text={formatPp(core.change, locale)} /> : undefined}
        meta={core ? formatPeriod(core.period, core.frequency, locale) : undefined}
        info={{
          label: t("common.info"),
          content: `${t("inf.coreNote")} ${t("common.source")}: ${sourceLabel(indicatorsQ.data?.source ?? "TradingView", t)}.`,
        }}
      />
      {tile(t("inf.ppiYearly"), data?.ufe_latest, data?.ufe_history, "yearly_inflation")}
      {tile(t("inf.ppiMonthly"), data?.ufe_latest, data?.ufe_history, "monthly_inflation")}
    </TileGrid>
  );
}

export function InflationTrendPanel({ className }: { className?: string }) {
  const { t } = useMakroI18n();
  const inflationQ = useInflation();
  const [range, setRange] = useState<TrendRange>("3y");
  const [view, setView] = useState<ChartView>("chart");

  const all = useMemo(
    () => mergeByMonth(inflationSeries(inflationQ.data?.tufe_history), inflationSeries(inflationQ.data?.ufe_history), "yearly"),
    [inflationQ.data?.tufe_history, inflationQ.data?.ufe_history],
  );
  const points = useMemo(() => lastMonths(all, TREND_RANGES[range]), [all, range]);
  const ticks = useMemo(() => monthTicks(points.map((p) => p.month), 7), [points]);
  const tickStyle = range !== "1y" && ticks.length > 0 && ticks.every((month) => month.endsWith("-01")) ? "year" : "monthYear";
  const hasPpi = points.some((point) => point.ppi !== null);
  const hasNegative = points.some((point) => (point.cpi ?? 0) < 0 || (point.ppi ?? 0) < 0);
  const latest = points.length > 0 ? points[points.length - 1] : null;

  return (
    <Panel
      className={className}
      bodyClassName="flex flex-col"
      title={t("inf.trendTitle")}
      subtitle={t("inf.trendDesc")}
      actions={
        <>
          <RangePicker
            value={range}
            onChange={setRange}
            options={(Object.keys(TREND_RANGES) as TrendRange[]).map((key) => ({
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
            source={inflationQ.data?.source ?? "TÜİK"}
            parts={[inflationQ.data?.as_of ? t("common.asOf", { date: formatMarketDate(inflationQ.data.as_of.slice(0, 7), "monthYear") }) : null]}
          />
          <ApiDataMeta path="/macro/inflation" className="mt-1" />
        </>
      }
    >
      {inflationQ.isPending ? (
        <ChartSkeleton height={TREND_HEIGHT + 24} />
      ) : inflationQ.isError && !inflationQ.data ? (
        <PanelError error={inflationQ.error} onRetry={() => void inflationQ.refetch()} />
      ) : points.length < 2 ? (
        <PanelEmpty />
      ) : view === "table" ? (
        <ChartTable
          caption={t("inf.trendTitle")}
          height={TREND_HEIGHT + 24}
          columns={[
            { key: "month", label: t("inf.month") },
            { key: "cpi", label: t("inf.series.cpi"), align: "right" },
            { key: "ppi", label: t("inf.series.ppi"), align: "right" },
          ]}
          rows={[...points].reverse().map((point) => ({
            key: point.month,
            cells: [
              formatMarketDate(point.month, "monthYear"),
              point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE,
              point.ppi !== null ? formatPercent(point.ppi) : EMPTY_VALUE,
            ],
          }))}
        />
      ) : (
        <div
          role="img"
          className="flex flex-1 flex-col"
          aria-label={t("inf.trendAria", {
            range: t(`range.${range}.long` as MakroKey),
            cpi: latest?.cpi != null ? formatPercent(latest.cpi) : EMPTY_VALUE,
            ppi: latest?.ppi != null ? formatPercent(latest.ppi) : EMPTY_VALUE,
          })}
        >
          <ChartLegend
            className="mb-2"
            items={[
              { key: "cpi", label: t("inf.series.cpi"), color: SERIES_COLOR.cpi },
              ...(hasPpi ? [{ key: "ppi", label: t("inf.series.ppi"), color: SERIES_COLOR.ppi }] : []),
            ]}
          />
          <div className="min-h-0 flex-1" style={{ minHeight: TREND_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 600, height: TREND_HEIGHT }}>
              <LineChart data={points} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
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
                  width={46}
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  tickCount={5}
                  domain={hasNegative ? ["auto", "auto"] : [0, "auto"]}
                  tickFormatter={(value) => formatPercent(Number(value), 0)}
                />
                <Tooltip
                  isAnimationActive={false}
                  cursor={CURSOR_STYLE}
                  content={({ active, payload }) => {
                    const point = active ? (payload?.[0]?.payload as TrendPoint | undefined) : undefined;
                    if (!point) return null;
                    return (
                      <ChartTooltipBox
                        title={formatMarketDate(point.month, "monthYear")}
                        rows={[
                          { key: "cpi", label: t("inf.series.cpi"), value: point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE, color: SERIES_COLOR.cpi },
                          ...(hasPpi
                            ? [{ key: "ppi", label: t("inf.series.ppi"), value: point.ppi !== null ? formatPercent(point.ppi) : EMPTY_VALUE, color: SERIES_COLOR.ppi }]
                            : []),
                        ]}
                      />
                    );
                  }}
                />
                <Line
                  type="linear"
                  dataKey="cpi"
                  stroke={SERIES_COLOR.cpi}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{ r: 4, fill: SERIES_COLOR.cpi, stroke: "var(--card)", strokeWidth: 2 }}
                  isAnimationActive={false}
                />
                {hasPpi ? (
                  <Line
                    type="linear"
                    dataKey="ppi"
                    stroke={SERIES_COLOR.ppi}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    dot={false}
                    activeDot={{ r: 4, fill: SERIES_COLOR.ppi, stroke: "var(--card)", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function MonthlyCpiPanel({ className }: { className?: string }) {
  const { t } = useMakroI18n();
  const inflationQ = useInflation();
  const [view, setView] = useState<ChartView>("chart");

  const points: MonthlyPoint[] = useMemo(
    () =>
      mergeByMonth(inflationSeries(inflationQ.data?.tufe_history), inflationSeries(inflationQ.data?.ufe_history), "monthly").slice(-24),
    [inflationQ.data?.tufe_history, inflationQ.data?.ufe_history],
  );
  const ticks = useMemo(() => monthTicks(points.map((p) => p.month), 5), [points]);
  const lastIndex = points.length - 1;
  const max = points.reduce<number | null>((acc, p) => (p.cpi !== null && (acc === null || p.cpi > acc) ? p.cpi : acc), null);

  return (
    <Panel
      className={className}
      bodyClassName="flex flex-col"
      title={t("inf.monthlyTitle")}
      subtitle={t("inf.monthlyDesc")}
      actions={<ViewToggle value={view} onChange={setView} />}
      footer={<SourceLine source={inflationQ.data?.source ?? "TÜİK"} />}
    >
      {inflationQ.isPending ? (
        <ChartSkeleton height={MONTHLY_HEIGHT} />
      ) : inflationQ.isError && !inflationQ.data ? (
        <PanelError error={inflationQ.error} onRetry={() => void inflationQ.refetch()} />
      ) : points.length === 0 ? (
        <PanelEmpty />
      ) : view === "table" ? (
        <ChartTable
          caption={t("inf.monthlyTitle")}
          height={MONTHLY_HEIGHT}
          columns={[
            { key: "month", label: t("inf.month") },
            { key: "cpi", label: t("inf.series.cpi"), align: "right" },
            { key: "ppi", label: t("inf.series.ppi"), align: "right" },
          ]}
          rows={[...points].reverse().map((point) => ({
            key: point.month,
            cells: [
              formatMarketDate(point.month, "monthYear"),
              point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE,
              point.ppi !== null ? formatPercent(point.ppi) : EMPTY_VALUE,
            ],
          }))}
        />
      ) : (
        <div
          role="img"
          aria-label={t("inf.monthlyAria", {
            last: points[lastIndex]?.cpi != null ? formatPercent(points[lastIndex].cpi) : EMPTY_VALUE,
            max: max !== null ? formatPercent(max) : EMPTY_VALUE,
          })}
          className="min-h-0 flex-1"
          style={{ minHeight: MONTHLY_HEIGHT }}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 320, height: MONTHLY_HEIGHT }}>
            <BarChart data={points} margin={{ top: 18, right: 0, left: 0, bottom: 0 }} barCategoryGap={2}>
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
                tickFormatter={(value) => formatMarketDate(String(value), "monthYear")}
              />
              <YAxis
                orientation="right"
                width={40}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
                tickCount={4}
                domain={points.some((point) => (point.cpi ?? 0) < 0) ? ["auto", "auto"] : [0, "auto"]}
                tickFormatter={(value) => formatPercent(Number(value), 0)}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={{ fill: "var(--color-muted)", fillOpacity: 0.5 }}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as MonthlyPoint | undefined) : undefined;
                  if (!point) return null;
                  return (
                    <ChartTooltipBox
                      title={formatMarketDate(point.month, "monthYear")}
                      rows={[
                        { key: "cpi", label: t("inf.series.cpi"), value: point.cpi !== null ? formatPercent(point.cpi) : EMPTY_VALUE, color: SERIES_COLOR.cpi },
                        { key: "ppi", label: t("inf.series.ppi"), value: point.ppi !== null ? formatPercent(point.ppi) : EMPTY_VALUE },
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="cpi" fill={SERIES_COLOR.cpi} maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {/* Direct label on the latest month only — the axis and tooltip carry the rest. */}
                <LabelList
                  dataKey="cpi"
                  content={(props) => {
                    const { index, x, y, width, height, value } = props as {
                      index?: number;
                      x?: number;
                      y?: number;
                      width?: number;
                      height?: number;
                      value?: unknown;
                    };
                    if (index !== lastIndex || typeof x !== "number" || typeof y !== "number" || typeof width !== "number") return null;
                    const text = formatPercent(Number(value));
                    return (
                      <text
                        x={x + width}
                        y={lastBarLabelY(points, { x, y, width, height }, text.length)}
                        textAnchor="end"
                        className="fill-foreground font-mono text-[10px] font-semibold"
                      >
                        {text}
                      </text>
                    );
                  }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
