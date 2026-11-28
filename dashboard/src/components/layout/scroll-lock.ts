/**
 * Safari measures CSS media queries against `documentElement.clientWidth` (excluding
 * permanent scrollbars), whereas Chromium/Firefox measure against `window.innerWidth`.
 * Locking root overflow when a permanent scrollbar is present causes `clientWidth` to
 * jump up to `innerWidth`, which can cross a breakpoint and self-close drawers/sheets.
 * Ported from Pureko/Website commit 8488282.
 */
export function shouldKeepScrollbar(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return (
    document.documentElement.clientWidth < window.innerWidth &&
    !window.matchMedia(`(min-width: ${window.innerWidth - 1}px)`).matches
  );
}
