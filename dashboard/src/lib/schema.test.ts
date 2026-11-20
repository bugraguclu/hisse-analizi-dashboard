import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  absUrl,
  breadcrumbList,
  collectionPage,
  definedTermSchema,
  faqPage,
  serializeJsonLd,
  siteOrigin,
} from "./schema.ts";

test("canonical origin defaults to the deployed site and rejects non-web URLs", () => {
  const previousPublic = process.env.NEXT_PUBLIC_SITE_URL;
  const previousServer = process.env.SITE_URL;
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    assert.equal(siteOrigin(), "https://hisse-analizi.duckdns.org");
    process.env.NEXT_PUBLIC_SITE_URL = "javascript:alert(1)";
    assert.equal(siteOrigin(), "https://hisse-analizi.duckdns.org");
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/app";
    assert.equal(siteOrigin(), "https://example.test");
  } finally {
    if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previousPublic;
    if (previousServer === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = previousServer;
  }
});

describe("absUrl", () => {
  test("normalizes leading and trailing slashes consistently", () => {
    assert.equal(absUrl("https://hisseanalizi.com/", "/"), "https://hisseanalizi.com/");
    assert.equal(absUrl("https://hisseanalizi.com", "/atlas/fk-orani/"), "https://hisseanalizi.com/atlas/fk-orani");
    assert.equal(absUrl("https://hisseanalizi.com", "sektor/bankalar#top"), "https://hisseanalizi.com/sektor/bankalar#top");
  });
});

describe("structured data builders", () => {
  test("breadcrumbList numbers steps sequentially with canonical URLs", () => {
    const schema = breadcrumbList("https://hisseanalizi.com", [
      { name: "Piyasa Özeti", path: "/" },
      { name: "Endeksler", path: "/endeks" },
      { name: "BIST 100", path: "/endeks/bist-100" },
    ]);
    assert.equal(schema["@type"], "BreadcrumbList");
    assert.equal(schema.itemListElement.length, 3);
    assert.deepEqual(schema.itemListElement[2], {
      "@type": "ListItem",
      position: 3,
      name: "BIST 100",
      item: "https://hisseanalizi.com/endeks/bist-100",
    });
  });

  test("collectionPage outputs CollectionPage + ItemList", () => {
    const schema = collectionPage("https://hisseanalizi.com", {
      path: "/sektor/bankalar",
      name: "Bankalar",
      description: "BIST bankacılık sektörü şirketleri ve medyan oranları.",
      locale: "tr",
      items: [
        { name: "GARAN", path: "/hisse/GARAN" },
        { name: "AKBNK", path: "/hisse/AKBNK" },
      ],
    });
    assert.equal(schema["@type"], "CollectionPage");
    assert.equal(schema.inLanguage, "tr-TR");
    assert.equal(schema.mainEntity["@type"], "ItemList");
    assert.equal(schema.mainEntity.numberOfItems, 2);
    assert.equal(schema.mainEntity.itemListElement[0].url, "https://hisseanalizi.com/hisse/GARAN");
  });

  test("definedTermSchema and faqPage build valid schema nodes", () => {
    const term = definedTermSchema("https://hisseanalizi.com", {
      path: "/atlas/fk-orani",
      name: "F/K Oranı",
      description: "Fiyat / Kazanç oranı.",
      locale: "en",
    });
    assert.equal(term["@type"], "DefinedTerm");
    assert.equal(term.inLanguage, "en-US");
    assert.equal(term.inDefinedTermSet.url, "https://hisseanalizi.com/atlas");

    const faq = faqPage([{ question: "F/K nedir?", answer: "Fiyatın hisse başına kâra oranıdır." }]);
    assert.equal(faq["@type"], "FAQPage");
    assert.equal(faq.mainEntity.length, 1);
  });

  test("serializeJsonLd escapes script breakout characters", () => {
    const out = serializeJsonLd({ text: "</script><script>alert(1)</script>" });
    assert.ok(!out.includes("</script>"));
    assert.ok(out.includes("\\u003c/script>"));
  });
});
