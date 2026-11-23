import React, { createContext, useContext, useMemo } from "react";
import { Easing, useColorScheme } from "react-native";

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
}

export const LightColors: ThemeColors = {
  bgPrimary: "#f7f6f3",
  bgSecondary: "#efede8",
  bgCard: "#fdfcfa",
  textPrimary: "#1d1c1a",
  textSecondary: "#45423d",
  textMuted: "#6f6b63",
  border: "#e3e0d8",
  accent: "#2557a7",
  accentLight: "rgba(37, 87, 167, 0.12)",
  up: "#16804a",
  down: "#c8322b",
  warn: "#9a6312",
};

export const DarkColors: ThemeColors = {
  bgPrimary: "#0e0e0e",
  bgSecondary: "#1a1a1a",
  bgCard: "#161616",
  textPrimary: "#eceae4",
  textSecondary: "#c7c3ba",
  textMuted: "#969188",
  border: "#2b2b2b",
  accent: "#6ea3f7",
  accentLight: "rgba(110, 163, 247, 0.16)",
  up: "#42c77d",
  down: "#eb5f57",
  warn: "#e2a93b",
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
  md: 8,
  lg: 12,
  xl: 18,
  full: 999,
} as const;

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
