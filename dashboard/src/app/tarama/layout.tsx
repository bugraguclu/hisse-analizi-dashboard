import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Hisse Tarama",
  en: "Stock screener",
  fr: "Filtrage d'actions",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "Hazır şablonlar ve özel filtrelerle BIST hisse taraması, teknik sinyal tarama ve BIST endeksleri.",
  en: "BIST stock screening with ready-made templates and custom filters, technical signal scanning and BIST indices.",
  fr: "Filtrage d'actions BIST avec modèles prédéfinis et filtres personnalisés, détection de signaux techniques et indices BIST.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function TaramaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
