import { cookies } from "next/headers";
import { IS_DEMO } from "./demo";
import { LOCALE_COOKIE, parseLocale, type Locale } from "./i18n";

/**
 * UI language for server rendering (layouts, pages, metadata): the `locale`
 * cookie, Turkish by default. The static demo is rendered at build time,
 * without a request, so it starts in Turkish and the client then applies a
 * saved choice (lib/locale-context.tsx).
 */
export async function requestLocale(): Promise<Locale> {
  if (IS_DEMO) return "tr";
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
}
