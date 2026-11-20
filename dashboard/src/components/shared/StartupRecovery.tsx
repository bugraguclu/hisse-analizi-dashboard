"use client";

import { useEffect, useSyncExternalStore } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/locale-context";
import {
  clearPendingAssetRecovery,
  getPendingAssetRecovery,
  initializeStartupRecovery,
  subscribeAssetRecovery,
  type AssetRecoveryNotice,
} from "@/lib/startup-recovery";

const getServerSnapshot = (): AssetRecoveryNotice | null => null;

function subscribe(onStoreChange: () => void): () => void {
  return subscribeAssetRecovery(() => onStoreChange());
}

/**
 * Synchronizes with the pre-hydration startup recovery script and surfaces a
 * calm, user-controlled reload banner whenever a stale chunk/CSS load fails
 * after interaction or while the automatic reload cooldown is active.
 */
export function StartupRecovery() {
  const { t } = useLocale();
  const notice = useSyncExternalStore(subscribe, getPendingAssetRecovery, getServerSnapshot);

  useEffect(() => {
    initializeStartupRecovery();
  }, []);

  if (!notice) return null;

  return (
    <div
      role="alert"
      className="border-b border-destructive/30 bg-card px-4 py-3 text-card-foreground md:px-6"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 border-l-2 border-destructive pl-3">
          <p className="text-[13px] font-semibold text-foreground">{t("recovery.title")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t("recovery.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden="true" />
            {t("recovery.reload")}
          </Button>
          <button
            type="button"
            onClick={() => clearPendingAssetRecovery()}
            aria-label={t("recovery.dismiss")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
