/**
 * Canonical Index & Sector Discovery Registry.
 *
 * Single source of truth for permanent shareable discovery URLs:
 * - /endeks and /endeks/[slug] (all 14 curated BIST indices)
 * - /sektor and /sektor/[slug] (all 48 KAP sectors + canonical alias redirects)
 *
 * Pure module (no React) so canonical routing, alias resolution, group medians
 * and search matching are verified directly under `node --test`.
 */
import type { Locale } from "./i18n";
import { isKnownSector, SECTOR_LABELS, sectorLabel } from "./sectors.ts";
import { foldTr } from "../components/shared/search/fold.ts";
import {
  breadth,
  countsToward,
  median,
  MIN_SECTOR_COMPANIES,
  SECTOR_MEDIAN_RULES,
  type NumericField,
  type PresetId,
  type Row,
} from "../components/tarama/model.ts";

export type LocalizedText = Readonly<Record<Locale, string>>;

export type IndexGroup = "headline" | "sector" | "thematic";

export interface DiscoveryIndex {
  /** Single canonical URL slug, e.g. "bist-100". */
  slug: string;
  /** BIST index ticker code accepted by /market/index/{code} & /tarama?idx={code}. */
  code: string;
  group: IndexGroup;
  name: LocalizedText;
  shortDesc: LocalizedText;
  lead: LocalizedText;
  methodology: LocalizedText;
  relatedAtlasSlugs: readonly string[];
  presetIds: readonly PresetId[];
}

export const INDEX_GROUP_LABELS: Readonly<Record<IndexGroup, LocalizedText>> = {
  headline: { tr: "Ana Endeksler", en: "Headline Indices", fr: "Indices principaux" },
  sector: { tr: "Sektör Endeksleri", en: "Sector Indices", fr: "Indices sectoriels" },
  thematic: { tr: "Tematik Endeksler", en: "Thematic Indices", fr: "Indices thématiques" },
};

/** All 14 curated screening-universe BIST indices (mirrors backend UNIVERSE_INDICES). */
export const DISCOVERY_INDICES: readonly DiscoveryIndex[] = [
  {
    slug: "bist-100",
    code: "XU100",
    group: "headline",
    name: { tr: "BIST 100", en: "BIST 100", fr: "BIST 100" },
    shortDesc: {
      tr: "Borsa İstanbul'un ana gösterge endeksi; piyasa değeri ve işlem hacmi en yüksek 100 şirket.",
      en: "Borsa Istanbul's flagship benchmark tracking the 100 largest and most liquid stocks.",
      fr: "Indice phare de Borsa Istanbul regroupant les 100 valeurs les plus liquides et capitalisées.",
    },
    lead: {
      tr: "BIST 100 (XU100), Yıldız Pazar'da işlem gören şirketler arasından fiili dolaşımdaki payların piyasa değeri ve günlük ortalama işlem hacmine göre seçilen 100 hisseyi kapsar. Türkiye hisse senedi piyasasının temel performans ölçütüdür.",
      en: "BIST 100 (XU100) selects 100 Yıldız Market stocks by free-float market capitalization and daily trading volume, serving as the primary benchmark of the Turkish equity market.",
      fr: "Le BIST 100 (XU100) réunit les 100 actions les plus importantes du marché Yıldız selon la capitalisation flottante et le volume échangé.",
    },
    methodology: {
      tr: "Bileşen listesi Borsa İstanbul resmî endeks duyurularından alınır; medyan çarpanlar yalnızca geçerli verisi olan bileşenler üzerinden hesaplanır.",
      en: "Constituents follow official Borsa Istanbul index rosters; medians are calculated across constituents with valid data.",
      fr: "Les composants suivent les listes officielles de Borsa Istanbul ; les médianes portent sur les valeurs disposant de données valides.",
    },
    relatedAtlasSlugs: ["reel-getiri", "fk-orani", "sektor-medyani"],
    presetIds: ["low_pe", "high_dividend", "high_roe", "uptrend"],
  },
  {
    slug: "bist-30",
    code: "XU030",
    group: "headline",
    name: { tr: "BIST 30", en: "BIST 30", fr: "BIST 30" },
    shortDesc: {
      tr: "En yüksek likiditeye ve piyasa değerine sahip 30 lokomotif BIST şirketi.",
      en: "The 30 largest and most liquid blue-chip listings on Borsa Istanbul.",
      fr: "Les 30 valeurs phares les plus liquides de Borsa Istanbul.",
    },
    lead: {
      tr: "BIST 30 (XU030), Borsa İstanbul'daki en derin işlem hacmine sahip 30 büyük ölçekli şirketi bir araya getirir. VİOP endeks sözleşmelerinin ve kurumsal portföy kıyaslamalarının ana dayanağıdır.",
      en: "BIST 30 (XU030) groups the 30 most liquid large-cap equities on Borsa Istanbul and underlies index futures and institutional benchmarks.",
      fr: "Le BIST 30 (XU030) rassemble les 30 grandes capitalisations les plus liquides, servant de référence aux contrats à terme et portefeuilles institutionnels.",
    },
    methodology: {
      tr: "Borsa İstanbul Yıldız Pazar kurallarına göre üçer aylık dönemlerde güncellenen 30 bileşen hisse.",
      en: "30 constituent stocks reviewed quarterly under Borsa Istanbul Yıldız Market rules.",
      fr: "30 valeurs révisées trimestriellement selon les règles de Borsa Istanbul.",
    },
    relatedAtlasSlugs: ["fk-orani", "pddd-orani", "reel-getiri"],
    presetIds: ["low_pe", "high_dividend", "high_foreign", "uptrend"],
  },
  {
    slug: "bist-50",
    code: "XU050",
    group: "headline",
    name: { tr: "BIST 50", en: "BIST 50", fr: "BIST 50" },
    shortDesc: {
      tr: "BIST 30'a ek 20 yüksek hacimli şirketi kapsayan orta-büyük ölçekli gösterge.",
      en: "Large- and upper-mid-cap benchmark extending BIST 30 with 20 liquid listings.",
      fr: "Indice de grandes et moyennes capitalisations élargissant le BIST 30 à 50 valeurs.",
    },
    lead: {
      tr: "BIST 50 (XU050), BIST 30 bileşenlerinin tamamını içerir ve piyasa değeri ile işlem hacmi açısından hemen ardından gelen 20 şirketi ekleyerek daha geniş bir büyük ölçek görünümü sunar.",
      en: "BIST 50 (XU050) includes every BIST 30 stock plus the next 20 largest, most liquid Yıldız Market companies.",
      fr: "Le BIST 50 (XU050) inclut les 30 valeurs du BIST 30 complétées par les 20 capitalisations liquides suivantes.",
    },
    methodology: {
      tr: "BIST 50 resmî bileşenleri; değerleme ve kârlılık medyanları güncel tarama evreninden türetilir.",
      en: "Official BIST 50 constituents; valuation and profitability medians are computed from the live universe.",
      fr: "Composants officiels du BIST 50 ; médianes calculées sur l'univers en direct.",
    },
    relatedAtlasSlugs: ["fk-orani", "roe-ozkaynak-karliligi", "sektor-medyani"],
    presetIds: ["low_pe", "high_roe", "high_dividend", "liquid"],
  },
  {
    slug: "bist-banka",
    code: "XBANK",
    group: "sector",
    name: { tr: "BIST Banka", en: "BIST Banks", fr: "BIST Banques" },
    shortDesc: {
      tr: "Borsa İstanbul'da işlem gören mevduat, katılım ve kalkınma bankaları endeksi.",
      en: "Index tracking Borsa Istanbul listed commercial, participation and development banks.",
      fr: "Indice des banques cotées à Borsa Istanbul.",
    },
    lead: {
      tr: "BIST Banka (XBANK), Türkiye bankacılık sektörünün borsadaki nabzını tutar. Faiz döngüsü, net faiz marjı, enflasyon ve yabancı sermaye akımlarına yüksek duyarlılık gösterir; değerlemede PD/DD ve ROE dengesi esastır.",
      en: "BIST Banks (XBANK) tracks listed Turkish banks. Highly sensitive to policy-rate cycles, net interest margins and foreign flows, banks are primarily valued on P/B versus ROE.",
      fr: "BIST Banques (XBANK) suit les banques cotées en Turquie, particulièrement sensibles au cycle des taux et évaluées avant tout via le couple C/VC et ROE.",
    },
    methodology: {
      tr: "Banka bilançolarında FD/FAVÖK kullanılmaz; bu sayfada PD/DD, F/K ve ROE medyanlarına odaklanılır.",
      en: "EV/EBITDA does not apply to bank balance sheets; this view emphasizes P/B, P/E and ROE medians.",
      fr: "VE/EBITDA ne s'applique pas aux banques ; la page met en avant les médianes C/VC, PER et ROE.",
    },
    relatedAtlasSlugs: ["banka-ve-sanayi-oranlari", "pddd-orani", "roe-ozkaynak-karliligi"],
    presetIds: ["low_pb", "high_roe", "low_pe", "high_foreign"],
  },
  {
    slug: "bist-sinai",
    code: "XUSIN",
    group: "sector",
    name: { tr: "BIST Sınai", en: "BIST Industrials", fr: "BIST Industrie" },
    shortDesc: {
      tr: "İmalat, otomotiv, metal, kimya, gıda ve tekstil odaklı üretim şirketleri endeksi.",
      en: "Manufacturing, automotive, metals, chemicals, food and textile producers on BIST.",
      fr: "Producteurs industriels, automobile, métallurgie, chimie et agroalimentaire du BIST.",
    },
    lead: {
      tr: "BIST Sınai (XUSIN), Türkiye'nin ihracat ve üretim omurgasını oluşturan sanayi şirketlerini kapsar. Kur hareketleri, emtia maliyetleri, kapasite kullanımı ve işletme sermayesi disiplini performansta belirleyicidir.",
      en: "BIST Industrials (XUSIN) covers Turkey's manufacturing and export backbone, where FX exposure, input costs, utilization and balance-sheet leverage drive returns.",
      fr: "BIST Industrie (XUSIN) regroupe le tissu productif et exportateur turc, sensible aux devises, matières premières et marges opérationnelles.",
    },
    methodology: {
      tr: "Sanayi şirketlerinde borç yapısını görmek için F/K yanında FD/FAVÖK medyanı birlikte sunulur.",
      en: "Industrial medians pair P/E with EV/EBITDA to reflect differences in financial leverage.",
      fr: "Les médianes industrielles associent PER et VE/EBITDA pour intégrer l'endettement.",
    },
    relatedAtlasSlugs: ["fd-favok", "banka-ve-sanayi-oranlari", "net-borc-favok"],
    presetIds: ["low_ev_ebitda", "low_pe", "high_roe", "high_dividend"],
  },
  {
    slug: "bist-hizmetler",
    code: "XUHIZ",
    group: "sector",
    name: { tr: "BIST Hizmetler", en: "BIST Services", fr: "BIST Services" },
    shortDesc: {
      tr: "Havacılık, perakende, telekomünikasyon, enerji ve turizm hizmet şirketleri.",
      en: "Aviation, retail, telecom, utilities and tourism service companies.",
      fr: "Transport aérien, distribution, télécoms, énergie et tourisme.",
    },
    lead: {
      tr: "BIST Hizmetler (XUHIZ), iç talep ve turizm/ulaştırma döngüsüne bağlı nakit akışı üreten perakende, havacılık, iletişim ve elektrik dağıtım şirketlerini bir araya getirir.",
      en: "BIST Services (XUHIZ) brings together retail, aviation, telecom and utility listings driven by domestic demand, pricing power and passenger/energy volume.",
      fr: "BIST Services (XUHIZ) réunit distribution, transport, télécommunications et services collectifs portés par la demande intérieure et les flux touristiques.",
    },
    methodology: {
      tr: "Hizmet sektörlerinde işletme sermayesi ve FAVÖK marjı sektörden sektöre değişir; her hisse kendi KAP sektörüyle de kıyaslanabilir.",
      en: "Working-capital dynamics vary widely across service sub-sectors; inspect individual KAP sector pages for tighter peer sets.",
      fr: "Les dynamiques varient selon les sous-secteurs ; consultez les pages secteurs KAP pour des pairs homogènes.",
    },
    relatedAtlasSlugs: ["fd-favok", "net-borc-favok", "sektor-medyani"],
    presetIds: ["low_ev_ebitda", "high_roe", "uptrend", "liquid"],
  },
  {
    slug: "bist-mali",
    code: "XUMAL",
    group: "sector",
    name: { tr: "BIST Mali", en: "BIST Financials", fr: "BIST Finance" },
    shortDesc: {
      tr: "Bankalar, holdingler, sigorta şirketleri, GYO'lar ve aracı kurumların geniş endeksi.",
      en: "Broad financials index spanning banks, holdings, insurers, REITs and brokerages.",
      fr: "Indice financier élargi : banques, holdings, assurances, foncières et courtiers.",
    },
    lead: {
      tr: "BIST Mali (XUMAL), finansal aracılık, sigortacılık, gayrimenkul yatırım ortaklığı ve yatırım holdingi faaliyetindeki tüm ana finans şirketlerini tek çatıda toplar.",
      en: "BIST Financials (XUMAL) combines banks, insurance companies, REITs, brokerages and investment holdings under one broad financial benchmark.",
      fr: "BIST Finance (XUMAL) regroupe banques, assureurs, foncières, sociétés de bourse et holdings d'investissement.",
    },
    methodology: {
      tr: "Alt kırılımlar (banka, sigorta, GYO, holding) farklı kârlılık modellerine sahip olduğundan PD/DD ve ROE birlikte okunmalıdır.",
      en: "Because banks, insurers, REITs and holdings have distinct models, review P/B alongside ROE and sub-sector medians.",
      fr: "Les sous-secteurs ayant des modèles distincts, lisez C/VC et ROE conjointement.",
    },
    relatedAtlasSlugs: ["banka-ve-sanayi-oranlari", "pddd-orani", "roe-ozkaynak-karliligi"],
    presetIds: ["low_pb", "low_pe", "high_roe", "high_dividend"],
  },
  {
    slug: "bist-teknoloji",
    code: "XUTEK",
    group: "sector",
    name: { tr: "BIST Teknoloji", en: "BIST Technology", fr: "BIST Technologie" },
    shortDesc: {
      tr: "Yazılım, bilişim, savunma elektroniği ve teknoloji donanım şirketleri.",
      en: "Software, IT services, defence electronics and technology hardware listings.",
      fr: "Logiciels, services informatiques, électronique de défense et matériel technologique.",
    },
    lead: {
      tr: "BIST Teknoloji (XUTEK), yazılım geliştirme, sistem entegrasyonu, savunma elektroniği ve bilişim dağıtımı alanındaki şirketleri izler. Büyüme beklentileri ve Ar-Ge yatırımları nedeniyle değerleme çarpanları piyasa ortalamasından ayrışabilir.",
      en: "BIST Technology (XUTEK) tracks software, IT distribution and defence-electronics firms whose growth profiles and intangible assets often lead to higher multiples than traditional industrials.",
      fr: "BIST Technologie (XUTEK) suit les acteurs du logiciel, de l'informatique et de l'électronique de défense.",
    },
    methodology: {
      tr: "Yüksek büyüme ve proje bazlı gelir tanıma nedeniyle TTM kârlılık ve nakit akışı birlikte izlenmelidir.",
      en: "Evaluate TTM profitability alongside order backlog and cash conversion for project-driven tech firms.",
      fr: "Croisez rentabilité TTM et conversion de trésorerie pour les sociétés technologiques à projets.",
    },
    relatedAtlasSlugs: ["ttm-son-12-ay", "fk-orani", "roe-ozkaynak-karliligi"],
    presetIds: ["high_roe", "high_net_margin", "uptrend", "low_pe"],
  },
  {
    slug: "bist-holding",
    code: "XHOLD",
    group: "sector",
    name: { tr: "BIST Holding ve Yatırım", en: "BIST Holding & Investment", fr: "BIST Holdings et investissement" },
    shortDesc: {
      tr: "Çok sektörlü iştirak portföylerine sahip yatırım holdingleri endeksi.",
      en: "Multi-sector Turkish investment holding companies index.",
      fr: "Indice des holdings d'investissement multisectorielles turques.",
    },
    lead: {
      tr: "BIST Holding ve Yatırım (XHOLD), bankacılıktan enerjiye, otomotivden perakendeye yayılan iştirak portföylerini yöneten holding şirketlerini kapsar. PD/DD çarpanı ve net aktif değer (NAD) iskontosu başlıca izleme metrikleridir.",
      en: "BIST Holding & Investment (XHOLD) tracks diversified Turkish conglomerates holding stakes across banking, energy, automotive and retail, typically assessed on P/B and NAV discount.",
      fr: "BIST Holdings (XHOLD) regroupe les grands conglomérats diversifiés, suivis principalement par le C/VC et la décote sur actif net.",
    },
    methodology: {
      tr: "Konsolide iştirak yapıları nedeniyle kâr rakamları iştirak yeniden değerlemelerinden etkilenebilir.",
      en: "Consolidated earnings can reflect subsidiary revaluations and equity-method income.",
      fr: "Les résultats consolidés peuvent refléter les réévaluations de participations.",
    },
    relatedAtlasSlugs: ["pddd-orani", "fk-orani", "banka-ve-sanayi-oranlari"],
    presetIds: ["low_pb", "low_pe", "high_dividend", "high_foreign"],
  },
  {
    slug: "bist-gyo",
    code: "XGMYO",
    group: "sector",
    name: { tr: "BIST GYO", en: "BIST REITs", fr: "BIST Foncières (SIIC)" },
    shortDesc: {
      tr: "Gayrimenkul portföyü ve proje geliştirme odaklı Gayrimenkul Yatırım Ortaklıkları.",
      en: "Listed Real Estate Investment Trusts holding commercial and residential portfolios.",
      fr: "Sociétés d'investissement immobilier cotées (foncières) du BIST.",
    },
    lead: {
      tr: "BIST GYO (XGMYO), kira geliri üreten ticari portföylere veya konut projelerine sahip Gayrimenkul Yatırım Ortaklıklarını izler. Yıl sonu ekspertiz değerlemeleri özkaynakları ve PD/DD iskontosunu doğrudan etkiler.",
      en: "BIST REITs (XGMYO) tracks real estate investment trusts across rental portfolios and development projects, where annual property appraisals directly shape book equity and P/B discounts.",
      fr: "BIST Foncières (XGMYO) suit les sociétés immobilières cotées dont les réévaluations d'actifs influencent directement les capitaux propres et le C/VC.",
    },
    methodology: {
      tr: "GYO'larda net kâr yeniden değerleme farklarını içerebildiğinden F/K tek başına yanıltıcı olabilir; PD/DD ve kira/nakit akışı birlikte değerlendirilmelidir.",
      en: "Because REIT net income often includes non-cash property revaluations, read P/E cautiously alongside P/B and rental cash flow.",
      fr: "Le résultat net intégrant les réévaluations d'immeubles, privilégiez le C/VC et les flux locatifs.",
    },
    relatedAtlasSlugs: ["pddd-orani", "banka-ve-sanayi-oranlari", "temettu-verimi"],
    presetIds: ["low_pb", "high_dividend", "low_pe", "uptrend"],
  },
  {
    slug: "bist-katilim-tum",
    code: "XKTUM",
    group: "thematic",
    name: { tr: "BIST Katılım Tüm", en: "BIST Participation All", fr: "BIST Participation (tous)" },
    shortDesc: {
      tr: "Katılım finans ilkelerine uygunluk kriterlerini karşılayan tüm BIST şirketleri.",
      en: "All Borsa Istanbul stocks meeting participation (Shariah-compliant) finance criteria.",
      fr: "Toutes les actions BIST conformes aux critères de finance participative.",
    },
    lead: {
      tr: "BIST Katılım Tüm (XKTUM), faaliyet alanı ve finansal oran (faizli borç, nakit ve uygun olmayan gelir eşikleri) kriterlerini karşılayan Borsa İstanbul şirketlerini kapsar.",
      en: "BIST Participation All (XKTUM) includes every Borsa Istanbul stock satisfying business-activity and balance-sheet participation-finance thresholds.",
      fr: "BIST Participation Tous (XKTUM) réunit les sociétés répondant aux critères d'activité et de bilan de la finance participative.",
    },
    methodology: {
      tr: "Üyelik listesi Borsa İstanbul katılım endeksi dönem güncellemelerine göre belirlenir.",
      en: "Membership follows official periodic Borsa Istanbul participation index reviews.",
      fr: "La composition suit les révisions officielles de Borsa Istanbul.",
    },
    relatedAtlasSlugs: ["net-borc-favok", "fk-orani", "temettu-verimi"],
    presetIds: ["low_pe", "high_dividend", "high_roe", "low_ev_ebitda"],
  },
  {
    slug: "bist-katilim-30",
    code: "XK030",
    group: "thematic",
    name: { tr: "BIST Katılım 30", en: "BIST Participation 30", fr: "BIST Participation 30" },
    shortDesc: {
      tr: "Katılım finans kriterlerini karşılayan en büyük ve likit 30 BIST hissesi.",
      en: "The 30 largest and most liquid participation-compliant BIST listings.",
      fr: "Les 30 valeurs participatives les plus liquides et capitalisées du BIST.",
    },
    lead: {
      tr: "BIST Katılım 30 (XK030), katılım finans ilkelerine uygun şirketler arasından fiili dolaşımdaki piyasa değeri ve işlem hacmi en yüksek 30 hisseyi seçer.",
      en: "BIST Participation 30 (XK030) selects the 30 highest free-float market-cap and most liquid companies from the participation-compliant universe.",
      fr: "BIST Participation 30 (XK030) sélectionne les 30 actions les plus liquides parmi les valeurs conformes à la finance participative.",
    },
    methodology: {
      tr: "Yüksek likidite ve katılım uygunluğunu birlikte arayan yatırımcılar için ana referans endeksidir.",
      en: "Core benchmark combining participation-finance compliance with large-cap liquidity.",
      fr: "Indice de référence alliant conformité participative et forte liquidité.",
    },
    relatedAtlasSlugs: ["net-borc-favok", "fk-orani", "roe-ozkaynak-karliligi"],
    presetIds: ["low_pe", "high_roe", "high_dividend", "uptrend"],
  },
  {
    slug: "bist-temettu",
    code: "XTMTU",
    group: "thematic",
    name: { tr: "BIST Temettü", en: "BIST Dividend", fr: "BIST Dividendes" },
    shortDesc: {
      tr: "Son mali yıllarda nakit temettü dağıtan şirketlerden oluşan temettü endeksi.",
      en: "Index of Borsa Istanbul companies distributing cash dividends.",
      fr: "Indice des sociétés de Borsa Istanbul distribuant des dividendes en numéraire.",
    },
    lead: {
      tr: "BIST Temettü (XTMTU), düzenli nakit kâr payı dağıtım geçmişine sahip şirketleri bir araya getirir. Temettü verimi, kâr dağıtma sürdürülebilirliği ve toplam getiri performansını izlemek için kullanılır.",
      en: "BIST Dividend (XTMTU) tracks companies with a track record of cash dividend distributions, useful for screening sustainable income and total-return compounders.",
      fr: "BIST Dividendes (XTMTU) regroupe les sociétés versant des dividendes en espèces, idéal pour suivre rendement et performance totale.",
    },
    methodology: {
      tr: "Temettü verimi medyanı yalnızca son 12 ayda nakit ödeme yapan bileşenler üzerinden hesaplanır.",
      en: "Dividend yield medians reflect constituents that paid cash dividends over the trailing 12 months.",
      fr: "La médiane de rendement reflète les composants ayant distribué sur les 12 derniers mois.",
    },
    relatedAtlasSlugs: ["temettu-verimi", "reel-getiri", "roe-ozkaynak-karliligi"],
    presetIds: ["high_dividend", "low_pe", "high_roe", "pe_below_sector"],
  },
  {
    slug: "bist-halka-arz",
    code: "XHARZ",
    group: "thematic",
    name: { tr: "BIST Halka Arz", en: "BIST IPO", fr: "BIST Introductions en bourse" },
    shortDesc: {
      tr: "Son 2 yıl içinde Borsa İstanbul'da halka arz edilerek işlem görmeye başlayan şirketler.",
      en: "Companies newly listed on Borsa Istanbul within the past two years.",
      fr: "Sociétés récemment introduites à Borsa Istanbul au cours des deux dernières années.",
    },
    lead: {
      tr: "BIST Halka Arz (XHARZ), Yıldız Pazar ve Ana Pazar'da son iki yıl içinde işlem görmeye başlayan yeni halka arz şirketlerini izler. Kısa bilanço geçmişi nedeniyle oynaklık ve çarpan dağılımı geniş olabilir.",
      en: "BIST IPO (XHARZ) tracks newly listed companies over their first two years on Borsa Istanbul. Shorter public track records often bring wider volatility and multiple dispersion.",
      fr: "BIST Introductions (XHARZ) suit les nouvelles cotations sur leurs deux premières années, caractérisées par une dispersion et une volatilité plus élevées.",
    },
    methodology: {
      tr: "Yeni halka arzların bazılarında 4 çeyreklik halka açık TTM geçmişi henüz oluşmamış olabilir.",
      en: "Some recent IPOs may not yet have four public trailing quarters for every ratio.",
      fr: "Certaines introductions récentes ne disposent pas encore de quatre trimestres publics complets.",
    },
    relatedAtlasSlugs: ["ttm-son-12-ay", "fk-orani", "rsi"],
    presetIds: ["profitable", "low_pe", "high_roe", "uptrend"],
  },
];

const INDEX_BY_SLUG: ReadonlyMap<string, DiscoveryIndex> = new Map(
  DISCOVERY_INDICES.map((item) => [item.slug, item]),
);

const INDEX_BY_CODE: ReadonlyMap<string, DiscoveryIndex> = new Map(
  DISCOVERY_INDICES.map((item) => [item.code, item]),
);

export function indexByCode(code: string): DiscoveryIndex | null {
  return INDEX_BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

export function indexPageHref(slugOrCode: string): string {
  const bySlug = INDEX_BY_SLUG.get(slugOrCode.trim().toLowerCase());
  if (bySlug) return `/endeks/${bySlug.slug}`;
  const byCode = INDEX_BY_CODE.get(slugOrCode.trim().toUpperCase());
  if (byCode) return `/endeks/${byCode.slug}`;
  return "/endeks";
}

/**
 * Resolves `/endeks/[slug]`: accepts canonical slugs ("bist-100") as well as
 * BIST index codes ("XU100", "xu100") so codes can redirect to the single canonical URL.
 */
export function resolveIndexSlug(raw: string): { entry: DiscoveryIndex; isCanonical: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const bySlug = INDEX_BY_SLUG.get(lower);
  if (bySlug) return { entry: bySlug, isCanonical: trimmed === bySlug.slug };
  const byCode = INDEX_BY_CODE.get(trimmed.toUpperCase());
  if (byCode) return { entry: byCode, isCanonical: false };
  return null;
}

// ---------------------------------------------------------------------------
// Canonical KAP Sectors (/sektor/[slug])
// ---------------------------------------------------------------------------

/**
 * Friendly aliases that permanently redirect to their single canonical KAP
 * sector URL (e.g. /sektor/bankacilik → /sektor/bankalar).
 */
export const SECTOR_ALIASES: Readonly<Record<string, string>> = {
  bankacilik: "bankalar",
  banka: "bankalar",
  havacilik: "ulastirma-ve-depolama",
  ulastirma: "ulastirma-ve-depolama",
  teknoloji: "bilisim",
  yazilim: "bilisim",
  enerji: "elektrik-gaz-ve-buhar",
  elektrik: "elektrik-gaz-ve-buhar",
  perakende: "perakende-ticaret",
  gida: "gida-icecek-ve-tutun",
  gyo: "gayrimenkul-yatirim-ortakliklari",
  holding: "holdingler-ve-yatirim-sirketleri",
  holdingler: "holdingler-ve-yatirim-sirketleri",
  sigorta: "sigorta-sirketleri",
  kimya: "kimya-ilac-petrol-lastik-ve-plastik-urunler",
  otomotiv: "metal-esya-makine-elektrikli-cihazlar-ve-ulasim-araclari",
  insaat: "insaat-ve-bayindirlik-isleri",
  cimento: "tas-ve-topraga-dayali",
  madencilik: "metal-cevheri-madenciligi",
  turizm: "konaklama",
  tekstil: "tekstil-giyim-esyasi-ve-deri",
  saglik: "insan-sagligi-ve-sosyal-hizmetler",
  telekom: "telekomunikasyon",
  iletisim: "telekomunikasyon",
  metal: "ana-metal-sanayi",
  "demir-celik": "ana-metal-sanayi",
};

/** Major KAP sectors highlighted in sibling navigation chips and hub featured cards. */
export const FEATURED_SECTORS: readonly string[] = [
  "bankalar",
  "holdingler-ve-yatirim-sirketleri",
  "ulastirma-ve-depolama",
  "perakende-ticaret",
  "elektrik-gaz-ve-buhar",
  "metal-esya-makine-elektrikli-cihazlar-ve-ulasim-araclari",
  "kimya-ilac-petrol-lastik-ve-plastik-urunler",
  "ana-metal-sanayi",
  "bilisim",
  "gida-icecek-ve-tutun",
  "gayrimenkul-yatirim-ortakliklari",
  "sigorta-sirketleri",
  "telekomunikasyon",
  "savunma",
];

const SECTOR_EDITORIAL: Readonly<Record<string, LocalizedText>> = {
  bankalar: {
    tr: "Borsa İstanbul'da işlem gören mevduat, katılım ve kalkınma bankaları. Bankalarda operasyonel kârlılık ve değerleme, FD/FAVÖK yerine PD/DD, F/K ve özkaynak kârlılığı (ROE) medyanlarıyla takip edilir.",
    en: "Listed commercial, participation and development banks on Borsa Istanbul. Bank valuation focuses on P/B, P/E and ROE medians rather than EV/EBITDA.",
    fr: "Banques cotées sur Borsa Istanbul. L'évaluation bancaire privilégie les médianes C/VC, PER et ROE plutôt que VE/EBITDA.",
  },
  "holdingler-ve-yatirim-sirketleri": {
    tr: "Farklı sektörlerdeki iştirakleri tek çatıda yöneten holding ve yatırım şirketleri. PD/DD çarpanı, temettü verimi ve iştirak portföyü dağılımı temel karşılaştırma eksenidir.",
    en: "Diversified holding and investment companies managing multi-sector subsidiaries, typically evaluated via P/B, dividend yield and subsidiary mix.",
    fr: "Holdings et sociétés d'investissement gérant des participations multisectorielles, suivies par C/VC et rendement.",
  },
  "ulastirma-ve-depolama": {
    tr: "Havayolu taşımacılığı, havalimanı işletmeciliği, lojistik ve liman şirketleri. Yolcu/kargo trafiği, akaryakıt maliyetleri, döviz gelir yapısı ve FD/FAVÖK çarpanı öne çıkar.",
    en: "Airlines, airport operators, logistics and port companies driven by traffic volume, fuel costs, FX revenues and EV/EBITDA multiples.",
    fr: "Compagnies aériennes, opérateurs aéroportuaires et logistique, évalués selon le trafic, les devises et VE/EBITDA.",
  },
  "perakende-ticaret": {
    tr: "Gıda, giyim, teknoloji ve çok kanallı perakende zincirleri. Mağaza büyümesi, nakit döngüsü, net marj ve FD/FAVÖK çarpanları sektörde emsal karşılaştırmasının merkezindedir.",
    en: "Food, apparel and multi-channel retail chains benchmarked on store expansion, cash conversion, net margins and EV/EBITDA.",
    fr: "Chaînes de distribution alimentaire et spécialisée, comparées sur les marges, la génération de trésorerie et VE/EBITDA.",
  },
  "elektrik-gaz-ve-buhar": {
    tr: "Yenilenebilir ve konvansiyonel elektrik üretimi, dağıtım ve doğal gaz şirketleri. Kapasite yatırımları nedeniyle Net Borç/FAVÖK ve FD/FAVÖK kritik göstergelerdir.",
    en: "Power generation, renewables and utility distribution companies where capital intensity makes EV/EBITDA and leverage central.",
    fr: "Producteurs et distributeurs d'électricité et de gaz, où l'intensité capitalistique place VE/EBITDA et dette au premier plan.",
  },
  bilisim: {
    tr: "Yazılım, sistem entegrasyonu, bulut hizmetleri ve teknoloji dağıtım şirketleri. Yüksek özkaynak kârlılığı ve ölçeklenebilir gelir yapısı nedeniyle çarpan dağılımı geniştir.",
    en: "Software, IT integration and technology distribution companies characterized by asset-light models and wide multiple dispersion.",
    fr: "Logiciels, intégration informatique et distribution technologique, aux multiples souvent dispersés.",
  },
  "ana-metal-sanayi": {
    tr: "Demir-çelik, alüminyum ve temel metal üreticileri. Küresel emtia fiyat döngüleri ve ton başı FAVÖK marjı kârlılığı belirlediği için F/K kadar FD/FAVÖK ve PD/DD de izlenir.",
    en: "Steel, aluminum and basic-metal producers whose cyclical margins make EV/EBITDA and P/B essential alongside P/E.",
    fr: "Producteurs d'acier et de métaux de base, secteur cyclique suivi par VE/EBITDA et C/VC.",
  },
  "gayrimenkul-yatirim-ortakliklari": {
    tr: "Kira getirili gayrimenkul portföyleri ve proje geliştiricileri. Ekspertiz değerlemeleri özkaynakları şekillendirdiği için PD/DD ve temettü verimi ana kıyaslama metrikleridir.",
    en: "REITs managing income-producing properties and developments, primarily compared on P/B discount and dividend yield.",
    fr: "Foncières immobilières cotées, comparées principalement sur le C/VC et le rendement.",
  },
  "sigorta-sirketleri": {
    tr: "Elementer, sağlık ve hayat/emeklilik sigorta şirketleri. Teknik kârlılık ve yatırım portföyü getirisi nedeniyle ROE ve PD/DD en anlamlı karşılaştırma ölçütleridir.",
    en: "Non-life, health and life/pension insurers where underwriting profitability and float income make ROE and P/B key.",
    fr: "Compagnies d'assurance vie et non-vie, évaluées principalement par le ROE et le C/VC.",
  },
  savunma: {
    tr: "Savunma elektroniği, havacılık sistemleri ve yüksek teknoloji mühendislik şirketleri. Uzun vadeli sipariş bakiyesi, Ar-Ge yoğunluğu ve TTM kârlılık artışı öne çıkar.",
    en: "Defence electronics and aerospace engineering firms distinguished by multi-year order backlogs and R&D intensity.",
    fr: "Électronique de défense et ingénierie aérospatiale portées par les carnets de commandes pluriannuels.",
  },
};

const FINANCIAL_SECTORS: ReadonlySet<string> = new Set([
  "bankalar",
  "sigorta-sirketleri",
  "araci-kurumlar",
  "finansal-kiralama-ve-faktoring-sirketleri",
  "finansman-sirketleri",
  "gayrimenkul-yatirim-ortakliklari",
  "girisim-sermayesi-yatirim-ortakliklari",
  "menkul-kiymet-yatirim-ortakliklari",
  "varlik-yonetim-sirketleri",
  "holdingler-ve-yatirim-sirketleri",
]);

export function allCanonicalSectorKeys(): string[] {
  return Object.keys(SECTOR_LABELS);
}

export function sectorPageHref(key: string): string {
  return `/sektor/${encodeURIComponent(key)}`;
}

/**
 * Resolves `/sektor/[slug]`: returns the canonical KAP sector key and whether
 * the URL is already canonical (false for friendly aliases like "bankacilik").
 */
export function resolveSectorSlug(raw: string): { key: string; isCanonical: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (isKnownSector(lower)) {
    return { key: lower, isCanonical: trimmed === lower };
  }
  if (Object.prototype.hasOwnProperty.call(SECTOR_ALIASES, lower)) {
    const target = SECTOR_ALIASES[lower];
    if (isKnownSector(target)) return { key: target, isCanonical: false };
  }
  return null;
}

export function sectorEditorialLead(key: string, locale: Locale): string {
  const custom = SECTOR_EDITORIAL[key]?.[locale];
  if (custom) return custom;
  const name = sectorLabel(key, locale);
  if (locale === "en") {
    return `Borsa Istanbul companies classified under ${name} by KAP. Compare market cap, valuation multiples, profitability and sector medians in one canonical view.`;
  }
  if (locale === "fr") {
    return `Sociétés de Borsa Istanbul classées dans le secteur ${name} par le KAP. Comparez capitalisation, multiples de valorisation, rentabilité et médianes sectorielles.`;
  }
  return `KAP sınıflandırmasına göre ${name} sektöründe yer alan Borsa İstanbul şirketleri. Piyasa değeri, değerleme çarpanları, kârlılık ve sektör medyanlarını tek sayfada karşılaştırın.`;
}

export function sectorRelatedAtlasSlugs(key: string): readonly string[] {
  if (FINANCIAL_SECTORS.has(key)) {
    return ["banka-ve-sanayi-oranlari", "pddd-orani", "roe-ozkaynak-karliligi", "sektor-medyani"];
  }
  return ["sektor-medyani", "fk-orani", "fd-favok", "net-borc-favok"];
}

export function isFinancialSector(key: string): boolean {
  return FINANCIAL_SECTORS.has(key);
}

// ---------------------------------------------------------------------------
// Group Metrics (medians, market cap & breadth for any index or sector)
// ---------------------------------------------------------------------------

export interface DiscoveryGroupMetrics {
  count: number;
  totalMarketCap: number | null;
  breadth: { up: number; down: number; flat: number };
  medians: Partial<Record<NumericField, number>>;
  counts: Partial<Record<NumericField, number>>;
}

const GROUP_MEDIAN_FIELDS: readonly NumericField[] = [
  "pe",
  "pb",
  "ev_ebitda",
  "roe",
  "net_margin",
  "dividend_yield",
  "change_pct",
  "perf_ytd",
  "perf_1y",
];

/**
 * Computes consistent summary stats and medians over any subset of screener
 * universe rows (an index or a KAP sector), applying the exact same counting
 * and MIN_SECTOR_COMPANIES rules as /tarama and stock peer cards.
 */
export function computeGroupMetrics(rows: readonly Row[]): DiscoveryGroupMetrics {
  let capSum = 0;
  let capCount = 0;
  for (const row of rows) {
    if (row.market_cap !== undefined && Number.isFinite(row.market_cap) && row.market_cap > 0) {
      capSum += row.market_cap;
      capCount += 1;
    }
  }

  const medians: Partial<Record<NumericField, number>> = {};
  const counts: Partial<Record<NumericField, number>> = {};
  for (const field of GROUP_MEDIAN_FIELDS) {
    const rule = SECTOR_MEDIAN_RULES[field] ?? "all";
    const values: number[] = [];
    for (const row of rows) {
      const value = row[field];
      if (value !== undefined && Number.isFinite(value) && countsToward(rule, value)) {
        values.push(value);
      }
    }
    counts[field] = values.length;
    if (values.length >= MIN_SECTOR_COMPANIES) {
      const m = median(values);
      if (m !== null) medians[field] = m;
    }
  }

  return {
    count: rows.length,
    totalMarketCap: capCount > 0 ? capSum : null,
    breadth: breadth(rows),
    medians,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Search across canonical indices and sectors (for global search bar)
// ---------------------------------------------------------------------------

export interface DiscoverySearchHit {
  kind: "index" | "sector";
  id: string;
  href: string;
  badge: string;
  label: string;
  subtitle: string;
}

export function searchDiscovery(
  query: string,
  locale: Locale,
  limit = 4,
): DiscoverySearchHit[] {
  const needle = foldTr(query);
  if (!needle || needle.length < 2) return [];
  const tokens = needle.split(" ").filter(Boolean);

  const scored: Array<{ hit: DiscoverySearchHit; score: number }> = [];

  for (const idx of DISCOVERY_INDICES) {
    const code = idx.code.toLowerCase();
    const slug = idx.slug.replace(/-/g, " ");
    const name = foldTr(idx.name[locale]);
    const nameTr = foldTr(idx.name.tr);
    const haystack = `${code} ${slug} ${name} ${nameTr}`;
    if (!tokens.every((token) => haystack.includes(token))) continue;

    let score = 3;
    if (code === needle || name === needle || nameTr === needle) score = 0;
    else if (code.startsWith(needle) || name.startsWith(needle) || nameTr.startsWith(needle)) score = 1;
    else score = 2;

    scored.push({
      score,
      hit: {
        kind: "index",
        id: `index:${idx.slug}`,
        href: `/endeks/${idx.slug}`,
        badge: idx.code,
        label: idx.name[locale],
        subtitle: idx.shortDesc[locale],
      },
    });
  }

  // Build reverse alias map so searching "bankacilik" or "havacilik" finds the canonical sector.
  const aliasesBySector = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(SECTOR_ALIASES)) {
    const list = aliasesBySector.get(target) ?? [];
    list.push(alias.replace(/-/g, " "));
    aliasesBySector.set(target, list);
  }

  for (const key of allCanonicalSectorKeys()) {
    const label = sectorLabel(key, locale);
    const labelTr = sectorLabel(key, "tr");
    const folded = foldTr(label);
    const foldedTr = foldTr(labelTr);
    const aliases = aliasesBySector.get(key) ?? [];
    const haystack = `${key.replace(/-/g, " ")} ${folded} ${foldedTr} ${aliases.join(" ")}`;
    if (!tokens.every((token) => haystack.includes(token))) continue;

    let score = 4;
    if (folded === needle || foldedTr === needle || aliases.includes(needle)) score = 0;
    else if (folded.startsWith(needle) || foldedTr.startsWith(needle) || aliases.some((a) => a.startsWith(needle))) score = 1;
    else score = 2;

    scored.push({
      score,
      hit: {
        kind: "sector",
        id: `sector:${key}`,
        href: sectorPageHref(key),
        badge: locale === "en" ? "SECTOR" : locale === "fr" ? "SECTEUR" : "SEKTÖR",
        label,
        subtitle: sectorEditorialLead(key, locale),
      },
    });
  }

  scored.sort((a, b) => a.score - b.score || a.hit.label.localeCompare(b.hit.label, locale));
  return scored.slice(0, limit).map((item) => item.hit);
}
