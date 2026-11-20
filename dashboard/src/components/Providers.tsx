"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { getQueryClient } from "@/lib/queryClient";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { LocalDataBridge } from "./LocalDataBridge";

export function Providers({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const queryClient = getQueryClient();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LocalDataBridge />
        <LocaleProvider initialLocale={initialLocale}>
          {children}
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
