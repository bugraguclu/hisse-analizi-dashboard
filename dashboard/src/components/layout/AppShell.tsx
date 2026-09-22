"use client";

import { useLocale } from "@/lib/locale-context";
import { AppSidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ShellProvider } from "./shell-context";

/** Sidebar (desktop rail / mobile drawer) + sticky TopBar around the page content. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { t } = useLocale();
  return (
    <ShellProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        {t("shell.skipToContent")}
      </a>
      <div className="flex min-h-screen">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
            {children}
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
