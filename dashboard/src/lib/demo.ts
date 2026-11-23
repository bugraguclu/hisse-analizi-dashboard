/**
 * Static demo build: the GitHub Pages copy of the site (`npm run build:demo`,
 * scripts/build-demo.mjs). With NEXT_PUBLIC_DEMO=1, next.config.ts exports the
 * site as static files under NEXT_PUBLIC_BASE_PATH and lib/api.ts answers every
 * API request from the recorded responses in demo/data (lib/demo-fetch.ts)
 * instead of the backend. In the normal build IS_DEMO is the constant `false`,
 * so everything gated on it is dropped from the bundles.
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** Sub-path the demo is served from (a GitHub Pages project site lives under /<repository>). */
export const DEMO_BASE_PATH = IS_DEMO ? (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "") : "";

/** When the recorded responses were captured (ISO 8601); empty outside the demo. */
export const DEMO_CAPTURED_AT = IS_DEMO ? (process.env.NEXT_PUBLIC_DEMO_CAPTURED_AT ?? "") : "";

/** Stocks whose pages the demo covers. */
export const DEMO_TICKERS: readonly string[] = IS_DEMO
  ? (process.env.NEXT_PUBLIC_DEMO_TICKERS ?? "")
      .split(",")
      .map((ticker) => ticker.trim())
      .filter(Boolean)
  : [];

export const LIVE_SITE_URL = "https://hisse-analizi.duckdns.org";

export function isDemoTicker(ticker: string): boolean {
  return DEMO_TICKERS.includes(ticker.trim().toUpperCase());
}

/**
 * Features that need the server or a real deployment. The demo turns them all
 * off; check here instead of testing IS_DEMO, so a new optional feature (a
 * service worker, push notifications, an assistant…) only has to name itself.
 */
export type OptionalFeature =
  /** Upstream symbol search for tickers the local index does not know. */
  | "serverSearch"
  /** Write requests (POST and the like). */
  | "mutations"
  /** Interval refetching of market data. */
  | "liveRefresh"
  | "serviceWorker"
  | "pushNotifications"
  | "assistant";

export function isFeatureEnabled(feature: OptionalFeature): boolean {
  void feature;
  return !IS_DEMO;
}

/**
 * generateStaticParams of the [ticker] routes: the recorded stocks in the demo.
 * Undefined in the server build, so those routes stay dynamic (rendered per
 * request, in the visitor's language) exactly as before.
 */
export const demoTickerStaticParams = IS_DEMO ? () => DEMO_TICKERS.map((ticker) => ({ ticker })) : undefined;
