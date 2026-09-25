"use client";

import { useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EMPTY_VALUE, formatMarketDate, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartSkeleton } from "@/components/ui/chart-skeleton";
import { useMakroI18n, type MakroKey } from "./i18n";
import { useMarketHistory, useMarkets } from "./queries";
import { formatBp, formatMarketValue } from "./format";
import { AXIS_TICK, CURSOR_STYLE, GRID_STROKE, SERIES_COLOR, ChartTable, ChartTooltipBox, niceScale } from "./chart-kit";
import { DataLabel, NeutralChange, Panel, PanelEmpty, PanelError, PriceChange, RangePicker, Shimmer, SourceLine, ViewToggle, type ChartView } from "./ui";
import { YieldCurvePanel } from "./YieldCurvePanel";
import { FxBulletinPanel } from "./FxBulletinPanel";
import type { MarketHistoryOut, MarketPeriod, MarketQuote } from "./types";

const BOARD_GROUPS = ["fx", "commodity", "global"] as const;
const PERIODS: MarketPeriod[] = ["1ay", "3ay", "6ay", "ytd", "1y", "2y", "5y"];
const CHART_HEIGHT = 260;

type Translate = ReturnType<typeof useMakroI18n>["t"];

function instrumentName(key: string, t: Translate): string {
  return t(`mk.name.${key}` as MakroKey);
}

function instrumentCode(key: string, t: Translate): string {
  return t(`mk.code.${key}` as MakroKey);
}

/** Daily change: price instruments in direction colours, yields as neutral basis points. */
function QuoteChange({ quote, className }: { quote: MarketQuote; className?: string }) {
  const { locale } = useMakroI18n();
  if (quote.unit === "percent") {
    return <NeutralChange value={quote.change} text={formatBp(quote.change, locale)} className={className} />;
  }
  return <PriceChange value={quote.change_percent} className={className} />;
}

function QuoteRow({ quote, selected, onSelect }: { quote: MarketQuote; selected: boolean; onSelect: () => void }) {
  const { t } = useMakroI18n();
  const name = instrumentName(quote.key, t);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={t("mk.select", { name })}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto_4.75rem] items-center gap-3 border-l-2 px-3 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          selected ? "border-primary bg-muted/70" : "border-transparent hover:bg-muted/40",
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-foreground">{name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{instrumentCode(quote.key, t)}</span>
        </span>
        <span className="font-mono text-[13px] tabular-nums text-foreground">{formatMarketValue(quote.last, quote.key, quote.unit)}</span>
        <QuoteChange quote={quote} className="justify-end text-xs" />
      </button>
    </li>
  );
}

function QuoteBoard({ selected, onSelect, className }: { selected: string; onSelect: (key: string) => void; className?: string }) {
  const { t } = useMakroI18n();
  const marketsQ = useMarkets();
  const instruments = marketsQ.data?.instruments ?? [];
  const updated = marketsQ.data?.as_of;

  return (
    <Panel
      className={className}
      title={t("mk.instruments")}
      subtitle={t("mk.instrumentsDesc")}
      bodyClassName="px-0 py-1"
      footer={
        <>
          <SourceLine source={marketsQ.data?.source ?? "TradingView"} parts={[updated ? t("common.updated", { time: formatMarketDate(updated, "dayMonthTime") }) : null]} />
          <p className="mt-1">{t("mk.derivedNote")}</p>
        </>
      }
    >
      {marketsQ.isPending ? (
        <div className="space-y-1.5 px-4 py-2">
          {Array.from({ length: 9 }, (_, i) => (
            <Shimmer key={i} className="h-8" />
          ))}
        </div>
      ) : marketsQ.isError && !marketsQ.data ? (
        <PanelError error={marketsQ.error} onRetry={() => void marketsQ.refetch()} />
      ) : (
        BOARD_GROUPS.map((group) => {
          const rows = instruments.filter((quote) => quote.group === group);
          if (rows.length === 0) return null;
          return (
            <div key={group} className="py-1">
              <DataLabel className="block px-4 pb-0.5 pt-1.5">{t(`mk.group.${group}` as MakroKey)}</DataLabel>
              <ul>
                {rows.map((quote) => (
                  <QuoteRow key={quote.key} quote={quote} selected={quote.key === selected} onSelect={() => onSelect(quote.key)} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </Panel>
  );
}

/** Month-/week-aligned x ticks for daily closes, thinned to at most `maxTicks`. */
function dateTicks(dates: readonly string[], period: MarketPeriod, maxTicks: number): string[] {
  if (dates.length === 0) return [];
  const weekly = period === "1ay";
  const bucket = (day: string) => {
    if (!weekly) return day.slice(0, 7);
    const d = new Date(`${day}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
    return monday.toISOString().slice(0, 10);
  };
  const starts: string[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    if (bucket(dates[i]) !== bucket(dates[i - 1])) starts.push(dates[i]);
  }
  if (weekly) {
    const step = Math.max(1, Math.ceil(starts.length / maxTicks));
    return starts.filter((_, index) => index % step === 0);
  }
  // Month starts, thinned to round calendar steps (every 2nd/3rd/6th month, Januaries).
  const step = [1, 2, 3, 6, 12, 24].find((candidate) => starts.length / candidate <= maxTicks) ?? 24;
  return starts.filter((day) => {
    const month = Number(day.slice(5, 7)) - 1;
    const year = Number(day.slice(0, 4));
    return step >= 12 ? month === 0 && year % (step / 12) === 0 : month % step === 0;
  });
}

function tickStyleFor(period: MarketPeriod, ticks: readonly string[]): "dayMonth" | "monthYear" | "year" {
  if (period === "1ay" || period === "3ay") return "dayMonth";
  // Only January ticks left (multi-year ranges) → bare years read cleanest.
  return ticks.length > 0 && ticks.every((day) => day.slice(5, 7) === "01") && period !== "ytd" && period !== "1y" ? "year" : "monthYear";
}

function MarketChartPanel({ selectedKey, className }: { selectedKey: string; className?: string }) {
  const { t, locale } = useMakroI18n();
  const marketsQ = useMarkets();
  const [period, setPeriod] = useState<MarketPeriod>("1y");
  const [view, setView] = useState<ChartView>("chart");
  const historyQ = useMarketHistory(selectedKey, period);
  const quote = marketsQ.data?.instruments?.find((item) => item.key === selectedKey) ?? null;
  const history: MarketHistoryOut | undefined = historyQ.data;
  const points = useMemo(() => history?.points ?? [], [history]);
  const unit = quote?.unit ?? history?.unit ?? "TRY";
  const isYield = unit === "percent";
  const ticks = useMemo(() => dateTicks(points.map((p) => p.date), period, 6), [points, period]);
  const scale = useMemo(() => niceScale(points.map((p) => p.close), 6), [points]);
  const formatTick = (v: number) => (isYield ? formatPercent(v, scale?.decimals ?? 0) : formatNumber(v, scale?.decimals ?? 0));
  // Axis as wide as its longest label (10 px sans digits ≈ 6 px) plus the tick gap.
  const axisWidth = Math.max(36, Math.max(0, ...(scale?.ticks ?? []).map((tick) => formatTick(tick).length)) * 6 + 12);
  const name = instrumentName(selectedKey, t);
  const value = (v: number | null | undefined) => formatMarketValue(v, selectedKey, unit);
  // Yields move in basis points; prices in percent.
  const periodChange = history && isYield ? formatBp(history.change, locale) : null;

  return (
    <Panel
      className={className}
      bodyClassName="flex flex-col"
      title={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span>{name}</span>
          <span className="text-[11px] font-normal text-muted-foreground">{instrumentCode(selectedKey, t)}</span>
        </span>
      }
      subtitle={t(`range.${period}.long` as MakroKey)}
      actions={
        <>
          <RangePicker
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((key) => ({ value: key, label: t(`range.${key}` as MakroKey), title: t(`range.${key}.long` as MakroKey) }))}
          />
          <ViewToggle value={view} onChange={setView} />
        </>
      }
      footer={
        <>
          <SourceLine source={history?.source ?? "TradingView"} parts={[t("common.delayedNote")]} />
          {isYield ? <p className="mt-1">{t("mk.yieldNote")}</p> : null}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          {quote ? (
            <>
              <div className="font-mono text-2xl font-semibold leading-8 tabular-nums text-foreground">{value(quote.last)}</div>
              <div className="flex items-center gap-2 text-xs">
                <QuoteChange quote={quote} />
                <span className="text-muted-foreground">{t("common.daily")}</span>
              </div>
            </>
          ) : marketsQ.isPending ? (
            <Shimmer className="h-12 w-36" />
          ) : null}
        </div>
        <dl className="grid grid-cols-3 gap-x-5 text-right">
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("common.periodChange")}</dt>
            <dd className="font-mono text-[13px] tabular-nums">
              {history ? (
                isYield ? (
                  <NeutralChange value={history.change} text={periodChange ?? EMPTY_VALUE} className="text-foreground" />
                ) : (
                  <PriceChange value={history.change_percent} />
                )
              ) : (
                EMPTY_VALUE
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("common.high")}</dt>
            <dd className="font-mono text-[13px] tabular-nums text-foreground">{history ? value(history.high) : EMPTY_VALUE}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted-foreground">{t("common.low")}</dt>
            <dd className="font-mono text-[13px] tabular-nums text-foreground">{history ? value(history.low) : EMPTY_VALUE}</dd>
          </div>
        </dl>
      </div>

      {historyQ.isPending ? (
        <ChartSkeleton height={CHART_HEIGHT} />
      ) : historyQ.isError && !history ? (
        <PanelError error={historyQ.error} onRetry={() => void historyQ.refetch()} />
      ) : points.length < 2 ? (
        <PanelEmpty />
      ) : view === "table" ? (
        <ChartTable
          caption={name}
          height={CHART_HEIGHT}
          columns={[
            { key: "date", label: t("common.date") },
            { key: "close", label: t("common.last"), align: "right" },
          ]}
          rows={[...points].reverse().map((point) => ({
            key: point.date,
            cells: [formatMarketDate(point.date, "date"), value(point.close)],
          }))}
        />
      ) : (
        <div
          role="img"
          aria-label={t("mk.chartAria", {
            name,
            range: t(`range.${period}.long` as MakroKey),
            last: value(points[points.length - 1]?.close),
            change: isYield ? (periodChange ?? EMPTY_VALUE) : history?.change_percent != null ? formatPercent(history.change_percent) : EMPTY_VALUE,
            high: value(history?.high),
            low: value(history?.low),
          })}
          aria-busy={historyQ.isPlaceholderData}
          className={cn("min-h-0 flex-1 transition-opacity", historyQ.isPlaceholderData && "opacity-60")}
          style={{ minHeight: CHART_HEIGHT }}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 600, height: CHART_HEIGHT }}>
            <AreaChart data={points} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                interval="equidistantPreserveStart"
                minTickGap={10}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
                tickMargin={6}
                tickFormatter={(v) => formatMarketDate(String(v), tickStyleFor(period, ticks))}
              />
              <YAxis
                orientation="right"
                width={axisWidth}
                axisLine={false}
                tickLine={false}
                tick={AXIS_TICK}
                domain={scale?.domain ?? ["auto", "auto"]}
                ticks={scale?.ticks}
                interval={0}
                tickFormatter={(v) => formatTick(Number(v))}
              />
              <Tooltip
                isAnimationActive={false}
                cursor={CURSOR_STYLE}
                content={({ active, payload }) => {
                  const point = active ? (payload?.[0]?.payload as { date: string; close: number } | undefined) : undefined;
                  if (!point) return null;
                  return (
                    <ChartTooltipBox
                      title={formatMarketDate(point.date, "date")}
                      rows={[{ key: "close", label: name, value: value(point.close), color: SERIES_COLOR.market }]}
                    />
                  );
                }}
              />
              <Area
                type="linear"
                dataKey="close"
                stroke={SERIES_COLOR.market}
                strokeWidth={2}
                strokeLinejoin="round"
                fill={SERIES_COLOR.market}
                fillOpacity={0.08}
                dot={false}
                activeDot={{ r: 4, fill: SERIES_COLOR.market, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function MarketsSection() {
  const [selected, setSelected] = useState("usdtry");
  const chartRef = useRef<HTMLDivElement>(null);

  /** Bond rows live in the yield-curve panel below the chart: bring the chart into view. */
  const selectFromCurve = (key: string) => {
    setSelected(key);
    chartRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="space-y-4">
      {/* Board on the left; chart and curve stacked on the right, the chart taking up
          whatever height the board leaves so both columns end together. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <QuoteBoard selected={selected} onSelect={setSelected} />
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <div ref={chartRef} className="flex min-w-0 flex-1 scroll-mt-24 flex-col">
            <MarketChartPanel selectedKey={selected} className="flex-1" />
          </div>
          <YieldCurvePanel selected={selected} onSelect={selectFromCurve} />
        </div>
      </div>
      <FxBulletinPanel />
    </div>
  );
}
