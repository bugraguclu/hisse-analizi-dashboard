import React, { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChartPeriod } from "../../../dashboard/src/types/index.ts";
import BottomSheetModal from "../../components/BottomSheetModal";
import { MacdSubChart, MultiLineChart, type ChartSeriesInput } from "../../components/NativeChart";
import {
  AnalystPanel,
  DividendsPanel,
  FinancialStatementsPanel,
  KapAndNewsPanel,
  MovingAveragesAndPivotsPanel,
  ProfileAndHoldersPanel,
  QuoteStatsPanel,
  RatiosPanel,
  ScorecardPanel,
  SectorComparisonPanel,
  TechnicalSummaryPanel,
} from "../../components/StockAnalysisPanels";
import {
  EmptyCard,
  ErrorCard,
  FreshnessBanner,
  LoadingBlock,
  MetricTile,
  SectionCard,
} from "../../components/StatusViews";
import { SheetScrollView } from "../../components/SwipeDismissSheet";
import { useAppContext } from "../../contexts/AppContext";
import { mobileApi, type StatementKind } from "../../lib/api";
import { normalizeTicker, type StockSection } from "../../lib/externalLinking";
import {
  EMPTY_VALUE,
  formatIstanbulDate,
  formatIstanbulShortDate,
  formatIstanbulTime,
  formatNumber,
  formatPrice,
  formatSignedPercent,
  formatSignedPrice,
} from "../../lib/format";
import {
  computeWindowIndicators,
  latestFinite,
  MOBILE_INDICATORS,
  type MobileIndicatorId,
} from "../../lib/indicators";
import { signalLabelTr } from "../../lib/stockParsers";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";

const SECTIONS: readonly { id: StockSection; label: string }[] = [
  { id: "hisse", label: "Genel" },
  { id: "teknik", label: "Teknik" },
  { id: "temel", label: "Temel" },
  { id: "analiz", label: "Analiz" },
];

const PERIODS: readonly { id: ChartPeriod; label: string }[] = [
  { id: "1d", label: "1G" },
  { id: "5d", label: "5G" },
  { id: "1mo", label: "1A" },
  { id: "3mo", label: "3A" },
  { id: "6mo", label: "6A" },
  { id: "ytd", label: "YBB" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  { id: "max", label: "Tümü" },
];

const OVERLAY_COLORS = {
  sma20: "#e2a93b",
  ema50: "#a855f7",
  bbUpper: "#06b6d4",
  bbMiddle: "#38bdf8",
  bbLower: "#06b6d4",
  bbBand: "rgba(6, 182, 212, 0.12)",
} as const;

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ ticker?: string; section?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { watchlists, addTickerToWatchlist, removeTickerFromWatchlist } = useAppContext();

  const ticker = normalizeTicker(params.ticker ?? "") ?? "THYAO";
  const initialSection: StockSection =
    params.section === "teknik" || params.section === "temel" || params.section === "analiz"
      ? params.section
      : "hisse";

  const [section, setSection] = useState<StockSection>(initialSection);
  const [period, setPeriod] = useState<ChartPeriod>("1y");
  const [indicatorSheetOpen, setIndicatorSheetOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<MobileIndicatorId[]>(["SMA 20", "RSI 14"]);
  const [statementKind, setStatementKind] = useState<StatementKind>("income");
  const [statementQuarterly, setStatementQuarterly] = useState(false);
  const [statementDiscrete, setStatementDiscrete] = useState(false);
  const [showAllCashflow, setShowAllCashflow] = useState(false);

  // Sync deep-link section param in place when navigating between sections of a stock.
  useEffect(() => {
    if (
      params.section === "hisse" ||
      params.section === "teknik" ||
      params.section === "temel" ||
      params.section === "analiz"
    ) {
      setSection(params.section);
    }
  }, [params.section]);

  // Reset statement toggle state when changing stock so previous stock's options never linger.
  useEffect(() => {
    setStatementDiscrete(false);
    setShowAllCashflow(false);
  }, [ticker]);

  const activeWatchlist = watchlists[0];
  const isWatched = Boolean(activeWatchlist?.tickers.includes(ticker));

  const overview = useResource({
    key: `stock:overview:${ticker}`,
    cacheKey: `stock_overview_${ticker}`,
    fetcher: (signal) => mobileApi.stockAnalysisOverview(ticker, signal),
  });

  const chart = useResource({
    key: `stock:chart:${ticker}:${period}`,
    cacheKey: `stock_chart_${ticker}_${period}`,
    enabled: section === "hisse" || section === "teknik" || section === "analiz",
    fetcher: (signal) => mobileApi.stockChartHistory(ticker, period, 80, signal),
    isEmpty: (data) => data.bars.length === 0,
  });

  const technical = useResource({
    key: `stock:technical:${ticker}`,
    cacheKey: `stock_tech_${ticker}`,
    enabled: section === "teknik" || section === "analiz",
    fetcher: (signal) => mobileApi.stockTechnical(ticker, signal),
  });

  const extras = useResource({
    key: `stock:extras:${ticker}`,
    cacheKey: `stock_extras_${ticker}`,
    enabled: section === "hisse" || section === "temel" || section === "analiz",
    fetcher: (signal) => mobileApi.stockOverviewExtras(ticker, signal),
  });

  const fundamentalsExtras = useResource({
    key: `stock:fund-extras:${ticker}`,
    cacheKey: `stock_fund_extras_${ticker}`,
    enabled: section === "temel" || section === "analiz",
    fetcher: (signal) => mobileApi.stockFundamentalsExtras(ticker, signal),
  });

  const statement = useResource({
    key: `stock:statement:${ticker}:${statementKind}:${statementQuarterly ? "q" : "a"}`,
    enabled: section === "temel",
    fetcher: (signal) => mobileApi.stockStatement(ticker, statementKind, statementQuarterly, signal),
    isEmpty: (data) => !data || (!data.unavailable && data.rows.length === 0),
  });

  const toggleIndicator = (id: MobileIndicatorId) => {
    setActiveIndicators((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleRefreshAll = () => {
    overview.reload();
    if (section === "hisse" || section === "teknik" || section === "analiz") chart.reload();
    if (section === "teknik" || section === "analiz") technical.reload();
    if (section === "hisse" || section === "temel" || section === "analiz") extras.reload();
    if (section === "temel" || section === "analiz") fundamentalsExtras.reload();
    if (section === "temel") statement.reload();
  };

  const isRefreshing =
    overview.refreshing || chart.refreshing || technical.refreshing || extras.refreshing;

  // Chart series & active indicator overlays (computed with warmup bars!)
  const chartView = useMemo(() => {
    const bars = chart.data?.bars ?? [];
    const warmup = chart.data?.warmup ?? [];
    const closes = bars.map((b) => b.close);
    const warmupCloses = warmup.map((b) => b.close);
    const labels = bars.map((b) =>
      period === "1d"
        ? formatIstanbulTime(b.time)
        : period === "5d" || period === "1mo" || period === "3mo"
          ? formatIstanbulShortDate(b.time)
          : formatIstanbulDate(b.time),
    );
    const indicators = computeWindowIndicators(warmupCloses, closes, activeIndicators);
    const firstClose = chart.data?.referenceClose ?? (closes.length > 0 ? closes[0] : null);
    const lastClose = closes.length > 0 ? closes[closes.length - 1] : null;
    const periodReturnPct =
      firstClose !== null && firstClose > 0 && lastClose !== null
        ? ((lastClose / firstClose) - 1) * 100
        : null;

    return {
      bars,
      closes,
      labels,
      indicators,
      referenceClose: chart.data?.referenceClose ?? null,
      periodReturnPct,
    };
  }, [activeIndicators, chart.data, period]);

  const quote = overview.data?.quote ?? null;
  const changePct = quote?.changePct ?? null;
  const changeAmount = quote?.change ?? null;
  const priceTone =
    changePct === null
      ? colors.textSecondary
      : changePct > 0.005
        ? colors.up
        : changePct < -0.005
          ? colors.down
          : colors.textSecondary;

  const lineColor =
    chartView.periodReturnPct === null
      ? colors.accent
      : chartView.periodReturnPct >= 0
        ? colors.up
        : colors.down;

  const buildPriceSeries = (withOverlays: boolean): ChartSeriesInput[] => {
    const out: ChartSeriesInput[] = [
      { id: "price", label: ticker, values: chartView.closes, color: lineColor, strokeWidth: 2 },
    ];
    if (!withOverlays) return out;
    if (chartView.indicators.sma20) {
      out.push({ id: "sma20", label: "SMA 20", values: chartView.indicators.sma20, color: OVERLAY_COLORS.sma20, strokeWidth: 1.5 });
    }
    if (chartView.indicators.ema50) {
      out.push({ id: "ema50", label: "EMA 50", values: chartView.indicators.ema50, color: OVERLAY_COLORS.ema50, strokeWidth: 1.5 });
    }
    if (chartView.indicators.bollinger) {
      out.push({ id: "bb-u", label: "BB Üst", values: chartView.indicators.bollinger.upper, color: OVERLAY_COLORS.bbUpper, strokeWidth: 1.25 });
      out.push({ id: "bb-m", label: "BB Orta", values: chartView.indicators.bollinger.middle, color: OVERLAY_COLORS.bbMiddle, strokeWidth: 1.25 });
      out.push({ id: "bb-l", label: "BB Alt", values: chartView.indicators.bollinger.lower, color: OVERLAY_COLORS.bbLower, strokeWidth: 1.25 });
    }
    return out;
  };

  const renderPriceChartCard = (withOverlays: boolean) => {
    const activeOverlays = withOverlays
      ? activeIndicators.filter((i) => i === "SMA 20" || i === "EMA 50" || i === "Bollinger 20 2")
      : [];

    return (
      <SectionCard
        title={withOverlays ? "Fiyat ve Gösterge Grafiği" : "Fiyat Geçmişi"}
        subtitle={
          chartView.periodReturnPct !== null
            ? `Dönem getirisi (${PERIODS.find((p) => p.id === period)?.label ?? period}): ${formatSignedPercent(chartView.periodReturnPct)}`
            : `Dönem: ${PERIODS.find((p) => p.id === period)?.label ?? period}`
        }
        right={
          withOverlays ? (
            <TouchableOpacity onPress={() => setIndicatorSheetOpen(true)} accessibilityRole="button">
              <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
                Göstergeler ({activeIndicators.length})
              </Text>
            </TouchableOpacity>
          ) : null
        }
      >
        {/* Period pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
          {PERIODS.map((p) => {
            const active = period === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.periodChip,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => setPeriod(p.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textSecondary,
                    fontSize: FontSize.xs,
                    fontWeight: active ? "700" : "500",
                  }}
                >
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Quick indicator toggles directly above technical chart */}
        {withOverlays ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
            {MOBILE_INDICATORS.map((ind) => {
              const on = activeIndicators.includes(ind);
              return (
                <TouchableOpacity
                  key={ind}
                  style={[
                    styles.indChip,
                    {
                      backgroundColor: on ? colors.accentLight : colors.bgSecondary,
                      borderColor: on ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => toggleIndicator(ind)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text
                    style={{
                      color: on ? colors.accent : colors.textMuted,
                      fontSize: 11,
                      fontWeight: on ? "700" : "500",
                    }}
                  >
                    {on ? "✓ " : ""}
                    {ind}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {chart.status === "loading" && !chart.data ? (
          <LoadingBlock message="Fiyat geçmişi yükleniyor…" />
        ) : chart.status === "error" && !chart.data ? (
          <ErrorCard
            title="Grafik verisi alınamadı"
            message={chart.error ?? "Bağlantı hatası."}
            onRetry={chart.reload}
          />
        ) : chart.status === "empty" || chartView.bars.length < 2 ? (
          <EmptyCard
            title="Grafik verisi yok"
            message="Seçilen dönem için yeterli fiyat geçmişi bulunamadı."
          />
        ) : (
          <>
            {chart.status === "stale" ? (
              <FreshnessBanner
                status={chart.status}
                fetchedAt={chart.fetchedAt}
                error={chart.error}
                refreshing={chart.refreshing}
                onRetry={chart.reload}
              />
            ) : null}
            <MultiLineChart
              labels={chartView.labels}
              series={buildPriceSeries(withOverlays)}
              band={
                withOverlays && chartView.indicators.bollinger
                  ? {
                      upper: chartView.indicators.bollinger.upper,
                      lower: chartView.indicators.bollinger.lower,
                      color: OVERLAY_COLORS.bbBand,
                    }
                  : null
              }
              referenceLines={
                chartView.referenceClose !== null
                  ? [{ value: chartView.referenceClose, label: "Ref" }]
                  : undefined
              }
              height={190}
              formatValue={(v) => formatPrice(v)}
              formatAxis={(v) => formatNumber(v, v >= 1000 ? 0 : 2)}
            />
            {withOverlays && activeOverlays.length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                Fiyat grafiği üzerinde SMA 20, EMA 50 veya Bollinger bantlarını açmak için yukarıdan seçin.
              </Text>
            ) : null}
          </>
        )}
      </SectionCard>
    );
  };

  const renderIndicatorSubPanels = () => {
    const showRsi = activeIndicators.includes("RSI 14");
    const showMacd = activeIndicators.includes("MACD 12 26 9");
    if (!showRsi && !showMacd) return null;

    const latestRsi = latestFinite(chartView.indicators.rsi14);
    const rsiZone =
      latestRsi === null
        ? null
        : latestRsi <= 30
          ? "Aşırı satım (≤ 30)"
          : latestRsi >= 70
            ? "Aşırı alım (≥ 70)"
            : "Nötr bölge (30–70)";

    return (
      <>
        {showRsi ? (
          <SectionCard
            title="RSI (14)"
            subtitle={
              latestRsi !== null
                ? `Son değer: ${formatNumber(latestRsi, 1)}${rsiZone ? ` · ${rsiZone}` : ""}`
                : "14 dönemlik Wilder Göreli Güç Endeksi"
            }
          >
            {chartView.indicators.rsi14 ? (
              <MultiLineChart
                labels={chartView.labels}
                series={[
                  {
                    id: "rsi14",
                    label: "RSI 14",
                    values: chartView.indicators.rsi14,
                    color: colors.accent,
                    strokeWidth: 1.75,
                  },
                ]}
                fixedDomain={{ min: 0, max: 100 }}
                referenceLines={[
                  { value: 70, label: "70", color: colors.down },
                  { value: 30, label: "30", color: colors.up },
                ]}
                height={118}
                formatValue={(v) => formatNumber(v, 1)}
                formatAxis={(v) => formatNumber(v, 0)}
                emptyMessage="RSI hesaplamak için bu dönemde yeterli veri yok."
              />
            ) : (
              <LoadingBlock message="RSI hesaplanıyor…" />
            )}
          </SectionCard>
        ) : null}

        {showMacd ? (
          <SectionCard title="MACD (12, 26, 9)" subtitle="MACD çizgisi, 9 günlük sinyal ve histogram">
            {chartView.indicators.macd ? (
              <MacdSubChart
                labels={chartView.labels}
                macd={chartView.indicators.macd.macd}
                signal={chartView.indicators.macd.signal}
                histogram={chartView.indicators.macd.histogram}
              />
            ) : (
              <LoadingBlock message="MACD hesaplanıyor…" />
            )}
          </SectionCard>
        ) : null}
      </>
    );
  };

  const navigatePeer = (peerTicker: string) => {
    router.replace({ pathname: `/stock/${peerTicker}`, params: { section } } as never);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefreshAll}
            tintColor={colors.accent}
          />
        }
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontSize: FontSize.md }}>← Geri</Text>
          </TouchableOpacity>
          <View style={styles.topActions}>
            <TouchableOpacity
              style={[styles.topActionBtn, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() =>
                isWatched
                  ? removeTickerFromWatchlist(ticker, activeWatchlist?.id)
                  : addTickerToWatchlist(ticker, activeWatchlist?.id)
              }
              accessibilityRole="button"
            >
              <Text style={{ color: isWatched ? colors.warn : colors.textSecondary, fontSize: FontSize.xs, fontWeight: "600" }}>
                {isWatched ? "★ Takipte" : "☆ Takip et"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.topActionBtn, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => router.push("/search" as never)}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
                Hisse seç
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Identity & Live Quote Header */}
        <View style={[styles.heroCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.ticker, { color: colors.textPrimary }]}>{ticker}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }} numberOfLines={2}>
                {overview.data?.name ?? (overview.status === "loading" ? "Şirket bilgisi yükleniyor…" : EMPTY_VALUE)}
              </Text>
              {overview.data?.profile?.sector || overview.data?.profile?.market ? (
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {[overview.data.profile.sector, overview.data.profile.market].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>

            <View style={styles.heroPriceCol}>
              {overview.status === "loading" && !overview.data ? (
                <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>Yükleniyor…</Text>
              ) : (
                <>
                  <Text style={[styles.heroPrice, { color: colors.textPrimary }]}>
                    {formatPrice(quote?.last)}
                  </Text>
                  <Text style={[styles.heroChange, { color: priceTone }]}>
                    {changeAmount !== null || changePct !== null
                      ? `${formatSignedPrice(changeAmount)} (${formatSignedPercent(changePct)})`
                      : EMPTY_VALUE}
                  </Text>
                </>
              )}
            </View>
          </View>

          <FreshnessBanner
            status={overview.status}
            fetchedAt={overview.fetchedAt}
            dataAsOf={quote?.updatedAt ?? null}
            delayMinutes={quote?.delayMinutes ?? 15}
            source={quote?.source ?? "Borsa İstanbul"}
            refreshing={overview.refreshing}
            error={overview.error}
            onRetry={overview.reload}
          />
        </View>

        {overview.status === "error" && !overview.data ? (
          <ErrorCard
            title={`${ticker} verisi alınamadı`}
            message={overview.error ?? "Sunucuya ulaşılamadı."}
            onRetry={overview.reload}
          />
        ) : null}

        {/* Section Tabs: Genel · Teknik · Temel · Analiz */}
        <View style={styles.tabs}>
          {SECTIONS.map((item) => {
            const active = section === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.tab,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgCard,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => setSection(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textSecondary,
                    fontSize: FontSize.xs,
                    fontWeight: active ? "700" : "500",
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* GENEL */}
        {section === "hisse" ? (
          <>
            {renderPriceChartCard(false)}
            <QuoteStatsPanel
              quote={quote}
              fastInfo={overview.data?.fastInfo ?? null}
              ratios={overview.data?.ratios ?? null}
            />
            {extras.status === "loading" && !extras.data ? (
              <LoadingBlock message="KAP, haber, temettü ve analist verileri yükleniyor…" />
            ) : extras.status === "error" && !extras.data ? (
              <ErrorCard
                title="Ek veriler alınamadı"
                message={extras.error ?? "Bağlantı hatası."}
                onRetry={extras.reload}
              />
            ) : (
              <>
                <AnalystPanel analyst={extras.data?.analyst ?? null} currentPrice={quote?.last ?? null} />
                <DividendsPanel dividends={extras.data?.dividends ?? []} currentPrice={quote?.last ?? null} />
                <KapAndNewsPanel kap={extras.data?.kap ?? []} news={extras.data?.news ?? []} />
              </>
            )}
          </>
        ) : null}

        {/* TEKNİK */}
        {section === "teknik" ? (
          <>
            {renderPriceChartCard(true)}
            {renderIndicatorSubPanels()}
            {technical.status === "loading" && !technical.data ? (
              <LoadingBlock message="Teknik sinyaller ve pivot seviyeleri yükleniyor…" />
            ) : technical.status === "error" && !technical.data ? (
              <ErrorCard
                title="Teknik analiz alınamadı"
                message={technical.error ?? "Bağlantı hatası."}
                onRetry={technical.reload}
              />
            ) : (
              <>
                {technical.status === "stale" ? (
                  <FreshnessBanner
                    status={technical.status}
                    fetchedAt={technical.fetchedAt}
                    error={technical.error}
                    refreshing={technical.refreshing}
                    onRetry={technical.reload}
                  />
                ) : null}
                <TechnicalSummaryPanel
                  signals={technical.data?.signals ?? null}
                  timeframes={technical.data?.timeframes ?? []}
                />
                <MovingAveragesAndPivotsPanel
                  rows={technical.data?.movingAverages ?? []}
                  lastCross={technical.data?.lastCross ?? null}
                  pivots={technical.data?.pivots ?? null}
                />
              </>
            )}
          </>
        ) : null}

        {/* TEMEL */}
        {section === "temel" ? (
          <>
            <RatiosPanel ratios={overview.data?.ratios ?? null} />
            <FinancialStatementsPanel
              kind={statementKind}
              onKindChange={(k) => {
                setStatementKind(k);
                setShowAllCashflow(false);
              }}
              quarterly={statementQuarterly}
              onQuarterlyChange={setStatementQuarterly}
              discrete={statementDiscrete}
              onDiscreteChange={setStatementDiscrete}
              showAllCashflow={showAllCashflow}
              onToggleAllCashflow={() => setShowAllCashflow((v) => !v)}
              status={statement.status}
              table={statement.data}
              error={statement.error}
              onRetry={statement.reload}
            />
            {fundamentalsExtras.status === "loading" && !fundamentalsExtras.data ? (
              <LoadingBlock message="Ortaklık yapısı ve sektör karşılaştırması yükleniyor…" />
            ) : fundamentalsExtras.status === "error" && !fundamentalsExtras.data ? (
              <ErrorCard
                title="Sektör ve ortaklık verisi alınamadı"
                message={fundamentalsExtras.error ?? "Bağlantı hatası."}
                onRetry={fundamentalsExtras.reload}
              />
            ) : (
              <>
                <SectorComparisonPanel
                  sector={fundamentalsExtras.data?.sector ?? null}
                  currentTicker={ticker}
                  onSelectPeer={navigatePeer}
                />
                <ProfileAndHoldersPanel
                  profile={overview.data?.profile ?? null}
                  holders={fundamentalsExtras.data?.holders ?? []}
                  earnings={extras.data?.earnings ?? []}
                />
              </>
            )}
            <DividendsPanel dividends={extras.data?.dividends ?? []} currentPrice={quote?.last ?? null} />
          </>
        ) : null}

        {/* ANALİZ (Kombine Temel + Teknik) */}
        {section === "analiz" ? (
          <>
            <SectionCard
              title="Birleşik Analiz Özeti"
              subtitle={`Aynı hisse (${ticker}) için temel ve teknik görünüm`}
            >
              <View style={styles.combinedTiles}>
                <MetricTile
                  label="Teknik Özet"
                  value={signalLabelTr(technical.data?.signals?.summary?.level ?? null)}
                  subValue={
                    technical.data?.signals?.summary
                      ? `Al ${technical.data.signals.summary.buy ?? EMPTY_VALUE} · Sat ${technical.data.signals.summary.sell ?? EMPTY_VALUE}`
                      : null
                  }
                  tone={
                    technical.data?.signals?.summary?.level === "buy" ||
                    technical.data?.signals?.summary?.level === "strongBuy"
                      ? "up"
                      : technical.data?.signals?.summary?.level === "sell" ||
                          technical.data?.signals?.summary?.level === "strongSell"
                        ? "down"
                        : "default"
                  }
                />
                <MetricTile
                  label="Analist Görüşü"
                  value={
                    extras.data?.analyst?.level
                      ? signalLabelTr(extras.data.analyst.level)
                      : extras.data?.analyst?.raw ?? EMPTY_VALUE
                  }
                  subValue={
                    extras.data?.analyst?.upside != null
                      ? `Potansiyel ${formatSignedPercent(extras.data.analyst.upside, 1)}`
                      : null
                  }
                />
                <MetricTile
                  label="RSI (14)"
                  value={formatNumber(latestFinite(chartView.indicators.rsi14), 1)}
                  subValue={`Dönem: ${PERIODS.find((p) => p.id === period)?.label ?? period}`}
                />
                <MetricTile
                  label="F/K · PD/DD"
                  // Market-data multiples first (same source as the quote and the scorecard, as on the web).
                  value={`${formatNumber(overview.data?.fastInfo?.pe ?? overview.data?.ratios?.values.pe_ratio, 1)} · ${formatNumber(overview.data?.fastInfo?.pb ?? overview.data?.ratios?.values.pb_ratio, 2)}`}
                  subValue={
                    overview.data?.fastInfo?.pe != null ? "Piyasa verisi · son 12 ay" : overview.data?.ratios?.mainPeriod?.label ?? null
                  }
                />
              </View>
            </SectionCard>

            <ScorecardPanel
              ratios={overview.data?.ratios ?? null}
              fastInfo={overview.data?.fastInfo ?? null}
              technicalLevel={technical.data?.signals?.summary?.level ?? null}
              loading={overview.status === "loading" || technical.status === "loading"}
            />
            {renderPriceChartCard(true)}
            <RatiosPanel ratios={overview.data?.ratios ?? null} compact />
            <SectorComparisonPanel
              sector={fundamentalsExtras.data?.sector ?? null}
              currentTicker={ticker}
              onSelectPeer={navigatePeer}
            />
            <TechnicalSummaryPanel
              signals={technical.data?.signals ?? null}
              timeframes={technical.data?.timeframes ?? []}
            />
            <MovingAveragesAndPivotsPanel
              rows={(technical.data?.movingAverages ?? []).slice(0, 6)}
              lastCross={technical.data?.lastCross ?? null}
              pivots={technical.data?.pivots ?? null}
            />
          </>
        ) : null}
      </ScrollView>

      {/* Indicator Settings Bottom Sheet */}
      <BottomSheetModal
        visible={indicatorSheetOpen}
        onClose={() => setIndicatorSheetOpen(false)}
        title="Gösterge ayarları"
        subtitle={`${ticker} · Seçilenler grafiğe çizilir`}
      >
        <SheetScrollView
          contentContainerStyle={[
            styles.sheetList,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {MOBILE_INDICATORS.map((label) => {
            const on = activeIndicators.includes(label);
            const description =
              label === "SMA 20"
                ? "Fiyat grafiği üstü 20 bar basit ortalama"
                : label === "EMA 50"
                  ? "Fiyat grafiği üstü 50 bar üstel ortalama"
                  : label === "Bollinger 20 2"
                    ? "20 bar ortalama ± 2 standart sapma bandı"
                    : label === "RSI 14"
                      ? "Alt grafikte 14 bar Wilder RSI (30 / 70)"
                      : "Alt grafikte MACD çizgisi, sinyal ve histogram";
            return (
              <TouchableOpacity
                key={label}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: on ? colors.accentLight : colors.bgSecondary,
                    borderColor: on ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => toggleIndicator(label)}
                accessibilityRole="button"
              >
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      color: on ? colors.accent : colors.textPrimary,
                      fontSize: FontSize.md,
                      fontWeight: on ? "700" : "500",
                    }}
                  >
                    {on ? "✓ " : ""}
                    {label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{description}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </SheetScrollView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topActions: { flexDirection: "row", gap: Spacing.xs },
  topActionBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  ticker: { fontSize: 26, fontWeight: "700" },
  heroPriceCol: { alignItems: "flex-end", gap: 3 },
  heroPrice: { fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  heroChange: { fontSize: FontSize.xs, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tabs: { flexDirection: "row", gap: Spacing.xs },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  periodRow: { gap: Spacing.xs, paddingVertical: 2 },
  periodChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  indChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  combinedTiles: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  sheetList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  optionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
