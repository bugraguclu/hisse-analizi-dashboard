/**
 * Shared iOS building blocks: SF Symbol icons, pressable feedback, large-title
 * headers, segmented controls, chips, change pills and inset-grouped lists.
 * Screens compose these instead of restyling the same controls by hand.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  type ColorValue,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SymbolWeight } from "expo-symbols";
import type { SFSymbol } from "sf-symbols-typescript";
import { buildLineSegments, computeYDomain } from "../lib/indicators";
import { formatSignedPercent } from "../lib/format";
import {
  BorderRadius,
  FontSize,
  Spacing,
  Type,
  useThemeColors,
  type ThemeColors,
} from "../lib/theme";

export type IconName = SFSymbol;

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

export const haptic = {
  selection() {
    if (Platform.OS === "ios") void Haptics.selectionAsync().catch(() => undefined);
  },
  light() {
    if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  medium() {
    if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  },
  success() {
    if (Platform.OS === "ios") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  },
  warning() {
    if (Platform.OS === "ios") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }
  },
};

// ---------------------------------------------------------------------------
// Pull to refresh
// ---------------------------------------------------------------------------

/**
 * Drives RefreshControl from the user's pull only. Background revalidation
 * (foreground resume, cache → network) must not toggle `refreshing`: on iOS that
 * shows the spinner programmatically and can leave the scroll content offset.
 */
export function usePullToRefresh(onRefresh: () => void, busy: boolean) {
  const [pulling, setPulling] = useState(false);
  const sawBusy = useRef(false);
  useEffect(() => {
    if (!pulling) return undefined;
    if (busy) sawBusy.current = true;
    if (!busy && sawBusy.current) {
      sawBusy.current = false;
      setPulling(false);
    }
    // Safety net when the reload resolves before `busy` is ever observed.
    const timer = setTimeout(() => setPulling(false), 8000);
    return () => clearTimeout(timer);
  }, [busy, pulling]);
  return {
    refreshing: pulling,
    onRefresh: () => {
      sawBusy.current = false;
      setPulling(true);
      haptic.light();
      onRefresh();
    },
  };
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

export function Icon({
  name,
  size = 18,
  color,
  weight = "medium",
  style,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  weight?: SymbolWeight;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color ?? colors.textSecondary}
      weight={weight}
      resizeMode="scaleAspectFit"
      style={[{ width: size, height: size }, style]}
      fallback={<View style={{ width: size, height: size }} />}
    />
  );
}

/** Turkish-aware upper-casing ("Pazartesi" → "PAZARTESİ"); CSS textTransform is not. */
export function trUpper(text: string): string {
  return text.toLocaleUpperCase("tr-TR");
}

/** "KİMYA İLAÇ VE PETROL" → "Kimya İlaç ve Petrol"; KAP publishes sector names in capitals. */
export function trTitleCase(text: string): string {
  const minor = new Set(["ve", "ile", "veya", "de", "da"]);
  return text
    .toLocaleLowerCase("tr-TR")
    .split(/(\s+)/)
    .map((word, i) =>
      /\s/.test(word) || (i > 0 && minor.has(word))
        ? word
        : word.charAt(0).toLocaleUpperCase("tr-TR") + word.slice(1),
    )
    .join("");
}

const OUTER_LAYOUT_KEYS = [
  "flex",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignSelf",
  "width",
  "minWidth",
  "maxWidth",
  "margin",
  "marginHorizontal",
  "marginVertical",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "position",
  "top",
  "left",
  "right",
  "bottom",
] as const;

/** Layout keys must sit on the Pressable so the touch target takes the slot the caller asked for. */
function splitLayoutStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = { ...(StyleSheet.flatten(style) ?? {}) } as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  for (const key of OUTER_LAYOUT_KEYS) {
    if (key in flat) {
      outer[key] = flat[key];
      delete flat[key];
    }
  }
  if ("flex" in outer || "flexGrow" in outer) flat.flexGrow = 1;
  if ("width" in outer) flat.width = "100%";
  return { outer: outer as ViewStyle, inner: flat as ViewStyle };
}

// ---------------------------------------------------------------------------
// Pressable with iOS-like dim + slight scale
// ---------------------------------------------------------------------------

export function Touchable({
  style,
  children,
  scaleTo = 0.97,
  haptics,
  onPress,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  scaleTo?: number;
  haptics?: "selection" | "light";
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const { outer, inner } = useMemo(() => splitLayoutStyle(style), [style]);

  return (
    <Pressable
      {...rest}
      style={outer}
      onPress={(event) => {
        if (haptics === "selection") haptic.selection();
        else if (haptics === "light") haptic.light();
        onPress?.(event);
      }}
      onPressIn={(event) => {
        animate(scaleTo);
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        rest.onPressOut?.(event);
      }}
    >
      {({ pressed }) => (
        <Animated.View style={[inner, { transform: [{ scale }], opacity: pressed ? 0.72 : 1 }]}>
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Status bar scrim
// ---------------------------------------------------------------------------

/**
 * Screens hide the navigation header, so scrolled content would run under the
 * clock. This band keeps the status bar legible; place it after the scroll view.
 */
export function StatusBarScrim() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: insets.top,
        backgroundColor: colors.bgPrimary,
        opacity: 0.94,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  right,
}: {
  title: string;
  eyebrow?: string | null;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.screenHeader}>
      <View style={{ flex: 1, gap: 2 }}>
        {eyebrow ? <Text style={[Type.overline, { color: colors.textMuted }]}>{trUpper(eyebrow)}</Text> : null}
        <Text style={[Type.largeTitle, { color: colors.textPrimary }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text style={[Type.footnote, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  style,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.sectionHeader, style]}>
      <Text style={[Type.headline, { color: colors.textPrimary }]} accessibilityRole="header">
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Touchable onPress={onAction} accessibilityRole="button" hitSlop={8} style={styles.sectionAction}>
          <Text style={{ color: colors.accent, fontSize: FontSize.sm, fontWeight: "500" }}>{actionLabel}</Text>
          <Icon name="chevron.right" size={11} color={colors.accent} weight="semibold" />
        </Touchable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function IconButton({
  icon,
  onPress,
  label,
  tint,
  variant = "filled",
  size = 36,
  badge,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  tint?: string;
  variant?: "filled" | "plain" | "accent";
  size?: number;
  badge?: number;
}) {
  const colors = useThemeColors();
  const bg = variant === "filled" ? colors.fill : variant === "accent" ? colors.accentLight : "transparent";
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={[styles.iconButton, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} color={tint ?? colors.accent} weight="semibold" />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: colors.accent, borderColor: colors.bgPrimary }]}>
          <Text style={{ color: colors.onAccent, fontSize: 10, fontWeight: "700" }}>{badge}</Text>
        </View>
      ) : null}
    </Touchable>
  );
}

export function PillButton({
  label,
  icon,
  onPress,
  variant = "tinted",
  accessibilityLabel,
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  variant?: "tinted" | "filled" | "plain";
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const bg = variant === "filled" ? colors.accent : variant === "tinted" ? colors.accentLight : colors.fill;
  const fg = variant === "filled" ? colors.onAccent : variant === "tinted" ? colors.accent : colors.textPrimary;
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={[styles.pillButton, { backgroundColor: bg, opacity: disabled ? 0.45 : 1 }]}
    >
      {icon ? <Icon name={icon} size={13} color={fg} weight="semibold" /> : null}
      <Text style={{ color: fg, fontSize: FontSize.sm, fontWeight: "600" }}>{label}</Text>
    </Touchable>
  );
}

export function SearchTrigger({ placeholder, onPress }: { placeholder: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Touchable
      onPress={onPress}
      scaleTo={0.99}
      accessibilityRole="search"
      accessibilityLabel={placeholder}
      style={[styles.searchTrigger, { backgroundColor: colors.fill }]}
    >
      <Icon name="magnifyingglass" size={15} color={colors.textMuted} weight="semibold" />
      <Text style={{ color: colors.textMuted, fontSize: FontSize.md, flex: 1 }} numberOfLines={1}>
        {placeholder}
      </Text>
    </Touchable>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (animated thumb)
// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
}) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const anim = useRef(new Animated.Value(index)).current;
  const pad = 2;
  const segW = width > 0 ? (width - pad * 2) / options.length : 0;

  useEffect(() => {
    Animated.spring(anim, { toValue: index, useNativeDriver: true, speed: 22, bounciness: 0 }).start();
  }, [anim, index]);

  const height = size === "sm" ? 30 : 34;

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.segTrack, { backgroundColor: colors.fill, height, padding: pad }]}
      accessibilityRole="tablist"
    >
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segThumb,
            {
              width: segW,
              height: height - pad * 2,
              backgroundColor: colors.elevated,
              transform: [{ translateX: Animated.multiply(anim, segW) }],
            },
          ]}
        />
      ) : null}
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            style={styles.segItem}
            onPress={() => {
              if (!active) {
                haptic.selection();
                onChange(opt.id);
              }
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: active ? colors.textPrimary : colors.textSecondary,
                fontSize: size === "sm" ? FontSize.xs : FontSize.sm,
                fontWeight: active ? "600" : "500",
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function Chip({
  label,
  active = false,
  onPress,
  icon,
  removable = false,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: IconName;
  removable?: boolean;
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  const fg = active ? colors.accent : colors.textSecondary;
  return (
    <Touchable
      onPress={onPress}
      haptics="selection"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (removable ? `${label} filtresini kaldır` : label)}
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.accentLight : colors.bgCard,
          borderColor: active ? "transparent" : colors.border,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={12} color={fg} weight="semibold" /> : null}
      <Text style={{ color: fg, fontSize: FontSize.xs, fontWeight: active ? "600" : "500" }} numberOfLines={1}>
        {label}
      </Text>
      {removable ? <Icon name="xmark" size={9} color={fg} weight="bold" /> : null}
    </Touchable>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function changeTone(value: number | null | undefined, colors: ThemeColors) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { fg: colors.textMuted, bg: colors.fill };
  }
  if (value > 0.005) return { fg: colors.up, bg: colors.upSoft };
  if (value < -0.005) return { fg: colors.down, bg: colors.downSoft };
  return { fg: colors.textSecondary, bg: colors.fill };
}

export function ChangePill({
  value,
  decimals = 2,
  size = "md",
  style,
}: {
  value: number | null | undefined;
  decimals?: number;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const tone = changeTone(value, colors);
  return (
    <View
      style={[
        styles.changePill,
        size === "sm" ? styles.changePillSm : null,
        { backgroundColor: tone.bg },
        style,
      ]}
    >
      <Text
        style={[
          Type.number,
          { color: tone.fg, fontSize: size === "sm" ? 11 : FontSize.sm, fontWeight: "600" },
        ]}
        numberOfLines={1}
      >
        {formatSignedPercent(value ?? null, decimals)}
      </Text>
    </View>
  );
}

/** Small trend line drawn with rotated views (no SVG dependency). */
export function Sparkline({
  values,
  width = 64,
  height = 24,
  color,
  strokeWidth = 1.5,
}: {
  values: ReadonlyArray<number | null>;
  width?: number;
  height?: number;
  color: string;
  strokeWidth?: number;
}) {
  const segments = useMemo(() => {
    const domain = computeYDomain([values]);
    if (!domain) return [];
    return buildLineSegments(values, domain, width, height, strokeWidth);
  }, [height, strokeWidth, values, width]);

  return (
    <View style={{ width, height }} pointerEvents="none">
      {segments.map((seg) => (
        <View
          key={seg.key}
          style={{
            position: "absolute",
            left: seg.left,
            top: seg.top,
            width: seg.width,
            height: strokeWidth,
            borderRadius: strokeWidth,
            backgroundColor: color,
            transform: [{ rotate: `${seg.angleRad}rad` }],
          }}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Inset grouped list
// ---------------------------------------------------------------------------

export function Card({ children, style, padded = true }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const colors = useThemeColors();
  return (
    <View
      style={[
        styles.card,
        padded ? styles.cardPadded : null,
        { backgroundColor: colors.bgCard, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  showChevron = false,
  isLast = false,
  accessibilityLabel,
  titleStyle,
  onLongPress,
  onPressOut,
}: {
  title: string;
  subtitle?: string | null;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Quick actions or drag lift. */
  onLongPress?: () => void;
  onPressOut?: () => void;
  showChevron?: boolean;
  isLast?: boolean;
  accessibilityLabel?: string;
  titleStyle?: StyleProp<TextStyle>;
}) {
  const colors = useThemeColors();
  const body = (
    <View style={styles.listRow}>
      {leading}
      <View
        style={[
          styles.listRowBody,
          !isLast ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator } : null,
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[{ color: colors.textPrimary, fontSize: FontSize.md, fontWeight: "600" }, titleStyle]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing}
        {showChevron ? <Icon name="chevron.right" size={12} color={colors.textMuted} weight="semibold" /> : null}
      </View>
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.pressed : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function Skeleton({ width, height = 12, radius = 6, style }: { width: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.fill, opacity: pulse }, style]}
    />
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Yükleniyor">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="38%" height={12} />
            <Skeleton width="62%" height={10} />
          </View>
          <Skeleton width={62} height={22} radius={7} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingBottom: 2 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
  },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 3 },
  iconButton: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  pillButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: BorderRadius.full,
  },
  searchTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 38,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  segTrack: { flexDirection: "row", borderRadius: 9 },
  segThumb: {
    position: "absolute",
    top: 2,
    left: 2,
    borderRadius: 7,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segItem: { flex: 1, alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  changePill: {
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    alignItems: "flex-end",
  },
  changePillSm: { minWidth: 58, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  card: { borderRadius: BorderRadius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardPadded: { padding: Spacing.lg },
  listRow: { flexDirection: "row", alignItems: "center", paddingLeft: Spacing.lg, gap: Spacing.md },
  listRowBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 11,
    paddingRight: Spacing.lg,
    minHeight: 56,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
});
