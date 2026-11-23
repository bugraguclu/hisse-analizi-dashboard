"use client";

import { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useShell } from "@/components/layout/shell-context";
import { useOnlineStatus } from "@/hooks/use-network-status";
import { useLocale } from "@/lib/locale-context";

const PAGES_CACHE_PREFIX = "hisse-pages-";
/** The service worker answers an unsaved page with this view under the requested URL. */
function readRequestedPath(): string | null {
  const path = window.location.pathname + window.location.search;
  return window.location.pathname === "/offline" ? null : path;
}

async function listSavedPages(): Promise<string[] | null> {
  if (typeof caches === "undefined") return null;
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(PAGES_CACHE_PREFIX));
    const paths = new Set<string>();
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.pathname !== "/offline") paths.add(url.pathname + url.search);
      }
    }
    return [...paths].sort((a, b) => a.localeCompare(b, "tr"));
  } catch {
    return null;
  }
}

export function OfflineView() {
  const { t } = useLocale();
  const online = useOnlineStatus();
  const { openWorkspaceManager } = useShell();
  const [requested, setRequested] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const path = readRequestedPath();
    void listSavedPages().then((pages) => {
      if (cancelled) return;
      setRequested(path);
      setSaved(pages);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mx-auto max-w-7xl py-10 md:py-16" aria-labelledby="offline-title">
      <div className="max-w-xl">
        <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
          {/* Served by the worker = the server was unreachable, even if the OS reports a network. */}
          {online && !requested ? t("offline.statusOnline") : t("offline.statusOffline")}
        </p>
        <h1 id="offline-title" className="mt-2 text-[32px] font-semibold leading-tight text-foreground">
          {t("pwa.offlineTitle")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {online && !requested ? t("pwa.offlineOnlineIntro") : t("pwa.offlineIntro")}
        </p>
        {requested ? (
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{t("pwa.offlineRequested", { path: requested })}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => window.location.assign(requested ?? "/")}
            className={buttonVariants({ variant: "default" })}
          >
            <RefreshCw aria-hidden="true" /> {t("pwa.offlineRetry")}
          </button>
          <button type="button" onClick={() => openWorkspaceManager("offline")} className={buttonVariants({ variant: "outline" })}>
            {t("offline.openSummary")}
          </button>
        </div>

        <h2 className="mt-10 text-sm font-semibold text-foreground">{t("pwa.offlineSaved")}</h2>
        {saved === undefined ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : saved === null ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("pwa.offlineSavedUnknown")}</p>
        ) : saved.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("pwa.offlineSavedNone")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {saved.map((path) => (
              <li key={path}>
                {/* A full navigation, so the service worker answers from its page cache. */}
                <a
                  href={path}
                  className="block break-all py-2 font-mono text-[13px] text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {path}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
