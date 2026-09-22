"use client";

import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
  formatChangePercent,
  formatNumber,
  formatPercent,
  formatPrice,
  formatSigned,
  trendTone,
  type TrendTone,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useIndicators, useQuote } from "./hooks";
import { useStockI18n } from "./i18n";
import { SectionCard, SectionError } from "./ui";

type QueryState = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

function Tile({
  title,
  query,
  hasData,
  children,
}: {
  title: string;
  query: QueryState;
  hasData: boolean;
  children: ReactNode;
}) {
  const { t } = useStockI18n();
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border/50 bg-muted/20 p-3">
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>
      {query.isPending ? (
        <div className="space-y-2" role="status">
          <span className="sr-only">{t("state.loading")}</span>
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : query.isError ? (
        <SectionError compact error={query.error} onRetry={() => void query.refetch()} />
      ) : !hasData ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">{t("tech.noIndicator")}</p>
      ) : (
        children
      )}
    </div>
  );
}

function ZonePill({ tone, children }: { tone: TrendTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold",
        tone === "flat" ? "bg-muted text-muted-foreground" : TREND_PILL_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Horizontal 0-100 oscillator gauge with shaded oversold/overbought zones. */
function OscillatorGauge({ value, low, high, label }: { value: number; low: number; high: number; label: string }) {
  const clamped = Math.min(Math.max(value, 0), 100);
  return (
    <div className="mt-3" role="img" aria-label={label}>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted/60">
        <div className="absolute inset-y-0 left-0 bg-up/20" style={{ width: `${low}%` }} />
        <div className="absolute inset-y-0 right-0 bg-down/20" style={{ width: `${100 - high}%` }} />
      </div>
      <div className="relative -mt-2.5 h-3">
        <span className="absolute top-0 h-3 w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${clamped}%` }} />
      </div>
      <div className="relative mt-0.5 h-3 font-mono text-[9px] tabular-nums text-muted-foreground" aria-hidden>
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${low}%` }}>{low}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${high}%` }}>{high}</span>
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono font-semibold tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}

/**
 * RSI (30/70), MACD (histogram sign), Bollinger (%B), Stochastic (20/80) and
 * SuperTrend (direction). Each indicator loads and fails independently.
 */
export function IndicatorPanel({ ticker, compact = false }: { ticker: string; compact?: boolean }) {
  const { t } = useStockI18n();
  const { data, queries } = useIndicators(ticker);
  const { quote } = useQuote(ticker);
  const price = quote?.last ?? null;

  const rsi = data.rsi;
  const rsiZone = rsi == null ? null : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral";

  const macd = data.macd;
  const histTone = trendTone(macd?.histogram ?? null);

  const boll = data.bollinger;
  const percentB =
    boll?.upper != null && boll.lower != null && price != null && boll.upper > boll.lower
      ? ((price - boll.lower) / (boll.upper - boll.lower)) * 100
      : null;
  const bandwidth = boll?.upper != null && boll.lower != null && boll.middle ? ((boll.upper - boll.lower) / boll.middle) * 100 : null;

  const stoch = data.stochastic;
  const k = stoch?.k ?? null;
  const d = stoch?.d ?? null;
  const stochZone = k == null ? null : k >= 80 ? "overbought" : k <= 20 ? "oversold" : "neutral";

  const st = data.supertrend;
  const stTone: TrendTone = st?.direction == null ? "flat" : st.direction > 0 ? "up" : st.direction < 0 ? "down" : "flat";
  const stDistance = st?.value != null && price != null ? (price / st.value - 1) * 100 : null;

  const zoneTone = (zone: string | null): TrendTone => (zone === "oversold" ? "up" : zone === "overbought" ? "down" : "flat");
  const zoneLabel = (zone: string | null) =>
    zone === "overbought" ? t("tech.overbought") : zone === "oversold" ? t("tech.oversold") : t("tech.neutralZone");

  return (
    <SectionCard title={t("tech.indicatorsTitle")} icon={<Activity />} footer={t("tech.indicatorsFooter")}>
      <div className={cn("grid grid-cols-1 gap-3", compact ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
        <Tile title={data.rsiPeriod ? `RSI (${data.rsiPeriod})` : "RSI"} query={queries.rsi} hasData={rsi != null}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xl font-bold tabular-nums text-foreground">{formatNumber(rsi)}</span>
            <ZonePill tone={zoneTone(rsiZone)}>{zoneLabel(rsiZone)}</ZonePill>
          </div>
          {rsi != null ? <OscillatorGauge value={rsi} low={30} high={70} label={t("tech.gaugeLabel", { name: "RSI", value: formatNumber(rsi) })} /> : null}
        </Tile>

        <Tile title={data.macdParams ? `MACD (${data.macdParams})` : "MACD"} query={queries.macd} hasData={macd != null}>
          <div className="space-y-1">
            <Row label={t("tech.macdLine")} value={formatNumber(macd?.macd, 3)} />
            <Row label={t("tech.signalLine")} value={formatNumber(macd?.signal, 3)} />
            <Row label={t("tech.histogram")} value={formatSigned(macd?.histogram, 3)} className={TREND_TEXT_CLASS[histTone]} />
          </div>
          {macd?.histogram != null ? (
            <p className="mt-2">
              <ZonePill tone={histTone}>{macd.histogram > 0 ? t("tech.macdBullish") : macd.histogram < 0 ? t("tech.macdBearish") : t("tech.macdFlat")}</ZonePill>
            </p>
          ) : null}
        </Tile>

        <Tile
          title={
            boll?.period
              ? t("tech.bollingerWithPeriod", { period: boll.stdDev ? `${boll.period}, ${boll.stdDev}` : boll.period })
              : t("tech.bollinger")
          }
          query={queries.bollinger}
          hasData={boll != null}
        >
          <div className="space-y-1">
            <Row label={t("tech.upperBand")} value={formatPrice(boll?.upper)} />
            <Row label={t("tech.middleBand")} value={formatPrice(boll?.middle)} />
            <Row label={t("tech.lowerBand")} value={formatPrice(boll?.lower)} />
            {bandwidth != null ? <Row label={t("tech.bandwidth")} value={formatPercent(bandwidth, 1)} /> : null}
          </div>
          {percentB != null ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {percentB > 100
                ? t("tech.aboveUpper")
                : percentB < 0
                  ? t("tech.belowLower")
                  : t("tech.percentB", { value: formatNumber(percentB, 0) })}
            </p>
          ) : null}
        </Tile>

        <Tile
          title={data.stochasticParams ? `${t("tech.stochastic")} (${data.stochasticParams})` : t("tech.stochastic")}
          query={queries.stochastic}
          hasData={stoch != null}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xl font-bold tabular-nums text-foreground">
              %K {formatNumber(k)} <span className="text-sm font-medium text-muted-foreground">/ %D {formatNumber(d)}</span>
            </span>
            <ZonePill tone={zoneTone(stochZone)}>{zoneLabel(stochZone)}</ZonePill>
          </div>
          {k != null ? <OscillatorGauge value={k} low={20} high={80} label={t("tech.gaugeLabel", { name: "%K", value: formatNumber(k) })} /> : null}
          {k != null && d != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{k > d ? t("tech.stochKAboveD") : k < d ? t("tech.stochKBelowD") : t("tech.stochKEqualD")}</p>
          ) : null}
        </Tile>

        <Tile
          title={data.supertrendParams ? `SuperTrend (${data.supertrendParams})` : "SuperTrend"}
          query={queries.supertrend}
          hasData={st != null}
        >
          <div className="flex items-center justify-between gap-2">
            <ZonePill tone={stTone}>{stTone === "up" ? t("tech.uptrend") : stTone === "down" ? t("tech.downtrend") : t("tech.noTrend")}</ZonePill>
          </div>
          <div className="mt-2 space-y-1">
            <Row label={t("tech.stLevel")} value={formatPrice(st?.value)} />
            {stDistance != null ? (
              <Row label={t("tech.stDistance")} value={formatChangePercent(stDistance)} className={TREND_TEXT_CLASS[trendTone(stDistance)]} />
            ) : null}
          </div>
        </Tile>
      </div>
    </SectionCard>
  );
}
