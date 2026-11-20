import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppContext } from "../contexts/AppContext";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

/**
 * Recoverable startup screen shown if local initialization fails or exceeds the UI timeout budget.
 * Pressing Retry re-observes the single process-wide `StartupCoordinator` without starting a
 * second concurrent migration.
 */
export default function StartupIssueScreen() {
  const { startupIssue, retryStartup } = useAppContext();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const isTimeout = startupIssue?.kind === "timeout";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgPrimary,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {isTimeout ? "Başlangıç beklenenden uzun sürdü" : "Uygulama başlatılamadı"}
        </Text>
        <Text style={[styles.message, { color: colors.textMuted }]}>
          {startupIssue?.message ?? "Yerel çalışma alanı hazırlanırken bir sorun oluştu."}
        </Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.accent }]}
          onPress={retryStartup}
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
        >
          <Text style={styles.buttonText}>
            {isTimeout ? "Durumu tekrar kontrol et" : "Tekrar dene"}
          </Text>
        </TouchableOpacity>
      </View>
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
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.xxl,
    alignItems: "center",
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: FontSize.md,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  button: {
    width: "100%",
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: FontSize.md,
    fontWeight: "600",
  },
});
