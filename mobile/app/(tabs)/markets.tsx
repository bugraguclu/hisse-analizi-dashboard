import React from "react";
import { useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  EmptyCard,
  ErrorCard,
  FreshnessBanner,
  LoadingBlock,
} from "../../components/StatusViews";
import { mobileApi } from "../../lib/api";
import { formatNumber, formatSignedPercent } from "../../lib/format";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";

const QUICK_TICKERS = ["THYAO", "GARAN", "ASELS", "AKBNK", "TUPRS"] as const;
const QUICK_MACRO_LINKS = [
  { label: "Makro Özet", params: {} },
  { label: "Enflasyon (TÜFE)", params: { piyasa: "tufe" } },
  { label: "USD / TRY", params: { piyasa: "usdtry" } },
] as const;

export default function MarketsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const overview = useResource({
    key: "markets:overview",
    cacheKey: "markets_overview",
    fetcher: (signal) => mobileApi.marketOverview(signal),
    isEmpty: (data) => !data.indices || data.indices.length === 0,
  });

  const indices = overview.data?.indices ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xxl },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={overview.refreshing}
          onRefresh={overview.reload}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Piyasalar</Text>
        <TouchableOpacity
          style={[styles.searchButton, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => router.push("/search" as never)}
          accessibilityRole="button"
          accessibilityLabel="Hisse ara"
        >
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>Ara…</Text>
        </TouchableOpacity>
      </View>

      <FreshnessBanner
        status={overview.status}
        fetchedAt={overview.fetchedAt}
        dataAsOf={overview.data?.updated_at ?? null}
        delayMinutes={15}
        source="BIST Endeksleri"
        refreshing={overview.refreshing}
        error={overview.error}
        onRetry={overview.reload}
      />

      {overview.status === "loading" && !overview.data ? (
        <LoadingBlock message="BIST endeks verileri yükleniyor…" />
      ) : overview.status === "error" && !overview.data ? (
        <ErrorCard
          title="Endeks verileri alınamadı"
          message={overview.error ?? "Sunucuya bağlanılamadı."}
          onRetry={overview.reload}
        />
      ) : indices.length === 0 ? (
        <EmptyCard
          title="Endeks verisi yok"
          message="Sunucudan görüntülenecek endeks verisi dönmedi."
          actionLabel="Yenile"
          onAction={overview.reload}
        />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>ENDEKSLER</Text>
          {indices.slice(0, 8).map((item) => {
            const ch = item.change_pct;
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
                key={item.code}
                style={[styles.row, { borderBottomColor: colors.border }]}
                onPress={() =>
                  router.push({ pathname: "/(tabs)/tarama", params: { index: item.code } } as never)
                }
                accessibilityRole="button"
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.ticker, { color: colors.textPrimary }]}>{item.code}</Text>
                  {item.name !== item.code ? (
                    <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                      {item.name}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.numVal, { color: colors.textPrimary }]}>
                    {formatNumber(item.price)}
                  </Text>
                  <Text style={[styles.numSub, { color: chColor }]}>
                    {formatSignedPercent(ch)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>HIZLI HİSSE ERİŞİMİ</Text>
        <View style={styles.chipWrap}>
          {QUICK_TICKERS.map((ticker) => (
            <TouchableOpacity
              key={ticker}
              style={[styles.chip, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
              onPress={() => router.push(`/stock/${ticker}` as never)}
              accessibilityRole="button"
            >
              <Text style={[styles.ticker, { color: colors.textPrimary }]}>{ticker}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>MAKROEKONOMİ</Text>
        <View style={styles.chipWrap}>
          {QUICK_MACRO_LINKS.map((item) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.chip, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
              onPress={() => router.push({ pathname: "/makro", params: item.params } as never)}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 26, fontWeight: "700" },
  searchButton: {
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
  sectionTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  ticker: { fontSize: FontSize.md, fontWeight: "600" },
  numVal: { fontSize: FontSize.sm, fontWeight: "700", fontVariant: ["tabular-nums"] },
  numSub: { fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
