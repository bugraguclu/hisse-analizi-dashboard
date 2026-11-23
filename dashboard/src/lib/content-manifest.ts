import manifestJson from "../../content/manifest.json" with { type: "json" };
import type { Locale } from "./i18n";

export type ContentStatus = "published" | "draft";

export interface LocalizedText {
  tr: string;
  en: string;
  fr: string;
}

export interface ScreenContract {
  id: string;
  webPath: string;
  iosRoute: string;
  navKey?: string;
  title: LocalizedText;
}

export interface MetricContract {
  id: string;
  status: ContentStatus;
  category: "valuation" | "profitability" | "technical" | "scale" | "macro";
  screenerRangeKey?: string;
  screenerPresetIds?: readonly string[];
  indicatorKind?: string;
  screenId: string;
  title: LocalizedText;
  summary: LocalizedText;
  source: LocalizedText;
}

export interface GuideContract {
  id: string;
  slug: string;
  status: ContentStatus;
  screenId: string;
  metricIds: readonly string[];
  presetIds: readonly string[];
  indicatorKinds: readonly string[];
  relatedGuideIds: readonly string[];
  title: LocalizedText;
  summary: LocalizedText;
}

export interface ContentManifest {
  schemaVersion: number;
  screens: readonly ScreenContract[];
  metrics: readonly MetricContract[];
  guides: readonly GuideContract[];
}

const RAW_MANIFEST = manifestJson as ContentManifest;

export interface ManifestReadOptions {
  /** Only true in explicit editorial preview environments; production always strips drafts. */
  includeDrafts?: boolean;
}

/**
 * Returns the content manifest filtered by publish boundary.
 * Production builds only expose `status === "published"` records; future editorial previews can
 * opt into `includeDrafts: true` without shipping draft links to live users.
 */
export function getContentManifest({ includeDrafts = false }: ManifestReadOptions = {}): ContentManifest {
  if (includeDrafts) return RAW_MANIFEST;
  return {
    schemaVersion: RAW_MANIFEST.schemaVersion,
    screens: RAW_MANIFEST.screens,
    metrics: RAW_MANIFEST.metrics.filter((item) => item.status === "published"),
    guides: RAW_MANIFEST.guides.filter((item) => item.status === "published"),
  };
}

export function localizedContent(text: LocalizedText, locale: Locale): string {
  return text[locale] ?? text.tr;
}

export function findGuidesByMetric(metricId: string, options?: ManifestReadOptions): readonly GuideContract[] {
  return getContentManifest(options).guides.filter((guide) => guide.metricIds.includes(metricId));
}

export function findGuidesByIndicator(indicatorKind: string, options?: ManifestReadOptions): readonly GuideContract[] {
  return getContentManifest(options).guides.filter((guide) => guide.indicatorKinds.includes(indicatorKind));
}

export function resolveScreenPath(
  screenId: string,
  params?: { ticker?: string },
  options?: ManifestReadOptions,
): string | null {
  const screen = getContentManifest(options).screens.find((item) => item.id === screenId);
  if (!screen) return null;
  if (screen.webPath.includes("[ticker]")) {
    const ticker = (params?.ticker ?? "THYAO").trim().toUpperCase();
    return screen.webPath.replace("[ticker]", encodeURIComponent(ticker));
  }
  return screen.webPath;
}
