import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { SectorDetailView } from "@/components/discovery/SectorDetailView";
import { JsonLd } from "@/components/shared/JsonLd";
import { getAtlasConcept } from "@/lib/atlas";
import {
  allCanonicalSectorKeys,
  resolveSectorSlug,
  sectorEditorialLead,
  sectorPageHref,
  sectorRelatedAtlasSlugs,
} from "@/lib/discovery";
import { t } from "@/lib/i18n";
import { requestLocale } from "@/lib/request-locale";
import { breadcrumbList, collectionPage, siteOrigin } from "@/lib/schema";
import { sectorHref, sectorLabel } from "@/lib/sectors";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return allCanonicalSectorKeys().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const resolved = resolveSectorSlug(slug);
  const locale = await requestLocale();
  if (!resolved) return { title: t("notFound.title", locale), robots: { index: false } };

  const { key } = resolved;
  const canonical = sectorPageHref(key);
  const title = sectorLabel(key, locale);
  const description = sectorEditorialLead(key, locale);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function SektorDetailPage({ params }: Props) {
  const { slug } = await params;
  const resolved = resolveSectorSlug(slug);
  if (!resolved) notFound();
  if (!resolved.isCanonical) permanentRedirect(sectorPageHref(resolved.key));

  const { key } = resolved;
  const locale = await requestLocale();
  const origin = siteOrigin();
  const name = sectorLabel(key, locale);
  const lead = sectorEditorialLead(key, locale);
  const path = sectorPageHref(key);

  const schema = [
    collectionPage(origin, {
      path,
      name,
      description: lead,
      locale,
      items: [
        { name: `${name} — ${t("nav.screening", locale)}`, path: sectorHref(key, "fundamentals") },
        ...sectorRelatedAtlasSlugs(key).map((atlasSlug) => ({ name: getAtlasConcept(atlasSlug)?.title[locale] ?? atlasSlug, path: `/atlas/${atlasSlug}` })),
      ],
    }),
    breadcrumbList(origin, [
      { name: t("nav.dashboard", locale), path: "/" },
      { name: t("nav.sectors", locale), path: "/sektor" },
      { name, path },
    ]),
  ];

  return (
    <>
      <JsonLd data={schema} />
      <SectorDetailView sectorKey={key} />
    </>
  );
}
