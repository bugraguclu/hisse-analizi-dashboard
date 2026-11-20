import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { SectorDetailView } from "@/components/discovery/SectorDetailView";
import { JsonLd } from "@/components/shared/JsonLd";
import {
  allCanonicalSectorKeys,
  resolveSectorSlug,
  sectorEditorialLead,
  sectorPageHref,
  sectorRelatedAtlasSlugs,
} from "@/lib/discovery";
import { LOCALE_COOKIE, parseLocale, t, type Locale } from "@/lib/i18n";
import { breadcrumbList, collectionPage, siteOrigin } from "@/lib/schema";
import { sectorHref, sectorLabel } from "@/lib/sectors";

type Props = { params: Promise<{ slug: string }> };

async function requestLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
}

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
        ...sectorRelatedAtlasSlugs(key).map((atlasSlug) => ({ name: atlasSlug, path: `/atlas/${atlasSlug}` })),
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
