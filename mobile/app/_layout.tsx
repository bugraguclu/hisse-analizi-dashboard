import React, { useEffect, useState } from "react";
import { Stack, router as globalRouter, usePathname, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Notifications from "expo-notifications";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Appearance,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import StartupIssueScreen from "../components/StartupIssueScreen";
import { AppProvider, useAppContext } from "../contexts/AppContext";
import { describeLinkRejection } from "../lib/externalLinking";
import { attachIncomingUrlHandler, incomingUrlNavigation, receiveIncomingUrl, startIncomingUrls } from "../lib/incomingUrl";
import { companion } from "../lib/companion";
import {
  BorderRadius,
  DarkColors,
  FontSize,
  Spacing,
  ThemeColorsProvider,
  useIsDarkTheme,
  useThemeColors,
} from "../lib/theme";

// Hold the native splash until a real surface is ready (TusAnkiM pattern).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ duration: 250, fade: true });

// Subscribe once at module load so launch/incoming URLs wait in the queue until startup succeeds.
if (Platform.OS !== "web") {
  startIncomingUrls(Linking);
  Notifications.setNotificationHandler({ handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }) });
  const notificationLinks = new Set<string>();
  const acceptNotification = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    const url = response.notification.request.content.data?.deepLink;
    if (typeof url !== "string" || notificationLinks.has(id)) return;
    notificationLinks.add(id);
    receiveIncomingUrl(url);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  };
  Notifications.addNotificationResponseReceivedListener(acceptNotification);
  void Notifications.getLastNotificationResponseAsync().then((response) => { if (response) acceptNotification(response); }).catch(() => undefined);
}

const SPLASH_GRACE_MS = 1500;

function hideSplash(): void {
  void SplashScreen.hideAsync().catch(() => undefined);
}

function useSplashHandoff(ready: boolean): boolean {
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setGraceElapsed(true), SPLASH_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  const released = ready || graceElapsed;
  useEffect(() => {
    if (released) hideSplash();
  }, [released]);

  return released;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; componentStack: string }
> {
  state = { hasError: false, message: "", componentStack: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info);
    hideSplash();
    if (info.componentStack) {
      this.setState({ componentStack: info.componentStack });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          message={this.state.message}
          componentStack={this.state.componentStack}
          onRetry={() => this.setState({ hasError: false, message: "", componentStack: "" })}
        />
      );
    }
    return this.props.children;
  }
}

function ErrorFallback({
  message,
  componentStack,
  onRetry,
}: {
  message: string;
  componentStack: string;
  onRetry: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleReturnHome = () => {
    try {
      globalRouter.dismissAll();
    } catch {
      // No modal stack above tabs.
    }
    try {
      globalRouter.dismissTo("/(tabs)/markets" as never);
    } catch {
      // Navigator not ready yet; clearing boundary is sufficient.
    }
    onRetry();
  };

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(
        `[Hisse Analizi Error]\nMessage: ${message}\nStack: ${componentStack || "N/A"}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore clipboard failures.
    }
  };

  return (
    <View
      style={[
        styles.center,
        {
          backgroundColor: DarkColors.bgPrimary,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        },
      ]}
    >
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Beklenmeyen bir hata oluştu</Text>
        <Text style={styles.errorMessage}>
          Uygulama güvenli biçimde kurtarılabilir. Tekrar deneyin veya Piyasalar ekranına dönün.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.primaryButtonText}>Tekrar dene</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleReturnHome}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Piyasalara dön</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.detailsToggle}
          onPress={() => setShowDetails((prev) => !prev)}
          accessibilityRole="button"
        >
          <Text style={styles.detailsToggleText}>
            {showDetails ? "Teknik detayları gizle" : "Teknik detayları göster"}
          </Text>
        </TouchableOpacity>
        {showDetails ? (
          <View style={styles.detailsBox}>
            <ScrollView style={{ maxHeight: 140 }}>
              <Text style={styles.detailsText} selectable>
                {message}
                {componentStack ? `\n\n${componentStack}` : ""}
              </Text>
            </ScrollView>
            <TouchableOpacity style={styles.copyButton} onPress={handleCopy} accessibilityRole="button">
              <Text style={styles.copyButtonText}>{copied ? "Kopyalandı" : "Hata detayını kopyala"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function StartupProgress() {
  const colors = useThemeColors();
  return (
    <View style={[styles.center, { backgroundColor: colors.bgPrimary }]}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={{ color: colors.textMuted, marginTop: Spacing.lg, fontSize: FontSize.md }}>
        Çalışma alanı hazırlanıyor…
      </Text>
    </View>
  );
}

function ThemeGate({ children }: { children: React.ReactNode }) {
  const { settings } = useAppContext();

  useEffect(() => {
    if (Platform.OS === "web") return;
    Appearance.setColorScheme(settings.themeMode === "system" ? "unspecified" : settings.themeMode);
  }, [settings.themeMode]);

  return <ThemeColorsProvider mode={settings.themeMode}>{children}</ThemeColorsProvider>;
}

function StartupGate({ children }: { children: React.ReactNode }) {
  const { isLoading, startupIssue } = useAppContext();
  const ready = !isLoading || Boolean(startupIssue);
  const splashReleased = useSplashHandoff(ready);

  if (!ready) {
    return splashReleased ? <StartupProgress /> : null;
  }
  if (startupIssue) {
    return <StartupIssueScreen />;
  }
  return <>{children}</>;
}

const formSheetOptions =
  Platform.OS === "ios"
    ? {
        presentation: "formSheet" as const,
        sheetAllowedDetents: [1],
        sheetGrabberVisible: true,
      }
    : { presentation: "modal" as const };

function AppStack() {
  const router = useRouter();
  const pathname = usePathname();
  const colors = useThemeColors();
  const isDark = useIsDarkTheme();
  const { isLoading, startupIssue } = useAppContext();
  const startupSucceeded = !isLoading && !startupIssue;

  useEffect(() => {
    if (!startupSucceeded || !companion.available) return;
    const consume = () => { void companion.consumeShortcut().then((url) => { if (url) receiveIncomingUrl(url); }).catch(() => undefined); };
    const active = () => {
      consume();
      void companion.refresh().catch(() => undefined);
    };
    const subscription = companion.subscribeShortcut(consume);
    const appState = AppState.addEventListener("change", (next) => { if (next === "active") active(); });
    active();
    return () => { subscription?.remove(); appState.remove(); };
  }, [startupSucceeded]);

  useEffect(() => {
    if (Platform.OS === "web" || !startupSucceeded) return undefined;
    return attachIncomingUrlHandler((url) => {
      const nav = incomingUrlNavigation(url, pathname);
      if (!nav) return;
      if (nav.method === "reject") {
        const { title, message } = describeLinkRejection(nav.rejection);
        Alert.alert(title, message);
        return;
      }
      const href = { pathname: nav.route.pathname, params: nav.route.params } as never;
      if (nav.route.ensureHomeUnderneath && !nav.route.isTabRoot) {
        try {
          router.dismissTo("/(tabs)/markets" as never);
        } catch {
          // Already at root.
        }
        router.push(href);
        return;
      }
      if (nav.method === "dismissTo") router.dismissTo(href);
      else if (nav.method === "replace") router.replace(href);
      else router.push(href);
    });
  }, [pathname, router, startupSucceeded]);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgPrimary },
          freezeOnBlur: true,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="companion" options={{ presentation: "card" }} />
        <Stack.Screen
          name="stock/[ticker]"
          options={{
            presentation: "card",
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="makro"
          options={{
            presentation: "card",
            gestureEnabled: true,
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            ...formSheetOptions,
            gestureEnabled: true,
            headerShown: false,
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppErrorBoundary>
        <AppProvider>
          <ThemeGate>
            <StartupGate>
              <AppStack />
            </StartupGate>
          </ThemeGate>
        </AppProvider>
      </AppErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  errorCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: DarkColors.bgCard,
    borderRadius: BorderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DarkColors.border,
    padding: Spacing.xxl,
    alignItems: "center",
  },
  errorTitle: {
    fontSize: FontSize.xl,
    fontWeight: "600",
    color: DarkColors.textPrimary,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    fontSize: FontSize.md,
    lineHeight: 22,
    color: DarkColors.textMuted,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  primaryButton: {
    width: "100%",
    backgroundColor: DarkColors.accent,
    paddingVertical: 14,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: FontSize.md,
    fontWeight: "600",
  },
  secondaryButton: {
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DarkColors.border,
    paddingVertical: 13,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: DarkColors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: "500",
  },
  detailsToggle: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  detailsToggleText: {
    color: DarkColors.textMuted,
    fontSize: FontSize.xs,
  },
  detailsBox: {
    width: "100%",
    marginTop: Spacing.md,
    backgroundColor: DarkColors.bgSecondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  detailsText: {
    color: DarkColors.textSecondary,
    fontSize: FontSize.xs,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyButton: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DarkColors.border,
    alignItems: "center",
  },
  copyButtonText: {
    color: DarkColors.accent,
    fontSize: FontSize.xs,
    fontWeight: "600",
  },
});
