import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { observeStartupRun, StartupCoordinator, type StartupState } from "../lib/startupCoordinator";
import {
  DEFAULT_LOCAL_STATE,
  loadLocalState,
  saveLocalState,
  type LocalAppState,
  type LocalSettings,
  type LocalWatchlist,
} from "../lib/storage";

const STARTUP_TIMEOUT_MS = 6000;

/** Process-wide singleton: prevents concurrent local migrations across retries or remounts. */
const startupCoordinator = new StartupCoordinator();

export type StartupIssue =
  | { kind: "timeout"; message: string }
  | { kind: "failure"; message: string };

interface AppContextValue {
  isLoading: boolean;
  startupState: StartupState;
  startupIssue: StartupIssue | null;
  retryStartup: () => void;
  settings: LocalSettings;
  watchlists: LocalWatchlist[];
  updateSettings: (patch: Partial<LocalSettings>) => void;
  addTickerToWatchlist: (ticker: string, listId?: string) => void;
  removeTickerFromWatchlist: (ticker: string, listId?: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LocalAppState>(DEFAULT_LOCAL_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedStateRef = useRef<LocalAppState>(DEFAULT_LOCAL_STATE);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setStartupIssue(null);

    const run = startupCoordinator.start(async () => {
      loadedStateRef.current = await loadLocalState();
    });

    void observeStartupRun(run, STARTUP_TIMEOUT_MS).then((observation) => {
      if (!active) return;
      if (observation.kind === "success") {
        setState(loadedStateRef.current);
        setStartupIssue(null);
        setIsLoading(false);
      } else if (observation.kind === "timeout") {
        setStartupIssue({
          kind: "timeout",
          message: "Yerel veriler beklenenden uzun sürdü. Mevcut işlem arka planda devam ediyor.",
        });
        setIsLoading(false);
      } else {
        const message =
          observation.error instanceof Error
            ? observation.error.message
            : "Yerel çalışma alanı başlatılamadı.";
        setStartupIssue({ kind: "failure", message });
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [attempt]);

  const retryStartup = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const persist = useCallback((updater: (prev: LocalAppState) => LocalAppState) => {
    setState((prev) => {
      const next = updater(prev);
      void saveLocalState(next).catch((error) => {
        console.warn("[Storage] save failed:", error);
      });
      return next;
    });
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<LocalSettings>) => {
      persist((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...patch },
      }));
    },
    [persist],
  );

  const addTickerToWatchlist = useCallback(
    (rawTicker: string, listId = "default") => {
      const ticker = rawTicker.trim().toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(ticker)) return;
      persist((prev) => ({
        ...prev,
        watchlists: prev.watchlists.map((list) =>
          list.id === listId && !list.tickers.includes(ticker)
            ? { ...list, tickers: [...list.tickers, ticker].slice(0, 40) }
            : list,
        ),
      }));
    },
    [persist],
  );

  const removeTickerFromWatchlist = useCallback(
    (rawTicker: string, listId = "default") => {
      const ticker = rawTicker.trim().toUpperCase();
      persist((prev) => ({
        ...prev,
        watchlists: prev.watchlists.map((list) =>
          list.id === listId
            ? { ...list, tickers: list.tickers.filter((item) => item !== ticker) }
            : list,
        ),
      }));
    },
    [persist],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      isLoading,
      startupState: startupCoordinator.state,
      startupIssue,
      retryStartup,
      settings: state.settings,
      watchlists: state.watchlists,
      updateSettings,
      addTickerToWatchlist,
      removeTickerFromWatchlist,
    }),
    [
      isLoading,
      startupIssue,
      retryStartup,
      state.settings,
      state.watchlists,
      updateSettings,
      addTickerToWatchlist,
      removeTickerFromWatchlist,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider.");
  return ctx;
}
