"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { computeBreadth } from "@/components/dashboard/MarketBreadthCard";
import type { MarketsOut } from "@/components/makro/types";
import { reportApiReachability } from "@/hooks/use-network-status";
import { isApiError } from "@/lib/api";
import { readIdbOfflineSnapshot } from "@/lib/local-store/idb";
import {
  OFFLINE_SUMMARY_EVENT,
  OFFLINE_SUMMARY_STORAGE_KEY,
  mergeOfflineSummary,
  parseOfflineSummary,
  readOfflineSummary,
  type OfflineMarketSummary,
} from "@/lib/local-store/offline-cache";
import { migrateLocalStorage } from "@/lib/local-store/schema";
import { createBrowserStorage } from "@/lib/local-store/storage";
import type { Company, EventOut, IndicesOut, ScreenerOut, SnapshotOut } from "@/types";

function isConnectivityError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!isApiError(error)) return false;
  if (error.code === "network" || error.code === "timeout") return true;
  return error.status !== null && error.status >= 502;
}

/**
 * Background client bridge that:
 * 1. Runs lossless versioned migration on personal localStorage keys at startup.
 * 2. Restores offline market summary from IndexedDB if localStorage was cleared.
 * 3. Persists fresh market query responses into the local offline summary cache.
 * 4. Tracks API reachability and automatically refreshes active queries on reconnect.
 */
export function LocalDataBridge() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const storage = createBrowserStorage();
    if (storage) {
      migrateLocalStorage(storage);
      if (!readOfflineSummary(storage)) {
        void readIdbOfflineSnapshot<OfflineMarketSummary>("latest-market-summary").then((idbCopy) => {
          if (!idbCopy) return;
          const verified = parseOfflineSummary(JSON.stringify(idbCopy));
          if (!verified) return;
          try {
            storage.setItem(OFFLINE_SUMMARY_STORAGE_KEY, JSON.stringify(verified));
            window.dispatchEvent(new Event(OFFLINE_SUMMARY_EVENT));
          } catch {
            // Private mode / quota.
          }
        });
      }
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { query, action } = event;

      if (action.type === "error") {
        if (isConnectivityError(action.error)) {
          reportApiReachability(false);
        }
        return;
      }

      if (action.type !== "success" || query.state.status !== "success") return;
      reportApiReachability(true);

      const key = query.queryKey;
      const root = key[0];
      const data = query.state.data;
      if (!data) return;

      if (root === "indexQuotes") {
        const indices = data as IndicesOut;
        if (Array.isArray(indices.quotes) && indices.quotes.length > 0) {
          mergeOfflineSummary({ indices: { quotes: indices.quotes, source: indices.source } });
        }
        return;
      }

      if (root === "snapshot") {
        const snap = data as SnapshotOut;
        if (snap.snapshot && typeof snap.snapshot === "object") {
          mergeOfflineSummary({ snapshot: snap });
        }
        return;
      }

      if (root === "companies") {
        const companies = data as Company[];
        if (Array.isArray(companies) && companies.length > 0) {
          mergeOfflineSummary({ companies });
        }
        return;
      }

      if (root === "latestEvents") {
        const events = data as EventOut[];
        if (Array.isArray(events) && events.length > 0) {
          mergeOfflineSummary({ latestEvents: events });
        }
        return;
      }

      if (root === "macro" && key[1] === "markets") {
        const markets = data as MarketsOut;
        if (Array.isArray(markets.instruments) && markets.instruments.length > 0) {
          mergeOfflineSummary({
            macroMarkets: { instruments: markets.instruments, as_of: markets.as_of ?? null },
          });
        }
        return;
      }

      if (root === "screener" && key[1] === "dashboard-default") {
        const screener = data as ScreenerOut;
        if (Array.isArray(screener.results) && screener.results.length > 0) {
          const companies = queryClient.getQueryData<Company[]>(["companies"]);
          const breadth = computeBreadth(screener.results, companies);
          if (breadth.up + breadth.down + breadth.flat > 0) {
            mergeOfflineSummary({ breadth });
          }
        }
      }
    });

    const handleOnline = () => {
      reportApiReachability(true);
      void queryClient.invalidateQueries({ refetchType: "active" });
    };
    const handleOffline = () => {
      reportApiReachability(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient]);

  return null;
}
