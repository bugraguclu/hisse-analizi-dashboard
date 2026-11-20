import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { SheetScrollView } from "../../components/SwipeDismissSheet";
import { mobileApi, type StockSummaryPayload } from "../../lib/api";
import { normalizeTicker, type StockSection } from "../../lib/externalLinking";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";

const SECTIONS: readonly { id: StockSection; label: string }[] = [
  { id: "hisse", label: "Genel" },
  { id: "teknik", label: "Teknik" },
  { id: "temel", label: "Temel" },
  { id: "analiz", label: "Analiz" },
];

const INDICATORS = ["SMA 20", "EMA 50", "RSI 14", "MACD 12 26 9", "Bollinger 20 2"] as const;

export default function StockDetailScreen() {
  const params = useLocalSearchParams<{ ticker?: string; section?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const ticker = normalizeTicker(params.ticker ?? "") ?? "THYAO";
  const initialSection: StockSection =
    params.section === "teknik" || params.section === "temel" || params.section === "analiz"
      ? params.section
      : "hisse";

  const [section, setSection] = useState<StockSection>(initialSection);
  const [summary, setSummary] = useState<StockSummaryPayload | null>(null);
  const [indicatorSheetOpen, setIndicatorSheetOpen] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<string[]>(["SMA 20", "RSI 14"]);

  useEffect(() => {
    const controller = new AbortController();
    void mobileApi
      .stockSummary(ticker, controller.signal)
      .then((data) => setSummary(data))
      .catch(() => setSummary(null));
    return () => controller.abort();
  }, [ticker]);

  const toggleIndicator = (label: string) => {
    setActiveIndicators((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.md, paddingBottom: Spacing.xxl },
        ]}
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
            <Text style={{ color: colors.accent, fontSize: FontSize.md }}>← Geri</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIndicatorSheetOpen(true)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.accent, fontSize: FontSize.sm, fontWeight: "600" }}>
              Göstergeler ({activeIndicators.length})
            </Text>
          </TouchableOpacity>
        </View>

        <View>
          <Text style={[styles.ticker, { color: colors.textPrimary }]}>{ticker}</Text>
          {summary?.name ? (
            <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>{summary.name}</Text>
          ) : null}
        </View>

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
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textSecondary,
                    fontSize: FontSize.xs,
                    fontWeight: active ? "600" : "400",
                  }}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
            Görünüm: {SECTIONS.find((s) => s.id === section)?.label}
          </Text>
          <Text style={{ color: colors.textPrimary, fontSize: FontSize.lg, fontWeight: "600" }}>
            {summary?.close != null ? `${summary.close.toFixed(2)} ₺` : "Fiyat verisi bekleniyor"}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
            Etkin göstergeler: {activeIndicators.join(", ") || "Yok"}
          </Text>
        </View>
      </ScrollView>

      <BottomSheetModal
        visible={indicatorSheetOpen}
        onClose={() => setIndicatorSheetOpen(false)}
        title="Gösterge ayarları"
        subtitle={ticker}
      >
        <SheetScrollView
          contentContainerStyle={[
            styles.sheetList,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {INDICATORS.map((label) => {
            const on = activeIndicators.includes(label);
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
                <Text style={{ color: on ? colors.accent : colors.textPrimary, fontSize: FontSize.md }}>
                  {on ? "✓ " : ""}
                  {label}
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
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  ticker: { fontSize: 28, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: Spacing.sm },
  tab: {
    flex: 1,
    alignItems: "center",
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
  sheetList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  optionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
