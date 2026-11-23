"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useLocale } from "@/lib/locale-context";
import { registerServiceWorker, serviceWorkerEnabled, unregisterStaleDevWorker } from "@/lib/pwa/registration";

const UPDATE_TOAST_ID = "sw-update";
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Registers the service worker (production builds only) and offers new versions
 * without reloading behind the user's back: a waiting worker shows a persistent
 * "new version ready" toast; only its Reload action activates the worker and
 * reloads this tab. Other tabs that lose their old worker get the same prompt.
 */
export function ServiceWorkerManager() {
  const { t } = useLocale();

  useEffect(() => {
    if (!serviceWorkerEnabled()) {
      void unregisterStaleDevWorker();
      return;
    }

    let disposed = false;
    let reloadRequested = false;
    let reloading = false;
    let interval: number | undefined;
    let registration: ServiceWorkerRegistration | null = null;

    const reload = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const prompt = (onReload: () => void) => {
      if (disposed) return;
      toast(t("pwa.updateReady"), {
        id: UPDATE_TOAST_ID,
        description: t("pwa.updateDescription"),
        duration: Number.POSITIVE_INFINITY,
        action: { label: t("pwa.reload"), onClick: onReload },
      });
    };

    const offerWaiting = (worker: ServiceWorker) => {
      // No controller = first install; there is no older version to replace.
      if (!navigator.serviceWorker.controller) return;
      prompt(() => {
        reloadRequested = true;
        worker.postMessage({ type: "SKIP_WAITING" });
      });
    };

    // The first install claims uncontrolled pages; that is not an update.
    let hadController = navigator.serviceWorker.controller !== null;
    const onControllerChange = () => {
      if (reloadRequested) reload();
      else if (hadController) prompt(reload);
      hadController = true;
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void registration?.update().catch(() => undefined);
    };

    const start = async () => {
      registration = await registerServiceWorker();
      if (!registration || disposed) return;
      if (registration.waiting) offerWaiting(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const installing = registration?.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed") offerWaiting(installing);
        });
      });
      interval = window.setInterval(() => void registration?.update().catch(() => undefined), UPDATE_CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", onVisible);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    if (document.readyState === "complete") void start();
    else window.addEventListener("load", () => void start(), { once: true });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [t]);

  return null;
}
