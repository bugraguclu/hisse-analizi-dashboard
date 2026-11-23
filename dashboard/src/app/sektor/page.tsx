import type { Metadata } from "next";
import { SectorHubView } from "@/components/discovery/SectorHubView";
import { JsonLd } from "@/components/shared/JsonLd";
import { allCanonicalSectorKeys, sectorPageHref } from "@/lib/discovery";
import { t, type Locale } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";
import { breadcrumbList, collectionPage, siteOrigin } from "@/lib/schema";
import { sectorLabel } from "@/lib/sectors";

const TITLES: Record<Locale, string> = {
  tr: "KAP Sektörleri",
  en: "KAP Sectors",
  fr: "Secteurs KAP",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "Borsa İstanbul'daki 48 KAP sektörü için kalıcı keşif sayfaları, sektör medyan çarpanları ve emsal şirket listeleri.",
  en: "Canonical discovery pages, sector median multiples and listed peer tables across all 48 KAP sectors on Borsa Istanbul.",
  fr: "Pages de découverte canoniques, médianes sectorielles et listes de sociétés pour les 48 secteurs KAP de Borsa Istanbul.",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: TITLES[locale],
    description: DESCRIPTIONS[locale],
    alternates: { canonical: "/sektor" },
    openGraph: { title: TITLES[locale], description: DESCRIPTIONS[locale], url: "/sektor" },
  };
}

export default async function SektorHubPage() {
  const locale = await requestLocale();
  const origin = siteOrigin();
  const keys = allCanonicalSectorKeys();

  const schema = [
    collectionPage(origin, {
      path: "/sektor",
      name: TITLES[locale],
      description: DESCRIPTIONS[locale],
      locale,
      items: keys.map((key) => ({ name: sectorLabel(key, locale), path: sectorPageHref(key) })),
    }),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.sectors", locale), path: "/sektor" },
    ]),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <SectorHubView />
    </>
  );
}
