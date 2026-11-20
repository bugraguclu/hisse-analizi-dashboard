import React, { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BottomSheetModal from "../../components/BottomSheetModal";
import { SheetNoDrag } from "../../components/SwipeDismissSheet";
import { useAppContext } from "../../contexts/AppContext";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../../lib/theme";

export default function WatchlistsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { watchlists, addTickerToWatchlist, removeTickerFromWatchlist } = useAppContext();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftTicker, setDraftTicker] = useState("");
  const activeList = watchlists[0];

  const handleAdd = () => {
    const clean = draftTicker.trim().toUpperCase();
    if (!clean) return;
    addTickerToWatchlist(clean, activeList?.id);
    setDraftTicker("");
    setSheetOpen(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.lg, paddingBottom: Spacing.xxl },
        ]}
      >
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/companion" as never)} style={{ paddingVertical: Spacing.md }}>
          <Text style={{ color: colors.accent }}>iPhone widget ve hatırlatıcılar</Text>
        </TouchableOpacity>
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>
            {activeList?.name ?? "Takip Listesi"}
          </Text>
          <TouchableOpacity
            style={[styles.addButton, { backgroundColor: colors.accent }]}
            onPress={() => setSheetOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.addButtonText}>+ Ekle</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {(activeList?.tickers ?? []).map((ticker) => (
            <View key={ticker} style={[styles.row, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => router.push(`/stock/${ticker}` as never)}
                accessibilityRole="button"
              >
                <Text style={[styles.ticker, { color: colors.textPrimary }]}>{ticker}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => removeTickerFromWatchlist(ticker, activeList?.id)}
                accessibilityRole="button"
                accessibilityLabel={`${ticker} hissesini çıkar`}
              >
                <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>Çıkar</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      <BottomSheetModal
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Takip listesine hisse ekle"
        avoidKeyboard
      >
        <View style={[styles.sheetBody, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          <SheetNoDrag>
            <TextInput
              value={draftTicker}
              onChangeText={setDraftTicker}
              placeholder="Örn. EREGL"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.bgSecondary,
                  borderColor: colors.border,
                },
              ]}
            />
          </SheetNoDrag>
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: colors.accent }]}
            onPress={handleAdd}
            accessibilityRole="button"
          >
            <Text style={styles.addButtonText}>Listeye ekle</Text>
          </TouchableOpacity>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { fontSize: 26, fontWeight: "700" },
  addButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  addButtonText: { color: "#ffffff", fontSize: FontSize.sm, fontWeight: "600" },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ticker: { fontSize: FontSize.md, fontWeight: "600" },
  sheetBody: { paddingHorizontal: Spacing.lg, gap: Spacing.md },
  input: {
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
  },
  submitButton: {
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
});
