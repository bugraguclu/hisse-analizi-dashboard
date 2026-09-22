"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { getQueryClient } from "@/lib/queryClient";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";

export function Providers({ children, initialLocale }: { children: React.ReactNode; initialLocale: Locale }) {
  const queryClient = getQueryClient();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={initialLocale}>
          {/* Honour the OS "reduce motion" setting for every framer-motion animation. */}
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
