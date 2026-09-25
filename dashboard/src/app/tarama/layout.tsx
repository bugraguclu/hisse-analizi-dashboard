import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Hisse Tarama",
  en: "Stock Screener",
  fr: "Filtrage d'actions",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "Borsa İstanbul'daki tüm hisseleri değerleme, kârlılık, teknik ve analist verileriyle filtreleyin: hazır taramalar, gelişmiş filtreler, CSV.",
  en: "Filter every Borsa Istanbul stock by valuation, profitability, technical and analyst data: quick screens, advanced filters, CSV export.",
  fr: "Filtrez toutes les actions de Borsa Istanbul selon la valorisation, la rentabilité, l'analyse technique et les analystes : filtres prédéfinis, filtres avancés, export CSV.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function TaramaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
