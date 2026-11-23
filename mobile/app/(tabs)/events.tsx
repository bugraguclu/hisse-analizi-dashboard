import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import {
  EmptyCard,
  ErrorCard,
  FreshnessBanner,
  LoadingBlock,
} from "../../components/StatusViews";
import { SheetScrollView } from "../../components/SwipeDismissSheet";
import { mobileApi } from "../../lib/api";
import { formatIstanbulDateTime } from "../../lib/format";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";

const SEVERITIES = [
  { id: "", label: "Tümü" },
  { id: "high", label: "Yüksek önem" },
  { id: "watch", label: "Orta önem" },
] as const;

export default function EventsScreen() {
  const params = useLocalSearchParams<{ ticker?: string; severity?: string; category?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [severity, setSeverity] = useState(params.severity ?? "");
  // A deep link that arrives while this tab is already open replaces the params in place.
  useEffect(() => setSeverity(params.severity ?? ""), [params.severity]);
  const [filterOpen, setFilterOpen] = useState(false);

  const resourceKey = `events:${params.ticker ?? ""}:${severity}:${params.category ?? ""}`;
  const events = useResource({
    key: resourceKey,
    cacheKey: params.ticker || severity || params.category ? undefined : "events_default",
    fetcher: (signal) =>
      mobileApi.events(
        { ticker: params.ticker, severity: severity || undefined, category: params.category },
        signal,
      ),
    isEmpty: (res) => !res.items || res.items.length === 0,
  });

  const items = events.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={events.refreshing}
            onRefresh={events.reload}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Takvim & KAP</Text>
          <TouchableOpacity
            style={[
              styles.filterButton,
              {
                backgroundColor: severity ? colors.accentLight : colors.bgCard,
                borderColor: severity ? colors.accent : colors.border,
              },
            ]}
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>
              Filtre{severity ? " · 1" : ""}
            </Text>
          </TouchableOpacity>
        </View>

        {params.ticker ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
            Hisse filtresi: {params.ticker}
          </Text>
        ) : null}

        <FreshnessBanner
          status={events.status}
          fetchedAt={events.fetchedAt}
          source="KAP & Resmi Bildirimler"
          refreshing={events.refreshing}
          error={events.error}
          onRetry={events.reload}
        />

        {events.status === "loading" && !events.data ? (
          <LoadingBlock message="KAP bildirimleri yükleniyor…" />
        ) : events.status === "error" && !events.data ? (
          <ErrorCard
            title="KAP bildirimleri alınamadı"
            message={events.error ?? "Sunucuya bağlanılamadı."}
            onRetry={events.reload}
          />
        ) : items.length === 0 ? (
          <EmptyCard
            title="Bildirim bulunamadı"
            message="Seçili filtre kriterlerine uyan KAP bildirimi bulunmuyor."
            actionLabel={severity ? "Filtreyi temizle" : "Yenile"}
            onAction={() => (severity ? setSeverity("") : events.reload())}
          />
        ) : (
          <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {items.slice(0, 25).map((item) => (
              <TouchableOpacity
                key={String(item.id)}
                disabled={!item.ticker}
                onPress={() => item.ticker && router.push(`/stock/${item.ticker}` as never)}
                style={[styles.row, { borderBottomColor: colors.border }]}
              >
                <View style={styles.rowMeta}>
                  <Text style={{ color: colors.accent, fontWeight: "700", fontSize: FontSize.xs }}>
                    {item.ticker ?? "KAP"}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                    {item.published_at ? formatIstanbulDateTime(item.published_at) : ""}
                  </Text>
                </View>
                <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm }} numberOfLines={2}>
                  {item.title ?? "Bildirim"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      <BottomSheetModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Bildirim önemi"
      >
        <SheetScrollView
          contentContainerStyle={[
            styles.sheetList,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {SEVERITIES.map((opt) => {
            const active = severity === opt.id;
            return (
              <TouchableOpacity
                key={opt.id || "all"}
                style={[
                  styles.optionRow,
                  {
                    backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
                onPress={() => {
                  setSeverity(opt.id);
                  setFilterOpen(false);
                }}
                accessibilityRole="button"
              >
                <Text style={{ color: active ? colors.accent : colors.textPrimary, fontSize: FontSize.md }}>
                  {opt.label}
                </Text>
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
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 26, fontWeight: "700" },
  filterButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  row: {
    gap: 3,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  optionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
