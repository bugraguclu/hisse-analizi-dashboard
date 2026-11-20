import React from "react";
import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { useThemeColors } from "../../lib/theme";

export default function TabsLayout() {
  const colors = useThemeColors();

  return (
    <Tabs
      initialRouteName="markets"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        sceneStyle: {
          backgroundColor: colors.bgPrimary,
        },
      }}
    >
      <Tabs.Screen name="markets" options={{ title: "Piyasa" }} />
      <Tabs.Screen name="watchlists" options={{ title: "Takip" }} />
      <Tabs.Screen name="tarama" options={{ title: "Tarama" }} />
      <Tabs.Screen name="events" options={{ title: "Takvim" }} />
    </Tabs>
  );
}
