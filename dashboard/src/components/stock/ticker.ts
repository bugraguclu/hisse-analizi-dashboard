/**
 * Same rule as the backend's `validate_ticker` / `normalize_symbol`: 2-10 ASCII
 * letters/digits after dropping a Yahoo-style `.IS` / `.E` suffix. Anything the
 * backend would reject with 400 must be a 404 here, not a page of errors.
 */
const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const SUFFIXES = [".IS", ".E"];

/**
 * Normalise a ticker route param ("thyao", "%20GARAN", "thyao.is") to the
 * canonical uppercase symbol, or `null` when it can never be a valid BIST
 * ticker. Safe to call from server components.
 */
export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  let upper = value.trim().toUpperCase();
  const suffix = SUFFIXES.find((s) => upper.endsWith(s));
  if (suffix) upper = upper.slice(0, -suffix.length);
  return TICKER_RE.test(upper) ? upper : null;
}
