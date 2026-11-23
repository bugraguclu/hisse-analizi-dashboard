import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { mobileApi, type MarketIndexQuote } from "../../lib/api";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";

const QUICK_TICKERS = ["THYAO", "GARAN", "ASELS", "AKBNK", "TUPRS"] as const;

export default function MarketsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [indices, setIndices] = useState<MarketIndexQuote[]>([]);
  const [offlineNote, setOfflineNote] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void mobileApi
      .marketOverview(controller.signal)
      .then((payload) => {
        setIndices(payload.indices ?? []);
        setOfflineNote(null);
      })
      .catch(() => {
        setOfflineNote("Canlı piyasa verisine şu an ulaşılamıyor; yerel mod aktif.");
      });
    return () => controller.abort();
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.lg, paddingBottom: Spacing.xxl },
      ]}
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

      {offlineNote ? (
        <View style={[styles.banner, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
          <Text style={{ color: colors.warn, fontSize: FontSize.xs }}>{offlineNote}</Text>
        </View>
      ) : null}

      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>ENDEKSLER</Text>
        {indices.length > 0 ? (
          indices.slice(0, 5).map((item) => (
            <View key={item.code} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Text style={[styles.ticker, { color: colors.textPrimary }]}>{item.code}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                {item.price !== null ? item.price.toFixed(2) : "—"}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            BIST 100 ve sektör endeksleri bağlantı hazır olduğunda yüklenir.
          </Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>HIZLI ERİŞİM</Text>
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
          <TouchableOpacity
            style={[styles.chip, { backgroundColor: colors.accentLight, borderColor: colors.accent }]}
            onPress={() => router.push("/makro" as never)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>Makro</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 26, fontWeight: "700" },
  searchButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  sectionTitle: { fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ticker: { fontSize: FontSize.md, fontWeight: "600" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
