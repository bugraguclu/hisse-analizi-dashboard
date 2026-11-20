import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ATLAS_CONCEPTS } from "./atlas.ts";
import {
  allCanonicalSectorKeys,
  computeGroupMetrics,
  DISCOVERY_INDICES,
  FEATURED_SECTORS,
  indexPageHref,
  resolveIndexSlug,
  resolveSectorSlug,
  searchDiscovery,
  SECTOR_ALIASES,
  sectorEditorialLead,
  sectorPageHref,
} from "./discovery.ts";
import { isKnownSector } from "./sectors.ts";

describe("DISCOVERY_INDICES", () => {
  test("every index has a unique canonical slug, valid code, TR/EN/FR text and valid Atlas references", () => {
    const atlasSlugs = new Set(ATLAS_CONCEPTS.map((c) => c.slug));
    const slugs = new Set<string>();
    const codes = new Set<string>();

    assert.equal(DISCOVERY_INDICES.length, 14);
    for (const idx of DISCOVERY_INDICES) {
      assert.match(idx.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(!slugs.has(idx.slug), idx.slug);
      assert.ok(!codes.has(idx.code), idx.code);
      slugs.add(idx.slug);
      codes.add(idx.code);

      for (const locale of ["tr", "en", "fr"] as const) {
        assert.ok(idx.name[locale].trim().length > 0);
        assert.ok(idx.shortDesc[locale].trim().length > 0);
        assert.ok(idx.lead[locale].trim().length > 0);
        assert.ok(idx.methodology[locale].trim().length > 0);
      }

      for (const slug of idx.relatedAtlasSlugs) {
        assert.ok(atlasSlugs.has(slug), `${idx.slug} references unknown atlas slug ${slug}`);
      }
    }
  });

  test("resolveIndexSlug resolves canonical slugs and redirects index codes", () => {
    assert.deepEqual(
      resolveIndexSlug("bist-100"),
      { entry: DISCOVERY_INDICES[0], isCanonical: true },
    );
    const byCode = resolveIndexSlug("XU100");
    assert.equal(byCode?.entry.slug, "bist-100");
    assert.equal(byCode?.isCanonical, false);

    const byLowerCode = resolveIndexSlug("xbank");
    assert.equal(byLowerCode?.entry.slug, "bist-banka");
    assert.equal(byLowerCode?.isCanonical, false);

    assert.equal(resolveIndexSlug("unknown"), null);
    assert.equal(indexPageHref("XU100"), "/endeks/bist-100");
    assert.equal(indexPageHref("bist-banka"), "/endeks/bist-banka");
  });
});

describe("Canonical KAP sectors and aliases", () => {
  test("all aliases and featured sectors map to real KAP sectors", () => {
    for (const [alias, target] of Object.entries(SECTOR_ALIASES)) {
      assert.ok(isKnownSector(target), `alias ${alias} points to unknown sector ${target}`);
      const resolved = resolveSectorSlug(alias);
      assert.equal(resolved?.key, target);
      assert.equal(resolved?.isCanonical, false);
    }

    for (const key of FEATURED_SECTORS) {
      assert.ok(isKnownSector(key), `featured sector ${key} unknown`);
      const resolved = resolveSectorSlug(key);
      assert.equal(resolved?.key, key);
      assert.equal(resolved?.isCanonical, true);
    }

    assert.equal(allCanonicalSectorKeys().length, 48);
    assert.equal(resolveSectorSlug("bankacilik")?.key, "bankalar");
    assert.equal(resolveSectorSlug("bankacilik")?.isCanonical, false);
    assert.equal(resolveSectorSlug("bankalar")?.isCanonical, true);
    assert.equal(resolveSectorSlug("constructor"), null);
    assert.equal(sectorPageHref("bankalar"), "/sektor/bankalar");
  });

  test("every canonical sector produces non-empty editorial copy in TR/EN/FR", () => {
    for (const key of allCanonicalSectorKeys()) {
      for (const locale of ["tr", "en", "fr"] as const) {
        assert.ok(sectorEditorialLead(key, locale).trim().length > 20);
      }
    }
  });
});

describe("computeGroupMetrics", () => {
  test("computes total market cap, breadth and medians with MIN_SECTOR_COMPANIES=3", () => {
    const metrics = computeGroupMetrics([
      { symbol: "AAA", market_cap: 100e9, pe: 5, pb: 1.0, roe: 30, dividend_yield: 4, change_pct: 2.1 },
      { symbol: "BBB", market_cap: 200e9, pe: 10, pb: 1.5, roe: 20, dividend_yield: 6, change_pct: -1.2 },
      { symbol: "CCC", market_cap: 50e9, pe: 20, pb: 2.0, roe: -5, dividend_yield: 0, change_pct: 0 },
    ]);
    assert.equal(metrics.count, 3);
    assert.equal(metrics.totalMarketCap, 350e9);
    assert.deepEqual(metrics.breadth, { up: 1, down: 1, flat: 1 });
    assert.equal(metrics.medians.pe, 10);
    assert.equal(metrics.medians.pb, 1.5);
    assert.equal(metrics.medians.roe, 20);
    // Only 2 dividend payers (0 does not count toward positive rule) -> no median.
    assert.equal(metrics.medians.dividend_yield, undefined);
    assert.equal(metrics.counts.dividend_yield, 2);
  });
});

describe("searchDiscovery", () => {
  test("matches canonical indices and sectors including aliases", () => {
    const bist100 = searchDiscovery("BIST 100", "tr");
    assert.equal(bist100[0]?.href, "/endeks/bist-100");

    const xbank = searchDiscovery("XBANK", "tr");
    assert.equal(xbank[0]?.href, "/endeks/bist-banka");

    const banking = searchDiscovery("bankacılık", "tr");
    assert.equal(banking.some((hit) => hit.href === "/sektor/bankalar"), true);
  });
});
