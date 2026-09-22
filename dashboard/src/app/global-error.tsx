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
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #111827; }
          main { width: min(420px, calc(100% - 32px)); box-sizing: border-box; padding: 32px; border: 1px solid #e5e7eb; border-radius: 20px; background: #fff; text-align: center; box-shadow: 0 16px 48px rgba(15, 23, 42, .08); }
          h1 { margin: 0; font-size: 22px; }
          p { margin: 12px 0 0; color: #64748b; line-height: 1.55; }
          .actions { margin-top: 24px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
          button { border: 0; border-radius: 10px; padding: 11px 18px; font: inherit; font-weight: 700; cursor: pointer; background: #4f46e5; color: #fff; }
          button:hover { background: #4338ca; }
          button.secondary { background: transparent; color: inherit; border: 1px solid #e5e7eb; }
          button:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
          .digest { margin-top: 16px; font-family: ui-monospace, monospace; font-size: 11px; }
          @media (prefers-color-scheme: dark) {
            body { background: #0e1118; color: #f3f4f6; }
            main { background: #171923; border-color: #303443; box-shadow: none; }
            p { color: #9ca3af; }
            button.secondary { border-color: #303443; }
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
