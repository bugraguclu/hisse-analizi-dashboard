import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { EMPTY_VALUE, formatFreshnessStamp, formatIstanbulDateTime } from "../lib/format";
import type { ResourceStatus } from "../lib/requestState";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";
import { Icon, type IconName, PillButton } from "./ui";

export function LoadingBlock({ message = "Veriler yükleniyor…" }: { message?: string }) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.stateBox, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <ActivityIndicator size="small" color={colors.accent} />
      <Text style={[styles.stateBody, { color: colors.textMuted }]}>{message}</Text>
    </View>
  );
}

export function ErrorCard({
  title = "Veriye ulaşılamadı",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.stateBox, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      accessibilityRole="alert"
    >
      <View style={[styles.stateIcon, { backgroundColor: colors.downSoft }]}>
        <Icon name="wifi.exclamationmark" size={20} color={colors.down} weight="semibold" />
      </View>
      <Text style={[styles.stateTitle, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.textMuted }]}>{message}</Text>
      {onRetry ? <PillButton label="Tekrar dene" icon="arrow.clockwise" variant="filled" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyCard({
  title = "Sonuç bulunamadı",
  message,
  actionLabel,
  onAction,
  icon = "tray",
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.stateBox, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
      <View style={[styles.stateIcon, { backgroundColor: colors.fill }]}>
        <Icon name={icon} size={20} color={colors.textMuted} weight="semibold" />
      </View>
      <Text style={[styles.stateTitle, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.stateBody, { color: colors.textMuted }]}>{message}</Text>
      {actionLabel && onAction ? <PillButton label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function FreshnessBanner({
  status,
  fetchedAt,
  dataAsOf,
  delayMinutes,
  source,
  refreshing,
  error,
  onRetry,
}: {
  status: ResourceStatus;
  fetchedAt: string | null;
  dataAsOf?: string | number | null;
  delayMinutes?: number | null;
  source?: string | null;
  refreshing?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const colors = useThemeColors();

  // A cached snapshot that is being refreshed right now is normal on launch; only
  // warn once the refresh has failed or stopped.
  if (status === "stale" && !(refreshing && !error)) {
    const savedText = fetchedAt ? formatIstanbulDateTime(fetchedAt) : EMPTY_VALUE;
    return (
      <View
        style={[
          styles.staleBanner,
          { backgroundColor: colors.bgSecondary, borderColor: colors.warn },
        ]}
      >
        <View style={styles.staleTextWrap}>
          <Text style={{ color: colors.warn, fontSize: FontSize.xs, fontWeight: "700" }}>
            Eski kayıt gösteriliyor · {savedText}
          </Text>
          {error ? (
            <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>{error}</Text>
          ) : refreshing ? (
            <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
              Güncel veri kontrol ediliyor…
            </Text>
          ) : null}
        </View>
        {onRetry ? (
          <TouchableOpacity
            style={[styles.inlineRetry, { borderColor: colors.warn }]}
            onPress={onRetry}
            accessibilityRole="button"
          >
            <Text style={{ color: colors.warn, fontSize: FontSize.xs, fontWeight: "600" }}>
              Yenile
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  const parts: string[] = [];
  if (source) parts.push(source);
  if (delayMinutes != null && delayMinutes > 0) parts.push(`${delayMinutes} dk gecikmeli`);
  const stamp = dataAsOf ?? fetchedAt;
  if (stamp) parts.push(`Güncelleme: ${formatFreshnessStamp(stamp)}`);
  if (parts.length === 0 && !refreshing) return null;

  return (
    <View style={styles.metaRow}>
      <Text style={[styles.metaText, { color: colors.textMuted }]} numberOfLines={1}>
        {parts.join(" · ")}
      </Text>
      {refreshing ? <ActivityIndicator size="small" color={colors.accent} /> : null}
    </View>
  );
}

export function SectionCard({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{title}</Text>
          {subtitle ? (
            <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>{subtitle}</Text>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function MetricTile({
  label,
  value,
  subValue,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  subValue?: string | null;
  /** Optional third line (e.g. the previous release). */
  detail?: string | null;
  tone?: "default" | "up" | "down" | "accent" | "warn";
}) {
  const colors = useThemeColors();
  const valueColor =
    tone === "up"
      ? colors.up
      : tone === "down"
        ? colors.down
        : tone === "accent"
          ? colors.accent
          : tone === "warn"
            ? colors.warn
            : colors.textPrimary;

  return (
    <View
      style={[
        styles.metricTile,
        { backgroundColor: colors.bgSecondary, borderColor: colors.border },
      ]}
      accessible
      accessibilityLabel={[label, value || EMPTY_VALUE, subValue, detail]
        .filter(Boolean)
        .map((part) => (part === EMPTY_VALUE ? "veri yok" : part))
        .join(", ")}
    >
      <Text style={[styles.metricLabel, { color: colors.textMuted }]} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[styles.metricValue, { color: valueColor }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value || EMPTY_VALUE}
      </Text>
      {subValue ? (
        <Text style={[styles.metricSub, { color: colors.textSecondary }]} numberOfLines={2}>
          {subValue}
        </Text>
      ) : null}
      {detail ? (
        <Text style={[styles.metricSub, { color: colors.textMuted }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stateBox: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
  },
  stateIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  stateTitle: {
    fontSize: FontSize.md,
    fontWeight: "600",
    textAlign: "center",
  },
  stateBody: {
    fontSize: FontSize.sm,
    textAlign: "center",
    lineHeight: 19,
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  staleTextWrap: {
    flex: 1,
    gap: 2,
  },
  inlineRetry: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  metaText: {
    fontSize: 11,
    flex: 1,
  },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  cardTitle: {
    fontSize: FontSize.md,
    fontWeight: "700",
  },
  metricTile: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 130,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  metricValue: {
    fontSize: FontSize.md,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  metricSub: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
});
