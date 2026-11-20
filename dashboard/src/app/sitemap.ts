import type { MetadataRoute } from "next";
import { ATLAS_CONCEPTS, atlasHref } from "@/lib/atlas";
import { allCanonicalSectorKeys, DISCOVERY_INDICES, indexPageHref, sectorPageHref } from "@/lib/discovery";
import { absUrl, siteOrigin } from "@/lib/schema";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();

  const coreRoutes: MetadataRoute.Sitemap = [
    { url: absUrl(origin, "/"), changeFrequency: "hourly", priority: 1 },
    { url: absUrl(origin, "/tarama"), changeFrequency: "hourly", priority: 0.9 },
    { url: absUrl(origin, "/makro"), changeFrequency: "daily", priority: 0.8 },
    { url: absUrl(origin, "/events"), changeFrequency: "hourly", priority: 0.8 },
    { url: absUrl(origin, "/atlas"), changeFrequency: "weekly", priority: 0.85 },
    { url: absUrl(origin, "/endeks"), changeFrequency: "daily", priority: 0.85 },
    { url: absUrl(origin, "/sektor"), changeFrequency: "daily", priority: 0.85 },
  ];

  const atlasRoutes: MetadataRoute.Sitemap = ATLAS_CONCEPTS.map((concept) => ({
    url: absUrl(origin, atlasHref(concept.slug)),
    changeFrequency: "monthly",
    priority: 0.75,
  }));

  const indexRoutes: MetadataRoute.Sitemap = DISCOVERY_INDICES.map((item) => ({
    url: absUrl(origin, indexPageHref(item.slug)),
    changeFrequency: "daily",
    priority: 0.8,
  }));

  const sectorRoutes: MetadataRoute.Sitemap = allCanonicalSectorKeys().map((key) => ({
    url: absUrl(origin, sectorPageHref(key)),
    changeFrequency: "daily",
    priority: 0.75,
  }));

  return [...coreRoutes, ...atlasRoutes, ...indexRoutes, ...sectorRoutes];
}
