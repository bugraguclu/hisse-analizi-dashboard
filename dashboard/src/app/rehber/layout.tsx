import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Kavram Rehberi ve Yardım",
  en: "Concept Guide & Help",
  fr: "Guide des notions et aide",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "F/K, PD/DD, TTM, RSI, reel getiri, enflasyon, politika faizi ve platform kullanım açıklamaları.",
  en: "Explanations for P/E, P/B, TTM, RSI, real return, inflation, policy rate and platform usage.",
  fr: "Explications sur PER, C/VC, TTM, RSI, rendement réel, inflation, taux directeur et utilisation.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function RehberLayout({ children }: { children: React.ReactNode }) {
  return children;
}
