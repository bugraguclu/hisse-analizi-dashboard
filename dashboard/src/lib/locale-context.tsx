"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  LOCALE_COOKIE,
  parseLocale,
  t as translate,
  type Locale,
  type TranslationKey,
  type TranslationVars,
} from "./i18n";
import { setFormatLocale } from "./format";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
}

const DEFAULT_LOCALE: Locale = "tr";
const STORAGE_KEY = "locale";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, vars) => translate(key, DEFAULT_LOCALE, vars),
});

const localeListeners = new Set<() => void>();

function readCookieLocale(): Locale | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
  return parseLocale(match ? decodeURIComponent(match[1]) : null);
}

function readStorageLocale(): Locale | null {
  try {
    return parseLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** The cookie is the source of truth (the server reads it too); localStorage is the legacy fallback. */
function readClientLocale(): Locale {
  return readCookieLocale() ?? readStorageLocale() ?? DEFAULT_LOCALE;
}

function persistLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage disabled — the cookie alone is enough.
  }
}

function subscribeToLocale(onStoreChange: () => void) {
  localeListeners.add(onStoreChange);
  // Another tab switched language: it already rewrote the shared cookie.
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    localeListeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  /** Locale the server rendered with (from the `locale` cookie). */
  initialLocale?: Locale;
}) {
  const locale = useSyncExternalStore(subscribeToLocale, readClientLocale, () => initialLocale);

  // lib/format.ts formatters read a module-level locale; update it before the
  // children render so numbers/dates follow the UI language in the same pass.
  setFormatLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    // Migrate localStorage-only preferences so the next SSR uses them too.
    if (readCookieLocale() !== locale) persistLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    persistLocale(next);
    localeListeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key, vars) => translate(key, locale, vars) }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}
