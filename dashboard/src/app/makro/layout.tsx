import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type Locale } from "@/lib/i18n";

const TITLES: Record<Locale, string> = {
  tr: "Makro Ekonomi",
  en: "Macroeconomy",
  fr: "Macro-économie",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "TCMB politika faizi ve faiz koridoru, reel faiz, TÜFE/ÜFE enflasyonu, büyüme ve istihdam, cari denge ve rezervler, tahvil getirileri, döviz ve altın, TCMB gösterge kurları ve ekonomik takvim.",
  en: "CBRT policy rate and corridor, real rate, CPI/PPI inflation, growth and labour, current account and reserves, bond yields, FX and gold, CBRT indicative rates and the economic calendar.",
  fr: "Taux directeur et corridor de la CBRT, taux réel, inflation IPC/IPP, croissance et emploi, compte courant et réserves, rendements obligataires, change et or, cours indicatifs de la CBRT et calendrier économique.",
};

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: TITLES[locale], description: DESCRIPTIONS[locale] };
}

export default function MakroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
