"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { SoftKeyboardTracker } from "@/components/ui/SoftKeyboardTracker";
import { trackKeyboardNavigation } from "@/lib/focus-ring";
import { getQueryClient } from "@/lib/queryClient";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/i18n";
import { CustomLayoutsProvider } from "@/components/widgets/custom-layouts-context";
import type { BuiltInPage } from "@/components/widgets/defaults";
import { LocalDataBridge } from "./LocalDataBridge";

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
  useEffect(() => trackKeyboardNavigation(), []);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LocalDataBridge />
        <LocaleProvider initialLocale={initialLocale}>
          <SoftKeyboardTracker />
          <CustomLayoutsProvider customLayouts={customLayouts}>
            {children}
          </CustomLayoutsProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
