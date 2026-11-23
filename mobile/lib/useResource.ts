/**
 * React hook wrapping `RequestGuard`, `ResourceState`, snapshot caching, and
 * `AppState` foreground revalidation so every screen gets:
 *  - distinct loading / ready / empty / stale / error states,
 *  - zero cross-key race overwrites on rapid ticker/period/filter switches,
 *  - consistent refresh on pull-to-refresh and app foreground resume.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { snapshotCache } from "./cache";
import {
  applyCachedSnapshot,
  applyFetchError,
  applyFetchStart,
  applyFetchSuccess,
  describeApiFailure,
  initialResourceState,
  isAbortError,
  RequestGuard,
  type ResourceState,
} from "./requestState";

export interface UseResourceOptions<T> {
  /** Stable logical key; changing `key` clears previous key's data immediately and aborts in-flight calls. */
  key: string;
  /** Optional AsyncStorage cache key for stale-fallback rendering on network outage. */
  cacheKey?: string;
  /** Disabled when false (lazy tab loading). */
  enabled?: boolean;
  /** Predicate deciding whether a successful payload represents an empty result set. */
  isEmpty?: (data: T) => boolean;
  /** Revalidate when returning from background after at least `foregroundStaleMs`. */
  revalidateOnForeground?: boolean;
  foregroundStaleMs?: number;
  fetcher: (signal: AbortSignal) => Promise<T>;
}

export interface UseResourceResult<T> extends ResourceState<T> {
  reload: () => void;
}

export function useResource<T>(options: UseResourceOptions<T>): UseResourceResult<T> {
  const {
    key,
    cacheKey,
    enabled = true,
    isEmpty,
    revalidateOnForeground = true,
    foregroundStaleMs = 60_000,
    fetcher,
  } = options;

  const [state, setState] = useState<ResourceState<T>>(() => initialResourceState<T>(key));
  const guardRef = useRef(new RequestGuard());
  const fetcherRef = useRef(fetcher);
  const isEmptyRef = useRef(isEmpty);
  const lastFetchedMsRef = useRef<number>(0);

  fetcherRef.current = fetcher;
  isEmptyRef.current = isEmpty;

  const runFetch = useCallback(
    (targetKey: string, targetCacheKey: string | undefined, readCache: boolean) => {
      const { token, signal } = guardRef.current.begin(targetKey);
      setState((prev) => applyFetchStart(prev, targetKey));

      if (readCache && targetCacheKey) {
        void snapshotCache.read<T>(targetCacheKey).then((entry) => {
          if (!entry || !guardRef.current.isCurrent(token, targetKey)) return;
          setState((prev) =>
            applyCachedSnapshot(prev, targetKey, entry.data, entry.savedAt, isEmptyRef.current),
          );
        });
      }

      void fetcherRef
        .current(signal)
        .then((data) => {
          if (!guardRef.current.isCurrent(token, targetKey)) return;
          const nowIso = new Date().toISOString();
          lastFetchedMsRef.current = Date.now();
          setState((prev) => applyFetchSuccess(prev, targetKey, data, nowIso, isEmptyRef.current));
          if (targetCacheKey) {
            void snapshotCache.write(targetCacheKey, data, nowIso);
          }
        })
        .catch((error) => {
          if (isAbortError(error) || !guardRef.current.isCurrent(token, targetKey)) return;
          const { message, status } = describeApiFailure(error);
          setState((prev) => applyFetchError(prev, targetKey, message, status));
        });
    },
    [],
  );

  useEffect(() => {
    if (!enabled) {
      guardRef.current.cancel();
      return;
    }
    runFetch(key, cacheKey, true);
    const guard = guardRef.current;
    return () => {
      guard.cancel();
    };
  }, [cacheKey, enabled, key, runFetch]);

  useEffect(() => {
    if (!enabled || !revalidateOnForeground) return;
    let lastAppState: string = AppState.currentState ?? "active";
    const sub = AppState.addEventListener("change", (nextState) => {
      const cameToForeground =
        (lastAppState === "background" || lastAppState === "inactive") && nextState === "active";
      lastAppState = nextState;
      if (cameToForeground && Date.now() - lastFetchedMsRef.current >= foregroundStaleMs) {
        runFetch(key, cacheKey, false);
      }
    });
    return () => sub.remove();
  }, [cacheKey, enabled, foregroundStaleMs, key, revalidateOnForeground, runFetch]);

  const reload = useCallback(() => {
    if (!enabled) return;
    runFetch(key, cacheKey, false);
  }, [cacheKey, enabled, key, runFetch]);

  return { ...state, reload };
}
