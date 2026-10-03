"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { getQueryClient } from "@/lib/queryClient";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { CustomLayoutsProvider } from "@/components/widgets/custom-layouts-context";
import type { BuiltInPage } from "@/components/widgets/defaults";

export function Providers({
  children,
  initialLocale,
  customLayouts,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
  customLayouts?: readonly BuiltInPage[];
}) {
  const queryClient = getQueryClient();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider initialLocale={initialLocale}>
          <CustomLayoutsProvider customLayouts={customLayouts}>
            {/* Honour the OS "reduce motion" setting for every framer-motion animation. */}
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
          </CustomLayoutsProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
