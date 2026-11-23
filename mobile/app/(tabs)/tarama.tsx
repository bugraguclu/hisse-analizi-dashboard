import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  FlatList,
  Pressable,
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
import { ChangePill, Chip, Icon, IconButton, ScreenHeader, Touchable, trTitleCase, usePullToRefresh } from "../../components/ui";
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
  FIELD_LABELS,
  FILTER_GROUPS,
  filterScreenerRows,
  parseDecimalInput,
  PRESET_BY_ID,
  RANGE_BY_KEY,
  RANGE_GROUPS,
  resolvePresetId,
  ROW_SIGNAL_LABELS,
  rowSignals,
  SCREENER_PRESETS,
  sortLabel,
  sortOptionsForView,
  sortScreenerRows,
  TECH_RATING_LABELS,
  techRating,
  toggleScreenerPreset,
  VIEW_METRICS,
  VIEWS,
  type CrossFilter,
  type NumericField,
  type RangeKey,
  type RecFilter,
  type ScreenerFilterState,
  type ScreenerStockRow,
  type SortKey,
} from "../../lib/screener";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";
import { useStockActions } from "../../lib/useStockActions";

type FilterSheetTab = "presets" | "universe" | "advanced";

/** Compact card labels; the sort sheet and VoiceOver use the longer FIELD_LABELS. */
const CARD_LABELS: Partial<Record<NumericField, string>> = {
  market_cap: "Piy. değeri",
  turnover: "Hacim",
  avg_turnover: "Ort. hacim",
  dividend_yield: "Temettü",
  sma50_dist: "SMA 50",
  sma200_dist: "SMA 200",
  high_52w_dist: "52H zirve",
  low_52w_dist: "52H dip",
  rel_volume: "Gör. hacim",
  tech_rating: "Teknik",
  perf_1w: "1H",
  perf_1m: "1A",
  perf_3m: "3A",
  perf_ytd: "YBB",
  perf_1y: "1Y",
  target_price: "Hedef",
  upside: "Potansiyel",
  foreign_ratio: "Yabancı",
  rsi: "RSI",
};

/** A screener value as shown on the result card; missing values are "—", never 0. */
function formatScreenerField(row: ScreenerStockRow, field: NumericField): string {
  const value = row[field];
  switch (field) {
    case "pe":
      return value !== undefined ? formatRatio(value) : row.loss ? "Zarar" : EMPTY_VALUE;
    case "pb":
    case "ev_ebitda":
      return formatRatio(value);
    case "rel_volume":
      return formatRatio(value, 2);
    case "dividend_yield":
      return formatPercent(value);
    case "roe":
    case "net_margin":
    case "foreign_ratio":
      return formatPercent(value, 1);
    case "rsi":
      return formatNumber(value, 1);
    case "close":
    case "target_price":
      return formatPrice(value);
    case "market_cap":
    case "turnover":
    case "avg_turnover":
      return formatCompactTry(value);
    case "tech_rating": {
      const rating = techRating(value);
      return rating ? TECH_RATING_LABELS[rating] : EMPTY_VALUE;
    }
    default:
      return formatSignedPercent(value, field === "change_pct" ? 2 : 1);
  }
}

export default function TaramaScreen() {
  const params = useLocalSearchParams<{ preset?: string; sector?: string; index?: string; q?: string }>();
  const router = useRouter();
  const stockActions = useStockActions();
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

  const pull = usePullToRefresh(universe.reload, universe.refreshing);

  const sectorLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of universe.data?.kap_sectors ?? []) map.set(s.key, trTitleCase(s.name));
    for (const s of universe.data?.sectors ?? []) {
      if (!map.has(s.key)) map.set(s.key, s.name_tr);
    }
    return map;
  }, [universe.data?.kap_sectors, universe.data?.sectors]);

  const sectorOptions = useMemo(() => {
    if (universe.data?.kap_sectors && universe.data.kap_sectors.length > 0) {
      return universe.data.kap_sectors.map((s) => ({ key: s.key, label: trTitleCase(s.name), count: s.count }));
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
  const displayMetrics = VIEW_METRICS[filters.view];
  // 4 → one row of four, 5–6 → two rows of three, 7 → four + three: no lone cell on a line.
  const metricWidth = displayMetrics.length === 5 || displayMetrics.length === 6 ? "33.333%" : "25%";
  const allRangeKeys = useMemo(() => RANGE_GROUPS.flatMap((group) => group.keys), []);

  const openFilterSheet = () => {
    const drafts: Record<string, { min: string; max: string }> = {};
    for (const key of allRangeKeys) {
      const b = filters.ranges[key];
      drafts[key] = {
        min: b?.min !== undefined ? String(b.min) : "",
        max: b?.max !== undefined ? String(b.max) : "",
      };
    }
    setRangeDrafts(drafts);
    setFilterOpen(true);
  };

  // Typed text stays in the draft (so "1," can be completed); only parsed bounds reach the filter.
  const applyRangeDraft = (key: RangeKey, side: "min" | "max", text: string) => {
    const current = rangeDrafts[key] ?? { min: "", max: "" };
    const updated = { ...current, [side]: text };
    setRangeDrafts((prev) => ({ ...prev, [key]: updated }));
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
  };

  const handleSortPick = (key: SortKey) => {
    setFilters((prev) => ({
      ...prev,
      sort: key,
      dir: prev.sort === key ? (prev.dir === "asc" ? "desc" : "asc") : defaultSortDir(key),
    }));
    setSortOpen(false);
  };

  const activeSortLabel = `${sortLabel(filters.sort)} ${filters.dir === "asc" ? "↑" : "↓"}`;
  const sortGroups = useMemo(() => sortOptionsForView(filters.view), [filters.view]);

  const renderStockRow = useCallback(
    ({ item }: { item: ScreenerStockRow }) => {
      const change = item.change_pct;
      const sectorName =
        (item.kap_sector ? sectorLabelMap.get(item.kap_sector) : undefined) ??
        (item.sector ? sectorLabelMap.get(item.sector) : undefined) ??
        null;
      const signals = filters.view === "technical" ? rowSignals(item) : [];
      const metricText = displayMetrics
        .map((field) => `${FIELD_LABELS[field]} ${formatScreenerField(item, field)}`)
        .join(", ")
        .split(EMPTY_VALUE)
        .join("veri yok");
      const a11yLabel = [
        item.symbol,
        item.name,
        sectorName,
        `fiyat ${formatScreenerField(item, "close")}`,
        `günlük ${formatScreenerField(item, "change_pct")}`,
        item.recommendation ? `analist önerisi ${item.recommendation}` : null,
        metricText,
        signals.length > 0 ? signals.map((s) => ROW_SIGNAL_LABELS[s]).join(", ") : null,
      ]
        .filter(Boolean)
        .join(", ");

      return (
        <Touchable
          scaleTo={0.985}
          style={[styles.stockCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => router.push(`/stock/${item.symbol}` as never)}
          onLongPress={() => stockActions(item.symbol, { name: item.name, price: item.close, changePct: item.change_pct })}
          delayLongPress={320}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint="Hisse analizini açar"
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
              <ChangePill value={change} size="sm" />
            </View>
          </View>

          <View style={[styles.metricsRow, { borderTopColor: colors.border }]}>
            {displayMetrics.map((field) => {
              const sorted = filters.sort === field;
              return (
                <View key={field} style={[styles.metricCell, { width: metricWidth }]}>
                  <Text
                    style={[styles.metricLabel, { color: sorted ? colors.accent : colors.textMuted }]}
                    numberOfLines={1}
                  >
                    {CARD_LABELS[field] ?? FIELD_LABELS[field]}
                    {sorted ? (filters.dir === "asc" ? " ↑" : " ↓") : ""}
                  </Text>
                  <Text
                    style={[
                      styles.metricValue,
                      { color: sorted ? colors.textPrimary : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {formatScreenerField(item, field)}
                  </Text>
                </View>
              );
            })}
          </View>

          {signals.length > 0 ? (
            <View style={styles.signalRow}>
              {signals.map((signal) => (
                <View
                  key={signal}
                  style={[styles.signalBadge, { backgroundColor: colors.fill }]}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 10, fontWeight: "600" }}>
                    {ROW_SIGNAL_LABELS[signal]}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </Touchable>
      );
    },
    [colors, displayMetrics, metricWidth, filters.dir, filters.sort, filters.view, router, sectorLabelMap, stockActions],
  );

  const listHeader = (
    <View style={styles.listHeader}>
      {/* Search bar */}
      <View style={[styles.searchRow, { backgroundColor: colors.fill }]}>
        <Icon name="magnifyingglass" size={15} color={colors.textMuted} weight="semibold" />
        <TextInput
          value={filters.q}
          onChangeText={(q) => setFilters((prev) => ({ ...prev, q }))}
          placeholder="Kod veya şirket ara"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
          style={[styles.searchInput, { color: colors.textPrimary }]}
        />
        {filters.q ? (
          <Pressable
            onPress={() => setFilters((prev) => ({ ...prev, q: "" }))}
            accessibilityRole="button"
            accessibilityLabel="Aramayı temizle"
            hitSlop={8}
          >
            <Icon name="xmark.circle.fill" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Featured quick presets */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetChipsRow}
      >
        {FEATURED_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={preset.label}
            active={filters.presets.includes(preset.id)}
            icon={filters.presets.includes(preset.id) ? "checkmark" : undefined}
            onPress={() => setFilters((prev) => toggleScreenerPreset(prev, preset.id))}
          />
        ))}
      </ScrollView>

      {/* Column set (web table views) */}
      <View style={styles.viewRow} accessibilityRole="tablist">
        {VIEWS.map((view) => {
          const active = filters.view === view.id;
          return (
            <TouchableOpacity
              key={view.id}
              style={[
                styles.viewChip,
                {
                  backgroundColor: active ? colors.accent : colors.bgCard,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              onPress={() => setFilters((prev) => ({ ...prev, view: view.id }))}
              accessibilityRole="tab"
              accessibilityLabel={`${view.label} görünümü`}
              accessibilityState={{ selected: active }}
            >
              <Text
                style={{
                  color: active ? "#ffffff" : colors.textSecondary,
                  fontSize: 11,
                  fontWeight: active ? "700" : "500",
                }}
                numberOfLines={1}
              >
                {view.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Active filter summary pills */}
      {activeCount > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.activeChipsRow}
        >
          {filters.index ? (
            <Chip
              active
              removable
              label={`Endeks: ${filters.index}`}
              onPress={() => setFilters((p) => ({ ...p, index: "" }))}
            />
          ) : null}
          {filters.sector ? (
            <Chip
              active
              removable
              label={`Sektör: ${sectorLabelMap.get(filters.sector) ?? filters.sector}`}
              onPress={() => setFilters((p) => ({ ...p, sector: "" }))}
            />
          ) : null}
          {filters.presets
            .filter((id) => !FEATURED_PRESETS.some((f) => f.id === id))
            .map((id) => (
              <Chip key={id}
                active
                removable
                label={PRESET_BY_ID.get(id)?.label ?? id}
                onPress={() => setFilters((p) => toggleScreenerPreset(p, id))}
              />
            ))}
          {filters.rec ? (
            <Chip
              active
              removable
              label={`Öneri: ${filters.rec}`}
              onPress={() => setFilters((p) => ({ ...p, rec: "" }))}
            />
          ) : null}
          {filters.cross ? (
            <Chip
              active
              removable
              label={filters.cross === "golden" ? "Golden cross" : "Death cross"}
              onPress={() => setFilters((p) => ({ ...p, cross: "" }))}
            />
          ) : null}
          {(Object.keys(filters.ranges) as RangeKey[]).map((key) => {
            const def = RANGE_BY_KEY.get(key);
            const b = filters.ranges[key];
            if (!def || !b) return null;
            const fmt = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 2);
            const text =
              b.min !== undefined && b.max !== undefined
                ? `${def.shortLabel}: ${fmt(b.min)}–${fmt(b.max)}`
                : b.min !== undefined
                  ? `${def.shortLabel} ≥ ${fmt(b.min)}`
                  : `${def.shortLabel} ≤ ${fmt(b.max as number)}`;
            return (
              <Chip key={key}
                active
                removable
                label={text}
                onPress={() => {
                  setFilters((p) => {
                    const nextRanges = { ...p.ranges };
                    delete nextRanges[key];
                    return { ...p, ranges: nextRanges };
                  });
                  setRangeDrafts((prev) => ({ ...prev, [key]: { min: "", max: "" } }));
                }}
              />
            );
          })}
          <Chip
            label="Tümünü temizle"
            icon="arrow.counterclockwise"
            onPress={() => {
              setFilters((p) => clearScreenerFilters(p));
              setRangeDrafts({});
            }}
          />
        </ScrollView>
      ) : null}

      <FreshnessBanner
        status={universe.status}
        fetchedAt={universe.fetchedAt}
        dataAsOf={universe.data?.as_of ?? null}
        delayMinutes={universe.data?.delay_minutes ?? null}
        source="Borsa İstanbul"
        refreshing={universe.refreshing}
        error={universe.error}
        onRetry={universe.reload}
      />

      {/* Result count + Sort bar */}
      {universe.data ? (
        <View style={styles.summaryBar}>
          <Text
            style={[styles.countText, { color: colors.textSecondary }]}
            accessibilityLabel={`${universe.data.rows.length} hisseden ${filteredRows.length} eşleşme, ${breadth.up} yükselen, ${breadth.down} düşen`}
          >
            <Text style={{ color: colors.up, fontWeight: "600" }}>▲ {breadth.up}</Text>
            {"   "}
            <Text style={{ color: colors.down, fontWeight: "600" }}>▼ {breadth.down}</Text>
          </Text>
          <Touchable
            style={[styles.sortPill, { backgroundColor: colors.fill }]}
            onPress={() => setSortOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sıralama: ${sortLabel(filters.sort)}, ${filters.dir === "asc" ? "artan" : "azalan"}`}
            accessibilityHint="Sıralama seçeneklerini açar"
          >
            <Icon name="arrow.up.arrow.down" size={11} color={colors.accent} weight="semibold" />
            <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>{activeSortLabel}</Text>
          </Touchable>
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
        <ScreenHeader
          title="Tarama"
          subtitle={universe.data ? `${filteredRows.length} / ${universe.data.rows.length} hisse` : null}
          right={
            <IconButton
              icon="slider.horizontal.3"
              label={activeCount > 0 ? `Filtreler, ${activeCount} etkin` : "Filtreler"}
              variant={activeCount > 0 ? "accent" : "filled"}
              badge={activeCount > 0 ? activeCount : undefined}
              onPress={openFilterSheet}
            />
          }
        />
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
            <RefreshControl {...pull} tintColor={colors.accent} />
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
              { id: "presets", label: `Hazır (${SCREENER_PRESETS.length})` },
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
                        accessibilityState={{ selected: active }}
                        accessibilityHint={preset.ruleSummary}
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
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
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
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
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={{ color: active ? colors.accent : colors.textPrimary, fontSize: FontSize.xs, fontWeight: "600" }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {RANGE_GROUPS.map((group) => (
                <View key={group.id} style={styles.groupBlock}>
                  <Text style={[styles.groupTitle, { color: colors.textMuted }]} accessibilityRole="header">
                    {(FILTER_GROUPS.find((g) => g.id === group.id)?.label ?? group.id).toLocaleUpperCase("tr")}
                  </Text>
                  {group.keys.map((key) => {
                    const def = RANGE_BY_KEY.get(key);
                    if (!def) return null;
                    const draft = rangeDrafts[key] ?? { min: "", max: "" };
                    const invalid = (text: string) => text.trim() !== "" && parseDecimalInput(text) === undefined;
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
                            accessibilityLabel={`${def.label} en az`}
                            style={[
                              styles.rangeInput,
                              {
                                color: colors.textPrimary,
                                backgroundColor: colors.bgSecondary,
                                borderColor: invalid(draft.min) ? colors.down : colors.border,
                              },
                            ]}
                          />
                          <Text style={{ color: colors.textMuted }}>–</Text>
                          <TextInput
                            value={draft.max}
                            onChangeText={(txt) => applyRangeDraft(key, "max", txt)}
                            placeholder="Maks"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numbers-and-punctuation"
                            accessibilityLabel={`${def.label} en çok`}
                            style={[
                              styles.rangeInput,
                              {
                                color: colors.textPrimary,
                                backgroundColor: colors.bgSecondary,
                                borderColor: invalid(draft.max) ? colors.down : colors.border,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
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
          {(
            [
              { title: `${VIEWS.find((v) => v.id === filters.view)?.label ?? ""} görünümü`, keys: sortGroups.primary },
              { title: "Diğer alanlar", keys: sortGroups.other },
            ] as const
          ).map((group) => (
            <View key={group.title} style={styles.groupBlock}>
              <Text style={[styles.groupTitle, { color: colors.textMuted }]} accessibilityRole="header">
                {group.title.toLocaleUpperCase("tr")}
              </Text>
              {group.keys.map((key) => {
                const active = filters.sort === key;
                return (
                  <TouchableOpacity
                    key={key}
                    style={[
                      styles.optionRow,
                      {
                        backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                        borderColor: active ? colors.accent : colors.border,
                      },
                    ]}
                    onPress={() => handleSortPick(key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={
                      active
                        ? `${sortLabel(key)}, ${filters.dir === "asc" ? "artan" : "azalan"}; yönü değiştirmek için dokunun`
                        : sortLabel(key)
                    }
                  >
                    <Text
                      style={{
                        color: active ? colors.accent : colors.textPrimary,
                        fontWeight: active ? "700" : "500",
                        fontSize: FontSize.md,
                      }}
                    >
                      {sortLabel(key)}
                    </Text>
                    {active ? (
                      <Text style={{ color: colors.accent, fontWeight: "700", fontSize: FontSize.sm }}>
                        {filters.dir === "asc" ? "Artan ↑" : "Azalan ↓"}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </SheetScrollView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  headerRow: { marginBottom: Spacing.md },
  stateWrap: { gap: Spacing.md },
  listContent: { paddingBottom: Spacing.xxl },
  listHeader: { gap: Spacing.sm, marginBottom: Spacing.md },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 38,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
    fontSize: FontSize.md,
  },
  presetChipsRow: { gap: Spacing.sm, paddingVertical: 2 },
  presetChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeChipsRow: { gap: Spacing.sm, paddingVertical: 2 },
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
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.md,
    height: 30,
    borderRadius: BorderRadius.full,
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
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    rowGap: Spacing.sm,
  },
  // Width is set per view (three or four columns) so up to seven metrics fit in two rows.
  metricCell: { paddingRight: Spacing.xs, gap: 1 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  signalBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.md,
  },
  viewRow: { flexDirection: "row", gap: Spacing.xs },
  viewChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
