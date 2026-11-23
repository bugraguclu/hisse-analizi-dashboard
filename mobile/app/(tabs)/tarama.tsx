import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { EmptyCard, ErrorCard, FreshnessBanner, LoadingBlock } from "../../components/StatusViews";
import { SheetNoDrag, SheetScrollView } from "../../components/SwipeDismissSheet";
import { mobileApi } from "../../lib/api";
import {
  EMPTY_VALUE,
  formatCompactTry,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatSignedPercent,
} from "../../lib/format";
import {
  clearScreenerFilters,
  computeBreadth,
  countActiveFilters,
  DEFAULT_SCREENER_STATE,
  defaultSortDir,
  FEATURED_PRESETS,
  FILTER_GROUPS,
  filterScreenerRows,
  MOBILE_RANGE_KEYS,
  parseDecimalInput,
  PRESET_BY_ID,
  RANGE_BY_KEY,
  resolvePresetId,
  SCREENER_PRESETS,
  SORT_OPTIONS,
  sortScreenerRows,
  toggleScreenerPreset,
  type CrossFilter,
  type NumericField,
  type PresetId,
  type RangeKey,
  type RecFilter,
  type ScreenerFilterState,
  type ScreenerStockRow,
  type SortKey,
} from "../../lib/screener";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";

type FilterSheetTab = "presets" | "universe" | "advanced";

function formatMetricCell(row: ScreenerStockRow, field: NumericField): { label: string; value: string } {
  switch (field) {
    case "pe":
      return {
        label: "F/K",
        value: row.pe !== undefined ? formatRatio(row.pe) : row.loss ? "Zarar" : EMPTY_VALUE,
      };
    case "pb":
      return { label: "PD/DD", value: formatRatio(row.pb) };
    case "ev_ebitda":
      return { label: "FD/FAVÖK", value: formatRatio(row.ev_ebitda) };
    case "dividend_yield":
      return { label: "Temettü", value: formatPercent(row.dividend_yield) };
    case "roe":
      return { label: "ROE", value: formatPercent(row.roe, 1) };
    case "net_margin":
      return { label: "Net marj", value: formatPercent(row.net_margin, 1) };
    case "rsi":
      return { label: "RSI", value: formatNumber(row.rsi, 1) };
    case "sma50_dist":
      return { label: "SMA50", value: formatSignedPercent(row.sma50_dist, 1) };
    case "sma200_dist":
      return { label: "SMA200", value: formatSignedPercent(row.sma200_dist, 1) };
    case "upside":
      return { label: "Potansiyel", value: formatSignedPercent(row.upside, 1) };
    case "foreign_ratio":
      return { label: "Yabancı", value: formatPercent(row.foreign_ratio, 1) };
    case "market_cap":
      return { label: "PD", value: formatCompactTry(row.market_cap) };
    case "avg_turnover":
      return { label: "Ort. hacim", value: formatCompactTry(row.avg_turnover) };
    case "rel_volume":
      return { label: "Gör. hacim", value: formatRatio(row.rel_volume, 2) };
    case "perf_1w":
      return { label: "1H", value: formatSignedPercent(row.perf_1w, 1) };
    case "high_52w_dist":
      return { label: "52H zirve", value: formatSignedPercent(row.high_52w_dist, 1) };
    case "low_52w_dist":
      return { label: "52H dip", value: formatSignedPercent(row.low_52w_dist, 1) };
    default:
      return { label: "PD", value: formatCompactTry(row.market_cap) };
  }
}

function selectRowMetrics(state: ScreenerFilterState): NumericField[] {
  const chosen: NumericField[] = [];
  const push = (field: NumericField | undefined) => {
    if (!field || field === "close" || field === "change_pct" || chosen.includes(field)) return;
    chosen.push(field);
  };
  for (const id of state.presets) {
    push(PRESET_BY_ID.get(id)?.highlightMetric);
  }
  if (state.sort !== "symbol" && state.sort !== "close" && state.sort !== "change_pct") {
    push(state.sort as NumericField);
  }
  for (const fallback of ["pe", "pb", "dividend_yield", "roe", "rsi", "market_cap"] as const) {
    if (chosen.length >= 4) break;
    push(fallback);
  }
  return chosen.slice(0, 4);
}

export default function TaramaScreen() {
  const params = useLocalSearchParams<{ preset?: string; sector?: string; index?: string; q?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const [filters, setFilters] = useState<ScreenerFilterState>(() => {
    const base: ScreenerFilterState = {
      ...DEFAULT_SCREENER_STATE,
      q: params.q?.trim() ?? "",
      sector: params.sector?.trim() ?? "",
      index: params.index?.trim().toUpperCase() ?? "",
    };
    const presetId = resolvePresetId(params.preset);
    return presetId ? toggleScreenerPreset(base, presetId) : base;
  });

  // Sync deep-link param changes in place while tab is already mounted.
  useEffect(() => {
    if (params.preset === undefined && params.sector === undefined && params.index === undefined && params.q === undefined) {
      return;
    }
    setFilters((prev) => {
      let next: ScreenerFilterState = {
        ...prev,
        q: params.q !== undefined ? params.q.trim() : prev.q,
        sector: params.sector !== undefined ? params.sector.trim() : prev.sector,
        index: params.index !== undefined ? params.index.trim().toUpperCase() : prev.index,
      };
      const presetId = resolvePresetId(params.preset);
      if (presetId && !next.presets.includes(presetId)) {
        next = toggleScreenerPreset({ ...next, presets: [] }, presetId);
      }
      return next;
    });
  }, [params.index, params.preset, params.q, params.sector]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterSheetTab>("presets");
  const [sortOpen, setSortOpen] = useState(false);
  const [rangeDrafts, setRangeDrafts] = useState<Record<string, { min: string; max: string }>>({});

  const universe = useResource({
    key: "screener:universe",
    cacheKey: "screener_universe",
    fetcher: (signal) => mobileApi.screenerUniverse(signal),
    isEmpty: (data) => !data.rows || data.rows.length === 0,
  });

  const sectorLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of universe.data?.kap_sectors ?? []) map.set(s.key, s.name);
    for (const s of universe.data?.sectors ?? []) {
      if (!map.has(s.key)) map.set(s.key, s.name_tr);
    }
    return map;
  }, [universe.data?.kap_sectors, universe.data?.sectors]);

  const sectorOptions = useMemo(() => {
    if (universe.data?.kap_sectors && universe.data.kap_sectors.length > 0) {
      return universe.data.kap_sectors.map((s) => ({ key: s.key, label: s.name, count: s.count }));
    }
    return (universe.data?.sectors ?? []).map((s) => ({ key: s.key, label: s.name_tr, count: s.count }));
  }, [universe.data?.kap_sectors, universe.data?.sectors]);

  const indexOptions = useMemo(() => universe.data?.indices ?? [], [universe.data?.indices]);

  const filteredRows = useMemo(() => {
    const rows = universe.data?.rows ?? [];
    return sortScreenerRows(filterScreenerRows(rows, filters), filters.sort, filters.dir);
  }, [filters, universe.data?.rows]);

  const breadth = useMemo(() => computeBreadth(filteredRows), [filteredRows]);
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);
  const displayMetrics = useMemo(() => selectRowMetrics(filters), [filters]);

  const openFilterSheet = () => {
    const drafts: Record<string, { min: string; max: string }> = {};
    for (const key of MOBILE_RANGE_KEYS) {
      const b = filters.ranges[key];
      drafts[key] = {
        min: b?.min !== undefined ? String(b.min) : "",
        max: b?.max !== undefined ? String(b.max) : "",
      };
    }
    setRangeDrafts(drafts);
    setFilterOpen(true);
  };

  const applyRangeDraft = (key: RangeKey, side: "min" | "max", text: string) => {
    setRangeDrafts((prev) => {
      const current = prev[key] ?? { min: "", max: "" };
      const updated = { ...current, [side]: text };
      const minVal = parseDecimalInput(updated.min);
      const maxVal = parseDecimalInput(updated.max);
      setFilters((f) => {
        const nextRanges = { ...f.ranges };
        if (minVal === undefined && maxVal === undefined) {
          delete nextRanges[key];
        } else {
          nextRanges[key] = { min: minVal, max: maxVal };
        }
        return { ...f, ranges: nextRanges };
      });
      return { ...prev, [key]: updated };
    });
  };

  const handleSortPick = (key: SortKey) => {
    setFilters((prev) => ({
      ...prev,
      sort: key,
      dir: prev.sort === key ? (prev.dir === "asc" ? "desc" : "asc") : defaultSortDir(key),
    }));
    setSortOpen(false);
  };

  const activeSortLabel = useMemo(() => {
    const found = SORT_OPTIONS.find((o) => o.key === filters.sort)?.label ?? filters.sort;
    return `${found} ${filters.dir === "asc" ? "↑" : "↓"}`;
  }, [filters.dir, filters.sort]);

  const renderStockRow = useCallback(
    ({ item }: { item: ScreenerStockRow }) => {
      const change = item.change_pct;
      const changeColor =
        change === undefined
          ? colors.textMuted
          : change > 0.005
            ? colors.up
            : change < -0.005
              ? colors.down
              : colors.textSecondary;
      const sectorName =
        (item.kap_sector ? sectorLabelMap.get(item.kap_sector) : undefined) ??
        (item.sector ? sectorLabelMap.get(item.sector) : undefined) ??
        null;

      return (
        <TouchableOpacity
          style={[styles.stockCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => router.push(`/stock/${item.symbol}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`${item.symbol} ${item.name ?? ""} analizini aç`}
        >
          <View style={styles.stockTopRow}>
            <View style={styles.stockIdentity}>
              <View style={styles.tickerLine}>
                <Text style={[styles.tickerText, { color: colors.textPrimary }]}>{item.symbol}</Text>
                {item.recommendation ? (
                  <View
                    style={[
                      styles.recBadge,
                      {
                        backgroundColor:
                          item.recommendation === "AL"
                            ? colors.accentLight
                            : colors.bgSecondary,
                        borderColor:
                          item.recommendation === "AL"
                            ? colors.up
                            : item.recommendation === "SAT"
                              ? colors.down
                              : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "700",
                        color:
                          item.recommendation === "AL"
                            ? colors.up
                            : item.recommendation === "SAT"
                              ? colors.down
                              : colors.textSecondary,
                      }}
                    >
                      {item.recommendation}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.companyName, { color: colors.textMuted }]} numberOfLines={1}>
                {item.name ?? EMPTY_VALUE}
                {sectorName ? ` · ${sectorName}` : ""}
              </Text>
            </View>

            <View style={styles.priceCol}>
              <Text style={[styles.priceText, { color: colors.textPrimary }]}>
                {formatPrice(item.close)}
              </Text>
              <Text style={[styles.changeText, { color: changeColor }]}>
                {formatSignedPercent(change)}
              </Text>
            </View>
          </View>

          <View style={[styles.metricsRow, { borderTopColor: colors.border }]}>
            {displayMetrics.map((field) => {
              const cell = formatMetricCell(item, field);
              return (
                <View key={field} style={styles.metricCell}>
                  <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{cell.label}</Text>
                  <Text style={[styles.metricValue, { color: colors.textSecondary }]} numberOfLines={1}>
                    {cell.value}
                  </Text>
                </View>
              );
            })}
          </View>
        </TouchableOpacity>
      );
    },
    [colors, displayMetrics, router, sectorLabelMap],
  );

  const listHeader = (
    <View style={styles.listHeader}>
      {/* Search bar */}
      <View
        style={[
          styles.searchRow,
          { backgroundColor: colors.bgCard, borderColor: colors.border },
        ]}
      >
        <TextInput
          value={filters.q}
          onChangeText={(q) => setFilters((prev) => ({ ...prev, q }))}
          placeholder="Hisse kodu veya şirket ara (örn. THYAO)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.textPrimary }]}
        />
        {filters.q ? (
          <TouchableOpacity
            onPress={() => setFilters((prev) => ({ ...prev, q: "" }))}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.textMuted, fontSize: FontSize.xs, fontWeight: "600" }}>
              Temizle
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Featured quick presets */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetChipsRow}
      >
        {FEATURED_PRESETS.map((preset) => {
          const active = filters.presets.includes(preset.id);
          return (
            <TouchableOpacity
              key={preset.id}
              style={[
                styles.presetChip,
                {
                  backgroundColor: active ? colors.accentLight : colors.bgCard,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              onPress={() => setFilters((prev) => toggleScreenerPreset(prev, preset.id))}
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
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Active filter summary pills */}
      {activeCount > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.activeChipsRow}
        >
          {filters.index ? (
            <TouchableOpacity
              style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
              onPress={() => setFilters((p) => ({ ...p, index: "" }))}
            >
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                Endeks: {filters.index} ×
              </Text>
            </TouchableOpacity>
          ) : null}
          {filters.sector ? (
            <TouchableOpacity
              style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
              onPress={() => setFilters((p) => ({ ...p, sector: "" }))}
            >
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                Sektör: {sectorLabelMap.get(filters.sector) ?? filters.sector} ×
              </Text>
            </TouchableOpacity>
          ) : null}
          {filters.presets
            .filter((id) => !FEATURED_PRESETS.some((f) => f.id === id))
            .map((id) => (
              <TouchableOpacity
                key={id}
                style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
                onPress={() => setFilters((p) => toggleScreenerPreset(p, id))}
              >
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                  {PRESET_BY_ID.get(id)?.label ?? id} ×
                </Text>
              </TouchableOpacity>
            ))}
          {filters.rec ? (
            <TouchableOpacity
              style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
              onPress={() => setFilters((p) => ({ ...p, rec: "" }))}
            >
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                Öneri: {filters.rec} ×
              </Text>
            </TouchableOpacity>
          ) : null}
          {filters.cross ? (
            <TouchableOpacity
              style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
              onPress={() => setFilters((p) => ({ ...p, cross: "" }))}
            >
              <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                {filters.cross === "golden" ? "Golden cross" : "Death cross"} ×
              </Text>
            </TouchableOpacity>
          ) : null}
          {(Object.keys(filters.ranges) as RangeKey[]).map((key) => {
            const def = RANGE_BY_KEY.get(key);
            const b = filters.ranges[key];
            if (!def || !b) return null;
            const text =
              b.min !== undefined && b.max !== undefined
                ? `${def.shortLabel}: ${b.min}–${b.max}`
                : b.min !== undefined
                  ? `${def.shortLabel} ≥ ${b.min}`
                  : `${def.shortLabel} ≤ ${b.max}`;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.activePill, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
                onPress={() =>
                  setFilters((p) => {
                    const nextRanges = { ...p.ranges };
                    delete nextRanges[key];
                    return { ...p, ranges: nextRanges };
                  })
                }
              >
                <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "600" }}>
                  {text} ×
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.activePill, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
            onPress={() => setFilters((p) => clearScreenerFilters(p))}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: "600" }}>
              Tümünü temizle
            </Text>
          </TouchableOpacity>
        </ScrollView>
      ) : null}

      <FreshnessBanner
        status={universe.status}
        fetchedAt={universe.fetchedAt}
        dataAsOf={universe.data?.as_of ?? null}
        delayMinutes={universe.data?.delay_minutes ?? null}
        source={universe.data?.source ?? "BIST Tarama Evreni"}
        refreshing={universe.refreshing}
        error={universe.error}
        onRetry={universe.reload}
      />

      {/* Result count + Sort bar */}
      {universe.data ? (
        <View style={styles.summaryBar}>
          <Text style={[styles.countText, { color: colors.textSecondary }]}>
            <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>{filteredRows.length}</Text>
            {" / "}
            {universe.data.rows.length} hisse
            {"  ·  "}
            <Text style={{ color: colors.up }}>↑ {breadth.up}</Text>
            {" "}
            <Text style={{ color: colors.down }}>↓ {breadth.down}</Text>
          </Text>
          <TouchableOpacity
            style={[styles.sortPill, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => setSortOpen(true)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
              {activeSortLabel}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgPrimary, paddingTop: insets.top + Spacing.md },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Tarama</Text>
        <TouchableOpacity
          style={[
            styles.filterButton,
            {
              backgroundColor: activeCount > 0 ? colors.accentLight : colors.bgCard,
              borderColor: activeCount > 0 ? colors.accent : colors.border,
            },
          ]}
          onPress={openFilterSheet}
          accessibilityRole="button"
        >
          <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>
            Filtreler{activeCount > 0 ? ` · ${activeCount}` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {universe.status === "loading" && !universe.data ? (
        <View style={styles.stateWrap}>
          {listHeader}
          <LoadingBlock message="BIST hisse tarama evreni yükleniyor…" />
        </View>
      ) : universe.status === "error" && !universe.data ? (
        <View style={styles.stateWrap}>
          {listHeader}
          <ErrorCard
            title="Tarama verisi alınamadı"
            message={universe.error ?? "Sunucuya bağlanılamadı."}
            onRetry={universe.reload}
          />
        </View>
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={(item) => item.symbol}
          renderItem={renderStockRow}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={
            <EmptyCard
              title="Koşullara uyan hisse bulunamadı"
              message={
                activeCount > 0
                  ? "Seçili tarama veya filtre kriterlerine uyan şirket yok. Filtreleri gevşeterek tekrar deneyin."
                  : "Tarama evreni şu an boş döndü."
              }
              actionLabel={activeCount > 0 ? "Filtreleri temizle" : "Yenile"}
              onAction={() =>
                activeCount > 0 ? setFilters((p) => clearScreenerFilters(p)) : universe.reload()
              }
            />
          }
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={
            <RefreshControl
              refreshing={universe.refreshing}
              onRefresh={universe.reload}
              tintColor={colors.accent}
            />
          }
          initialNumToRender={16}
          maxToRenderPerBatch={20}
          windowSize={9}
        />
      )}

      {/* Filter Bottom Sheet: 31 presets + Sector/Index + Advanced ranges */}
      <BottomSheetModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Tarama filtreleri"
        subtitle={`${filteredRows.length} hisse eşleşiyor`}
      >
        <View style={styles.sheetTabs}>
          {(
            [
              { id: "presets", label: "Hazır (31)" },
              { id: "universe", label: "Endeks & Sektör" },
              { id: "advanced", label: "Kriterler" },
            ] as const
          ).map((tab) => {
            const active = filterTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.sheetTab,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => setFilterTab(tab.id)}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textSecondary,
                    fontSize: FontSize.xs,
                    fontWeight: active ? "700" : "500",
                  }}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <SheetScrollView
          contentContainerStyle={[
            styles.sheetBody,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {filterTab === "presets" ? (
            FILTER_GROUPS.map((group) => {
              const items = SCREENER_PRESETS.filter((p) => p.group === group.id);
              return (
                <View key={group.id} style={styles.groupBlock}>
                  <Text style={[styles.groupTitle, { color: colors.textMuted }]}>
                    {group.label.toUpperCase()}
                  </Text>
                  {items.map((preset) => {
                    const active = filters.presets.includes(preset.id);
                    return (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.optionRow,
                          {
                            backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setFilters((prev) => toggleScreenerPreset(prev, preset.id))}
                        accessibilityRole="button"
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: active ? colors.accent : colors.textPrimary,
                              fontWeight: active ? "700" : "500",
                              fontSize: FontSize.sm,
                            }}
                          >
                            {active ? "✓ " : ""}
                            {preset.label}
                          </Text>
                          <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                            {preset.ruleSummary}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          ) : filterTab === "universe" ? (
            <>
              <View style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: colors.textMuted }]}>ENDEKS</Text>
                <View style={styles.chipGrid}>
                  <TouchableOpacity
                    style={[
                      styles.gridChip,
                      {
                        backgroundColor: !filters.index ? colors.accentLight : colors.bgSecondary,
                        borderColor: !filters.index ? colors.accent : colors.border,
                      },
                    ]}
                    onPress={() => setFilters((p) => ({ ...p, index: "" }))}
                  >
                    <Text
                      style={{
                        color: !filters.index ? colors.accent : colors.textPrimary,
                        fontSize: FontSize.xs,
                        fontWeight: !filters.index ? "700" : "500",
                      }}
                    >
                      Tüm hisseler
                    </Text>
                  </TouchableOpacity>
                  {indexOptions.map((idx) => {
                    const active = filters.index === idx.code;
                    return (
                      <TouchableOpacity
                        key={idx.code}
                        style={[
                          styles.gridChip,
                          {
                            backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setFilters((p) => ({ ...p, index: active ? "" : idx.code }))}
                      >
                        <Text
                          style={{
                            color: active ? colors.accent : colors.textPrimary,
                            fontSize: FontSize.xs,
                            fontWeight: active ? "700" : "500",
                          }}
                        >
                          {idx.code} ({idx.count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: colors.textMuted }]}>SEKTÖR</Text>
                <TouchableOpacity
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor: !filters.sector ? colors.accentLight : colors.bgSecondary,
                      borderColor: !filters.sector ? colors.accent : colors.border,
                    },
                  ]}
                  onPress={() => setFilters((p) => ({ ...p, sector: "" }))}
                >
                  <Text
                    style={{
                      color: !filters.sector ? colors.accent : colors.textPrimary,
                      fontWeight: !filters.sector ? "700" : "500",
                      fontSize: FontSize.sm,
                    }}
                  >
                    Tüm sektörler
                  </Text>
                </TouchableOpacity>
                {sectorOptions.map((sec) => {
                  const active = filters.sector === sec.key;
                  return (
                    <TouchableOpacity
                      key={sec.key}
                      style={[
                        styles.optionRow,
                        {
                          backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                      onPress={() => setFilters((p) => ({ ...p, sector: active ? "" : sec.key }))}
                    >
                      <Text
                        style={{
                          color: active ? colors.accent : colors.textPrimary,
                          fontWeight: active ? "700" : "400",
                          fontSize: FontSize.sm,
                        }}
                      >
                        {sec.label} ({sec.count})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <SheetNoDrag>
              <View style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: colors.textMuted }]}>ANALİST ÖNERİSİ</Text>
                <View style={styles.chipGrid}>
                  {(["", "AL", "TUT", "SAT"] as readonly RecFilter[]).map((rec) => {
                    const active = filters.rec === rec;
                    return (
                      <TouchableOpacity
                        key={rec || "all"}
                        style={[
                          styles.gridChip,
                          {
                            backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setFilters((p) => ({ ...p, rec }))}
                      >
                        <Text style={{ color: active ? colors.accent : colors.textPrimary, fontSize: FontSize.xs, fontWeight: "600" }}>
                          {rec || "Hepsi"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: colors.textMuted }]}>SMA 50 / 200 KESİŞİMİ</Text>
                <View style={styles.chipGrid}>
                  {(
                    [
                      { id: "", label: "Hepsi" },
                      { id: "golden", label: "Golden cross" },
                      { id: "death", label: "Death cross" },
                    ] as readonly { id: CrossFilter; label: string }[]
                  ).map((opt) => {
                    const active = filters.cross === opt.id;
                    return (
                      <TouchableOpacity
                        key={opt.id || "all"}
                        style={[
                          styles.gridChip,
                          {
                            backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setFilters((p) => ({ ...p, cross: opt.id }))}
                      >
                        <Text style={{ color: active ? colors.accent : colors.textPrimary, fontSize: FontSize.xs, fontWeight: "600" }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.groupBlock}>
                <Text style={[styles.groupTitle, { color: colors.textMuted }]}>SAYISAL ARALIKLAR</Text>
                {MOBILE_RANGE_KEYS.map((key) => {
                  const def = RANGE_BY_KEY.get(key);
                  if (!def) return null;
                  const draft = rangeDrafts[key] ?? { min: "", max: "" };
                  return (
                    <View key={key} style={styles.rangeRow}>
                      <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs, fontWeight: "600" }}>
                        {def.label}
                      </Text>
                      <View style={styles.rangeInputs}>
                        <TextInput
                          value={draft.min}
                          onChangeText={(txt) => applyRangeDraft(key, "min", txt)}
                          placeholder="Min"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="numbers-and-punctuation"
                          style={[
                            styles.rangeInput,
                            { color: colors.textPrimary, backgroundColor: colors.bgSecondary, borderColor: colors.border },
                          ]}
                        />
                        <Text style={{ color: colors.textMuted }}>—</Text>
                        <TextInput
                          value={draft.max}
                          onChangeText={(txt) => applyRangeDraft(key, "max", txt)}
                          placeholder="Maks"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="numbers-and-punctuation"
                          style={[
                            styles.rangeInput,
                            { color: colors.textPrimary, backgroundColor: colors.bgSecondary, borderColor: colors.border },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </SheetNoDrag>
          )}

          <View style={styles.sheetFooter}>
            {activeCount > 0 ? (
              <TouchableOpacity
                style={[styles.clearBtn, { borderColor: colors.border, backgroundColor: colors.bgSecondary }]}
                onPress={() => {
                  setFilters((p) => clearScreenerFilters(p));
                  setRangeDrafts({});
                }}
              >
                <Text style={{ color: colors.textSecondary, fontWeight: "600", fontSize: FontSize.sm }}>
                  Temizle
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: colors.accent }]}
              onPress={() => setFilterOpen(false)}
            >
              <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: FontSize.sm }}>
                {filteredRows.length} hisseyi göster
              </Text>
            </TouchableOpacity>
          </View>
        </SheetScrollView>
      </BottomSheetModal>

      {/* Sort Bottom Sheet */}
      <BottomSheetModal
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sıralama"
        subtitle="Aynı alana tekrar dokunarak yönü değiştirin"
      >
        <SheetScrollView
          contentContainerStyle={[
            styles.sheetBody,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {SORT_OPTIONS.map((opt) => {
            const active = filters.sort === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => handleSortPick(opt.key)}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textPrimary,
                    fontWeight: active ? "700" : "500",
                    fontSize: FontSize.md,
                  }}
                >
                  {opt.label}
                </Text>
                {active ? (
                  <Text style={{ color: colors.accent, fontWeight: "700", fontSize: FontSize.sm }}>
                    {filters.dir === "asc" ? "Artan ↑" : "Azalan ↓"}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </SheetScrollView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  heading: { fontSize: 26, fontWeight: "700" },
  filterButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stateWrap: { gap: Spacing.md },
  listContent: { paddingBottom: Spacing.xxl },
  listHeader: { gap: Spacing.sm, marginBottom: Spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: FontSize.sm,
  },
  presetChipsRow: { gap: Spacing.xs, paddingVertical: 2 },
  presetChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeChipsRow: { gap: Spacing.xs, paddingVertical: 2 },
  activePill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  countText: {
    fontSize: FontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  sortPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stockCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  stockTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  stockIdentity: { flex: 1, gap: 2 },
  tickerLine: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  tickerText: { fontSize: FontSize.md, fontWeight: "700" },
  recBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  companyName: { fontSize: FontSize.xs },
  priceCol: { alignItems: "flex-end", gap: 2 },
  priceText: { fontSize: FontSize.md, fontWeight: "700", fontVariant: ["tabular-nums"] },
  changeText: { fontSize: FontSize.xs, fontWeight: "600", fontVariant: ["tabular-nums"] },
  metricsRow: {
    flexDirection: "row",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  metricCell: { flex: 1, gap: 1 },
  metricLabel: { fontSize: 10 },
  metricValue: { fontSize: FontSize.xs, fontWeight: "600", fontVariant: ["tabular-nums"] },
  sheetTabs: {
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sheetTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  groupBlock: { gap: Spacing.xs },
  groupTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  gridChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rangeRow: { gap: 4, paddingVertical: 4 },
  rangeInputs: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  rangeInput: {
    flex: 1,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    fontSize: FontSize.sm,
  },
  sheetFooter: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  clearBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  applyBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
});
