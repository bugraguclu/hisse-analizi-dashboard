import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isKnownSector, SECTOR_LABELS, sectorHref, sectorLabel, titleCaseTr } from "./sectors.ts";

/** GET /sectors on 2026-09-27: every KAP sector key of the listed stocks. */
const API_KEYS = [
  "ana-metal-sanayi", "araci-kurumlar", "balikcilik-ve-su-urunleri", "bankalar", "bilgi-hizmet-faaliyetleri", "bilisim",
  "buro-yonetimi-buro-destegi-ve-diger-sirket-destek-faaliyetleri", "diger-imalat-sanayii", "diger-madencilik-ve-tas-ocakciligi",
  "elektrik-gaz-ve-buhar", "finansal-kiralama-ve-faktoring-sirketleri", "finansman-sirketleri", "gayrimenkul-faaliyetleri",
  "gayrimenkul-yatirim-ortakliklari", "gida-icecek-ve-tutun", "girisim-sermayesi-yatirim-ortakliklari",
  "ham-petrol-ve-dogal-gaz-cikartilmasi", "holdingler-ve-yatirim-sirketleri", "hukuk-ve-muhasebe-faaliyetleri",
  "insaat-ve-bayindirlik-isleri", "insan-sagligi-ve-sosyal-hizmetler", "kagit-ve-kagit-urunleri-basim",
  "kimya-ilac-petrol-lastik-ve-plastik-urunler", "kiralama-ve-leasing-faaliyetleri", "komur-ve-linyit-madenciligi", "konaklama",
  "menkul-kiymet-yatirim-ortakliklari", "metal-cevheri-madenciligi", "metal-esya-makine-elektrikli-cihazlar-ve-ulasim-araclari",
  "mimarlik-ve-muhendislik-faaliyetleri-teknik-muayene-ve-analiz", "orman-urunleri-ve-mobilya", "perakende-ticaret",
  "reklamcilik-ve-pazar-arastirmasi", "savunma",
  "seyahat-acentesi-tur-operatoru-ve-diger-rezervasyon-hizmetleri-ile-ilgili-faaliyetler", "sigorta-sirketleri",
  "spor-eglence-bos-zamanlari-degerlendirme-hizmetleri", "spor-faaliyetleri-eglence-ve-oyun-faaliyetleri",
  "tarim-ve-hayvancilik-avcilik-ve-ilgili-hizmet-faaliyetleri", "tas-ve-topraga-dayali", "tekstil-giyim-esyasi-ve-deri",
  "telekomunikasyon", "toptan-ticaret", "ulastirma-ve-depolama", "varlik-yonetim-sirketleri",
  "yaratici-sanatlar-gosteri-sanatlari-ve-eglence-faaliyetleri", "yayimcilik", "yiyecek-ve-icecek-hizmetleri",
];

describe("SECTOR_LABELS", () => {
  test("names every KAP sector in all three languages", () => {
    assert.equal(API_KEYS.length, 48);
    for (const key of API_KEYS) {
      assert.ok(isKnownSector(key), key);
      for (const locale of ["tr", "en", "fr"] as const) {
        const label = sectorLabel(key, locale);
        assert.ok(label.trim().length > 0 && label !== key, `${key} ${locale}`);
      }
    }
    assert.deepEqual(Object.keys(SECTOR_LABELS).sort(), [...API_KEYS].sort());
  });

  test("labels are unique per language (two KAP sectors never read the same)", () => {
    for (const locale of ["tr", "en", "fr"] as const) {
      const labels = API_KEYS.map((key) => sectorLabel(key, locale));
      assert.equal(new Set(labels).size, labels.length, locale);
    }
  });
});

describe("sectorLabel", () => {
  test("uses the curated name", () => {
    assert.equal(sectorLabel("bankalar", "tr"), "Bankalar");
    assert.equal(sectorLabel("bankalar", "en"), "Banks");
    assert.equal(sectorLabel("gida-icecek-ve-tutun", "fr"), "Alimentation, boissons et tabac");
  });

  test("falls back to KAP's name, then to the key", () => {
    assert.equal(sectorLabel("yeni-sektor", "tr", "YENİ SEKTÖR VE HİZMETLER"), "Yeni Sektör ve Hizmetler");
    assert.equal(sectorLabel("yeni-sektor", "en", "  "), "yeni-sektor");
    assert.equal(sectorLabel("yeni-sektor", "fr"), "yeni-sektor");
  });

  test("never resolves inherited object keys from a URL", () => {
    assert.equal(isKnownSector("constructor"), false);
    assert.equal(isKnownSector("__proto__"), false);
    assert.equal(sectorLabel("constructor", "tr"), "constructor");
  });
});

describe("titleCaseTr", () => {
  test("title-cases KAP capitals the Turkish way", () => {
    assert.equal(titleCaseTr("ULAŞTIRMA VE DEPOLAMA"), "Ulaştırma ve Depolama");
    assert.equal(titleCaseTr("İNŞAAT VE BAYINDIRLIK İŞLERİ"), "İnşaat ve Bayındırlık İşleri");
    assert.equal(titleCaseTr("GIDA, İÇECEK VE TÜTÜN"), "Gıda, İçecek ve Tütün");
    assert.equal(titleCaseTr("MALİ KURULUŞLAR"), "Mali Kuruluşlar");
  });

  test("keeps known abbreviations", () => {
    assert.equal(titleCaseTr("BIST YILDIZ PAZAR"), "BIST Yıldız Pazar");
    assert.equal(titleCaseTr("TÜRK HAVA YOLLARI A.O."), "Türk Hava Yolları A.O.");
  });
});

describe("sectorHref", () => {
  test("opens Hisse Tarama on the sector", () => {
    assert.equal(sectorHref("bankalar"), "/tarama?sector=bankalar");
    assert.equal(sectorHref("ulastirma-ve-depolama", "fundamentals"), "/tarama?sector=ulastirma-ve-depolama&view=fundamentals");
  });
});
