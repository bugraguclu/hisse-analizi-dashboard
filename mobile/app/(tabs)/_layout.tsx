import React from "react";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { haptic, Icon, type IconName } from "../../components/ui";
import { useThemeColors } from "../../lib/theme";

export const unstable_settings = { anchor: "markets" };

const TAB_ICONS: Record<string, { idle: IconName; active: IconName }> = {
  markets: { idle: "chart.line.uptrend.xyaxis", active: "chart.line.uptrend.xyaxis" },
  watchlists: { idle: "star", active: "star.fill" },
  tarama: { idle: "line.3.horizontal.decrease.circle", active: "line.3.horizontal.decrease.circle.fill" },
  events: { idle: "calendar", active: "calendar" },
};

export default function TabsLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      backBehavior="initialRoute"
      screenListeners={{ tabPress: () => haptic.selection() }}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        tabBarIcon: ({ color, focused }) => {
          const icon = TAB_ICONS[route.name];
          if (!icon) return null;
          return <Icon name={focused ? icon.active : icon.idle} size={22} color={color} weight="medium" />;
        },
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        sceneStyle: {
          backgroundColor: colors.bgPrimary,
        },
      })}
    >
      <Tabs.Screen name="markets" options={{ title: "Piyasa" }} />
      <Tabs.Screen name="watchlists" options={{ title: "Takip" }} />
      <Tabs.Screen name="tarama" options={{ title: "Tarama" }} />
      <Tabs.Screen name="events" options={{ title: "Takvim" }} />
    </Tabs>
  );
}
