import React, { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import BottomSheetModal from "../../components/BottomSheetModal";
import { DragGrip, ReorderableList } from "../../components/Reorderable";
import { ErrorCard, FreshnessBanner } from "../../components/StatusViews";
import { SheetNoDrag } from "../../components/SwipeDismissSheet";
import {
  Card,
  ChangePill,
  changeTone,
  haptic,
  Icon,
  IconButton,
  ListRow,
  PillButton,
  ScreenHeader,
  SearchTrigger,
  SectionHeader,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
  StatusBarScrim,
  Touchable,
  usePullToRefresh,
} from "../../components/ui";
import { useAppContext } from "../../contexts/AppContext";
import { mobileApi, type MarketIndexQuote } from "../../lib/api";
import { formatCompactTry, formatNumber, formatPrice, formatSignedPercent } from "../../lib/format";
import {
  DEFAULT_HOME_SECTIONS,
  HOME_SECTION_LABELS,
  type HomeSectionId,
  type HomeSectionPref,
  moveItem,
} from "../../lib/reorder";
import { BorderRadius, FontSize, Spacing, type ThemeMode, Type, useThemeColors } from "../../lib/theme";
import { computeMovers, useMarketUniverse } from "../../lib/useMarketUniverse";
import { useResource } from "../../lib/useResource";
import { useStockActions } from "../../lib/useStockActions";

type MoverTab = "gainers" | "losers" | "active";

const MOVER_TABS: readonly { id: MoverTab; label: string }[] = [
  { id: "gainers", label: "Yükselenler" },
  { id: "losers", label: "Düşenler" },
  { id: "active", label: "Hacim" },
];

const HERO_INDEX = "XU100";
const SECONDARY_INDICES = ["XU030", "XU050", "XBANK", "XUSIN"] as const;

const MACRO_LINKS: readonly { label: string; hint: string; params: Record<string, string> }[] = [
  { label: "Enflasyon", hint: "TÜFE, ÜFE ve piyasa beklentisi", params: { piyasa: "tufe" } },
  { label: "USD / TRY", hint: "Kur geçmişi", params: { piyasa: "usdtry" } },
  { label: "Makro özet", hint: "Faiz, kur, büyüme", params: {} },
];

function todayLabel(): string {
  try {
    const text = new Intl.DateTimeFormat("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "Europe/Istanbul",
    }).format(new Date());
    return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
  } catch {
    return "Borsa İstanbul";
  }
}

export default function MarketsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { watchlists, settings, updateSettings } = useAppContext();
  const stockActions = useStockActions();
  const [moverTab, setMoverTab] = useState<MoverTab>("gainers");
  const [showAllIndices, setShowAllIndices] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const overview = useResource({
    key: "markets:overview",
    cacheKey: "markets_overview",
    fetcher: (signal) => mobileApi.marketOverview(signal),
    isEmpty: (data) => !data.indices || data.indices.length === 0,
  });
  const universe = useMarketUniverse();

  const indices = overview.data?.indices ?? [];
  const hero = indices.find((i) => i.code === HERO_INDEX) ?? indices[0] ?? null;
  const secondary = SECONDARY_INDICES.map((code) => indices.find((i) => i.code === code)).filter(
    (i): i is MarketIndexQuote => Boolean(i),
  );
  const listedIndices = indices.filter((i) => i.code !== hero?.code);
  const visibleIndices = showAllIndices ? listedIndices : listedIndices.slice(0, 6);

  const movers = useMemo(() => computeMovers(universe.data?.rows ?? [], 5), [universe.data?.rows]);
  const moverRows = movers[moverTab];

  const watchTickers = watchlists[0]?.tickers ?? [];
  const homeSections = settings.homeSections;

  const pull = usePullToRefresh(() => {
    overview.reload();
    universe.reload();
  }, overview.refreshing || universe.refreshing);

  const openStock = (ticker: string) => router.push(`/stock/${ticker}` as never);
  const openIndex = (code: string) =>
    router.push({ pathname: "/(tabs)/tarama", params: { index: code } } as never);

  const renderSection = (id: HomeSectionId): React.ReactNode => {
    switch (id) {
      case "summary":
        return (
          <React.Fragment key={id}>
            {overview.status === "error" && !overview.data ? (
              <ErrorCard
                title="Endeks verileri alınamadı"
                message={overview.error ?? "Sunucuya bağlanılamadı."}
                onRetry={overview.reload}
              />
            ) : (
              <Card style={{ gap: Spacing.md }}>
                {hero ? (
                  <Touchable onPress={() => openIndex(hero.code)} scaleTo={0.99} accessibilityRole="button" accessibilityLabel={`${hero.name} hisselerini tara`}>
                    <View style={styles.heroTop}>
                      <View style={{ gap: 2 }}>
                        <Text style={[styles.heroLabel, { color: colors.textSecondary }]}>{hero.code === "XU100" ? "BIST 100" : hero.code}</Text>
                        <Text style={[styles.heroValue, Type.number, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                          {formatNumber(hero.price)}
                        </Text>
                      </View>
                      <ChangePill value={hero.change_pct} />
                    </View>
                  </Touchable>
                ) : (
                  <View style={{ gap: 8 }}>
                    <Skeleton width={70} height={10} />
                    <Skeleton width={180} height={32} radius={8} />
                  </View>
                )}

                <BreadthBar breadth={universe.data ? movers.breadth : null} />

                {secondary.length > 0 ? (
                  <View style={[styles.secondaryRow, { borderTopColor: colors.separator }]}>
                    {secondary.map((idx) => {
                      const tone = changeTone(idx.change_pct, colors);
                      return (
                        <Touchable key={idx.code} style={styles.secondaryCell} onPress={() => openIndex(idx.code)} accessibilityRole="button" accessibilityLabel={`${idx.code} endeksi`}>
                          <Text style={[styles.secondaryCode, { color: colors.textMuted }]}>{idx.code}</Text>
                          <Text style={[Type.number, styles.secondaryValue, { color: colors.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                            {formatNumber(idx.price, 0)}
                          </Text>
                          <Text style={[Type.number, { color: tone.fg, fontSize: 11, fontWeight: "600" }]}>
                            {formatSignedPercent(idx.change_pct)}
                          </Text>
                        </Touchable>
                      );
                    })}
                  </View>
                ) : null}
              </Card>
            )}
            <FreshnessBanner
              status={overview.status}
              fetchedAt={overview.fetchedAt}
              delayMinutes={15}
              source="Borsa İstanbul"
              refreshing={overview.refreshing}
              error={overview.error}
              onRetry={overview.reload}
            />
          </React.Fragment>
        );

      case "watchlist":
        if (watchTickers.length === 0) return null;
        return (
          <React.Fragment key={id}>
            <SectionHeader title="Takip listen" actionLabel="Tümü" onAction={() => router.push("/(tabs)/watchlists" as never)} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.watchStrip} style={styles.bleed}>
              {watchTickers.slice(0, 12).map((ticker) => {
                const row = universe.bySymbol.get(ticker);
                const tone = changeTone(row?.change_pct, colors);
                return (
                  <Touchable
                    key={ticker}
                    onPress={() => openStock(ticker)}
                    onLongPress={() => stockActions(ticker, { name: row?.name, price: row?.close, changePct: row?.change_pct })}
                    delayLongPress={320}
                    accessibilityRole="button"
                    accessibilityLabel={`${ticker} analizini aç`}
                    style={[styles.watchCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                  >
                    <Text style={[styles.watchTicker, { color: colors.textPrimary }]}>{ticker}</Text>
                    <Text style={[Type.number, styles.watchPrice, { color: colors.textPrimary }]} numberOfLines={1}>
                      {row ? formatPrice(row.close) : "—"}
                    </Text>
                    <Text style={[Type.number, { color: tone.fg, fontSize: FontSize.xs, fontWeight: "600" }]}>
                      {formatSignedPercent(row?.change_pct)}
                    </Text>
                  </Touchable>
                );
              })}
            </ScrollView>
          </React.Fragment>
        );

      case "movers":
        return (
          <React.Fragment key={id}>
            <SectionHeader title="Günün hareketlileri" actionLabel="Tarama" onAction={() => router.push("/(tabs)/tarama" as never)} />
            <SegmentedControl options={MOVER_TABS} value={moverTab} onChange={setMoverTab} />
            <Card padded={false}>
              {universe.status === "loading" && !universe.data ? (
                <SkeletonRows count={5} />
              ) : universe.status === "error" && !universe.data ? (
                <View style={{ padding: Spacing.lg }}>
                  <Text style={{ color: colors.textMuted, fontSize: FontSize.sm, textAlign: "center" }}>
                    Hisse listesi alınamadı. Aşağı çekerek yenileyin.
                  </Text>
                </View>
              ) : (
                moverRows.map((row, i) => (
                  <ListRow
                    key={row.symbol}
                    title={row.symbol}
                    subtitle={row.name ?? null}
                    onPress={() => openStock(row.symbol)}
                    onLongPress={() => stockActions(row.symbol, { name: row.name, price: row.close, changePct: row.change_pct })}
                    accessibilityLabel={`${row.symbol} ${row.name ?? ""}`}
                    isLast={i === moverRows.length - 1}
                    trailing={
                      <View style={styles.rowTrailing}>
                        <Text style={[Type.number, styles.rowPrice, { color: colors.textPrimary }]}>
                          {moverTab === "active" ? formatCompactTry(row.turnover) : formatPrice(row.close)}
                        </Text>
                        <ChangePill value={row.change_pct} size="sm" />
                      </View>
                    }
                  />
                ))
              )}
            </Card>
          </React.Fragment>
        );

      case "indices":
        if (listedIndices.length === 0) {
          return overview.status === "loading" ? (
            <Card key={id} padded={false}>
              <SkeletonRows count={4} />
            </Card>
          ) : null;
        }
        return (
          <React.Fragment key={id}>
            <SectionHeader
              title="Endeksler"
              actionLabel={listedIndices.length > 6 ? (showAllIndices ? "Daralt" : `Tümü (${listedIndices.length})`) : undefined}
              onAction={() => setShowAllIndices((v) => !v)}
            />
            <Card padded={false}>
              {visibleIndices.map((item, i) => (
                <ListRow
                  key={item.code}
                  title={item.code}
                  subtitle={item.name !== item.code ? item.name : null}
                  onPress={() => openIndex(item.code)}
                  accessibilityLabel={`${item.code} endeksindeki hisseleri tara`}
                  isLast={i === visibleIndices.length - 1}
                  trailing={
                    <View style={styles.rowTrailing}>
                      <Text style={[Type.number, styles.rowPrice, { color: colors.textPrimary }]}>{formatNumber(item.price)}</Text>
                      <ChangePill value={item.change_pct} size="sm" />
                    </View>
                  }
                />
              ))}
            </Card>
          </React.Fragment>
        );

      case "macro":
        return (
          <React.Fragment key={id}>
            <SectionHeader title="Makroekonomi" />
            <Card padded={false}>
              {MACRO_LINKS.map((item, i) => (
                <ListRow
                  key={item.label}
                  title={item.label}
                  subtitle={item.hint}
                  showChevron
                  isLast={i === MACRO_LINKS.length - 1}
                  onPress={() => router.push({ pathname: "/makro", params: item.params } as never)}
                  accessibilityLabel={`${item.label}: ${item.hint}`}
                />
              ))}
            </Card>
          </React.Fragment>
        );
    }
  };

  const openEditorFromSettings = () => {
    setSettingsOpen(false);
    // Let the settings sheet finish closing before presenting the next one.
    setTimeout(() => setEditorOpen(true), 380);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bgPrimary }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: Spacing.xxl * 2 },
        ]}
        refreshControl={<RefreshControl {...pull} tintColor={colors.accent} />}
      >
        <ScreenHeader
          title="Piyasa"
          subtitle={todayLabel()}
          right={<IconButton icon="gearshape" label="Ayarlar" onPress={() => setSettingsOpen(true)} />}
        />
        <SearchTrigger placeholder="Hisse, şirket veya endeks ara" onPress={() => router.push("/search" as never)} />

        {homeSections.filter((s) => s.visible).map((s) => renderSection(s.id))}

        <View style={styles.footer}>
          <PillButton label="Ana sayfayı düzenle" icon="slider.horizontal.3" onPress={() => setEditorOpen(true)} />
          <Text style={[styles.footnote, { color: colors.textMuted }]}>
            Fiyatlar 15 dakika gecikmelidir. Yatırım tavsiyesi değildir.
          </Text>
        </View>
      </ScrollView>
      <StatusBarScrim />

      <BottomSheetModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} title="Ayarlar">
        <View style={[styles.settingsBody, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          <Text style={[Type.footnote, { color: colors.textMuted }]}>Görünüm</Text>
          <SegmentedControl
            options={THEME_OPTIONS}
            value={settings.themeMode}
            onChange={(themeMode) => updateSettings({ themeMode })}
          />
          <Card padded={false} style={{ marginTop: Spacing.md }}>
            <ListRow
              title="Ana sayfa"
              subtitle="Bölümleri sırala, gizle veya göster"
              showChevron
              isLast
              onPress={openEditorFromSettings}
            />
          </Card>
          <Text style={[styles.settingsNote, { color: colors.textMuted }]}>
            Fiyatlar Borsa İstanbul (15 dk gecikmeli), bildirimler KAP, makro veriler TCMB ve TÜİK kaynaklıdır.
            {APP_VERSION ? `\nHisse Analizi ${APP_VERSION}` : ""}
          </Text>
        </View>
      </BottomSheetModal>

      <BottomSheetModal
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title="Ana sayfayı düzenle"
        subtitle="Sürükleyerek sırala, istemediğini kapat"
      >
        <HomeEditor
          sections={homeSections}
          onChange={(next) => updateSettings({ homeSections: next })}
          bottomInset={Math.max(insets.bottom, Spacing.lg)}
        />
      </BottomSheetModal>
    </View>
  );
}

function HomeEditor({
  sections,
  onChange,
  bottomInset,
}: {
  sections: HomeSectionPref[];
  onChange: (next: HomeSectionPref[]) => void;
  bottomInset: number;
}) {
  const colors = useThemeColors();
  const isDefault = JSON.stringify(sections) === JSON.stringify(DEFAULT_HOME_SECTIONS);
  return (
    <View style={{ paddingHorizontal: Spacing.lg, paddingBottom: bottomInset, gap: Spacing.md }}>
      <SheetNoDrag>
        <Card padded={false}>
          <ReorderableList
            data={sections}
            keyExtractor={sectionKey}
            onReorder={(from, to) => onChange(moveItem(sections, from, to))}
            renderItem={(section, controls) => {
              const label = HOME_SECTION_LABELS[section.id];
              return (
                <View style={{ backgroundColor: colors.bgCard, opacity: section.visible || controls.isActive ? 1 : 0.55 }}>
                  <ListRow
                    title={label.title}
                    subtitle={label.hint}
                    isLast={controls.index === sections.length - 1 || controls.isDragging}
                    onLongPress={controls.lift}
                    onPressOut={controls.drop}
                    trailing={
                      <>
                        <Switch
                          value={section.visible}
                          onValueChange={(visible) => {
                            haptic.selection();
                            onChange(sections.map((s) => (s.id === section.id ? { ...s, visible } : s)));
                          }}
                          trackColor={{ true: colors.accent }}
                          accessibilityLabel={`${label.title} bölümünü göster`}
                        />
                        <DragGrip controls={controls} label={`${label.title} sırasını değiştir`} />
                      </>
                    }
                  />
                </View>
              );
            }}
          />
        </Card>
      </SheetNoDrag>
      {!isDefault ? (
        <View style={{ alignItems: "center" }}>
        <PillButton
          label="Varsayılana dön"
          icon="arrow.counterclockwise"
          onPress={() => {
            haptic.light();
            onChange([...DEFAULT_HOME_SECTIONS]);
          }}
        />
        </View>
      ) : null}
    </View>
  );
}

function sectionKey(section: HomeSectionPref) {
  return section.id;
}

const THEME_OPTIONS: readonly { id: ThemeMode; label: string }[] = [
  { id: "system", label: "Sistem" },
  { id: "light", label: "Açık" },
  { id: "dark", label: "Koyu" },
];

const APP_VERSION = Constants.expoConfig?.version ?? "";

function BreadthBar({ breadth }: { breadth: { up: number; down: number; flat: number } | null }) {
  const colors = useThemeColors();
  if (!breadth) {
    return <Skeleton width="100%" height={6} radius={3} />;
  }
  const total = breadth.up + breadth.down + breadth.flat;
  if (total === 0) return null;
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`${breadth.up} hisse yükseldi, ${breadth.down} hisse düştü, ${breadth.flat} hisse yatay`}>
      <View style={[styles.breadthTrack, { backgroundColor: colors.fill }]}>
        <View style={{ flex: breadth.up, backgroundColor: colors.up }} />
        <View style={{ flex: breadth.flat, backgroundColor: colors.textMuted, opacity: 0.35 }} />
        <View style={{ flex: breadth.down, backgroundColor: colors.down }} />
      </View>
      <View style={styles.breadthLegend}>
        <Text style={[Type.number, { color: colors.up, fontSize: 11, fontWeight: "600" }]}>▲ {breadth.up} yükselen</Text>
        <Text style={[Type.number, { color: colors.textMuted, fontSize: 11 }]}>{breadth.flat} yatay</Text>
        <Text style={[Type.number, { color: colors.down, fontSize: 11, fontWeight: "600" }]}>{breadth.down} düşen ▼</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  bleed: { marginHorizontal: -Spacing.lg },
  heroTop: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: Spacing.md },
  heroValue: { fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  breadthTrack: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", gap: 2 },
  breadthLegend: { flexDirection: "row", justifyContent: "space-between" },
  secondaryRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.md,
    marginHorizontal: -4,
  },
  secondaryCell: { flex: 1, paddingHorizontal: 4, gap: 1 },
  secondaryCode: { fontSize: 11, fontWeight: "600" },
  secondaryValue: { fontSize: FontSize.sm, fontWeight: "600" },
  watchStrip: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  watchCard: {
    width: 112,
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: 3,
  },
  watchTicker: { fontSize: FontSize.sm, fontWeight: "700" },
  watchPrice: { fontSize: FontSize.md, fontWeight: "600", marginTop: 6 },
  rowTrailing: { alignItems: "flex-end", gap: 4 },
  rowPrice: { fontSize: FontSize.md, fontWeight: "600" },
  heroLabel: { fontSize: FontSize.sm, fontWeight: "600" },
  footer: { alignItems: "center", gap: Spacing.md, marginTop: Spacing.lg },
  footnote: { fontSize: 11, textAlign: "center" },
  settingsBody: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  settingsNote: { fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: Spacing.md },
});
