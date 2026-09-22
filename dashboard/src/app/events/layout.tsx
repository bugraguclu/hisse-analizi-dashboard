import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Olaylar & KAP Bildirimleri",
  en: "Events & KAP disclosures",
  fr: "Événements et publications KAP",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "Tüm KAP bildirimleri, haberler ve fiyat olayları — ticker, kategori, önem derecesi ve tarih aralığına göre filtrelenebilir.",
  en: "All KAP disclosures, news and price events — filterable by ticker, category, severity and date range.",
  fr: "Toutes les publications KAP, actualités et événements de prix — filtrables par symbole, catégorie, gravité et période.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
