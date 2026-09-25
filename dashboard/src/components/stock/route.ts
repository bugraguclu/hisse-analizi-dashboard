import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
import { stockText, type StockKey } from "./i18n-dict";
import { normalizeTicker } from "./ticker";

type TickerParams = Promise<{ ticker: string }>;

/** Per-ticker <title>/<meta description> in the visitor's language (locale cookie). */
export async function stockMetadata(params: TickerParams, titleKey: StockKey): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normalizeTicker(ticker);
  const locale = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value) ?? "tr";
  if (!symbol) return { title: stockText("notFound.title", locale), robots: { index: false } };
  return {
    title: stockText(titleKey, locale, { ticker: symbol }),
    description: stockText("meta.description", locale, { ticker: symbol }),
  };
}

/**
 * Canonical ticker for a route: malformed symbols render the segment's
 * not-found page (HTTP 404), lowercase ones redirect to the uppercase URL.
 */
export async function resolveTicker(params: TickerParams, basePath: string): Promise<string> {
  const { ticker } = await params;
  const symbol = normalizeTicker(ticker);
  if (!symbol) notFound();
  if (symbol !== ticker) redirect(`${basePath}/${symbol}`);
  return symbol;
}
