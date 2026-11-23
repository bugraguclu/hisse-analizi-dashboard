import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { moveItem } from "../lib/reorder";
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
  /** `atIndex` restores a removed ticker to its old slot (undo). */
  addTickerToWatchlist: (ticker: string, listId?: string, atIndex?: number) => void;
  removeTickerFromWatchlist: (ticker: string, listId?: string) => void;
  /** Drag-to-reorder: moves the ticker at `from` to `to`. */
  moveTickerInWatchlist: (from: number, to: number, listId?: string) => void;
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
    (rawTicker: string, listId = "default", atIndex?: number) => {
      const ticker = rawTicker.trim().toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(ticker)) return;
      persist((prev) => ({
        ...prev,
        watchlists: prev.watchlists.map((list) => {
          if (list.id !== listId || list.tickers.includes(ticker)) return list;
          const next = [...list.tickers];
          const slot = atIndex === undefined ? next.length : Math.max(0, Math.min(atIndex, next.length));
          next.splice(slot, 0, ticker);
          return { ...list, tickers: next.slice(0, 40) };
        }),
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

  const moveTickerInWatchlist = useCallback(
    (from: number, to: number, listId = "default") => {
      persist((prev) => ({
        ...prev,
        watchlists: prev.watchlists.map((list) =>
          list.id === listId ? { ...list, tickers: moveItem(list.tickers, from, to) } : list,
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
      moveTickerInWatchlist,
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
      moveTickerInWatchlist,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside AppProvider.");
  return ctx;
}
