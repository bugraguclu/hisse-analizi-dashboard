import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { LOCALE_COOKIE, parseLocale, t, type Locale } from "@/lib/i18n";

// Type system (mapped to font-sans / font-mono / font-display in globals.css):
// Plex Sans for UI text, Plex Mono for figures and tickers, Newsreader for page titles.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin", "latin-ext"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
});

const OPEN_GRAPH_LOCALES: Record<Locale, string> = { tr: "tr_TR", en: "en_US", fr: "fr_FR" };

async function requestLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const title = t("meta.title", locale);
  const description = t("meta.description", locale);
  return {
    title: { default: title, template: "%s · Hisse Analizi" },
    description,
    applicationName: "Hisse Analizi",
    // app/favicon.ico is picked up by the file convention.
    formatDetection: { telephone: false },
    openGraph: { type: "website", siteName: "Hisse Analizi", title, description, locale: OPEN_GRAPH_LOCALES[locale] },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0e" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The UI language travels in a cookie so the server renders it directly
  // (correct <html lang>, no flash of Turkish text for EN/FR users).
  const locale = await requestLocale();
  return (
    <html lang={locale} className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        <Providers initialLocale={locale}>
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
