import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findGuidesByIndicator,
  findGuidesByMetric,
  getContentManifest,
  resolveScreenPath,
} from "./content-manifest.ts";
import { validateWorkspace } from "../../scripts/content-validator.mjs";

const DASHBOARD_ROOT = path.resolve(import.meta.dirname, "../..");

describe("content-manifest publish vs preview boundary", () => {
  it("strips draft entries in production mode and exposes them in preview mode", () => {
    const published = getContentManifest();
    const preview = getContentManifest({ includeDrafts: true });

    assert.ok(published.guides.every((g) => g.status === "published"));
    assert.ok(preview.guides.some((g) => g.status === "draft"));
    assert.ok(preview.guides.length > published.guides.length);
  });

  it("looks up guides by metric or indicator and resolves dynamic stock paths", () => {
    assert.ok(findGuidesByMetric("pe").some((g) => g.id === "valuation-multiples"));
    assert.ok(findGuidesByIndicator("rsi").some((g) => g.id === "technical-momentum"));
    assert.equal(resolveScreenPath("stock-technical", { ticker: "thyao" }), "/teknik/THYAO");
    assert.equal(resolveScreenPath("screener"), "/tarama");
    assert.equal(resolveScreenPath("missing-screen"), null);
  });
});

describe("content-validator pre-build checks", () => {
  it("passes cleanly on the current workspace (Web + iOS)", () => {
    const result = validateWorkspace({ dashboardRoot: DASHBOARD_ROOT });
    assert.equal(result.problems.length, 0);
    assert.ok(result.stats.screens >= 8);
    assert.ok(result.stats.i18nKeys > 1000);
    assert.equal(result.stats.checkedMobileRoutes, true);
  });

  it("catches broken metric, indicator, web/iOS screen, and published->draft references", () => {
    const live = getContentManifest({ includeDrafts: true });
    const broken = structuredClone(live) as unknown as {
      schemaVersion: number;
      screens: Array<Record<string, unknown>>;
      metrics: Array<Record<string, unknown>>;
      guides: Array<Record<string, unknown>>;
    };

    broken.screens[0].webPath = "/olmayan-web-sayfasi";
    broken.screens[0].iosRoute = "/olmayan-ios-ekrani";
    broken.metrics[0].screenerRangeKey = "removed_metric_key";
    broken.metrics[0].indicatorKind = "removed_indicator";
    broken.guides[0].relatedGuideIds = ["draft-sector-medians"];

    const result = validateWorkspace({
      dashboardRoot: DASHBOARD_ROOT,
      manifestOverride: broken,
    });

    const titles = result.problems.map((p: { title: string }) => p.title);
    assert.ok(titles.some((t: string) => t.includes("kırık web yoluna")));
    assert.ok(titles.some((t: string) => t.includes("kırık iOS yoluna")));
    assert.ok(titles.some((t: string) => t.includes("kaldırılmış veya tanımsız tarama kriterine")));
    assert.ok(titles.some((t: string) => t.includes("tanımsız grafik göstergesine")));
    assert.ok(titles.some((t: string) => t.includes("taslak rehbere bağlı")));
  });
});
