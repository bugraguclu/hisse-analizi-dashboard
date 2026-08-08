"use client";

import { createContext, useContext, useSyncExternalStore, useCallback, type ReactNode } from "react";
import { type Locale, type TranslationKey, t as translate } from "./i18n";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "tr",
  setLocale: () => {},
  t: (key) => translate(key, "tr"),
});

const localeListeners = new Set<() => void>();

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "tr";
  const saved = window.localStorage.getItem("locale");
  return saved === "en" || saved === "fr" || saved === "tr" ? saved : "tr";
}

function subscribeToLocale(onStoreChange: () => void) {
  localeListeners.add(onStoreChange);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === "locale") onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    localeListeners.delete(onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribeToLocale, readStoredLocale, (): Locale => "tr");

  const setLocale = useCallback((newLocale: Locale) => {
    window.localStorage.setItem("locale", newLocale);
    localeListeners.forEach((listener) => listener());
  }, []);

  const t = useCallback(
    (key: TranslationKey) => translate(key, locale),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
