import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { AtlasConceptView } from "@/components/atlas/AtlasConceptView";
import { JsonLd } from "@/components/shared/JsonLd";
import { ATLAS_CONCEPTS, atlasHref, getAtlasConcept } from "@/lib/atlas";
import { LOCALE_COOKIE, parseLocale, t, type Locale } from "@/lib/i18n";
import { breadcrumbList, definedTermSchema, faqPage, siteOrigin } from "@/lib/schema";

type Props = { params: Promise<{ slug: string }> };

async function requestLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
}

export function generateStaticParams() {
  return ATLAS_CONCEPTS.map((concept) => ({ slug: concept.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const concept = getAtlasConcept(slug);
  const locale = await requestLocale();
  if (!concept) return { title: t("notFound.title", locale), robots: { index: false } };

  const canonical = atlasHref(concept.slug);
  const description = concept.cardDesc[locale];
  return {
    title: concept.title[locale],
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: concept.title[locale],
      description,
      url: canonical,
    },
  };
}

export default async function AtlasConceptPage({ params }: Props) {
  const { slug } = await params;
  const concept = getAtlasConcept(slug);
  if (!concept) notFound();
  if (slug !== concept.slug) permanentRedirect(atlasHref(concept.slug));

  const locale = await requestLocale();
  const origin = siteOrigin();
  const path = atlasHref(concept.slug);

  const schema = [
    definedTermSchema(origin, {
      path,
      name: concept.title[locale],
      description: concept.intro[locale],
      setName: t("nav.atlas", locale),
      locale,
    }),
    faqPage([
      {
        question: concept.question[locale],
        answer: `${concept.intro[locale]} ${concept.methodology[locale]}`,
      },
    ]),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.atlas", locale), path: "/atlas" },
      { name: concept.title[locale], path },
    ]),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <AtlasConceptView concept={concept} />
    </>
  );
}
