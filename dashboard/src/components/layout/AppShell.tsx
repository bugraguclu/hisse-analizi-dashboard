"use client";

import { useLocale } from "@/lib/locale-context";
import { MarketStrip } from "./MarketStrip";
import { MobileNav } from "./MobileNav";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { ShellProvider } from "./shell-context";

/** Scroll-linked top navigation + market strip above the page, site footer below; drawer menu on small screens. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  return (
    <ShellProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
      >
        {t("shell.skipToContent")}
      </a>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <MarketStrip />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 pb-12 pt-6 outline-none md:px-6 md:pt-8">
          {children}
        </main>
        <SiteFooter />
      </div>
      <MobileNav />
    </ShellProvider>
  );
}
