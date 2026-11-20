import { APP_SCHEME, isAppUrl } from "./externalLinking.ts";

/**
 * True for any incoming OS URL owned by `app/_layout.tsx`'s `IncomingUrlQueue`.
 *
 * iOS delivers incoming custom-scheme and Universal Link URLs to BOTH Expo Router and `Linking`.
 * Claiming them in `app/+native-intent.tsx` stops Expo Router from resolving the raw URL as a
 * screen path before startup finishes or opening a "+not-found" screen behind the real target.
 */
export function isHandledByAppLayout(url: string): boolean {
  if (!url) return false;
  if (url.toLowerCase().startsWith(`${APP_SCHEME}://`)) return true;
  return isAppUrl(url);
}

/**
 * Expo Router's `redirectSystemPath` hook, re-exported by `app/+native-intent.tsx`.
 *
 * - On cold launch (`initial: true`), returns `/(tabs)/markets` so the root tabs mount cleanly
 *   while `IncomingUrlQueue` holds the URL until local startup succeeds.
 * - On warm launch (`initial: false`), returns `null` so the router stays where it is while
 *   `IncomingUrlQueue` performs validated navigation.
 * - In-app paths pass through unchanged.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (!isHandledByAppLayout(path)) return path;
  return initial ? "/(tabs)/markets" : null;
}
