import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Sayfalarım",
  en: "My pages",
  fr: "Mes pages",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "Kendi sayfanızı oluşturun: temettü, bilanço, fiyat grafiği, KAP bildirimleri ve makro göstergeleri istediğiniz düzende bir araya getirin.",
  en: "Build your own page: put dividends, statements, price charts, KAP filings and macro figures together in the layout you want.",
  fr: "Créez votre propre page : réunissez dividendes, états financiers, graphiques, publications KAP et indicateurs macro dans la mise en page de votre choix.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function MyPagesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
