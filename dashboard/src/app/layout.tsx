import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { motionCss } from "@/lib/motion";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { t, type Locale } from "@/lib/i18n";
import { IS_DEMO } from "@/lib/demo";
import { requestLocale } from "@/lib/request-locale";
import { siteOrigin } from "@/lib/schema";
import { startupBootstrapScript } from "@/lib/startup-recovery";

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const title = t("meta.title", locale);
  const description = t("meta.description", locale);
  return {
    metadataBase: new URL(siteOrigin()),
    title: { default: title, template: "%s · Hisse Analizi" },
    description,
    applicationName: "Hisse Analizi",
    // app/favicon.ico is picked up by the file convention.
    formatDetection: { telephone: false },
    openGraph: { type: "website", siteName: "Hisse Analizi", title, description, locale: OPEN_GRAPH_LOCALES[locale] },
    // The static demo (lib/demo.ts) is a copy of the live site: keep it out of search results.
    ...(IS_DEMO ? { robots: { index: false, follow: false } } : {}),
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
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
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
    <html lang={locale} className={`${plexSans.variable} ${plexMono.variable} ${newsreader.variable} h-full antialiased`} style={motionCss as React.CSSProperties} suppressHydrationWarning>
      <head>
        <script
          id="hisse-startup-recovery"
          dangerouslySetInnerHTML={{ __html: startupBootstrapScript(locale) }}
        />
      </head>
      <body className="min-h-full">
        <Providers initialLocale={locale}>
          <AppShell>{children}</AppShell>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
