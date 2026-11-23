import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requestLocale } from "@/lib/request-locale";
import { stockText, type StockKey } from "./i18n-dict";
import { normalizeTicker } from "./ticker";

type TickerParams = Promise<{ ticker: string }>;

/** Per-ticker <title>/<meta description> in the visitor's language (locale cookie). */
export async function stockMetadata(params: TickerParams, titleKey: StockKey): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normalizeTicker(ticker);
  const locale = await requestLocale();
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
