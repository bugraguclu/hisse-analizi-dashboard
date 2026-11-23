import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

export default function MakroScreen() {
  const params = useLocalSearchParams<{ piyasa?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.md, paddingBottom: Spacing.xxl },
      ]}
    >
      <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
        <Text style={{ color: colors.accent, fontSize: FontSize.md }}>← Geri</Text>
      </TouchableOpacity>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Makroekonomi</Text>
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={{ color: colors.textSecondary, fontSize: FontSize.md }}>
          {params.piyasa
            ? `Seçili gösterge: ${params.piyasa.toUpperCase()}`
            : "TCMB politika faizi, enflasyon (TÜFE/ÜFE) ve döviz göstergeleri."}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  heading: { fontSize: 26, fontWeight: "700" },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
});
