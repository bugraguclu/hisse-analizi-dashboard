import type { Metadata } from "next";
import { IndexHubView } from "@/components/discovery/IndexHubView";
import { JsonLd } from "@/components/shared/JsonLd";
import { DISCOVERY_INDICES, indexPageHref } from "@/lib/discovery";
import { t, type Locale } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";
import { breadcrumbList, collectionPage, siteOrigin } from "@/lib/schema";

const TITLES: Record<Locale, string> = {
  tr: "BIST Endeksleri",
  en: "BIST Indices",
  fr: "Indices BIST",
};

const DESCRIPTIONS: Record<Locale, string> = {
  tr: "BIST 100, BIST 30, BIST Banka, BIST Sınai ve tematik endeksler için kalıcı keşif sayfaları, grafikler ve medyan çarpanlar.",
  en: "Canonical discovery pages, live charts and median ratios for BIST 100, BIST 30, BIST Banks, BIST Industrials and thematic indices.",
  fr: "Pages canoniques, graphiques en direct et médianes pour le BIST 100, le BIST 30, BIST Banques et les indices thématiques.",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: TITLES[locale],
    description: DESCRIPTIONS[locale],
    alternates: { canonical: "/endeks" },
    openGraph: { title: TITLES[locale], description: DESCRIPTIONS[locale], url: "/endeks" },
  };
}

export default async function EndeksHubPage() {
  const locale = await requestLocale();
  const origin = siteOrigin();

  const schema = [
    collectionPage(origin, {
      path: "/endeks",
      name: TITLES[locale],
      description: DESCRIPTIONS[locale],
      locale,
      items: DISCOVERY_INDICES.map((item) => ({ name: item.name[locale], path: indexPageHref(item.slug) })),
    }),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.indices", locale), path: "/endeks" },
    ]),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <IndexHubView />
    </>
  );
}
