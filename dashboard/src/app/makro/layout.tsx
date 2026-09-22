import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Makro Ekonomi",
  en: "Macroeconomics",
  fr: "Macro-économie",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "TCMB politika faizi, enflasyon (TÜFE), USD/EUR/GBP döviz kurları ve ekonomik takvim.",
  en: "CBRT policy rate, inflation (CPI), USD/EUR/GBP exchange rates and the economic calendar.",
  fr: "Taux directeur de la CBRT, inflation (IPC), taux de change USD/EUR/GBP et calendrier économique.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function MakroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
