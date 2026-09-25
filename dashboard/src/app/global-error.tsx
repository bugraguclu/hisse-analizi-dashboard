"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, parseLocale, t, type Locale } from "@/lib/i18n";

/**
 * Replaces the root layout when it crashes, so no providers, fonts or global
 * CSS are available here: the locale comes straight from the cookie and the
 * styles are inlined (light/dark via the OS preference).
 */
function detectLocale(): Locale {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
  return parseLocale(match?.[1]) ?? parseLocale(document.documentElement.lang) ?? "tr";
}

const noopSubscribe = () => () => {};
const serverLocale = (): Locale => "tr";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Server/hydration render in Turkish; switch to the saved language right after.
  const locale = useSyncExternalStore(noopSubscribe, detectLocale, serverLocale);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <title>{`${t("error.appTitle", locale)} · Hisse Analizi`}</title>
        <style>{`
          :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f6f3; color: #1d1b18; }
          main { width: min(460px, calc(100% - 32px)); box-sizing: border-box; padding: 4px 0 4px 20px; border-left: 2px solid #c8322b; }
          h1 { margin: 0; font-family: ui-serif, Georgia, "Times New Roman", serif; font-size: 30px; font-weight: 600; line-height: 1.15; letter-spacing: -0.01em; }
          p { margin: 12px 0 0; color: #6b6760; font-size: 14px; line-height: 1.55; }
          .actions { margin-top: 24px; display: flex; gap: 8px; flex-wrap: wrap; }
          button { height: 32px; border: 0; border-radius: 4px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; background: #1d1b18; color: #f7f6f3; }
          button:hover { opacity: 0.88; }
          button.secondary { background: transparent; color: inherit; border: 1px solid #dedcd7; }
          button:focus-visible { outline: 2px solid #2f5b9e; outline-offset: 2px; }
          .digest { margin-top: 16px; font-family: ui-monospace, monospace; font-size: 11px; }
          @media (prefers-color-scheme: dark) {
            body { background: #0e0e0e; color: #ebe9e5; }
            main { border-left-color: #e5645a; }
            p { color: #99968f; }
            button { background: #ebe9e5; color: #0e0e0e; }
            button.secondary { background: transparent; color: inherit; border-color: #2b2b2b; }
            button:focus-visible { outline-color: #86a6d6; }
          }
        `}</style>
        <main role="alert">
          <h1>{t("error.appTitle", locale)}</h1>
          <p>{t("error.appDescription", locale)}</p>
          <div className="actions">
            <button type="button" onClick={() => retry()}>
              {t("common.retry", locale)}
            </button>
            {/* A full reload is the most reliable recovery once the root layout failed. */}
            <button type="button" className="secondary" onClick={() => window.location.assign(window.location.origin)}>
              {t("error.backHome", locale)}
            </button>
          </div>
          {error.digest && (
            <p className="digest">
              {t("error.code", locale)}: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
