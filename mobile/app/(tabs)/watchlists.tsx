import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { DragGrip, type DragControls, ReorderableList, SwipeRow } from "../../components/Reorderable";
import { FreshnessBanner } from "../../components/StatusViews";
import { SheetNoDrag, SheetScrollView } from "../../components/SwipeDismissSheet";
import {
  Card,
  ChangePill,
  Chip,
  haptic,
  Icon,
  IconButton,
  ListRow,
  PillButton,
  ScreenHeader,
  SegmentedControl,
  SkeletonRows,
  StatusBarScrim,
  Touchable,
  usePullToRefresh,
} from "../../components/ui";
import { useAppContext } from "../../contexts/AppContext";
import { formatNumber, formatPrice, formatSignedPercent } from "../../lib/format";
import type { ScreenerStockRow } from "../../lib/screener";
import { BorderRadius, FontSize, Spacing, Type, useThemeColors } from "../../lib/theme";
import { useMarketUniverse } from "../../lib/useMarketUniverse";
import { useStockActions } from "../../lib/useStockActions";

type SortMode = "manual" | "change" | "alpha";

const SORT_OPTIONS: readonly { id: SortMode; label: string }[] = [
  { id: "manual", label: "Liste sırası" },
  { id: "change", label: "Günlük %" },
  { id: "alpha", label: "A–Z" },
];

const SUGGESTED = ["THYAO", "GARAN", "AKBNK", "ASELS", "BIMAS", "EREGL", "TUPRS", "KCHOL", "SISE", "FROTO"] as const;

function normalizeForSearch(text: string): string {
  return text.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export default function WatchlistsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { watchlists, addTickerToWatchlist, removeTickerFromWatchlist, moveTickerInWatchlist } = useAppContext();
  const stockActions = useStockActions();
  const [dragging, setDragging] = useState(false);
  const universe = useMarketUniverse();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState<SortMode>("manual");
  const [undo, setUndo] = useState<{ ticker: string; index: number } | null>(null);
  const pull = usePullToRefresh(universe.reload, universe.refreshing);
  const activeList = watchlists[0];
  const tickers = activeList?.tickers ?? [];

  const rows = useMemo(() => {
    const list = tickers.map((ticker, order) => ({ ticker, order, row: universe.bySymbol.get(ticker) }));
    if (sort === "alpha") list.sort((a, b) => a.ticker.localeCompare(b.ticker, "tr"));
    if (sort === "change") {
      list.sort((a, b) => (b.row?.change_pct ?? -Infinity) - (a.row?.change_pct ?? -Infinity));
    }
    return list;
  }, [sort, tickers, universe.bySymbol]);

  const summary = useMemo(() => {
    const changes = rows.map((r) => r.row?.change_pct).filter((v): v is number => typeof v === "number");
    if (changes.length === 0) return null;
    const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
    const up = changes.filter((c) => c > 0.005).length;
    const down = changes.filter((c) => c < -0.005).length;
    return { avg, up, down };
  }, [rows]);

  // Undo window for removals.
  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (tickers.length === 0) setEditing(false);
  }, [tickers.length]);

  const remove = (ticker: string) => {
    haptic.warning();
    setUndo({ ticker, index: tickers.indexOf(ticker) });
    removeTickerFromWatchlist(ticker, activeList?.id);
  };

  const moveToTop = (ticker: string) => {
    const from = tickers.indexOf(ticker);
    if (from <= 0) return;
    haptic.success();
    moveTickerInWatchlist(from, 0, activeList?.id);
  };

  const add = (raw: string) => {
    const clean = raw.trim().toUpperCase();
    if (!clean || tickers.includes(clean)) return;
    haptic.success();
    addTickerToWatchlist(clean, activeList?.id);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setDraft("");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: Spacing.xxl * 3 },
        ]}
        refreshControl={
          <RefreshControl {...pull} tintColor={colors.accent} />
        }
      >
        <ScreenHeader
          title={activeList?.name ?? "Takip Listem"}
          subtitle={tickers.length > 0 ? `${tickers.length} hisse` : null}
          right={
            <>
              {tickers.length > 0 ? (
                <Touchable onPress={() => setEditing((v) => !v)} accessibilityRole="button" hitSlop={8} haptics="selection">
                  <Text style={{ color: colors.accent, fontSize: FontSize.md, fontWeight: editing ? "600" : "400" }}>
                    {editing ? "Bitti" : "Düzenle"}
                  </Text>
                </Touchable>
              ) : null}
              <IconButton icon="plus" label="Hisse ekle" variant="accent" onPress={() => setSheetOpen(true)} />
            </>
          }
        />

        {tickers.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={[Type.headline, { color: colors.textPrimary, textAlign: "center" }]}>Listen boş</Text>
            <Text style={{ color: colors.textMuted, fontSize: FontSize.sm, textAlign: "center", lineHeight: 19 }}>
              İzlemek istediğin hisseleri ekle; fiyat ve günlük değişim burada tek bakışta görünsün.
            </Text>
            <View style={styles.suggestWrap}>
              {SUGGESTED.slice(0, 6).map((t) => (
                <Chip key={t} label={t} icon="plus" onPress={() => add(t)} accessibilityLabel={`${t} hissesini ekle`} />
              ))}
            </View>
            <PillButton label="Hisse ara ve ekle" icon="magnifyingglass" variant="filled" onPress={() => setSheetOpen(true)} />
          </Card>
        ) : (
          <>
            {summary ? (
              <View style={styles.summaryRow}>
                <View style={{ gap: 2 }}>
                  <Text style={[Type.footnote, { color: colors.textMuted }]}>Liste ortalaması (eşit ağırlık)</Text>
                  <Text
                    style={[
                      Type.number,
                      {
                        fontSize: 22,
                        fontWeight: "700",
                        color: summary.avg > 0.005 ? colors.up : summary.avg < -0.005 ? colors.down : colors.textPrimary,
                      },
                    ]}
                  >
                    {formatSignedPercent(summary.avg)}
                  </Text>
                </View>
                <Text style={[Type.number, { color: colors.textMuted, fontSize: FontSize.xs }]}>
                  <Text style={{ color: colors.up, fontWeight: "600" }}>{summary.up} ▲</Text>
                  {"   "}
                  <Text style={{ color: colors.down, fontWeight: "600" }}>{summary.down} ▼</Text>
                </Text>
              </View>
            ) : null}

            {tickers.length > 1 ? <SegmentedControl options={SORT_OPTIONS} value={sort} onChange={setSort} size="sm" /> : null}

            <Card padded={false}>
              {universe.status === "loading" && !universe.data ? (
                <SkeletonRows count={Math.min(tickers.length, 6)} />
              ) : sort === "manual" ? (
                <ReorderableList
                  data={rows}
                  keyExtractor={rowKey}
                  onDragActiveChange={setDragging}
                  onReorder={(from, to) => moveTickerInWatchlist(from, to, activeList?.id)}
                  renderItem={({ ticker, row }, controls) => (
                    <WatchRow
                      ticker={ticker}
                      row={row}
                      editing={editing}
                      controls={controls}
                      isLast={controls.index === rows.length - 1}
                      onOpen={() => router.push(`/stock/${ticker}` as never)}
                      onRemove={() => remove(ticker)}
                      onMoveToTop={controls.index > 0 ? () => moveToTop(ticker) : undefined}
                    />
                  )}
                />
              ) : (
                rows.map(({ ticker, row }, i) => (
                  <WatchRow
                    key={ticker}
                    ticker={ticker}
                    row={row}
                    editing={editing}
                    isLast={i === rows.length - 1}
                    onOpen={() => router.push(`/stock/${ticker}` as never)}
                    onLongPress={() =>
                      stockActions(ticker, { name: row?.name, price: row?.close, changePct: row?.change_pct })
                    }
                    onRemove={() => remove(ticker)}
                  />
                ))
              )}
            </Card>

            {tickers.length > 1 && !editing ? (
              <Text style={[Type.footnote, { color: colors.textMuted, marginLeft: 2 }]}>
                {sort === "manual"
                  ? "Basılı tutup sürükleyerek sırala. Sola kaydır: kaldır, sağa kaydır: başa taşı."
                  : "Elle sıralamak için “Liste sırası”nı seç"}
              </Text>
            ) : null}

            <FreshnessBanner
              status={universe.status}
              fetchedAt={universe.fetchedAt}
              dataAsOf={universe.data?.as_of ?? null}
              delayMinutes={universe.data?.delay_minutes ?? 15}
              source="Borsa İstanbul"
              refreshing={universe.refreshing}
              error={universe.error}
              onRetry={universe.reload}
            />
          </>
        )}
      </ScrollView>
      <StatusBarScrim />

      {undo ? (
        <UndoToast
          bottom={Spacing.lg}
          message={`${undo.ticker} listeden çıkarıldı`}
          onUndo={() => {
            addTickerToWatchlist(undo.ticker, activeList?.id, undo.index);
            haptic.light();
            setUndo(null);
          }}
        />
      ) : null}

      <BottomSheetModal visible={sheetOpen} onClose={closeSheet} title="Hisse ekle" subtitle={activeList?.name} avoidKeyboard>
        <AddTickerSheet
          draft={draft}
          setDraft={setDraft}
          existing={tickers}
          universeRows={(universe.data?.rows ?? []) as ScreenerStockRow[]}
          onAdd={add}
          bottomInset={Math.max(insets.bottom, Spacing.lg)}
        />
      </BottomSheetModal>
    </View>
  );
}

function rowKey(item: { ticker: string }) {
  return item.ticker;
}

function WatchRow({
  ticker,
  row,
  editing,
  isLast,
  controls,
  onOpen,
  onRemove,
  onMoveToTop,
  onLongPress,
}: {
  ticker: string;
  row: ScreenerStockRow | undefined;
  editing: boolean;
  isLast: boolean;
  /** Present when the list is in manual order and rows can be dragged. */
  controls?: DragControls;
  onOpen: () => void;
  onRemove: () => void;
  onMoveToTop?: () => void;
  onLongPress?: () => void;
}) {
  const colors = useThemeColors();
  const content = (
    <ListRow
      title={ticker}
      subtitle={row?.name ?? "Fiyat bilgisi yok"}
      leading={
        editing ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`${ticker} hissesini listeden çıkar`}>
            <Icon name="minus.circle.fill" size={22} color={colors.down} />
          </Pressable>
        ) : null
      }
      onPress={editing ? undefined : onOpen}
      onLongPress={editing ? undefined : controls ? controls.lift : onLongPress}
      onPressOut={controls?.drop}
      accessibilityLabel={`${ticker} ${row?.name ?? ""}, ${formatPrice(row?.close)}, ${formatSignedPercent(row?.change_pct)}`}
      isLast={isLast || Boolean(controls?.isDragging)}
      trailing={
        <>
          <View style={styles.trailing}>
            <Text style={[Type.number, styles.price, { color: colors.textPrimary }]}>{formatPrice(row?.close)}</Text>
            <ChangePill value={row?.change_pct} size="sm" />
          </View>
          {editing && controls ? <DragGrip controls={controls} label={`${ticker} sırasını değiştir`} /> : null}
        </>
      }
    />
  );
  return (
    <SwipeRow
      enabled={!editing && !controls?.isDragging}
      trailing={[{ label: "Kaldır", icon: "trash", color: colors.down, onPress: onRemove }]}
      leading={onMoveToTop ? { label: "Başa taşı", icon: "arrow.up.to.line", color: colors.accent, onPress: onMoveToTop } : undefined}
    >
      <View style={{ backgroundColor: colors.bgCard }}>{content}</View>
    </SwipeRow>
  );
}

function AddTickerSheet({
  draft,
  setDraft,
  existing,
  universeRows,
  onAdd,
  bottomInset,
}: {
  draft: string;
  setDraft: (v: string) => void;
  existing: readonly string[];
  universeRows: readonly ScreenerStockRow[];
  onAdd: (ticker: string) => void;
  bottomInset: number;
}) {
  const colors = useThemeColors();
  const q = normalizeForSearch(draft.trim());

  const matches = useMemo(() => {
    if (!q) {
      const suggested = SUGGESTED.map((s) => universeRows.find((r) => r.symbol === s)).filter(
        (r): r is ScreenerStockRow => Boolean(r),
      );
      return suggested.length > 0 ? suggested : [];
    }
    const starts: ScreenerStockRow[] = [];
    const contains: ScreenerStockRow[] = [];
    for (const r of universeRows) {
      const sym = r.symbol.toLowerCase();
      const name = normalizeForSearch(r.name ?? "");
      if (sym.startsWith(q)) starts.push(r);
      else if (name.includes(q) || sym.includes(q)) contains.push(r);
      if (starts.length >= 25) break;
    }
    return [...starts, ...contains].slice(0, 25);
  }, [q, universeRows]);

  const exactTicker = /^[A-Z0-9]{2,10}$/.test(draft.trim().toUpperCase()) ? draft.trim().toUpperCase() : null;
  const offline = universeRows.length === 0;

  return (
    <View style={{ paddingBottom: bottomInset, gap: Spacing.md }}>
      <SheetNoDrag style={{ paddingHorizontal: Spacing.lg }}>
        <View style={[styles.inputWrap, { backgroundColor: colors.fill }]}>
          <Icon name="magnifyingglass" size={15} color={colors.textMuted} weight="semibold" />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Kod veya şirket adı (örn. EREGL)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              if (matches[0]) onAdd(matches[0].symbol);
              else if (offline && exactTicker) onAdd(exactTicker);
            }}
            style={[styles.input, { color: colors.textPrimary }]}
          />
          {draft ? (
            <Pressable onPress={() => setDraft("")} hitSlop={8} accessibilityLabel="Aramayı temizle">
              <Icon name="xmark.circle.fill" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </SheetNoDrag>

      <Text style={[Type.footnote, { color: colors.textMuted, paddingHorizontal: Spacing.lg }]}>
        {q ? (matches.length >= 25 ? "En iyi eşleşmeler" : `${matches.length} sonuç`) : "Öne çıkanlar"}
      </Text>

      <SheetScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginHorizontal: Spacing.lg }}>
          <Card padded={false}>
            {matches.length === 0 ? (
              <View style={{ padding: Spacing.lg, gap: Spacing.sm, alignItems: "center" }}>
                <Text style={{ color: colors.textMuted, fontSize: FontSize.sm, textAlign: "center" }}>
                  {offline ? "Hisse listesi şu an yüklenemedi." : `"${draft.trim()}" ile eşleşen BIST hissesi yok.`}
                </Text>
                {offline && exactTicker && !existing.includes(exactTicker) ? (
                  <PillButton label={`${exactTicker} ekle`} icon="plus" onPress={() => onAdd(exactTicker)} />
                ) : null}
              </View>
            ) : (
              matches.map((r, i) => {
                const added = existing.includes(r.symbol);
                return (
                  <ListRow
                    key={r.symbol}
                    title={r.symbol}
                    subtitle={r.name ?? null}
                    isLast={i === matches.length - 1}
                    onPress={added ? undefined : () => onAdd(r.symbol)}
                    accessibilityLabel={added ? `${r.symbol} zaten listede` : `${r.symbol} hissesini ekle`}
                    trailing={
                      <View style={styles.addTrailing}>
                        <Text style={[Type.number, { color: colors.textSecondary, fontSize: FontSize.xs }]}>
                          {formatNumber(r.close)}
                        </Text>
                        <Icon
                          name={added ? "checkmark.circle.fill" : "plus.circle"}
                          size={22}
                          color={added ? colors.up : colors.accent}
                        />
                      </View>
                    }
                  />
                );
              })
            )}
          </Card>
        </View>
      </SheetScrollView>
    </View>
  );
}

function UndoToast({ message, onUndo, bottom }: { message: string; onUndo: () => void; bottom: number }) {
  const colors = useThemeColors();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
  }, [enter]);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          bottom,
          backgroundColor: colors.textPrimary,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
        },
      ]}
    >
      <Text style={{ color: colors.bgPrimary, fontSize: FontSize.sm, flex: 1 }} numberOfLines={1}>
        {message}
      </Text>
      <Pressable onPress={onUndo} hitSlop={10} accessibilityRole="button">
        <Text style={{ color: colors.bgPrimary, fontSize: FontSize.sm, fontWeight: "700" }}>Geri al</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  emptyCard: { alignItems: "center", gap: Spacing.md, paddingVertical: Spacing.xxl },
  suggestWrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: Spacing.sm },
  summaryRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 2 },
  trailing: { alignItems: "flex-end", gap: 4 },
  price: { fontSize: FontSize.md, fontWeight: "600" },
  addTrailing: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 42,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  input: { flex: 1, fontSize: FontSize.md, paddingVertical: 0 },
  toast: {
    position: "absolute",
    left: Spacing.lg,
    right: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
    borderRadius: BorderRadius.lg,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
