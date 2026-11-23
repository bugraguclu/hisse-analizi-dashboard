import React, { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MultiLineChart, VerticalBarChart } from "../components/NativeChart";
import {
  EmptyCard,
  ErrorCard,
  FreshnessBanner,
  LoadingBlock,
  MetricTile,
  SectionCard,
} from "../components/StatusViews";
import { mobileApi } from "../lib/api";
import {
  EMPTY_VALUE,
  formatBp,
  formatIstanbulDate,
  formatIstanbulShortDate,
  formatMarketValue,
  formatMonthYear,
  formatNumber,
  formatPercent,
  formatSignedPercent,
  formatSignedPp,
} from "../lib/format";
import {
  buildYieldCurve,
  formatIndicatorChange,
  formatIndicatorPeriod,
  formatIndicatorValue,
  istanbulDayKey,
  MACRO_INDICATOR_GROUPS,
  MACRO_MARKET_PERIODS,
  MACRO_RANGES,
  resolveRequestedMarketKey,
  sliceLastMonths,
  splitCalendarRows,
  type EconomicCalendarEvent,
  type MacroHistoryRange,
  type MacroMarketPeriod,
} from "../lib/macroParsers";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";
import { useResource } from "../lib/useResource";

type MacroTab = "summary" | "policy" | "markets" | "indicators" | "calendar";

const MACRO_TABS: readonly { id: MacroTab; label: string }[] = [
  { id: "summary", label: "Özet" },
  { id: "policy", label: "Faiz & Enflasyon" },
  { id: "markets", label: "Piyasalar" },
  { id: "indicators", label: "Göstergeler" },
  { id: "calendar", label: "Takvim" },
];

const MARKET_GROUP_LABELS: Record<string, string> = {
  fx: "Döviz",
  commodity: "Emtia",
  bond: "Tahvil",
  global: "Küresel",
};

const TCMB_EVENT_LABELS: Record<string, string> = {
  mpc_decision: "PPK Faiz Kararı",
  mpc_summary: "PPK Özeti",
  inflation_report: "Enflasyon Raporu",
  financial_stability_report: "Finansal İstikrar Raporu",
};

function initialTabForParam(piyasa?: string): MacroTab {
  if (!piyasa) return "summary";
  const norm = piyasa.trim().toLowerCase();
  if (norm === "enflasyon" || norm === "tufe" || norm === "faiz" || norm === "tcmb") return "policy";
  if (norm === "takvim") return "calendar";
  return "markets";
}

export default function MakroScreen() {
  const params = useLocalSearchParams<{ piyasa?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<MacroTab>(() => initialTabForParam(params.piyasa));
  const [historyRange, setHistoryRange] = useState<MacroHistoryRange>("3y");
  const [marketPeriod, setMarketPeriod] = useState<MacroMarketPeriod>("1y");
  const [selectedMarketKey, setSelectedMarketKey] = useState<string>(
    params.piyasa?.trim().toLowerCase() || "usdtry",
  );
  const [calendarCountry, setCalendarCountry] = useState<"ALL" | "TR" | "US">("ALL");
  const [highImportanceOnly, setHighImportanceOnly] = useState(false);
  const [calendarLimit, setCalendarLimit] = useState(30);

  useEffect(() => {
    setCalendarLimit(30);
  }, [calendarCountry, highImportanceOnly]);

  const overview = useResource({
    key: "macro:overview",
    cacheKey: "macro_overview",
    fetcher: (signal) => mobileApi.macroOverview(signal),
  });

  // Sync deep-link `?piyasa=` once market instruments arrive or param changes.
  useEffect(() => {
    if (!params.piyasa) return;
    const norm = params.piyasa.trim().toLowerCase();
    setTab(initialTabForParam(norm));
    if (overview.data?.markets && overview.data.markets.length > 0) {
      setSelectedMarketKey(resolveRequestedMarketKey(norm, overview.data.markets));
    }
  }, [overview.data?.markets, params.piyasa]);

  const resolvedMarketKey = useMemo(
    () => resolveRequestedMarketKey(selectedMarketKey, overview.data?.markets ?? []),
    [overview.data?.markets, selectedMarketKey],
  );

  const marketHistory = useResource({
    key: `macro:market-history:${resolvedMarketKey}:${marketPeriod}`,
    cacheKey: `macro_mh_${resolvedMarketKey}_${marketPeriod}`,
    enabled: (tab === "markets" || tab === "summary") && Boolean(resolvedMarketKey),
    fetcher: (signal) => mobileApi.macroMarketHistory(resolvedMarketKey, marketPeriod, signal),
    isEmpty: (data) => !data || data.points.length === 0,
  });

  // One week back (latest releases) and three weeks ahead; the API's default two-month
  // window is ~1.3 MB, too much to download and parse on a phone.
  const todayKey = istanbulDayKey(Date.now());
  const calendar = useResource({
    key: `macro:calendar:${calendarCountry}:${highImportanceOnly ? "high" : "all"}:${todayKey}`,
    cacheKey: `macro_calendar_${calendarCountry}_${highImportanceOnly ? "high" : "all"}`,
    enabled: tab === "calendar",
    fetcher: (signal) =>
      mobileApi.macroCalendar(
        {
          countries: calendarCountry === "ALL" ? ["TR", "US"] : [calendarCountry],
          start: istanbulDayKey(Date.now(), -7),
          end: istanbulDayKey(Date.now(), 21),
          importance: highImportanceOnly ? "high" : undefined,
        },
        signal,
      ),
    isEmpty: (data) => data.rows.length === 0,
  });

  const handleRefresh = () => {
    overview.reload();
    if (tab === "markets" || tab === "summary") marketHistory.reload();
    if (tab === "calendar") calendar.reload();
  };

  const rangeMonths = MACRO_RANGES.find((r) => r.id === historyRange)?.months ?? 36;

  const policyCpiPoints = useMemo(
    () => sliceLastMonths(overview.data?.policyInflationSeries ?? [], rangeMonths),
    [overview.data?.policyInflationSeries, rangeMonths],
  );

  const cpiMonthlyPoints = useMemo(
    () => sliceLastMonths(overview.data?.inflation.cpiSeries ?? [], Math.min(rangeMonths ?? 24, 24)),
    [overview.data?.inflation.cpiSeries, rangeMonths],
  );

  const cpiPpiPoints = useMemo(() => {
    const cpi = sliceLastMonths(overview.data?.inflation.cpiSeries ?? [], rangeMonths);
    const ppiMap = new Map((overview.data?.inflation.ppiSeries ?? []).map((p) => [p.month, p.yearly]));
    return cpi.map((p) => ({
      month: p.month,
      cpi: p.yearly,
      ppi: ppiMap.get(p.month) ?? null,
    }));
  }, [overview.data?.inflation.cpiSeries, overview.data?.inflation.ppiSeries, rangeMonths]);

  const selectedInstrument = useMemo(
    () => overview.data?.markets.find((m) => m.key === resolvedMarketKey) ?? null,
    [overview.data?.markets, resolvedMarketKey],
  );

  const calendarSplit = useMemo(() => {
    const rows = calendar.data?.rows ?? [];
    return splitCalendarRows(highImportanceOnly ? rows.filter((r) => r.importance === "high") : rows, todayKey);
  }, [calendar.data?.rows, highImportanceOnly, todayKey]);

  const yieldCurve = useMemo(
    () => buildYieldCurve(overview.data?.markets ?? [], overview.data?.corridor.policy ?? null),
    [overview.data?.markets, overview.data?.corridor.policy],
  );

  const data = overview.data;

  const renderRangePicker = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {MACRO_RANGES.map((r) => {
        const active = historyRange === r.id;
        return (
          <TouchableOpacity
            key={r.id}
            style={[
              styles.periodChip,
              {
                backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
            onPress={() => setHistoryRange(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`Dönem ${r.label}`}
            accessibilityState={{ selected: active }}
          >
            <Text
              style={{
                color: active ? colors.accent : colors.textSecondary,
                fontSize: FontSize.xs,
                fontWeight: active ? "700" : "500",
              }}
            >
              {r.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderMarketHistoryCard = () => {
    const history = marketHistory.data;
    const isYield = (history?.unit ?? selectedInstrument?.unit) === "percent";
    const periodChangeText =
      isYield
        ? history?.change != null
          ? formatBp(history.change * 100)
          : null
        : history?.change_percent != null
          ? formatSignedPercent(history.change_percent)
          : null;

    return (
      <SectionCard
        title={selectedInstrument?.name ?? history?.name ?? resolvedMarketKey.toUpperCase()}
        subtitle={
          selectedInstrument
            ? `Son: ${formatMarketValue(selectedInstrument.last, selectedInstrument.unit)}${periodChangeText ? ` · Dönem: ${periodChangeText}` : ""}`
            : periodChangeText
              ? `Dönem değişimi: ${periodChangeText}`
              : null
        }
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {MACRO_MARKET_PERIODS.map((p) => {
            const active = marketPeriod === p.id;
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
                onPress={() => setMarketPeriod(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Dönem ${p.label}`}
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

        {marketHistory.status === "loading" && !history ? (
          <LoadingBlock message="Piyasa geçmişi yükleniyor…" />
        ) : marketHistory.status === "error" && !history ? (
          <ErrorCard
            title="Geçmiş grafiği alınamadı"
            message={marketHistory.error ?? "Bağlantı hatası."}
            onRetry={marketHistory.reload}
          />
        ) : !history || history.points.length < 2 ? (
          <EmptyCard
            title="Geçmiş verisi bulunamadı"
            message="Bu gösterge ve dönem için yeterli veri noktası yok."
          />
        ) : (
          <>
            {marketHistory.status === "stale" ? (
              <FreshnessBanner
                status={marketHistory.status}
                fetchedAt={marketHistory.fetchedAt}
                error={marketHistory.error}
                refreshing={marketHistory.refreshing}
                onRetry={marketHistory.reload}
              />
            ) : null}
            <MultiLineChart
              labels={history.points.map((pt) =>
                marketPeriod === "1ay" || marketPeriod === "3ay"
                  ? formatIstanbulShortDate(pt.date)
                  : formatIstanbulDate(pt.date),
              )}
              series={[
                {
                  id: history.key,
                  label: history.name,
                  values: history.points.map((pt) => pt.close),
                  color:
                    (history.change_percent ?? 0) >= 0 ? colors.up : colors.down,
                  strokeWidth: 2,
                },
              ]}
              referenceLines={
                history.reference_close !== null
                  ? [{ value: history.reference_close, label: "Ref" }]
                  : undefined
              }
              height={178}
              formatValue={(v) => formatMarketValue(v, history.unit)}
              formatAxis={(v) => formatNumber(v, v >= 100 ? 1 : 2)}
            />
            <View style={styles.rangeStatsRow}>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                En düşük: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatMarketValue(history.low, history.unit)}</Text>
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                En yüksek: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatMarketValue(history.high, history.unit)}</Text>
              </Text>
            </View>
          </>
        )}
      </SectionCard>
    );
  };

  const renderYieldCurveCard = () => {
    const { points, policy, spread2s10s, spreadUs10y, updatedAt } = yieldCurve;
    return (
      <SectionCard
        title="Getiri Eğrisi"
        subtitle={`TR devlet tahvili getirileri (vade)${updatedAt ? ` · ${formatIstanbulDate(updatedAt)}` : ""}`}
      >
        {points.length < 2 ? (
          <EmptyCard
            title="Getiri eğrisi oluşturulamadı"
            message="Tahvil getirileri şu an dönmedi; piyasa verisi geldiğinde eğri burada çizilir."
          />
        ) : (
          <>
            <MultiLineChart
              labels={points.map((p) => p.label)}
              series={[
                {
                  id: "curve",
                  label: "Getiri",
                  values: points.map((p) => p.yield),
                  color: colors.accent,
                  strokeWidth: 2,
                },
              ]}
              referenceLines={
                policy !== null ? [{ value: policy, label: `Politika ${formatPercent(policy)}` }] : undefined
              }
              height={150}
              formatValue={(v) => formatPercent(v)}
              formatAxis={(v) => formatPercent(v, 1)}
              accessibilityLabel={`Getiri eğrisi: ${points.map((p) => `${p.years} yıl ${formatPercent(p.yield)}`).join(", ")}${policy !== null ? `. Politika faizi ${formatPercent(policy)}` : ""}`}
            />
            <View style={styles.tileGrid}>
              {points.map((p) => (
                <MetricTile
                  key={p.key}
                  label={`${p.years} yıllık`}
                  value={formatPercent(p.yield)}
                  subValue={p.change !== null ? formatBp(p.change * 100) : null}
                  tone={p.change === null || Math.abs(p.change) < 0.005 ? "default" : p.change > 0 ? "down" : "up"}
                />
              ))}
              <MetricTile
                label="10Y − 2Y farkı"
                value={spread2s10s !== null ? formatBp(spread2s10s * 100) : EMPTY_VALUE}
                subValue={spread2s10s === null ? null : spread2s10s < 0 ? "Ters eğri" : "Pozitif eğim"}
              />
              <MetricTile
                label="TR 10Y − ABD 10Y"
                value={spreadUs10y !== null ? formatSignedPp(spreadUs10y) : EMPTY_VALUE}
              />
            </View>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>
              Getiriler basit yıllık; yükselen getiri (fiyat düşüşü) kırmızı gösterilir.
            </Text>
          </>
        )}
      </SectionCard>
    );
  };

  const renderCalendarRow = (ev: EconomicCalendarEvent) => (
    <View
      key={ev.id}
      style={[styles.calRow, { borderBottomColor: colors.border }]}
      accessible
      accessibilityLabel={[
        formatIstanbulDate(ev.date),
        ev.time,
        ev.countryName || ev.countryCode,
        ev.title,
        ev.period,
        `önem ${ev.importance === "high" ? "yüksek" : ev.importance === "mid" ? "orta" : "düşük"}`,
        `açıklanan ${ev.actual ?? "yok"}`,
        `beklenti ${ev.forecast ?? "yok"}`,
        `önceki ${ev.previous ?? "yok"}`,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={styles.calTop}>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          {formatIstanbulDate(ev.date)}
          {ev.time ? ` · ${ev.time}` : ""} · {ev.countryCode}
          {ev.keyEvent ? " · Faiz kararı" : ""}
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: "700",
            color:
              ev.importance === "high" ? colors.down : ev.importance === "mid" ? colors.warn : colors.textMuted,
          }}
        >
          {ev.importance === "high" ? "YÜKSEK" : ev.importance === "mid" ? "ORTA" : "DÜŞÜK"}
        </Text>
      </View>
      <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "600" }}>
        {ev.title}
        {ev.period ? ` (${ev.period})` : ""}
      </Text>
      <View style={styles.calValues}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Açıklanan: <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{ev.actual ?? EMPTY_VALUE}</Text>
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Beklenti: {ev.forecast ?? EMPTY_VALUE}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Önceki: {ev.previous ?? EMPTY_VALUE}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: insets.bottom + Spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={overview.refreshing || marketHistory.refreshing || calendar.refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontSize: FontSize.md }}>← Geri</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
              Yenile
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ gap: 4 }}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Makroekonomi</Text>
          <FreshnessBanner
            status={overview.status}
            fetchedAt={overview.fetchedAt}
            dataAsOf={data?.asOf ?? null}
            source="TCMB · TÜİK · Piyasalar"
            refreshing={overview.refreshing}
            error={overview.error}
            onRetry={overview.reload}
          />
        </View>

        {/* Sub-section Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {MACRO_TABS.map((item) => {
            const active = tab === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.tabChip,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgCard,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => setTab(item.id)}
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
        </ScrollView>

        {overview.status === "loading" && !data ? (
          <LoadingBlock message="TCMB, enflasyon ve piyasa verileri yükleniyor…" />
        ) : overview.status === "error" && !data ? (
          <ErrorCard
            title="Makro veriler alınamadı"
            message={overview.error ?? "Sunucuya bağlanılamadı."}
            onRetry={overview.reload}
          />
        ) : data ? (
          <>
            {/* ÖZET */}
            {tab === "summary" ? (
              <>
                <SectionCard title="Temel Makro Göstergeler">
                  <View style={styles.tileGrid}>
                    <MetricTile
                      label="TCMB Politika Faizi"
                      value={formatPercent(data.corridor.policy)}
                      subValue={
                        data.corridor.policyDate
                          ? `${formatIstanbulDate(data.corridor.policyDate)}${data.corridor.lastChange?.change_bp != null ? ` · ${formatBp(data.corridor.lastChange.change_bp)}` : ""}`
                          : null
                      }
                      tone="accent"
                    />
                    <MetricTile
                      label="Yıllık Enflasyon (TÜFE)"
                      value={formatPercent(data.inflation.cpiYearly)}
                      subValue={
                        [
                          data.inflation.cpiDate ? formatMonthYear(data.inflation.cpiDate) : null,
                          data.inflation.cpiYearlyDelta !== null ? formatSignedPp(data.inflation.cpiYearlyDelta) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || null
                      }
                    />
                    <MetricTile
                      label="Aylık TÜFE"
                      value={formatPercent(data.inflation.cpiMonthly)}
                      subValue={data.inflation.cpiDate ? formatMonthYear(data.inflation.cpiDate) : null}
                    />
                    <MetricTile
                      label="Reel Faiz (Ex-Post)"
                      value={formatSignedPp(data.latestRealRate)}
                      subValue="Politika faizi − Yıllık TÜFE"
                      tone={
                        data.latestRealRate === null
                          ? "default"
                          : data.latestRealRate >= 0
                            ? "up"
                            : "down"
                      }
                    />
                  </View>
                </SectionCard>

                {/* Policy vs Inflation preview chart */}
                <SectionCard
                  title="Politika Faizi ve Yıllık TÜFE"
                  subtitle="Dönem seçerek geçmiş eğilimi inceleyin"
                >
                  {renderRangePicker()}
                  <MultiLineChart
                    labels={policyCpiPoints.map((p) => formatMonthYear(p.month))}
                    series={[
                      {
                        id: "policy",
                        label: "Politika",
                        values: policyCpiPoints.map((p) => p.policy),
                        color: colors.accent,
                        strokeWidth: 2,
                        stepped: true,
                      },
                      {
                        id: "cpi",
                        label: "Yıllık TÜFE",
                        values: policyCpiPoints.map((p) => p.cpi),
                        color: colors.down,
                        strokeWidth: 2,
                      },
                    ]}
                    height={175}
                    formatValue={(v) => formatPercent(v)}
                    formatAxis={(v) => formatPercent(v, 0)}
                  />
                </SectionCard>

                {/* Key market quotes + chart preview */}
                {data.markets.length > 0 ? (
                  <SectionCard
                    title="Döviz, Emtia ve Tahvil"
                    subtitle="Grafiğini incelemek için bir göstergeye dokunun"
                  >
                    <View style={styles.quoteList}>
                      {data.markets.slice(0, 6).map((q) => {
                        const selected = q.key === resolvedMarketKey;
                        const ch = q.unit === "percent" ? q.change : q.change_percent;
                        const chColor =
                          ch === null
                            ? colors.textMuted
                            : ch > 0.005
                              ? colors.up
                              : ch < -0.005
                                ? colors.down
                                : colors.textSecondary;
                        return (
                          <TouchableOpacity
                            key={q.key}
                            style={[
                              styles.quoteRow,
                              {
                                borderBottomColor: colors.border,
                                backgroundColor: selected ? colors.accentLight : "transparent",
                              },
                            ]}
                            onPress={() => setSelectedMarketKey(q.key)}
                            accessibilityRole="button" accessibilityState={{ selected }} accessibilityHint="Geçmiş grafiğini gösterir"
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "600" }}>
                                {q.name}
                              </Text>
                              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                                {MARKET_GROUP_LABELS[q.group] ?? q.group}
                              </Text>
                            </View>
                            <View style={{ alignItems: "flex-end" }}>
                              <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                                {formatMarketValue(q.last, q.unit)}
                              </Text>
                              <Text style={{ color: chColor, fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
                                {q.unit === "percent"
                                  ? formatBp(q.change !== null ? q.change * 100 : null)
                                  : formatSignedPercent(q.change_percent)}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </SectionCard>
                ) : null}

                {renderMarketHistoryCard()}
              </>
            ) : null}

            {/* FAİZ & ENFLASYON */}
            {tab === "policy" ? (
              <>
                <SectionCard
                  title="TCMB Faiz Koridoru"
                  subtitle={
                    data.corridor.nextMpc
                      ? `Sıradaki PPK: ${formatIstanbulDate(data.corridor.nextMpc.date)}${data.corridor.nextMpc.time ? ` · ${data.corridor.nextMpc.time}` : ""}`
                      : null
                  }
                >
                  <View style={styles.tileGrid}>
                    <MetricTile label="Politika Faizi (1 Hafta)" value={formatPercent(data.corridor.policy)} tone="accent" />
                    <MetricTile label="Gecelik Borçlanma" value={formatPercent(data.corridor.overnightBorrowing)} />
                    <MetricTile label="Gecelik Borç Verme" value={formatPercent(data.corridor.overnightLending)} />
                    <MetricTile label="Geç Likidite (GLP)" value={formatPercent(data.corridor.lateLiquidityLending)} />
                  </View>

                  {data.corridor.recentChanges.length > 0 ? (
                    <View style={{ gap: Spacing.xs, marginTop: Spacing.xs }}>
                      <Text style={[styles.subLabel, { color: colors.textMuted }]}>SON FAİZ KARARLARI</Text>
                      {data.corridor.recentChanges.slice(0, 5).map((chg) => (
                        <View key={chg.date} style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>
                            {formatIstanbulDate(chg.date)}
                          </Text>
                          <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                            {formatPercent(chg.rate)}{" "}
                            <Text style={{ color: (chg.change_bp ?? 0) >= 0 ? colors.down : colors.up }}>
                              ({formatBp(chg.change_bp)})
                            </Text>
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {data.corridor.upcomingPublications.length > 0 ? (
                    <View style={{ gap: Spacing.xs, marginTop: Spacing.xs }}>
                      <Text style={[styles.subLabel, { color: colors.textMuted }]}>TCMB YAYIN TAKVİMİ</Text>
                      {data.corridor.upcomingPublications.map((pub) => (
                        <View key={`${pub.type}-${pub.date}`} style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                          <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs }}>
                            {TCMB_EVENT_LABELS[pub.type] ?? pub.type}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>
                            {formatIstanbulDate(pub.date)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </SectionCard>

                {renderYieldCurveCard()}

                <SectionCard
                  title="Enflasyon Özeti (TÜFE & ÜFE)"
                  subtitle={data.inflation.cpiDate ? `Son dönem: ${formatMonthYear(data.inflation.cpiDate)}` : null}
                >
                  <View style={styles.tileGrid}>
                    <MetricTile
                      label="Yıllık TÜFE"
                      value={formatPercent(data.inflation.cpiYearly)}
                      subValue={formatSignedPp(data.inflation.cpiYearlyDelta)}
                    />
                    <MetricTile
                      label="Aylık TÜFE"
                      value={formatPercent(data.inflation.cpiMonthly)}
                      subValue={formatSignedPp(data.inflation.cpiMonthlyDelta)}
                    />
                    <MetricTile
                      label="Yıllık ÜFE"
                      value={formatPercent(data.inflation.ppiYearly)}
                      subValue={formatSignedPp(data.inflation.ppiYearlyDelta)}
                    />
                    <MetricTile
                      label="Aylık ÜFE"
                      value={formatPercent(data.inflation.ppiMonthly)}
                      subValue={data.inflation.ppiDate ? formatMonthYear(data.inflation.ppiDate) : null}
                    />
                  </View>
                </SectionCard>

                <SectionCard title="Yıllık TÜFE ve ÜFE Eğilimi">
                  {renderRangePicker()}
                  <MultiLineChart
                    labels={cpiPpiPoints.map((p) => formatMonthYear(p.month))}
                    series={[
                      {
                        id: "cpi",
                        label: "TÜFE",
                        values: cpiPpiPoints.map((p) => p.cpi),
                        color: colors.accent,
                        strokeWidth: 2,
                      },
                      {
                        id: "ppi",
                        label: "ÜFE",
                        values: cpiPpiPoints.map((p) => p.ppi),
                        color: colors.warn,
                        strokeWidth: 1.75,
                      },
                    ]}
                    height={176}
                    formatValue={(v) => formatPercent(v)}
                    formatAxis={(v) => formatPercent(v, 0)}
                  />
                </SectionCard>

                <SectionCard title="Aylık TÜFE Değişimi" subtitle="Son 24 ay · Dokunarak ay değerini inceleyin">
                  <VerticalBarChart
                    labels={cpiMonthlyPoints.map((p) => formatMonthYear(p.month))}
                    values={cpiMonthlyPoints.map((p) => p.monthly)}
                    formatValue={(v) => formatPercent(v)}
                  />
                </SectionCard>
              </>
            ) : null}

            {/* PİYASALAR */}
            {tab === "markets" ? (
              <>
                {renderMarketHistoryCard()}

                <SectionCard
                  title="Piyasa Göstergeleri"
                  subtitle="Grafiğini yüklemek için bir satıra dokunun"
                >
                  {data.markets.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
                      Piyasa göstergesi verisi bulunamadı.
                    </Text>
                  ) : (
                    (["fx", "commodity", "bond", "global"] as const).map((group) => {
                      const items = data.markets.filter((m) => m.group === group);
                      if (items.length === 0) return null;
                      return (
                        <View key={group} style={{ gap: 4 }}>
                          <Text style={[styles.subLabel, { color: colors.textMuted }]}>
                            {(MARKET_GROUP_LABELS[group] ?? group).toUpperCase()}
                          </Text>
                          {items.map((q) => {
                            const selected = q.key === resolvedMarketKey;
                            const ch = q.unit === "percent" ? q.change : q.change_percent;
                            const chColor =
                              ch === null
                                ? colors.textMuted
                                : ch > 0.005
                                  ? colors.up
                                  : ch < -0.005
                                    ? colors.down
                                    : colors.textSecondary;
                            return (
                              <TouchableOpacity
                                key={q.key}
                                style={[
                                  styles.quoteRow,
                                  {
                                    borderBottomColor: colors.border,
                                    backgroundColor: selected ? colors.accentLight : "transparent",
                                  },
                                ]}
                                onPress={() => setSelectedMarketKey(q.key)}
                                accessibilityRole="button" accessibilityState={{ selected }} accessibilityHint="Geçmiş grafiğini gösterir"
                              >
                                <Text style={{ color: selected ? colors.accent : colors.textPrimary, fontSize: FontSize.sm, fontWeight: "600", flex: 1 }}>
                                  {q.name}
                                </Text>
                                <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "700", fontVariant: ["tabular-nums"], marginRight: Spacing.md }}>
                                  {formatMarketValue(q.last, q.unit)}
                                </Text>
                                <Text style={{ color: chColor, fontSize: FontSize.xs, fontWeight: "600", fontVariant: ["tabular-nums"], width: 64, textAlign: "right" }}>
                                  {q.unit === "percent"
                                    ? formatBp(q.change !== null ? q.change * 100 : null)
                                    : formatSignedPercent(q.change_percent)}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })
                  )}
                </SectionCard>

                {data.fxBulletinRates.length > 0 ? (
                  <SectionCard
                    title="TCMB Günlük Döviz Bülteni"
                    subtitle={data.fxBulletinDate ? `Bülten tarihi: ${formatIstanbulDate(data.fxBulletinDate)}` : null}
                  >
                    <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                      <Text style={[styles.th, { flex: 1.2, color: colors.textMuted }]}>Kur</Text>
                      <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Alış</Text>
                      <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Satış</Text>
                      <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Değişim</Text>
                    </View>
                    {data.fxBulletinRates.slice(0, 10).map((rate) => (
                      <View key={rate.currency} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                        <Text style={[styles.td, { flex: 1.2, color: colors.textPrimary, fontWeight: "600" }]}>
                          {rate.currency}
                        </Text>
                        <Text style={[styles.td, styles.numCol, { color: colors.textSecondary }]}>
                          {formatNumber(rate.forex_buying, 4)}
                        </Text>
                        <Text style={[styles.td, styles.numCol, { color: colors.textPrimary }]}>
                          {formatNumber(rate.forex_selling, 4)}
                        </Text>
                        <Text
                          style={[
                            styles.td,
                            styles.numCol,
                            {
                              color:
                                rate.change_percent === null
                                  ? colors.textMuted
                                  : rate.change_percent >= 0
                                    ? colors.up
                                    : colors.down,
                            },
                          ]}
                        >
                          {formatSignedPercent(rate.change_percent)}
                        </Text>
                      </View>
                    ))}
                  </SectionCard>
                ) : null}
              </>
            ) : null}

            {/* GÖSTERGELER */}
            {tab === "indicators" ? (
              data.indicators.length === 0 ? (
                <EmptyCard
                  title="Makro gösterge bulunamadı"
                  message="Büyüme, istihdam ve dış denge verileri şu an dönmedi."
                />
              ) : (
                MACRO_INDICATOR_GROUPS.map((group) => {
                  const items = data.indicators.filter((ind) => ind.group === group.id);
                  if (items.length === 0) return null;
                  return (
                    <SectionCard key={group.id} title={group.label}>
                      <View style={styles.tileGrid}>
                        {items.map((ind) => (
                          <MetricTile
                            key={ind.key}
                            label={ind.name}
                            value={formatIndicatorValue(ind, ind.value)}
                            subValue={
                              [
                                formatIndicatorPeriod(ind.period, ind.frequency),
                                ind.previous !== null ? `önc. ${formatIndicatorValue(ind, ind.previous)}` : null,
                              ]
                                .filter((part) => part && part !== EMPTY_VALUE)
                                .join(" · ") || null
                            }
                            detail={ind.change !== null ? `Değişim: ${formatIndicatorChange(ind)}` : null}
                          />
                        ))}
                      </View>
                    </SectionCard>
                  );
                })
              )
            ) : null}

            {/* EKONOMİK TAKVİM */}
            {tab === "calendar" ? (
              <SectionCard
                title="Ekonomik Takvim"
                subtitle="Açıklanacak ve son açıklanan makro veriler"
              >
                <View style={styles.calFilterRow}>
                  {(["ALL", "TR", "US"] as const).map((c) => {
                    const active = calendarCountry === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[
                          styles.periodChip,
                          {
                            backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setCalendarCountry(c)}
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
                          {c === "ALL" ? "TR + ABD" : c === "TR" ? "Türkiye" : "ABD"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[
                      styles.periodChip,
                      {
                        backgroundColor: highImportanceOnly ? colors.accentLight : colors.bgSecondary,
                        borderColor: highImportanceOnly ? colors.accent : colors.border,
                      },
                    ]}
                    onPress={() => setHighImportanceOnly((v) => !v)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: highImportanceOnly }}
                  >
                    <Text
                      style={{
                        color: highImportanceOnly ? colors.accent : colors.textSecondary,
                        fontSize: FontSize.xs,
                        fontWeight: highImportanceOnly ? "700" : "500",
                      }}
                    >
                      Yalnız Yüksek Önem
                    </Text>
                  </TouchableOpacity>
                </View>

                {calendar.status === "loading" && !calendar.data ? (
                  <LoadingBlock message="Ekonomik takvim yükleniyor…" />
                ) : calendar.status === "error" && !calendar.data ? (
                  <ErrorCard
                    title="Ekonomik takvim alınamadı"
                    message={calendar.error ?? "Bağlantı hatası."}
                    onRetry={calendar.reload}
                  />
                ) : calendarSplit.upcoming.length === 0 && calendarSplit.recent.length === 0 ? (
                  <EmptyCard
                    title="Takvim kaydı bulunamadı"
                    message="Seçili ülke ve önem filtresi için son bir hafta ve önümüzdeki üç haftada açıklama yok."
                  />
                ) : (
                  <View style={{ gap: Spacing.xs }}>
                    {calendar.status === "stale" ? (
                      <FreshnessBanner
                        status={calendar.status}
                        fetchedAt={calendar.fetchedAt}
                        error={calendar.error}
                        refreshing={calendar.refreshing}
                        onRetry={calendar.reload}
                      />
                    ) : null}
                    <Text style={[styles.subLabel, { color: colors.textMuted }]} accessibilityRole="header">
                      YAKLAŞAN ({calendarSplit.upcoming.length})
                    </Text>
                    {calendarSplit.upcoming.length === 0 ? (
                      <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
                        Önümüzdeki üç haftada bu filtreye uyan açıklama yok.
                      </Text>
                    ) : (
                      calendarSplit.upcoming.slice(0, calendarLimit).map(renderCalendarRow)
                    )}
                    {calendarSplit.upcoming.length > calendarLimit ? (
                      <TouchableOpacity
                        style={[styles.moreButton, { borderColor: colors.border }]}
                        onPress={() => setCalendarLimit((n) => n + 30)}
                        accessibilityRole="button"
                      >
                        <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
                          Daha fazla göster ({calendarSplit.upcoming.length - calendarLimit})
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {calendarSplit.recent.length > 0 ? (
                      <>
                        <Text style={[styles.subLabel, { color: colors.textMuted }]} accessibilityRole="header">
                          SON AÇIKLANANLAR
                        </Text>
                        {calendarSplit.recent.slice(0, 15).map(renderCalendarRow)}
                      </>
                    ) : null}
                    {calendar.data?.asOf ? (
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        Kaynak: TradingView · Güncelleme: {formatIstanbulDate(calendar.data.asOf)}
                      </Text>
                    ) : null}
                  </View>
                )}
              </SectionCard>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 26, fontWeight: "700" },
  chipRow: { gap: Spacing.xs, paddingVertical: 2 },
  tabChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  periodChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  subLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, marginTop: 4 },
  quoteList: { gap: 2 },
  quoteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: BorderRadius.md,
  },
  rangeStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 2,
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  th: { fontSize: 11, fontWeight: "700" },
  td: { fontSize: FontSize.xs, fontVariant: ["tabular-nums"] },
  numCol: { flex: 1, textAlign: "right" },
  calFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  calRow: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  calTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  calValues: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  moreButton: {
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
