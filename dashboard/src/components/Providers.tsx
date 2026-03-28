"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { getQueryClient } from "@/lib/queryClient";
import { LocaleProvider } from "@/lib/locale-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>{children}</LocaleProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
