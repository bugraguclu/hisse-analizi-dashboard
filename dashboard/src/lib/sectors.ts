import type { Locale } from "./i18n";

type Entry = { tr: string; en: string; fr: string };

/**
 * KAP sectors — the sector a stock is compared with (sector medians on the stock
 * pages, the SEKTÖR filter and sector screens of /tarama; backend:
 * src/services/sector_service.py). Keys are the backend's `sector_key()` of KAP's
 * name ("GIDA, İÇECEK VE TÜTÜN" → "gida-icecek-ve-tutun"). KAP writes the names in
 * capitals and drops some commas; these are the readable forms, the longest ones
 * shortened a little. A sector missing here falls back to KAP's own name.
 */
export const SECTOR_LABELS: Readonly<Record<string, Entry>> = {
  "ana-metal-sanayi": { tr: "Ana Metal Sanayi", en: "Basic Metals", fr: "Métallurgie de base" },
  "araci-kurumlar": { tr: "Aracı Kurumlar", en: "Brokerage Houses", fr: "Sociétés de bourse" },
  "balikcilik-ve-su-urunleri": { tr: "Balıkçılık ve Su Ürünleri", en: "Fishing and Aquaculture", fr: "Pêche et aquaculture" },
  bankalar: { tr: "Bankalar", en: "Banks", fr: "Banques" },
  "bilgi-hizmet-faaliyetleri": { tr: "Bilgi Hizmet Faaliyetleri", en: "Information Services", fr: "Services d'information" },
  bilisim: { tr: "Bilişim", en: "Information Technology", fr: "Informatique" },
  "buro-yonetimi-buro-destegi-ve-diger-sirket-destek-faaliyetleri": {
    tr: "Büro Yönetimi ve Şirket Destek Faaliyetleri",
    en: "Office Administration and Business Support",
    fr: "Services administratifs et de soutien aux entreprises",
  },
  "diger-imalat-sanayii": { tr: "Diğer İmalat Sanayii", en: "Other Manufacturing", fr: "Autres industries manufacturières" },
  "diger-madencilik-ve-tas-ocakciligi": {
    tr: "Diğer Madencilik ve Taş Ocakçılığı",
    en: "Other Mining and Quarrying",
    fr: "Autres industries extractives",
  },
  "elektrik-gaz-ve-buhar": { tr: "Elektrik, Gaz ve Buhar", en: "Electricity, Gas and Steam", fr: "Électricité, gaz et vapeur" },
  "finansal-kiralama-ve-faktoring-sirketleri": {
    tr: "Finansal Kiralama ve Faktoring Şirketleri",
    en: "Leasing and Factoring Companies",
    fr: "Crédit-bail et affacturage",
  },
  "finansman-sirketleri": { tr: "Finansman Şirketleri", en: "Finance Companies", fr: "Sociétés de financement" },
  "gayrimenkul-faaliyetleri": { tr: "Gayrimenkul Faaliyetleri", en: "Real Estate Activities", fr: "Activités immobilières" },
  "gayrimenkul-yatirim-ortakliklari": {
    tr: "Gayrimenkul Yatırım Ortaklıkları",
    en: "Real Estate Investment Trusts",
    fr: "Sociétés d'investissement immobilier",
  },
  "gida-icecek-ve-tutun": { tr: "Gıda, İçecek ve Tütün", en: "Food, Beverages and Tobacco", fr: "Alimentation, boissons et tabac" },
  "girisim-sermayesi-yatirim-ortakliklari": {
    tr: "Girişim Sermayesi Yatırım Ortaklıkları",
    en: "Venture Capital Investment Trusts",
    fr: "Sociétés de capital-risque",
  },
  "ham-petrol-ve-dogal-gaz-cikartilmasi": {
    tr: "Ham Petrol ve Doğal Gaz Çıkartılması",
    en: "Crude Oil and Natural Gas Extraction",
    fr: "Extraction de pétrole et de gaz naturel",
  },
  "holdingler-ve-yatirim-sirketleri": {
    tr: "Holdingler ve Yatırım Şirketleri",
    en: "Holding and Investment Companies",
    fr: "Holdings et sociétés d'investissement",
  },
  "hukuk-ve-muhasebe-faaliyetleri": {
    tr: "Hukuk ve Muhasebe Faaliyetleri",
    en: "Legal and Accounting Activities",
    fr: "Activités juridiques et comptables",
  },
  "insaat-ve-bayindirlik-isleri": { tr: "İnşaat ve Bayındırlık İşleri", en: "Construction and Public Works", fr: "Construction et travaux publics" },
  "insan-sagligi-ve-sosyal-hizmetler": {
    tr: "İnsan Sağlığı ve Sosyal Hizmetler",
    en: "Health and Social Services",
    fr: "Santé humaine et action sociale",
  },
  "kagit-ve-kagit-urunleri-basim": {
    tr: "Kağıt ve Kağıt Ürünleri, Basım",
    en: "Paper, Paper Products and Printing",
    fr: "Papier, carton et imprimerie",
  },
  "kimya-ilac-petrol-lastik-ve-plastik-urunler": {
    tr: "Kimya, İlaç, Petrol, Lastik ve Plastik Ürünler",
    en: "Chemicals, Pharmaceuticals, Petroleum, Rubber and Plastics",
    fr: "Chimie, pharmacie, pétrole, caoutchouc et plastiques",
  },
  "kiralama-ve-leasing-faaliyetleri": { tr: "Kiralama ve Leasing Faaliyetleri", en: "Rental and Leasing", fr: "Location et location-bail" },
  "komur-ve-linyit-madenciligi": { tr: "Kömür ve Linyit Madenciliği", en: "Coal and Lignite Mining", fr: "Extraction de houille et de lignite" },
  konaklama: { tr: "Konaklama", en: "Accommodation", fr: "Hébergement" },
  "menkul-kiymet-yatirim-ortakliklari": {
    tr: "Menkul Kıymet Yatırım Ortaklıkları",
    en: "Securities Investment Trusts",
    fr: "Sociétés d'investissement en valeurs mobilières",
  },
  "metal-cevheri-madenciligi": { tr: "Metal Cevheri Madenciliği", en: "Metal Ore Mining", fr: "Extraction de minerais métalliques" },
  "metal-esya-makine-elektrikli-cihazlar-ve-ulasim-araclari": {
    tr: "Metal Eşya, Makine, Elektrikli Cihazlar ve Ulaşım Araçları",
    en: "Metal Products, Machinery, Electrical Equipment and Vehicles",
    fr: "Produits métalliques, machines, équipements électriques et véhicules",
  },
  "mimarlik-ve-muhendislik-faaliyetleri-teknik-muayene-ve-analiz": {
    tr: "Mimarlık, Mühendislik, Teknik Muayene ve Analiz",
    en: "Architecture, Engineering and Technical Testing",
    fr: "Architecture, ingénierie et contrôle technique",
  },
  "orman-urunleri-ve-mobilya": { tr: "Orman Ürünleri ve Mobilya", en: "Wood Products and Furniture", fr: "Bois et ameublement" },
  "perakende-ticaret": { tr: "Perakende Ticaret", en: "Retail Trade", fr: "Commerce de détail" },
  "reklamcilik-ve-pazar-arastirmasi": {
    tr: "Reklamcılık ve Pazar Araştırması",
    en: "Advertising and Market Research",
    fr: "Publicité et études de marché",
  },
  savunma: { tr: "Savunma", en: "Defence", fr: "Défense" },
  "seyahat-acentesi-tur-operatoru-ve-diger-rezervasyon-hizmetleri-ile-ilgili-faaliyetler": {
    tr: "Seyahat Acentesi, Tur Operatörü ve Rezervasyon Hizmetleri",
    en: "Travel Agencies, Tour Operators and Reservations",
    fr: "Agences de voyage, voyagistes et réservation",
  },
  "sigorta-sirketleri": { tr: "Sigorta Şirketleri", en: "Insurance Companies", fr: "Compagnies d'assurance" },
  "spor-eglence-bos-zamanlari-degerlendirme-hizmetleri": {
    tr: "Spor, Eğlence ve Boş Zaman Hizmetleri",
    en: "Sports, Entertainment and Leisure Services",
    fr: "Sports, divertissement et loisirs",
  },
  "spor-faaliyetleri-eglence-ve-oyun-faaliyetleri": {
    tr: "Spor, Eğlence ve Oyun Faaliyetleri",
    en: "Sports, Amusement and Recreation",
    fr: "Activités sportives, récréatives et de loisirs",
  },
  "tarim-ve-hayvancilik-avcilik-ve-ilgili-hizmet-faaliyetleri": {
    tr: "Tarım, Hayvancılık, Avcılık ve İlgili Hizmetler",
    en: "Agriculture, Livestock and Hunting",
    fr: "Agriculture, élevage et chasse",
  },
  "tas-ve-topraga-dayali": { tr: "Taş ve Toprağa Dayalı", en: "Non-Metallic Mineral Products", fr: "Produits minéraux non métalliques" },
  "tekstil-giyim-esyasi-ve-deri": { tr: "Tekstil, Giyim Eşyası ve Deri", en: "Textiles, Apparel and Leather", fr: "Textile, habillement et cuir" },
  telekomunikasyon: { tr: "Telekomünikasyon", en: "Telecommunications", fr: "Télécommunications" },
  "toptan-ticaret": { tr: "Toptan Ticaret", en: "Wholesale Trade", fr: "Commerce de gros" },
  "ulastirma-ve-depolama": { tr: "Ulaştırma ve Depolama", en: "Transportation and Storage", fr: "Transport et entreposage" },
  "varlik-yonetim-sirketleri": { tr: "Varlık Yönetim Şirketleri", en: "Asset Management Companies", fr: "Sociétés de gestion d'actifs" },
  "yaratici-sanatlar-gosteri-sanatlari-ve-eglence-faaliyetleri": {
    tr: "Yaratıcı Sanatlar, Gösteri Sanatları ve Eğlence",
    en: "Arts, Performing Arts and Entertainment",
    fr: "Arts, spectacles et divertissement",
  },
  yayimcilik: { tr: "Yayımcılık", en: "Publishing", fr: "Édition" },
  "yiyecek-ve-icecek-hizmetleri": { tr: "Yiyecek ve İçecek Hizmetleri", en: "Food and Beverage Services", fr: "Restauration" },
};

/**
 * A few abbreviations that keep their canonical casing instead of being title-cased,
 * keyed by their Turkish lower case (the dotted-I rule turns "BIST" into "bıst").
 */
const KEEP_CASE_TR: ReadonlyMap<string, string> = new Map(
  ["BIST", "A.O.", "A.Ş.", "T.A.Ş."].map((word) => [word.toLocaleLowerCase("tr-TR"), word]),
);

/** Conjunctions/particles that stay lower-case inside a title ("… ve Depolama"). */
const LOWER_WORDS_TR = new Set(["ve", "ile", "veya", "ya", "da", "de", "ki", "için"]);

/** "ULAŞTIRMA VE DEPOLAMA" → "Ulaştırma ve Depolama" (Turkish-aware; KAP writes sectors and markets
 *  in capitals). A couple of known abbreviations keep their canonical casing. */
export function titleCaseTr(raw: string): string {
  return raw
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .map(
      (word, index) =>
        KEEP_CASE_TR.get(word) ??
        (index > 0 && LOWER_WORDS_TR.has(word)
          ? word
          : // First letter, even after an opening "(" or quote.
            word.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("tr-TR"))),
    )
    .join(" ");
}

/** Whether `key` is a KAP sector listed above (own keys only: "constructor" from a URL is not one). */
export function isKnownSector(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(SECTOR_LABELS, key);
}

/** Display name of a KAP sector key; an unlisted one falls back to KAP's name, title-cased, then to the key. */
export function sectorLabel(key: string, locale: Locale, kapName?: string | null): string {
  if (isKnownSector(key)) return SECTOR_LABELS[key][locale];
  return kapName?.trim() ? titleCaseTr(kapName) : key;
}

/** Hisse Tarama narrowed to one KAP sector; the table then opens with the sector's medians on top. */
export function sectorHref(key: string, view?: "fundamentals"): string {
  const params = new URLSearchParams({ sector: key });
  if (view) params.set("view", view);
  return `/tarama?${params.toString()}`;
}
