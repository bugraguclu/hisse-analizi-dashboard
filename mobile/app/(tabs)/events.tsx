import React, { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { SheetScrollView } from "../../components/SwipeDismissSheet";
import { mobileApi, type EventItemPayload } from "../../lib/api";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";

const SEVERITIES = [
  { id: "", label: "Tümü" },
  { id: "high", label: "Yüksek önem" },
  { id: "medium", label: "Orta önem" },
] as const;

export default function EventsScreen() {
  const params = useLocalSearchParams<{ ticker?: string; severity?: string; category?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [severity, setSeverity] = useState(params.severity ?? "");
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<EventItemPayload[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void mobileApi
      .events(
        { ticker: params.ticker, severity: severity || undefined, category: params.category },
        controller.signal,
      )
      .then((res) => setItems(res.items ?? []))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, [params.category, params.ticker, severity]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: Spacing.xxl },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Takvim & KAP</Text>
          <TouchableOpacity
            style={[styles.filterButton, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>Filtre</Text>
          </TouchableOpacity>
        </View>

        {params.ticker ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
            Hisse filtresi: {params.ticker}
          </Text>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {items.length > 0 ? (
            items.slice(0, 15).map((item) => (
              <View key={String(item.id)} style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.xs }}>
                  {item.ticker ?? "KAP"}
                </Text>
                <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm }} numberOfLines={2}>
                  {item.title ?? "Bildirim"}
                </Text>
              </View>
            ))
          ) : (
            <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
              Bilanço, temettü ve KAP akışı bağlantı sağlandığında burada listelenir.
            </Text>
          )}
        </View>
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
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
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
    gap: Spacing.md,
  },
  row: {
    gap: 2,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  optionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
