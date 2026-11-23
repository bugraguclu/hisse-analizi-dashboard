import React, { createContext, useContext, useMemo } from "react";
import { Easing, type TextStyle, useColorScheme } from "react-native";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  accentLight: string;
  up: string;
  down: string;
  warn: string;
  /** Inset list dividers; lighter than card borders. */
  separator: string;
  /** Neutral fill for segmented tracks, chips and icon wells. */
  fill: string;
  /** Pressed/selected overlay on cards and rows. */
  pressed: string;
  upSoft: string;
  downSoft: string;
  warnSoft: string;
  /** Text and icons placed on top of `accent`. */
  onAccent: string;
  /** Raised surface inside a card (segment thumb, popovers). */
  elevated: string;
}

export const LightColors: ThemeColors = {
  bgPrimary: "#f4f3ef",
  bgSecondary: "#ecebe6",
  bgCard: "#ffffff",
  textPrimary: "#1b1a18",
  textSecondary: "#45423d",
  textMuted: "#6f6b63",
  border: "#e2dfd7",
  accent: "#2557a7",
  accentLight: "rgba(37, 87, 167, 0.10)",
  up: "#147a45",
  down: "#c4302a",
  warn: "#9a6312",
  separator: "#ebe8e1",
  fill: "rgba(118, 112, 100, 0.12)",
  pressed: "rgba(27, 26, 24, 0.05)",
  upSoft: "rgba(20, 122, 69, 0.10)",
  downSoft: "rgba(196, 48, 42, 0.09)",
  warnSoft: "rgba(154, 99, 18, 0.10)",
  onAccent: "#ffffff",
  elevated: "#ffffff",
};

export const DarkColors: ThemeColors = {
  bgPrimary: "#0b0b0b",
  bgSecondary: "#1c1c1d",
  bgCard: "#161617",
  textPrimary: "#eeece6",
  textSecondary: "#c7c3ba",
  textMuted: "#9a958c",
  border: "#2a2a2c",
  accent: "#6ea3f7",
  accentLight: "rgba(110, 163, 247, 0.15)",
  up: "#42c77d",
  down: "#f0645c",
  warn: "#e2a93b",
  separator: "#242426",
  fill: "rgba(150, 146, 138, 0.16)",
  pressed: "rgba(255, 255, 255, 0.06)",
  upSoft: "rgba(66, 199, 125, 0.14)",
  downSoft: "rgba(240, 100, 92, 0.14)",
  warnSoft: "rgba(226, 169, 59, 0.14)",
  onAccent: "#0b1830",
  elevated: "#3a3a3e",
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const FontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 21,
} as const;

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

/**
 * iOS-aligned type ramp. Numbers use tabular figures wherever values line up in
 * columns so prices do not jitter while they refresh.
 */
export const Type = {
  largeTitle: { fontSize: 32, fontWeight: "700", letterSpacing: 0.2 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: 0.1 },
  headline: { fontSize: FontSize.lg, fontWeight: "600" },
  body: { fontSize: FontSize.md, fontWeight: "400" },
  callout: { fontSize: FontSize.sm, fontWeight: "500" },
  footnote: { fontSize: FontSize.xs, fontWeight: "400" },
  caption: { fontSize: 11, fontWeight: "500" },
  /** Callers upper-case the text with `trUpper` (Turkish dotted İ). */
  overline: { fontSize: 11, fontWeight: "600", letterSpacing: 0.8 },
  number: { fontVariant: ["tabular-nums"] },
} as const satisfies Record<string, TextStyle>;

export const MotionEasing = {
  out: Easing.bezier(0.22, 1, 0.36, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
} as const;

export const MotionSpring = {
  snap: { tension: 260, friction: 26 },
} as const;

interface ThemeContextValue {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: DarkColors,
  isDark: true,
});

export function ThemeColorsProvider({ mode, children }: { mode: ThemeMode; children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const isDark = mode === "system" ? systemScheme !== "light" : mode === "dark";
  const value = useMemo<ThemeContextValue>(
    () => ({ colors: isDark ? DarkColors : LightColors, isDark }),
    [isDark],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

export function useIsDarkTheme(): boolean {
  return useContext(ThemeContext).isDark;
}
