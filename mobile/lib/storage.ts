import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeMode } from "./theme";

export const LOCAL_SCHEMA_VERSION = 1;
const STORAGE_KEY = "hisse_analizi_local_state_v1";

export interface LocalWatchlist {
  id: string;
  name: string;
  tickers: string[];
}

export interface LocalSettings {
  themeMode: ThemeMode;
  locale: "tr" | "en" | "fr";
}

export interface LocalAppState {
  schemaVersion: number;
  settings: LocalSettings;
  watchlists: LocalWatchlist[];
  lastMarketSyncIso: string | null;
}

export const DEFAULT_LOCAL_STATE: LocalAppState = {
  schemaVersion: LOCAL_SCHEMA_VERSION,
  settings: {
    themeMode: "system",
    locale: "tr",
  },
  watchlists: [
    {
      id: "default",
      name: "Takip Listem",
      tickers: ["THYAO", "GARAN", "ASELS", "TUPRS", "KCHOL"],
    },
  ],
  lastMarketSyncIso: null,
};

function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isValidLocale(value: unknown): value is LocalSettings["locale"] {
  return value === "tr" || value === "en" || value === "fr";
}

/** Sanitizes persisted JSON so corrupted records recover gracefully instead of blocking launch. */
export function sanitizeLocalState(raw: unknown): LocalAppState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_LOCAL_STATE;
  }
  const data = raw as Record<string, unknown>;
  const rawSettings = (data.settings && typeof data.settings === "object"
    ? data.settings
    : {}) as Record<string, unknown>;

  const settings: LocalSettings = {
    themeMode: isValidThemeMode(rawSettings.themeMode)
      ? rawSettings.themeMode
      : DEFAULT_LOCAL_STATE.settings.themeMode,
    locale: isValidLocale(rawSettings.locale)
      ? rawSettings.locale
      : DEFAULT_LOCAL_STATE.settings.locale,
  };

  const watchlists: LocalWatchlist[] = Array.isArray(data.watchlists)
    ? data.watchlists
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item, index) => ({
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 64) : `list-${index + 1}`,
          name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 60) : "Liste",
          tickers: Array.isArray(item.tickers)
            ? Array.from(
                new Set(
                  item.tickers
                    .filter((t): t is string => typeof t === "string")
                    .map((t) => t.trim().toUpperCase())
                    .filter((t) => /^[A-Z0-9]{2,10}$/.test(t)),
                ),
              ).slice(0, 40)
            : [],
        }))
    : DEFAULT_LOCAL_STATE.watchlists;

  return {
    schemaVersion: LOCAL_SCHEMA_VERSION,
    settings,
    watchlists: watchlists.length > 0 ? watchlists : DEFAULT_LOCAL_STATE.watchlists,
    lastMarketSyncIso: typeof data.lastMarketSyncIso === "string" ? data.lastMarketSyncIso : null,
  };
}

/** Local-only startup read: never waits on network connectivity. */
export async function loadLocalState(): Promise<LocalAppState> {
  const serialized = await AsyncStorage.getItem(STORAGE_KEY);
  if (!serialized) return DEFAULT_LOCAL_STATE;
  try {
    return sanitizeLocalState(JSON.parse(serialized));
  } catch {
    return DEFAULT_LOCAL_STATE;
  }
}

export async function saveLocalState(state: LocalAppState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
