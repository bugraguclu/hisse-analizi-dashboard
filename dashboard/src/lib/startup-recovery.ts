/**
 * Bounded recovery for stale Next.js JS/CSS chunks after a deployment.
 *
 * Adapted from Yemek Takibi's startupRecovery.js to Next.js App Router:
 * - Only auto-reloads once during an untouched startup window (30 s), while
 *   online and visible, guarded by a 60 s sessionStorage cooldown so a broken
 *   build or offline proxy can never trap the tab in a reload loop.
 * - Never auto-reloads after the user has interacted (pointerdown, keydown,
 *   input, submit) — instead notifies the UI so the visitor can reload
 *   without silently losing form input or chart state.
 * - Fails safe when sessionStorage is unavailable.
 */

export const STARTUP_RELOAD_KEY = "hisse.startup.reload";
export const RELOAD_INTERVAL_MS = 60_000;
export const STARTUP_WINDOW_MS = 30_000;
export const ASSET_ERROR_EVENT = "hisse:asset-load-error";

export type RecoveryReason =
  | "not-asset-error"
  | "reloaded"
  | "already-reloading"
  | "interacted"
  | "startup-window-elapsed"
  | "offline"
  | "hidden"
  | "cooldown-active"
  | "storage-unavailable";

export interface RecoveryResult {
  outcome: "ignored" | "reloading" | "manual";
  reason: RecoveryReason;
}

export interface AssetRecoveryNotice {
  reason: RecoveryReason;
  detail?: string;
  at: number;
}

const ASSET_ERROR_PATTERN =
  /ChunkLoadError|Loading (?:CSS )?chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS|CSS_CHUNK_LOAD_FAILED/i;

/**
 * Returns true when an error or rejection looks like a missing/stale JS or CSS
 * chunk (as happens when a tab stays open across a deployment or a static asset
 * request fails mid-boot). Normal API or runtime errors return false.
 */
export function isAssetLoadError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return ASSET_ERROR_PATTERN.test(error);
  if (typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof record.name === "string" ? record.name : "";
    const message = typeof record.message === "string" ? record.message : "";
    if (name === "ChunkLoadError" || ASSET_ERROR_PATTERN.test(name) || ASSET_ERROR_PATTERN.test(message)) {
      return true;
    }
    if (record.cause && record.cause !== error) {
      return isAssetLoadError(record.cause);
    }
  }
  return false;
}

/**
 * True when a failed `<script>` or `<link rel="stylesheet">` URL belongs to
 * Next.js's static asset bundle on the same origin (`/_next/static/...`).
 */
export function isStaticAssetUrl(rawUrl: string | null | undefined, origin: string): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl, origin);
    if (parsed.origin !== new URL(origin).origin) return false;
    return parsed.pathname.startsWith("/_next/static/");
  } catch {
    return false;
  }
}

export interface BrowserLike {
  document: {
    visibilityState?: string;
    addEventListener: (
      type: string,
      listener: () => void,
      options?: { capture?: boolean; once?: boolean } | boolean,
    ) => void;
    removeEventListener: (type: string, listener: () => void, options?: boolean) => void;
  };
  navigator?: { onLine?: boolean };
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  location: { origin: string; reload: () => void };
}

export interface StartupRecoveryController {
  handleError: (error: unknown) => RecoveryResult;
  handleResourceUrl: (url: string | null | undefined) => RecoveryResult;
  hasInteracted: () => boolean;
  dispose: () => void;
}

const INTERACTION_EVENTS = ["pointerdown", "keydown", "input", "submit"] as const;

/**
 * Creates a bounded startup recovery controller for a browser-like environment.
 * Pure enough to unit test under Node without DOM globals.
 */
export function createStartupRecovery(
  browser: BrowserLike,
  options: {
    now?: () => number;
    onManualRecovery?: (notice: AssetRecoveryNotice) => void;
  } = {},
): StartupRecoveryController {
  const now = options.now ?? Date.now;
  const started = now();
  let interacted = false;
  let reloading = false;

  const markInteracted = () => {
    interacted = true;
    for (const type of INTERACTION_EVENTS) {
      browser.document.removeEventListener(type, markInteracted, true);
    }
  };

  for (const type of INTERACTION_EVENTS) {
    browser.document.addEventListener(type, markInteracted, { capture: true, once: true });
  }

  function attemptRecovery(detail?: string): RecoveryResult {
    if (reloading) return { outcome: "reloading", reason: "already-reloading" };

    const notifyManual = (reason: RecoveryReason): RecoveryResult => {
      options.onManualRecovery?.({ reason, detail, at: now() });
      return { outcome: "manual", reason };
    };

    if (interacted) return notifyManual("interacted");
    if (now() - started > STARTUP_WINDOW_MS) return notifyManual("startup-window-elapsed");
    if (browser.navigator?.onLine === false) return notifyManual("offline");
    if (browser.document.visibilityState === "hidden") return notifyManual("hidden");

    try {
      const storage = browser.sessionStorage;
      if (!storage) return notifyManual("storage-unavailable");
      const previous = storage.getItem(STARTUP_RELOAD_KEY);
      if (previous !== null) {
        const elapsed = now() - Number(previous);
        if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < RELOAD_INTERVAL_MS) {
          return notifyManual("cooldown-active");
        }
      }
      storage.setItem(STARTUP_RELOAD_KEY, String(now()));
    } catch {
      // Without durable sessionStorage we cannot safely rule out a reload loop.
      return notifyManual("storage-unavailable");
    }

    reloading = true;
    browser.location.reload();
    return { outcome: "reloading", reason: "reloaded" };
  }

  return {
    handleError(error: unknown): RecoveryResult {
      if (!isAssetLoadError(error)) {
        return { outcome: "ignored", reason: "not-asset-error" };
      }
      const detail = error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
      return attemptRecovery(detail);
    },
    handleResourceUrl(url: string | null | undefined): RecoveryResult {
      if (!isStaticAssetUrl(url, browser.location.origin)) {
        return { outcome: "ignored", reason: "not-asset-error" };
      }
      return attemptRecovery(url ?? undefined);
    },
    hasInteracted: () => interacted,
    dispose() {
      for (const type of INTERACTION_EVENTS) {
        browser.document.removeEventListener(type, markInteracted, true);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-hydration inline bootstrap script & client bridge
// ---------------------------------------------------------------------------

interface RecoveryWindow extends Window {
  __hisseStartupRecovery?: {
    hydrated: boolean;
    pending: AssetRecoveryNotice | null;
    recover: (error: unknown) => RecoveryResult;
  };
}

const FALLBACK_COPY: Record<"tr" | "en" | "fr", { title: string; body: string; reload: string }> = {
  tr: {
    title: "Uygulama dosyaları yüklenemedi",
    body: "Yeni bir sürüm yayınlanmış veya bağlantı kesilmiş olabilir. Verileriniz etkilenmedi; sayfayı yenileyerek tekrar deneyebilirsiniz.",
    reload: "Sayfayı yenile",
  },
  en: {
    title: "Application assets failed to load",
    body: "A new version may have been deployed or the connection dropped. Your data is safe; reload the page to try again.",
    reload: "Reload page",
  },
  fr: {
    title: "Les fichiers de l'application n'ont pas pu être chargés",
    body: "Une nouvelle version a peut-être été déployée ou la connexion a été interrompue. Vos données sont intactes ; rechargez la page pour réessayer.",
    reload: "Recharger la page",
  },
};

/**
 * Tiny pre-hydration inline script placed in `<head>`.
 * Catches failed `/_next/static/` JS/CSS assets before React boots:
 * - Auto-reloads at most once during untouched startup (30 s window, 60 s cooldown).
 * - If auto-reload is blocked (cooldown/offline/post-interaction), stores the
 *   notice for React's banner and, if React never hydrates, renders a minimal
 *   self-styled fallback notice with a manual reload button.
 */
export function startupBootstrapScript(locale: "tr" | "en" | "fr" = "tr"): string {
  const copy = FALLBACK_COPY[locale] ?? FALLBACK_COPY.tr;
  return `(function(){if(window.__hisseStartupRecovery)return;var K=${JSON.stringify(STARTUP_RELOAD_KEY)},I=${RELOAD_INTERVAL_MS},W=${STARTUP_WINDOW_MS},E=${JSON.stringify(ASSET_ERROR_EVENT)},C=${JSON.stringify(copy)};var t0=Date.now(),interacted=false,reloading=false,shownFallback=false;var P=/ChunkLoadError|Loading (?:CSS )?chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS|CSS_CHUNK_LOAD_FAILED/i;var evs=["pointerdown","keydown","input","submit"];function onInt(){interacted=true;for(var i=0;i<evs.length;i++)document.removeEventListener(evs[i],onInt,true);}for(var i=0;i<evs.length;i++)document.addEventListener(evs[i],onInt,{capture:true,once:true});function isAssetErr(err){if(!err)return false;if(typeof err==="string")return P.test(err);var n=typeof err.name==="string"?err.name:"",m=typeof err.message==="string"?err.message:"";return n==="ChunkLoadError"||P.test(n)||P.test(m);}function isStaticUrl(u){if(!u)return false;try{var p=new URL(u,location.origin);return p.origin===location.origin&&p.pathname.indexOf("/_next/static/")===0;}catch(e){return false;}}function renderDomFallback(){if(shownFallback||state.hydrated||!document.body)return;if(document.getElementById("startup-recovery-fallback"))return;shownFallback=true;var b=document.createElement("div");b.id="startup-recovery-fallback";b.setAttribute("role","alert");b.style.cssText="position:fixed;inset-inline:16px;bottom:16px;z-index:9999;max-width:480px;margin:0 auto;padding:16px 18px;border:1px solid #d4d1cb;border-left:3px solid #c8322b;border-radius:8px;background:#faf9f7;color:#1d1b18;font:14px/1.5 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.18)";var h=document.createElement("strong");h.style.cssText="display:block;font-size:15px;margin-bottom:4px";h.textContent=C.title;var p=document.createElement("p");p.style.cssText="margin:0 0 12px;color:#55514b;font-size:13px";p.textContent=C.body;var btn=document.createElement("button");btn.type="button";btn.id="startup-retry";btn.textContent=C.reload;btn.style.cssText="height:32px;padding:0 12px;border:0;border-radius:4px;background:#1d1b18;color:#f7f6f3;font:500 13px system-ui,sans-serif;cursor:pointer";btn.onclick=function(){location.reload();};b.appendChild(h);b.appendChild(p);b.appendChild(btn);document.body.appendChild(b);}function trigger(reason,detail){var n={reason:reason,detail:detail,at:Date.now()};state.pending=n;try{window.dispatchEvent(new CustomEvent(E,{detail:n}));}catch(e){}if(!state.hydrated){setTimeout(renderDomFallback,1500);}return{outcome:"manual",reason:reason};}function attempt(detail){if(reloading)return{outcome:"reloading",reason:"already-reloading"};if(interacted)return trigger("interacted",detail);if(Date.now()-t0>W)return trigger("startup-window-elapsed",detail);if(navigator.onLine===false)return trigger("offline",detail);if(document.visibilityState==="hidden")return trigger("hidden",detail);try{var prev=sessionStorage.getItem(K);if(prev!==null){var d=Date.now()-Number(prev);if(isFinite(d)&&d>=0&&d<I)return trigger("cooldown-active",detail);}sessionStorage.setItem(K,String(Date.now()));}catch(e){return trigger("storage-unavailable",detail);}reloading=true;location.reload();return{outcome:"reloading",reason:"reloaded"};}var state={hydrated:false,pending:null,recover:function(err){if(!isAssetErr(err))return{outcome:"ignored",reason:"not-asset-error"};return attempt(err&&err.message?String(err.message):undefined);}};window.__hisseStartupRecovery=state;window.addEventListener("error",function(ev){var t=ev&&ev.target;if(t&&t!==window){var u=(t.tagName==="SCRIPT"&&t.src)||(t.tagName==="LINK"&&t.rel==="stylesheet"&&t.href)||"";if(isStaticUrl(u))attempt(u);return;}if(ev&&(isAssetErr(ev.error)||isAssetErr(ev.message)))attempt(ev.message);},true);window.addEventListener("unhandledrejection",function(ev){if(ev&&isAssetErr(ev.reason))attempt(ev.reason&&ev.reason.message?String(ev.reason.message):undefined);});})();`;
}

let fallbackController: StartupRecoveryController | null = null;

function notifyClientListeners(notice: AssetRecoveryNotice) {
  if (typeof window === "undefined") return;
  const win = window as RecoveryWindow;
  if (win.__hisseStartupRecovery) {
    win.__hisseStartupRecovery.pending = notice;
  }
  window.dispatchEvent(new CustomEvent<AssetRecoveryNotice>(ASSET_ERROR_EVENT, { detail: notice }));
}

/**
 * Ensures client-side recovery is active (using the pre-hydration bridge when
 * present, or creating a fallback controller if the inline script did not run).
 */
export function initializeStartupRecovery(): void {
  if (typeof window === "undefined") return;
  const win = window as RecoveryWindow;
  if (win.__hisseStartupRecovery) {
    win.__hisseStartupRecovery.hydrated = true;
    const domFallback = document.getElementById("startup-recovery-fallback");
    if (domFallback) domFallback.remove();
    return;
  }
  if (!fallbackController) {
    fallbackController = createStartupRecovery(window, {
      onManualRecovery: notifyClientListeners,
    });
  }
}

/** Attempts bounded startup recovery for an error caught in a React boundary. */
export function recoverStartup(error: unknown): RecoveryResult {
  if (typeof window === "undefined") {
    return { outcome: "ignored", reason: "not-asset-error" };
  }
  const win = window as RecoveryWindow;
  if (win.__hisseStartupRecovery) {
    return win.__hisseStartupRecovery.recover(error);
  }
  if (!fallbackController) {
    fallbackController = createStartupRecovery(window, {
      onManualRecovery: notifyClientListeners,
    });
  }
  return fallbackController.handleError(error);
}

/** Returns any pending asset-load notice captured before React mounted. */
export function getPendingAssetRecovery(): AssetRecoveryNotice | null {
  if (typeof window === "undefined") return null;
  const win = window as RecoveryWindow;
  return win.__hisseStartupRecovery?.pending ?? null;
}

/** Clears the pending notice after the user dismisses the recovery banner. */
export function clearPendingAssetRecovery(): void {
  if (typeof window === "undefined") return;
  const win = window as RecoveryWindow;
  if (win.__hisseStartupRecovery) {
    win.__hisseStartupRecovery.pending = null;
  }
  window.dispatchEvent(new CustomEvent<AssetRecoveryNotice | null>(ASSET_ERROR_EVENT, { detail: null }));
}

/** Subscribes to manual asset-recovery changes (compatible with useSyncExternalStore). */
export function subscribeAssetRecovery(listener: (notice: AssetRecoveryNotice | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AssetRecoveryNotice | null>).detail ?? null;
    listener(detail);
  };
  window.addEventListener(ASSET_ERROR_EVENT, handler);
  return () => window.removeEventListener(ASSET_ERROR_EVENT, handler);
}
