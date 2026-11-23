import React from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

/** Safe fallback route for any unknown address. */
export default function NotFoundScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgPrimary,
          paddingTop: insets.top + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
        },
      ]}
    >
      <Text style={[styles.title, { color: colors.textPrimary }]}>Ekran bulunamadı</Text>
      <Text style={[styles.subtitle, { color: colors.textMuted }]}>
        Açmaya çalıştığınız bağlantı geçersiz veya kaldırılmış olabilir.
      </Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.accent }]}
        onPress={() => router.dismissTo("/(tabs)/markets" as never)}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Piyasalara dön</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  title: { fontSize: FontSize.xl, fontWeight: "600", marginBottom: Spacing.sm },
  subtitle: {
    fontSize: FontSize.md,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  button: {
    paddingVertical: 13,
    paddingHorizontal: Spacing.xxl,
    borderRadius: BorderRadius.lg,
  },
  buttonText: { color: "#ffffff", fontSize: FontSize.md, fontWeight: "600" },
});
