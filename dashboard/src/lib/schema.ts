import type { Locale } from "./i18n";

const DEFAULT_ORIGIN = "https://hisseanalizi.com";

const IN_LANGUAGE: Record<Locale, string> = {
  tr: "tr-TR",
  en: "en-US",
  fr: "fr-FR",
};

/**
 * Canonical site origin used for <link rel="canonical">, sitemap.xml and JSON-LD.
 * Falls back to a stable production URL when NEXT_PUBLIC_SITE_URL is unset so
 * structured data always carries valid absolute URLs.
 */
export function siteOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? "").trim();
  if (!configured) return DEFAULT_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/**
 * Normalizes an internal route path against `origin` with no trailing slash
 * (except root "/"), matching Next.js's canonical URL convention.
 */
export function absUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, "");
  if (!path || path === "/") return `${base}/`;
  const [pathname, hash] = path.split("#");
  const normalized = `/${pathname.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return `${base}${normalized}${hash ? `#${hash}` : ""}`;
}

export interface SchemaCrumb {
  name: string;
  path: string;
}

/** Schema.org BreadcrumbList with every step carrying its canonical absolute URL. */
export function breadcrumbList(origin: string, trail: readonly SchemaCrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absUrl(origin, crumb.path),
    })),
  };
}

export interface CollectionSchemaItem {
  name: string;
  path: string;
}

/**
 * Schema.org CollectionPage + ItemList for canonical discovery pages
 * (/atlas, /endeks, /endeks/[slug], /sektor, /sektor/[slug]).
 */
export function collectionPage(
  origin: string,
  opts: {
    path: string;
    name: string;
    description: string;
    locale?: Locale;
    items: readonly CollectionSchemaItem[];
  },
) {
  const url = absUrl(origin, opts.path);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: opts.name,
    description: opts.description,
    inLanguage: IN_LANGUAGE[opts.locale ?? "tr"],
    isPartOf: { "@id": `${origin.replace(/\/+$/, "")}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: absUrl(origin, item.path),
      })),
    },
  };
}

export interface FaqSchemaItem {
  question: string;
  answer: string;
}

/** Schema.org FAQPage for the concept atlas hub and concept detail pages. */
export function faqPage(items: readonly FaqSchemaItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

/** Schema.org DefinedTerm node for an individual investment concept in /atlas/[slug]. */
export function definedTermSchema(
  origin: string,
  opts: {
    path: string;
    name: string;
    description: string;
    setPath?: string;
    setName?: string;
    locale?: Locale;
  },
) {
  const url = absUrl(origin, opts.path);
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    "@id": `${url}#term`,
    url,
    name: opts.name,
    description: opts.description,
    inLanguage: IN_LANGUAGE[opts.locale ?? "tr"],
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: opts.setName ?? "Hisse Analizi Yatırım Kavram Atlası",
      url: absUrl(origin, opts.setPath ?? "/atlas"),
    },
  };
}

/**
 * Escapes `<` so embedded JSON-LD can never break out of a `<script>` tag.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
