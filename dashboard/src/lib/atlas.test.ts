import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ATLAS_CATEGORIES,
  ATLAS_CATEGORY_LABELS,
  ATLAS_CONCEPTS,
  ATLAS_FAQS,
  atlasHref,
  getAtlasConcept,
  getRelatedConcepts,
  searchAtlasConcepts,
} from "./atlas.ts";

describe("ATLAS_CONCEPTS contract", () => {
  test("every concept has a unique canonical slug, complete TR/EN/FR copy, valid actions and valid relatedSlugs", () => {
    assert.ok(ATLAS_CONCEPTS.length >= 8);
    const slugs = new Set<string>();

    for (const concept of ATLAS_CONCEPTS) {
      assert.match(concept.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `invalid slug: ${concept.slug}`);
      assert.ok(!slugs.has(concept.slug), `duplicate slug: ${concept.slug}`);
      slugs.add(concept.slug);
      assert.ok(ATLAS_CATEGORIES.includes(concept.category), concept.category);
      assert.ok(concept.badge.trim().length > 0, concept.slug);
      assert.ok(concept.actions.length >= 1, `missing actions on ${concept.slug}`);
      assert.ok(concept.keywords.length >= 2, `missing keywords on ${concept.slug}`);

      for (const locale of ["tr", "en", "fr"] as const) {
        assert.ok(concept.title[locale].trim().length > 0, `${concept.slug} title ${locale}`);
        assert.ok(concept.cardDesc[locale].trim().length > 0, `${concept.slug} cardDesc ${locale}`);
        assert.ok(concept.question[locale].trim().length > 0, `${concept.slug} question ${locale}`);
        assert.ok(concept.intro[locale].trim().length > 0, `${concept.slug} intro ${locale}`);
        assert.ok(concept.methodology[locale].trim().length > 0, `${concept.slug} methodology ${locale}`);
        assert.ok(concept.source[locale].trim().length > 0, `${concept.slug} source ${locale}`);
        assert.ok(concept.points[locale].length >= 2, `${concept.slug} points ${locale}`);
      }

      for (const action of concept.actions) {
        assert.ok(action.href.startsWith("/"), `${concept.slug} action href must be internal: ${action.href}`);
        for (const locale of ["tr", "en", "fr"] as const) {
          assert.ok(action.label[locale].trim().length > 0);
          assert.ok(action.description[locale].trim().length > 0);
        }
      }
    }

    for (const concept of ATLAS_CONCEPTS) {
      for (const rel of concept.relatedSlugs) {
        assert.ok(slugs.has(rel), `${concept.slug} references unknown related slug ${rel}`);
        assert.notEqual(rel, concept.slug, `${concept.slug} must not reference itself`);
      }
      assert.equal(getRelatedConcepts(concept).length, concept.relatedSlugs.length);
    }
  });

  test("categories and FAQs cover all three locales", () => {
    for (const cat of ATLAS_CATEGORIES) {
      for (const locale of ["tr", "en", "fr"] as const) {
        assert.ok(ATLAS_CATEGORY_LABELS[cat][locale].trim().length > 0);
      }
    }
    assert.ok(ATLAS_FAQS.length >= 3);
    for (const faq of ATLAS_FAQS) {
      for (const locale of ["tr", "en", "fr"] as const) {
        assert.ok(faq.question[locale].trim().length > 0);
        assert.ok(faq.answer[locale].trim().length > 0);
      }
    }
  });
});

describe("getAtlasConcept and searchAtlasConcepts", () => {
  test("resolves concepts by slug and builds canonical hrefs", () => {
    assert.equal(getAtlasConcept("fk-orani")?.badge, "F/K");
    assert.equal(getAtlasConcept("FK-ORANI")?.slug, "fk-orani");
    assert.equal(getAtlasConcept("olmayan-kavram"), null);
    assert.equal(atlasHref(), "/atlas");
    assert.equal(atlasHref("fk-orani"), "/atlas/fk-orani");
  });

  test("finds F/K, TTM, reel getiri, RSI and banka/sanayi queries", () => {
    assert.equal(searchAtlasConcepts("F/K", "tr")[0]?.slug, "fk-orani");
    assert.equal(searchAtlasConcepts("TTM", "tr")[0]?.slug, "ttm-son-12-ay");
    assert.equal(searchAtlasConcepts("reel getiri", "tr")[0]?.slug, "reel-getiri");
    assert.equal(searchAtlasConcepts("RSI", "tr")[0]?.slug, "rsi");
    assert.equal(searchAtlasConcepts("enflasyon", "tr")[0]?.slug, "reel-getiri");
    assert.equal(searchAtlasConcepts("banka", "tr").some((c) => c.slug === "banka-ve-sanayi-oranlari"), true);
    assert.equal(searchAtlasConcepts("dividend", "en")[0]?.slug, "temettu-verimi");
  });
});
