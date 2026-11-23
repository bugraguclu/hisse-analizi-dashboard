import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { SheetScrollView } from "../../components/SwipeDismissSheet";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";

const QUICK_PRESETS = [
  { id: "low_pe", label: "Düşük F/K" },
  { id: "low_pb", label: "Düşük PD/DD" },
  { id: "high_dividend", label: "Yüksek temettü" },
  { id: "high_roe", label: "Yüksek ROE" },
  { id: "rsi_oversold", label: "RSI aşırı satım" },
  { id: "uptrend", label: "Yükseliş trendi" },
] as const;

export default function TaramaScreen() {
  const params = useLocalSearchParams<{ preset?: string; sector?: string; index?: string; q?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [selectedPreset, setSelectedPreset] = useState<string>(params.preset ?? "");
  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgPrimary, paddingTop: insets.top + Spacing.lg },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Tarama</Text>
        <TouchableOpacity
          style={[styles.filterButton, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          onPress={() => setFilterOpen(true)}
          accessibilityRole="button"
        >
          <Text style={{ color: colors.accent, fontWeight: "600", fontSize: FontSize.sm }}>
            Filtreler{selectedPreset ? " · 1" : ""}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={{ color: colors.textSecondary, fontSize: FontSize.md }}>
          {selectedPreset
            ? `Etkin tarama: ${QUICK_PRESETS.find((p) => p.id === selectedPreset)?.label ?? selectedPreset}`
            : "Hazır tarama veya sektör filtresi seçmek için Filtreler panelini açın."}
        </Text>
        {params.sector ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>Sektör: {params.sector}</Text>
        ) : null}
        {params.index ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>Endeks: {params.index}</Text>
        ) : null}
      </View>

      <BottomSheetModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Tarama filtreleri"
        subtitle="Hazır tarama seçin"
      >
        <SheetScrollView
          contentContainerStyle={[
            styles.sheetList,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
        >
          {QUICK_PRESETS.map((preset) => {
            const active = selectedPreset === preset.id;
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
                onPress={() => {
                  setSelectedPreset(active ? "" : preset.id);
                  setFilterOpen(false);
                }}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: active ? colors.accent : colors.textPrimary,
                    fontWeight: active ? "600" : "400",
                    fontSize: FontSize.md,
                  }}
                >
                  {preset.label}
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
  container: { flex: 1, paddingHorizontal: Spacing.lg, gap: Spacing.lg },
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
    gap: Spacing.xs,
  },
  sheetList: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  optionRow: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
