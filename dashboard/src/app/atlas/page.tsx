import type { Metadata } from "next";
import { AtlasHubView } from "@/components/atlas/AtlasHubView";
import { JsonLd } from "@/components/shared/JsonLd";
import { ATLAS_CONCEPTS, ATLAS_FAQS, atlasHref } from "@/lib/atlas";
import { t, type Locale } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";
import { breadcrumbList, collectionPage, faqPage, siteOrigin } from "@/lib/schema";

const META_TITLES: Record<Locale, string> = {
  tr: "Yatırım Kavram Atlası",
  en: "Investment Concept Atlas",
  fr: "Atlas des concepts d'investissement",
};

const META_DESCRIPTIONS: Record<Locale, string> = {
  tr: "F/K, TTM, reel getiri, RSI, PD/DD, FD/FAVÖK ve sektör medyanı rehberi; BIST grafiklerine ve hazır taramalara doğrudan bağlantılar.",
  en: "Reference guide to P/E, TTM, real returns, RSI, P/B, EV/EBITDA and sector medians with direct links to live BIST charts and screens.",
  fr: "Guide des concepts PER, TTM, rendement réel, RSI, C/VC, VE/EBITDA et médianes sectorielles avec liens directs vers les graphiques et filtres.",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return {
    title: META_TITLES[locale],
    description: META_DESCRIPTIONS[locale],
    alternates: { canonical: "/atlas" },
    openGraph: {
      title: META_TITLES[locale],
      description: META_DESCRIPTIONS[locale],
      url: "/atlas",
    },
  };
}

export default async function AtlasPage() {
  const locale = await requestLocale();
  const origin = siteOrigin();

  const schema = [
    collectionPage(origin, {
      path: "/atlas",
      name: META_TITLES[locale],
      description: META_DESCRIPTIONS[locale],
      locale,
      items: ATLAS_CONCEPTS.map((c) => ({ name: c.title[locale], path: atlasHref(c.slug) })),
    }),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.atlas", locale), path: "/atlas" },
    ]),
    faqPage(ATLAS_FAQS.map((item) => ({ question: item.question[locale], answer: item.answer[locale] }))),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <AtlasHubView />
    </>
  );
}
