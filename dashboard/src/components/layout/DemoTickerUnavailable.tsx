"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_BASE_PATH, DEMO_TICKERS, IS_DEMO, LIVE_SITE_URL } from "@/lib/demo";
import { useLocale } from "@/lib/locale-context";
import { TICKER_SECTIONS } from "./nav";

const noop = () => () => {};

/**
 * The stock page a static demo URL asks for, when the demo has no page for it.
 * GitHub Pages answers every unknown path with 404.html, rendered at build time
 * for no particular URL, so the address is read in the browser.
 */
function useMissingDemoStock(): { section: string; ticker: string } | null {
  const path = useSyncExternalStore(
    noop,
    () => window.location.pathname,
    () => null,
  );
  if (!IS_DEMO || !path) return null;
  const local = DEMO_BASE_PATH && path.startsWith(DEMO_BASE_PATH) ? path.slice(DEMO_BASE_PATH.length) : path;
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(local);
  if (!match || !TICKER_SECTIONS.has(match[1])) return null;
  let ticker = match[2];
  try {
    ticker = decodeURIComponent(ticker);
  } catch {
    // keep the raw segment
  }
  ticker = ticker.toUpperCase().slice(0, 24);
  return DEMO_TICKERS.includes(ticker) ? null : { section: match[1], ticker };
}

/**
 * Static demo only: "this stock is not in the demo" with the stocks it has and a
 * link to the same page on the live site. Renders nothing for other URLs, so the
 * caller falls back to its ordinary not-found page.
 */
export function DemoTickerUnavailable({ fallback }: { fallback: React.ReactNode }) {
  const { t } = useLocale();
  const missing = useMissingDemoStock();
  if (!missing) return fallback;
  const { section, ticker } = missing;
  return (
    <section className="mx-auto max-w-7xl py-10 md:py-16" aria-labelledby="demo-missing-title">
      <div className="max-w-lg">
        <p className="font-mono text-xs text-muted-foreground">{t("demo.label")}</p>
        <h1 id="demo-missing-title" className="mt-2 break-words text-[32px] font-semibold leading-tight text-foreground">
          {t("demo.unavailableTitle", { ticker })}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("demo.unavailableBody")}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {DEMO_TICKERS.map((symbol) => (
            <li key={symbol}>
              <Link href={`/${section}/${symbol}`} className={buttonVariants({ variant: "outline", size: "sm", className: "font-mono" })}>
                {symbol}
              </Link>
            </li>
          ))}
        </ul>
        <a
          href={`${LIVE_SITE_URL}/${section}/${encodeURIComponent(ticker)}`}
          className={buttonVariants({ variant: "default", className: "mt-6" })}
        >
          {t("demo.openLive", { ticker })} <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
