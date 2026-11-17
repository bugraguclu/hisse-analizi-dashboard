import type { BuiltInPage } from "./defaults";

export const CUSTOM_LAYOUTS_COOKIE = "hisse.customLayouts";

const BUILT_IN_PAGES = new Set<string>([
  "home",
  "stock.overview",
  "stock.fundamental",
  "stock.technical",
  "stock.combined",
  "macro",
]);

export function parseCustomLayoutsCookie(raw: string | undefined | null): BuiltInPage[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is BuiltInPage => BUILT_IN_PAGES.has(s));
}
