import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { IndexDetailView } from "@/components/discovery/IndexDetailView";
import { JsonLd } from "@/components/shared/JsonLd";
import { DISCOVERY_INDICES, indexPageHref, resolveIndexSlug } from "@/lib/discovery";
import { LOCALE_COOKIE, parseLocale, t, type Locale } from "@/lib/i18n";
import { breadcrumbList, collectionPage, siteOrigin } from "@/lib/schema";

type Props = { params: Promise<{ slug: string }> };

async function requestLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
}

export function generateStaticParams() {
  return DISCOVERY_INDICES.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveIndexSlug(slug);
  const locale = await requestLocale();
  if (!resolved) return { title: t("notFound.title", locale), robots: { index: false } };

  const { entry } = resolved;
  const canonical = indexPageHref(entry.slug);
  const title = `${entry.name[locale]} (${entry.code})`;
  const description = entry.shortDesc[locale];
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function EndeksDetailPage({ params }: Props) {
  const { slug } = await params;
  const resolved = resolveIndexSlug(slug);
  if (!resolved) notFound();
  if (!resolved.isCanonical) permanentRedirect(indexPageHref(resolved.entry.slug));

  const { entry } = resolved;
  const locale = await requestLocale();
  const origin = siteOrigin();
  const path = indexPageHref(entry.slug);

  const schema = [
    collectionPage(origin, {
      path,
      name: `${entry.name[locale]} (${entry.code})`,
      description: entry.lead[locale],
      locale,
      items: [
        { name: `${entry.name[locale]} — ${t("nav.screening", locale)}`, path: `/tarama?idx=${entry.code}` },
        ...entry.relatedAtlasSlugs.map((atlasSlug) => ({ name: atlasSlug, path: `/atlas/${atlasSlug}` })),
      ],
    }),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.indices", locale), path: "/endeks" },
      { name: entry.name[locale], path },
    ]),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <IndexDetailView entry={entry} />
    </>
  );
}
