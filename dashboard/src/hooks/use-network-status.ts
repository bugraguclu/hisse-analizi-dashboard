"use client";

import { useSyncExternalStore } from "react";
import {
  OFFLINE_SUMMARY_EVENT,
  OFFLINE_SUMMARY_STORAGE_KEY,
  parseOfflineSummary,
  type OfflineMarketSummary,
} from "@/lib/local-store/offline-cache";

// ---------------------------------------------------------------------------
// Browser online/offline status (hydration-safe)
// ---------------------------------------------------------------------------

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);
}

// ---------------------------------------------------------------------------
// API reachability tracker (catches unreachable server even when navigator.onLine is true)
// ---------------------------------------------------------------------------

let apiReachable = true;
const reachabilityListeners = new Set<() => void>();

export function reportApiReachability(reachable: boolean): void {
  if (apiReachable === reachable) return;
  apiReachable = reachable;
  reachabilityListeners.forEach((listener) => listener());
}

function subscribeReachability(listener: () => void): () => void {
  reachabilityListeners.add(listener);
  return () => {
    reachabilityListeners.delete(listener);
  };
}

export function useApiReachable(): boolean {
  return useSyncExternalStore(subscribeReachability, () => apiReachable, () => true);
}

/** True when either the browser is offline or recent market API requests failed to reach the server. */
export function useIsDisconnected(): boolean {
  const online = useOnlineStatus();
  const reachable = useApiReachable();
  return !online || !reachable;
}

// ---------------------------------------------------------------------------
// Reactive persistent offline summary store (hydration-safe)
// ---------------------------------------------------------------------------

let cachedRaw: string | null | undefined;
let cachedSummary: OfflineMarketSummary | null = null;

function readRawSummary(): string | null {
  try {
    return window.localStorage.getItem(OFFLINE_SUMMARY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSummarySnapshot(): OfflineMarketSummary | null {
  const raw = readRawSummary();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSummary = parseOfflineSummary(raw);
  }
  return cachedSummary;
}

function subscribeSummary(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === OFFLINE_SUMMARY_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(OFFLINE_SUMMARY_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(OFFLINE_SUMMARY_EVENT, listener);
  };
}

export function useOfflineSummary(): OfflineMarketSummary | null {
  return useSyncExternalStore(subscribeSummary, getSummarySnapshot, () => null);
}
