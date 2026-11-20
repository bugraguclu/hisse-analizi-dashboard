import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { normalizeTicker } from "../lib/externalLinking";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

const POPULAR = ["THYAO", "GARAN", "AKBNK", "ASELS", "EREGL", "TUPRS", "KCHOL", "SISE"] as const;

export default function SearchModalScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(params.q ?? "");

  const filtered = POPULAR.filter((ticker) =>
    ticker.includes(query.trim().toUpperCase()),
  );

  const openTicker = (raw: string) => {
    const ticker = normalizeTicker(raw);
    if (!ticker) return;
    router.replace(`/stock/${ticker}` as never);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgPrimary,
          paddingTop: Spacing.lg,
          paddingBottom: Math.max(insets.bottom, Spacing.lg),
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Hisse Ara</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontSize: FontSize.md }}>Kapat</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => openTicker(query)}
        placeholder="Hisse kodu (örn. THYAO)"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
          },
        ]}
      />

      <View style={styles.list}>
        {filtered.map((ticker) => (
          <TouchableOpacity
            key={ticker}
            style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={() => openTicker(ticker)}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.textPrimary, fontSize: FontSize.md, fontWeight: "600" }}>
              {ticker}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: FontSize.xl, fontWeight: "700" },
  input: {
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
  },
  list: { gap: Spacing.sm },
  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
