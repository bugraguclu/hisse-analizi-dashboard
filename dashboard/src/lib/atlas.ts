/**
 * Investment Concept Atlas — single canonical content registry.
 *
 * Modeled on Belif's atlas pattern: one typed record per concept drives
 * the hub page (/atlas), detail pages (/atlas/[slug]), FAQ / DefinedTerm
 * structured data, and site-wide search results, with direct links to the
 * live screens, charts and preset filters in Hisse Analizi.
 */
import type { Locale } from "./i18n";
import { foldTr } from "../components/shared/search/fold.ts";

export type LocalizedText = Readonly<Record<Locale, string>>;
export type LocalizedList = Readonly<Record<Locale, readonly string[]>>;

export type AtlasCategory = "valuation" | "profitability" | "technical" | "macro" | "sector";

export type AtlasActionKind = "screener" | "chart" | "macro" | "sector" | "index";

export interface AtlasAction {
  kind: AtlasActionKind;
  href: string;
  label: LocalizedText;
  description: LocalizedText;
}

export interface AtlasConcept {
  /** Stable canonical URL slug (also the cross-platform concept ID). */
  slug: string;
  category: AtlasCategory;
  /** Short badge/code shown in compact cards and search results (e.g. "F/K", "TTM", "RSI"). */
  badge: string;
  title: LocalizedText;
  cardDesc: LocalizedText;
  /** Natural question form used for FAQ schema and detail metadata. */
  question: LocalizedText;
  intro: LocalizedText;
  formula?: LocalizedText;
  /** Key nuances ("Neye dikkat etmeli?"). */
  points: LocalizedList;
  /** How Hisse Analizi computes or sources this metric. */
  methodology: LocalizedText;
  source: LocalizedText;
  /** Extra search terms across Turkish/English/French. */
  keywords: readonly string[];
  /** Live links into charts, screener presets, macro or discovery pages. */
  actions: readonly AtlasAction[];
  relatedSlugs: readonly string[];
}

export const ATLAS_CATEGORIES: readonly AtlasCategory[] = [
  "valuation",
  "profitability",
  "technical",
  "macro",
  "sector",
];

export const ATLAS_CATEGORY_LABELS: Readonly<Record<AtlasCategory, LocalizedText>> = {
  valuation: { tr: "Değerleme", en: "Valuation", fr: "Valorisation" },
  profitability: { tr: "Kârlılık ve Finansal Sağlık", en: "Profitability & Health", fr: "Rentabilité et santé" },
  technical: { tr: "Teknik Analiz", en: "Technical Analysis", fr: "Analyse technique" },
  macro: { tr: "Makro ve Getiri", en: "Macro & Returns", fr: "Macro et rendements" },
  sector: { tr: "Sektör ve Emsal Analizi", en: "Sector & Peers", fr: "Secteurs et pairs" },
};

export const ATLAS_CONCEPTS: readonly AtlasConcept[] = [
  {
    slug: "fk-orani",
    category: "valuation",
    badge: "F/K",
    title: {
      tr: "F/K Oranı (Fiyat / Kazanç)",
      en: "P/E Ratio (Price to Earnings)",
      fr: "Ratio PER (Cours / Bénéfice)",
    },
    cardDesc: {
      tr: "Hisse fiyatının son 12 aylık hisse başına net kâra oranı; değerleme başlangıç noktası.",
      en: "Share price divided by trailing 12-month earnings per share; a core valuation yardstick.",
      fr: "Cours de l'action rapporté au bénéfice net par action sur 12 mois glissants.",
    },
    question: {
      tr: "F/K oranı nedir ve BIST hisselerinde nasıl yorumlanır?",
      en: "What is the P/E ratio and how is it read on BIST stocks?",
      fr: "Qu'est-ce que le PER et comment l'interpréter sur Borsa Istanbul ?",
    },
    intro: {
      tr: "F/K (Fiyat / Kazanç) oranı, piyasanın bir şirketin son 12 ayda ürettiği 1 TL'lik net kâr için kaç TL ödemeye razı olduğunu gösterir. Tek başına ucuzluk veya pahalılık kanıtı değildir; şirketin kendi KAP sektör medyanı, büyüme hızı ve kârın sürekliliğiyle birlikte okunmalıdır.",
      en: "The P/E (Price-to-Earnings) ratio shows how much the market pays for 1 TRY of a company's trailing 12-month net income. A low or high multiple alone proves nothing — compare it against the company's KAP sector median, earnings growth and earnings quality.",
      fr: "Le PER (Cours / Bénéfice) indique combien le marché paie pour 1 TRY de bénéfice net réalisé sur les 12 derniers mois. Il ne s'interprète jamais isolément : comparez-le à la médiane du secteur KAP et à la pérennité des résultats.",
    },
    formula: {
      tr: "F/K = Hisse Fiyatı / Hisse Başına Kâr (TTM)  =  Piyasa Değeri / Net Kâr (TTM)",
      en: "P/E = Share Price / EPS (TTM)  =  Market Cap / Net Income (TTM)",
      fr: "PER = Cours / BPA (12M glissants)  =  Capitalisation / Résultat net (12M)",
    },
    points: {
      tr: [
        "Son 12 ayı net zararla kapatan şirketlerde F/K tanımlı değildir; taramada 'Zararda' olarak ayrılır ve düşük F/K filtrelerine girmez.",
        "Tek seferlik varlık satışı, vergi geliri veya yüksek enflasyon muhasebesi (TMS 29) parasal kazançları F/K'yı geçici olarak düşük gösterebilir.",
        "Döngüsel sanayi şirketlerinde (demir-çelik, havacılık) zirve kâr döneminde F/K düşük, dip kâr döneminde yüksek görünebilir.",
        "Yüksek büyüme beklenen şirketlerde piyasa gelecek kârları fiyatladığı için F/K sektör medyanının üzerinde kalabilir.",
      ],
      en: [
        "Loss-making companies over the trailing 12 months have no meaningful P/E and are excluded from low-P/E screens.",
        "One-off asset sales, tax credits or IAS 29 inflation-accounting monetary gains can make P/E appear artificially low.",
        "In cyclical industries (metals, airlines), P/E often looks lowest near peak earnings and highest near trough earnings.",
        "High-growth businesses can sustain above-median P/E multiples when investors price in future earnings expansion.",
      ],
      fr: [
        "Les sociétés déficitaires sur 12 mois n'ont pas de PER défini et sont exclues des filtres de PER faible.",
        "Les produits exceptionnels ou gains monétaires IAS 29 peuvent réduire artificiellement le PER.",
        "Dans les secteurs cycliques, le PER paraît souvent bas au sommet du cycle bénéficiaire.",
        "Une entreprise en forte croissance peut se traiter au-dessus de la médiane sectorielle.",
      ],
    },
    methodology: {
      tr: "Hisse Analizi tarama ve sektör medyanlarında son 12 ay (TTM) pozitif net kâr üreten şirketlerin F/K değerleri sayılır. En az 3 pozitif değerli şirket olmadan sektör medyanı gösterilmez.",
      en: "Hisse Analizi computes P/E on trailing 12-month (TTM) earnings and counts only positive values toward KAP sector medians (minimum 3 companies).",
      fr: "Hisse Analizi calcule le PER sur 12 mois glissants (TTM) et ne retient que les valeurs positives dans les médianes sectorielles (minimum 3 sociétés).",
    },
    source: {
      tr: "KAP finansal tabloları ve TradingView TTM çarpan akışı",
      en: "KAP financial statements & TradingView TTM multiples feed",
      fr: "États financiers KAP et flux de multiples TTM TradingView",
    },
    keywords: ["f/k", "fk", "p/e", "pe", "per", "fiyat kazanc", "fiyat/kazanc", "carpan", "ucuz hisse", "degerleme"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=low_pe&view=fundamentals&sort=pe&dir=asc",
        label: { tr: "Düşük F/K taramasını aç (F/K ≤ 10)", en: "Open Low P/E screen (P/E ≤ 10)", fr: "Ouvrir le filtre PER faible (PER ≤ 10)" },
        description: { tr: "BIST genelinde F/K oranı 10 ve altındaki kârlı şirketler.", en: "Profitable BIST stocks trading at P/E ≤ 10.", fr: "Actions rentables du BIST avec PER ≤ 10." },
      },
      {
        kind: "screener",
        href: "/tarama?screen=pe_below_sector&view=fundamentals&sort=pe&dir=asc",
        label: { tr: "F/K sektör medyanının altındakiler", en: "P/E below KAP sector median", fr: "PER sous la médiane du secteur KAP" },
        description: { tr: "Her hisseyi kendi KAP sektörünün medyan F/K'sıyla kıyaslar.", en: "Compares each stock to its own KAP sector median P/E.", fr: "Compare chaque action à la médiane PER de son secteur." },
      },
      {
        kind: "chart",
        href: "/temel/THYAO",
        label: { tr: "Örnek temel analiz: THYAO", en: "Sample fundamental view: THYAO", fr: "Exemple d'analyse fondamentale : THYAO" },
        description: { tr: "Oran kartlarında hissenin F/K'sını ve sektör medyanını inceleyin.", en: "Inspect P/E alongside the sector median in the ratios card.", fr: "Consultez le PER face à la médiane sectorielle." },
      },
    ],
    relatedSlugs: ["ttm-son-12-ay", "pddd-orani", "fd-favok", "sektor-medyani"],
  },
  {
    slug: "ttm-son-12-ay",
    category: "profitability",
    badge: "TTM",
    title: {
      tr: "TTM (Son 12 Ay Kaydırılmış Veri)",
      en: "TTM (Trailing Twelve Months)",
      fr: "TTM (12 mois glissants)",
    },
    cardDesc: {
      tr: "Son dört çeyreğin toplamıyla yıllıklandırılmış gelir, FAVÖK ve net kâr hesabı.",
      en: "Rolling sum of the latest four quarters for revenue, EBITDA and net income.",
      fr: "Somme glissante des quatre derniers trimestres pour le chiffre d'affaires, l'EBITDA et le résultat net.",
    },
    question: {
      tr: "TTM (Trailing Twelve Months) nedir ve neden çeyreklik veriden farklıdır?",
      en: "What is TTM (Trailing Twelve Months) and why is it used in ratios?",
      fr: "Qu'est-ce que le TTM (12 mois glissants) et pourquoi l'utiliser ?",
    },
    intro: {
      tr: "TTM (Trailing Twelve Months — Son 12 Ay), yıl sonu bilançosunu beklemeden şirketin en güncel 12 aylık performansını görmek için son dört çeyreğin akım kalemlerini (satış, FAVÖK, net kâr, nakit akışı) toplar. Mevsimselliği dengeler ve güncel piyasa değerini güncel kazanç gücüyle eşleştirir.",
      en: "TTM (Trailing Twelve Months) sums the last four reported quarters of flow metrics (revenue, EBITDA, net income, cash flow). It smooths out seasonality and aligns today's market capitalization with the company's most recent full-year earning power.",
      fr: "Le TTM (12 mois glissants) additionne les quatre derniers trimestres publiés pour lisser la saisonnalité et rapprocher la capitalisation actuelle de la capacité bénéficiaire la plus récente.",
    },
    formula: {
      tr: "TTM = (Güncel Yıl Kümülatif) + (Önceki Yıl 12A) − (Önceki Yıl Aynı Ara Dönem)",
      en: "TTM = (Current YTD) + (Prior Full Year) − (Prior Same YTD Period)",
      fr: "TTM = (Cumul en cours) + (Exercice précédent) − (Même cumul N-1)",
    },
    points: {
      tr: [
        "Yalnızca gelir tablosu ve nakit akışı gibi akım (dönemlik) kalemleri TTM olarak toplanır; bilanço (özkaynak, net borç) her zaman son bilanço tarihindeki stok değerdir.",
        "KAP'ta ara dönem tabloları kümülatif (3A, 6A, 9A, 12A) yayımlanır; bu nedenle 2. çeyrek sonrası TTM hesabı için bir önceki yılın 6 aylık verisi çıkarılır.",
        "Yüksek enflasyon dönemlerinde TMS 29 düzeltmesi uygulanan ve uygulanmayan çeyreklerin aynı TTM toplamına karışmamasına dikkat edilmelidir.",
        "F/K, FD/FAVÖK, ROE ve temettü verimi oranları karşılaştırılabilirlik için TTM bazında hesaplanır.",
      ],
      en: [
        "Only flow items (income statement, cash flow) are summed over 12 months; balance-sheet items (equity, net debt) use the latest snapshot.",
        "Because KAP interim reports are cumulative (3M, 6M, 9M, 12M), TTM subtracts the prior year's matching interim period.",
        "During IAS 29 inflation accounting transitions, verify that restated and unadjusted quarters are not mixed.",
        "P/E, EV/EBITDA, ROE and dividend yield rely on TTM figures so stocks with different fiscal rhythms stay comparable.",
      ],
      fr: [
        "Seuls les flux (résultat, trésorerie) sont cumulés sur 12 mois ; le bilan reste un instantané de fin de période.",
        "Les états intermédiaires KAP étant cumulatifs (3M, 6M, 9M, 12M), on retranche la même période de l'exercice précédent.",
        "Veillez à la cohérence IAS 29 lors des transitions comptables en période d'inflation.",
        "PER, VE/EBITDA, ROE et rendement du dividende s'appuient sur le TTM pour rester comparables.",
      ],
    },
    methodology: {
      tr: "Hisse Analizi temel analiz tablolarında dönem bazlı KAP kümülatif verileri korunurken, tarama ve değerleme çarpanlarında son 12 aylık kaydırılmış (TTM) seriler kullanılır.",
      en: "Fundamental statement tables preserve reported KAP periods, while screener multiples and ROE use trailing 12-month (TTM) series.",
      fr: "Les états financiers conservent les périodes KAP publiées ; le filtre et les multiples utilisent les séries TTM.",
    },
    source: {
      tr: "KAP finansal raporları ve TradingView TTM veri seti",
      en: "KAP financial reports & TradingView TTM dataset",
      fr: "Rapports financiers KAP et données TTM TradingView",
    },
    keywords: ["ttm", "son 12 ay", "kaydirilmis", "yilliklandirilmis", "ceyrek", "bilanco", "trailing twelve months"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=profitable&view=fundamentals",
        label: { tr: "Son 12 ayda kârlı şirketler", en: "TTM profitable stocks", fr: "Sociétés bénéficiaires (TTM)" },
        description: { tr: "TTM net kârı pozitif olan tüm BIST hisseleri.", en: "All BIST listings with positive trailing 12-month net income.", fr: "Toutes les actions BIST à résultat net TTM positif." },
      },
      {
        kind: "chart",
        href: "/temel/THYAO",
        label: { tr: "Finansal tabloları incele: THYAO", en: "Inspect financial statements: THYAO", fr: "Consulter les états financiers : THYAO" },
        description: { tr: "Yıllık ve çeyreklik gelir tablosu, bilanço ve nakit akışı.", en: "Annual and quarterly income statement, balance sheet and cash flow.", fr: "Compte de résultat, bilan et flux de trésorerie." },
      },
    ],
    relatedSlugs: ["fk-orani", "roe-ozkaynak-karliligi", "fd-favok"],
  },
  {
    slug: "reel-getiri",
    category: "macro",
    badge: "REEL",
    title: {
      tr: "Reel Getiri (Enflasyondan Arındırılmış Getiri)",
      en: "Real Return (Inflation-Adjusted Return)",
      fr: "Rendement réel (corrigé de l'inflation)",
    },
    cardDesc: {
      tr: "Nominal TL getirisinin TÜFE enflasyonu veya döviz/altın karşısındaki alım gücü değişimi.",
      en: "Purchasing-power return after adjusting nominal TRY performance for CPI inflation or FX/gold.",
      fr: "Performance en pouvoir d'achat après correction du rendement nominal par l'IPC, les devises ou l'or.",
    },
    question: {
      tr: "Reel getiri nasıl hesaplanır ve BIST grafiklerinde nasıl görülür?",
      en: "How is real return calculated and viewed on BIST charts?",
      fr: "Comment calculer le rendement réel et l'afficher sur les graphiques BIST ?",
    },
    intro: {
      tr: "Yüksek enflasyon ortamında bir hissenin veya endeksin TL bazında yükselmesi tek başına alım gücü artışı anlamına gelmez. Reel getiri, nominal fiyat hareketini TÜFE enflasyon endeksine göre bugünün lirasına çevirerek gerçek değer artışını ölçer; USD, EUR ve gram altın bazlı birimler de alternatif kıyaslama sağlar.",
      en: "In a high-inflation economy, a rising nominal TRY price does not guarantee higher purchasing power. Real return deflates historical prices by CPI into today's lira, while USD, EUR and gram-gold units offer currency and commodity benchmarks.",
      fr: "En contexte inflationniste, une hausse nominale en TRY ne garantit pas un gain de pouvoir d'achat. Le rendement réel ajuste les cours par l'IPC en lires d'aujourd'hui ; l'USD, l'EUR et l'or offrent des repères complémentaires.",
    },
    formula: {
      tr: "Reel Getiri = ((1 + Nominal Getiri) / (1 + Enflasyon)) − 1",
      en: "Real Return = ((1 + Nominal Return) / (1 + Inflation)) − 1",
      fr: "Rendement réel = ((1 + Rendement nominal) / (1 + Inflation)) − 1",
    },
    points: {
      tr: [
        "Basit çıkarma (Nominal − Enflasyon) yüksek enflasyonda hata üretir; doğru sonuç bileşik Fisher formülüyle bulunur.",
        "Hisse Analizi fiyat grafiklerindeki birim menüsünden (TRY / USD / EUR / Gram Altın / Reel TL) tek tıkla enflasyondan arındırılmış seri açılabilir.",
        "Reel TL serisi her çubuğun ayındaki TÜFE düzeyini en son açıklanan TÜFE'ye oranlayarak fiyatları bugünün alım gücüne taşır.",
        "Temettü ödeyen hisselerde gerçek alım gücü karşılaştırması için temettülerin yeniden yatırıldığı toplam getiri (Total Return) çizgisi de birlikte değerlendirilmelidir.",
      ],
      en: [
        "Simple subtraction (Nominal − Inflation) drifts significantly at high inflation; use the compounded Fisher formula.",
        "Every price chart in Hisse Analizi includes a unit switcher (TRY / USD / EUR / Gold / Real TRY) to inspect purchasing-power series.",
        "The Real TRY series scales each bar by latest CPI / bar-month CPI, expressing past prices in today's lira.",
        "For dividend payers, combine real-unit charts with total-return (reinvested dividend) performance.",
      ],
      fr: [
        "La simple soustraction (Nominal − Inflation) est inexacte lorsque l'inflation est élevée ; utilisez la formule de Fisher.",
        "Les graphiques de Hisse Analizi proposent un sélecteur d'unité (TRY / USD / EUR / Or / TRY réel).",
        "La série TRY réel revalorise chaque barre par le rapport IPC récent / IPC du mois de la barre.",
        "Pour les valeurs à dividende, croisez le rendement réel avec le rendement total (dividendes réinvestis).",
      ],
    },
    methodology: {
      tr: "Grafik motorundaki Reel TL dönüşümü aylık TÜİK/TCMB TÜFE değişimlerini zincirleyerek her günlük/haftalık çubuğu en güncel ayın alım gücüne ölçekler.",
      en: "Chart Real TRY conversion chains monthly CPI changes from CBRT/TurkStat and scales daily/weekly bars (up to 5Y) into the latest month's purchasing power.",
      fr: "La conversion en TRY réel chaîne les variations mensuelles de l'IPC (BCRT/TurkStat) et met les cours en pouvoir d'achat du dernier mois publié.",
    },
    source: {
      tr: "TCMB EVDS / TÜİK TÜFE enflasyon serisi ve BIST kapanış verileri",
      en: "CBRT / TurkStat CPI inflation series & BIST historical prices",
      fr: "Séries IPC BCRT / TurkStat et historiques de cours BIST",
    },
    keywords: ["reel getiri", "enflasyon", "tufe", "cpi", "real return", "dolar bazli", "usd", "altin bazli", "alim gucu"],
    actions: [
      {
        kind: "macro",
        href: "/makro",
        label: { tr: "Enflasyon ve politika faizi (/makro)", en: "Inflation & policy rate (/makro)", fr: "Inflation et taux directeur (/makro)" },
        description: { tr: "Güncel yıllık/aylık TÜFE, TCMB faizi, döviz ve tahvil getirileri.", en: "Latest annual/monthly CPI, CBRT policy rate, FX and bond yields.", fr: "IPC annuel/mensuel, taux BCRT, devises et obligations." },
      },
      {
        kind: "index",
        href: "/endeks/bist-100",
        label: { tr: "BIST 100 endeks sayfası ve grafik", en: "BIST 100 index page & chart", fr: "Page et graphique BIST 100" },
        description: { tr: "Endeks grafiğinde birim menüsünden USD veya Reel TL görünümüne geçin.", en: "Switch units to USD or Real TRY directly on the index chart.", fr: "Basculez le graphique en USD ou TRY réel." },
      },
      {
        kind: "chart",
        href: "/hisse/THYAO",
        label: { tr: "Örnek hisse grafiği (birim seçici)", en: "Sample stock chart (unit switcher)", fr: "Graphique d'action (sélecteur d'unité)" },
        description: { tr: "Grafik araç çubuğundan Reel TL, USD, EUR veya Gram Altın seçin.", en: "Pick Real TRY, USD, EUR or Gold from the chart toolbar.", fr: "Choisissez TRY réel, USD, EUR ou Or dans la barre d'outils." },
      },
    ],
    relatedSlugs: ["temettu-verimi", "ttm-son-12-ay"],
  },
  {
    slug: "rsi",
    category: "technical",
    badge: "RSI",
    title: {
      tr: "RSI (Göreli Güç Endeksi — 14)",
      en: "RSI (Relative Strength Index — 14)",
      fr: "RSI (Indice de force relative — 14)",
    },
    cardDesc: {
      tr: "0–100 aralığında momentum osilatörü; aşırı satım (≤ 30) ve aşırı alım (≥ 70) bölgeleri.",
      en: "0–100 momentum oscillator highlighting oversold (≤ 30) and overbought (≥ 70) zones.",
      fr: "Oscillateur de momentum (0–100) identifiant les zones de survente (≤ 30) et de surachat (≥ 70).",
    },
    question: {
      tr: "RSI göstergesi nedir, 30 ve 70 seviyeleri ne anlama gelir?",
      en: "What is RSI and what do the 30 and 70 thresholds mean?",
      fr: "Qu'est-ce que le RSI et que signifient les seuils 30 et 70 ?",
    },
    intro: {
      tr: "RSI (Relative Strength Index), belirli bir dönemdeki (standart 14 bar) yükseliş kapanışlarının ortalama büyüklüğünü düşüş kapanışlarının ortalama büyüklüğüyle karşılaştırarak 0 ile 100 arasında bir momentum puanı üretir. Kısa vadeli aşırı gerilmeleri ve fiyat-momentum uyumsuzluklarını görmeye yardımcı olur.",
      en: "RSI (Relative Strength Index) compares average upward closes to average downward closes over a lookback window (standard 14 bars), producing a 0–100 momentum score to spot stretched moves and divergences.",
      fr: "Le RSI compare la moyenne des hausses à la moyenne des baisses sur 14 périodes pour produire un indicateur de momentum borné entre 0 et 100.",
    },
    formula: {
      tr: "RSI = 100 − [ 100 / (1 + Ortalama Kazanç / Ortalama Kayıp) ]",
      en: "RSI = 100 − [ 100 / (1 + Average Gain / Average Loss) ]",
      fr: "RSI = 100 − [ 100 / (1 + Gain moyen / Perte moyenne) ]",
    },
    points: {
      tr: [
        "RSI ≤ 30 genellikle 'aşırı satım', RSI ≥ 70 'aşırı alım' bölgesi olarak izlenir; ancak güçlü trendlerde RSI uzun süre bu bölgelerde kalabilir.",
        "Tek başına al/sat tetikleyicisi değildir; trend yönü (SMA 50/200), işlem hacmi ve temel gelişmelerle (KAP bildirimleri) teyit edilmelidir.",
        "Fiyat yeni dip yaparken RSI daha yüksek dip yapıyorsa pozitif uyumsuzluk, fiyat yeni zirve yaparken RSI düşüyorsa negatif uyumsuzluk oluşur.",
        "Farklı zaman dilimlerinde (günlük, haftalık) RSI farklı sinyaller verebilir.",
      ],
      en: [
        "RSI ≤ 30 is commonly watched as oversold and RSI ≥ 70 as overbought, but strong trends can remain stretched for weeks.",
        "Never treat RSI as a standalone buy/sell trigger; confirm with trend (SMA 50/200), volume and KAP news.",
        "Divergences occur when price makes a new high or low that RSI fails to confirm.",
        "Daily and weekly timeframes can tell very different momentum stories.",
      ],
      fr: [
        "Un RSI ≤ 30 signale une zone de survente et ≥ 70 une zone de surachat, mais une tendance forte peut y rester durablement.",
        "Ne l'utilisez pas seul : croisez-le avec la tendance (MM 50/200), les volumes et l'actualité KAP.",
        "Une divergence apparaît lorsque le cours inscrit un nouveau sommet ou creux non confirmé par le RSI.",
        "Les unités de temps journalière et hebdomadaire peuvent donner des lectures différentes.",
      ],
    },
    methodology: {
      tr: "Hisse Analizi teknik ekranlarında ve taramada Wilder düzleştirilmiş 14 periyot günlük RSI (RSI 14) kullanılır; aşırı satım eşiği 30, aşırı alım eşiği 70'tir.",
      en: "Hisse Analizi technical pages and the screener use Wilder-smoothed 14-period daily RSI with oversold ≤ 30 and overbought ≥ 70 thresholds.",
      fr: "Les pages techniques et le filtre utilisent le RSI journalier à 14 périodes (lissage Wilder), avec seuils 30 et 70.",
    },
    source: {
      tr: "BIST günlük OHLCV serileri ve TradingView teknik göstergeleri",
      en: "BIST daily OHLCV series & TradingView technical indicators",
      fr: "Séries OHLCV journalières BIST et indicateurs techniques TradingView",
    },
    keywords: ["rsi", "goreli guc", "momentum", "asiri satim", "asiri alim", "oversold", "overbought", "teknik"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=rsi_oversold&view=technical&sort=rsi&dir=asc",
        label: { tr: "RSI aşırı satım taraması (RSI ≤ 30)", en: "RSI oversold screen (RSI ≤ 30)", fr: "Filtre RSI survendu (RSI ≤ 30)" },
        description: { tr: "Günlük RSI(14) değeri 30 ve altındaki BIST hisseleri.", en: "BIST stocks with daily RSI(14) at or below 30.", fr: "Actions BIST avec RSI(14) ≤ 30." },
      },
      {
        kind: "screener",
        href: "/tarama?screen=rsi_overbought&view=technical&sort=rsi&dir=desc",
        label: { tr: "RSI aşırı alım taraması (RSI ≥ 70)", en: "RSI overbought screen (RSI ≥ 70)", fr: "Filtre RSI suracheté (RSI ≥ 70)" },
        description: { tr: "Günlük RSI(14) değeri 70 ve üzerindeki BIST hisseleri.", en: "BIST stocks with daily RSI(14) at or above 70.", fr: "Actions BIST avec RSI(14) ≥ 70." },
      },
      {
        kind: "chart",
        href: "/teknik/THYAO",
        label: { tr: "Teknik analiz ekranı: THYAO", en: "Technical analysis view: THYAO", fr: "Analyse technique : THYAO" },
        description: { tr: "RSI, MACD, Bollinger ve tüm zaman dilimi sinyallerini inceleyin.", en: "Review RSI, MACD, Bollinger Bands and multi-timeframe signals.", fr: "Consultez RSI, MACD, Bollinger et signaux multi-horizons." },
      },
    ],
    relatedSlugs: ["sma-kesisimleri", "reel-getiri"],
  },
  {
    slug: "pddd-orani",
    category: "valuation",
    badge: "PD/DD",
    title: {
      tr: "PD/DD Oranı (Piyasa Değeri / Defter Değeri)",
      en: "P/B Ratio (Price to Book Value)",
      fr: "Ratio C/VC (Cours / Valeur comptable)",
    },
    cardDesc: {
      tr: "Piyasa değerinin şirketin özkaynaklarına oranı; banka, GYO ve holdinglerde temel çarpan.",
      en: "Market cap relative to shareholders' equity; central for banks, REITs and holdings.",
      fr: "Capitalisation rapportée aux capitaux propres ; référence pour banques, foncières et holdings.",
    },
    question: {
      tr: "PD/DD oranı nedir ve neden özellikle bankalar ile GYO'larda kullanılır?",
      en: "What is the P/B ratio and why is it central for banks and REITs?",
      fr: "Qu'est-ce que le ratio C/VC et pourquoi domine-t-il pour les banques ?",
    },
    intro: {
      tr: "PD/DD (Piyasa Değeri / Defter Değeri), şirketin borsa değerini bilançosundaki ana ortaklığa ait özkaynaklara böler. Varlıklarının büyük bölümü finansal alacaklardan veya gayrimenkul portföyünden oluşan bankalar, sigorta şirketleri, GYO'lar ve holdingler için temel değerleme ölçütüdür.",
      en: "P/B (Price-to-Book) divides market capitalization by shareholders' equity. It is the primary valuation lens for asset-heavy financial businesses — banks, insurers, REITs and holding companies — and must be read alongside ROE.",
      fr: "Le ratio Cours / Valeur comptable (C/VC) compare la capitalisation aux capitaux propres. Il est central pour les banques, assureurs, foncières et holdings, et se lit toujours avec le ROE.",
    },
    formula: {
      tr: "PD/DD = Piyasa Değeri / Özkaynaklar (Defter Değeri)",
      en: "P/B = Market Capitalization / Book Equity",
      fr: "C/VC = Capitalisation boursière / Capitaux propres",
    },
    points: {
      tr: [
        "PD/DD < 1 olması hissenin muhasebe özkaynağının altında fiyatlandığını gösterir; ancak düşük özkaynak kârlılığı (ROE) varsa bu iskonto kalıcı olabilir.",
        "Yüksek ROE üreten bir şirket haklı olarak daha yüksek PD/DD çarpanıyla işlem görür (PD/DD ≈ ROE × F/K).",
        "Özkaynakları negatif olan şirketlerde PD/DD anlamlı değildir ve sektör medyanına dahil edilmez.",
        "Yazılım ve marka odaklı şirketlerde maddi olmayan varlıklar bilançoda tam yansımadığı için PD/DD yüksek kalabilir.",
      ],
      en: [
        "P/B < 1 means trading below accounting equity, which can be a value opportunity or a reflection of persistently weak ROE.",
        "Higher sustainable ROE justifies a higher P/B multiple (P/B ≈ ROE × P/E).",
        "Negative-equity firms have no meaningful P/B and are excluded from sector medians.",
        "Asset-light software or brand businesses naturally trade at higher P/B ratios.",
      ],
      fr: [
        "Un C/VC < 1 indique une décote sur les fonds propres, parfois justifiée si le ROE reste faible.",
        "Un ROE durablement élevé justifie un C/VC supérieur (C/VC ≈ ROE × PER).",
        "Les capitaux propres négatifs sont exclus des médianes sectorielles.",
        "Les sociétés peu capitalistiques (logiciels, services) affichent naturellement un C/VC plus élevé.",
      ],
    },
    methodology: {
      tr: "Sektör medyanı hesabında yalnızca pozitif PD/DD değerleri dikkate alınır (en az 3 şirket).",
      en: "Sector medians count only positive P/B observations (minimum 3 companies).",
      fr: "Les médianes sectorielles ne retiennent que les valeurs C/VC positives (minimum 3 sociétés).",
    },
    source: {
      tr: "KAP son dönem bilançosu ve TradingView değerleme verisi",
      en: "Latest KAP balance sheet & TradingView valuation feed",
      fr: "Dernier bilan KAP et flux de valorisation TradingView",
    },
    keywords: ["pd/dd", "pddd", "p/b", "pb", "defter degeri", "ozkaynak", "book value", "banka carpani"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=low_pb&view=fundamentals&sort=pb&dir=asc",
        label: { tr: "Düşük PD/DD taraması (PD/DD ≤ 1)", en: "Low P/B screen (P/B ≤ 1)", fr: "Filtre C/VC faible (C/VC ≤ 1)" },
        description: { tr: "Defter değerinin altında veya eşit işlem gören hisseler.", en: "Stocks trading at or below book value.", fr: "Actions cotées à ou sous leur valeur comptable." },
      },
      {
        kind: "sector",
        href: "/sektor/bankalar",
        label: { tr: "Bankalar sektör sayfası", en: "Banks sector page", fr: "Page secteur Banques" },
        description: { tr: "Bankaların PD/DD, F/K ve ROE medyanlarını yan yana görün.", en: "Compare bank P/B, P/E and ROE medians side by side.", fr: "Comparez C/VC, PER et ROE des banques." },
      },
    ],
    relatedSlugs: ["banka-ve-sanayi-oranlari", "roe-ozkaynak-karliligi", "fk-orani"],
  },
  {
    slug: "fd-favok",
    category: "valuation",
    badge: "FD/FAVÖK",
    title: {
      tr: "FD/FAVÖK (Firma Değeri / FAVÖK)",
      en: "EV/EBITDA (Enterprise Value to EBITDA)",
      fr: "VE/EBITDA (Valeur d'entreprise / EBITDA)",
    },
    cardDesc: {
      tr: "Borç yapısını da içeren firma değerinin operasyonel nakit üretim gücüne (FAVÖK) oranı.",
      en: "Debt-inclusive enterprise value divided by operating earnings before depreciation & amortization.",
      fr: "Valeur d'entreprise (dette incluse) rapportée à l'excédent brut d'exploitation (EBITDA).",
    },
    question: {
      tr: "FD/FAVÖK neden F/K'yı tamamlar ve hangi sektörlerde anlamlıdır?",
      en: "Why does EV/EBITDA complement P/E and where does it apply?",
      fr: "Pourquoi le ratio VE/EBITDA complète-t-il le PER ?",
    },
    intro: {
      tr: "FD/FAVÖK, piyasa değerine net borcu ekleyerek şirketin tamamını satın alma maliyetini (Firma Değeri) ölçer ve bunu vergi, faiz ve amortisman öncesi operasyonel kâra (FAVÖK) böler. Farklı borçluluk yapısına sahip sanayi, enerji, perakende ve ulaştırma şirketlerini kıyaslamak için F/K'dan daha temiz bir zemin sunar.",
      en: "EV/EBITDA adds net debt to market cap to measure the total acquisition cost of a business (Enterprise Value) and compares it to operating cash earnings (EBITDA). It enables cleaner comparisons across industrial, energy, retail and airline peers with different leverage.",
      fr: "VE/EBITDA intègre la dette nette dans la valeur de l'entreprise pour la rapporter à l'EBITDA opérationnel, facilitant la comparaison entre entreprises industrielles différemment endettées.",
    },
    formula: {
      tr: "FD/FAVÖK = (Piyasa Değeri + Net Borç) / FAVÖK (TTM)",
      en: "EV/EBITDA = (Market Cap + Net Debt) / EBITDA (TTM)",
      fr: "VE/EBITDA = (Capitalisation + Dette nette) / EBITDA (TTM)",
    },
    points: {
      tr: [
        "Yüksek borçlu şirketlerde F/K düşük görünse bile net borç eklendiğinde FD/FAVÖK yüksek çıkabilir.",
        "Bankalar, sigorta şirketleri ve finansal kurumlarda borç iş modelinin hammaddesidir; bu yüzden FD/FAVÖK finans sektöründe kullanılmaz.",
        "FAVÖK yatırım harcamalarını (CAPEX) düşmez; çok yüksek bakım yatırımı gerektiren sektörlerde nakit akışı ayrıca kontrol edilmelidir.",
        "FAVÖK negatif olduğunda oran tanımlı değildir.",
      ],
      en: [
        "Heavily leveraged firms can look cheap on P/E while looking expensive on EV/EBITDA once net debt is included.",
        "Banks and insurers treat deposits and debt as operating inventory, so EV/EBITDA is not applicable to financials.",
        "EBITDA excludes capital expenditure (CAPEX); always check free cash flow in capital-intensive industries.",
        "The ratio is undefined when trailing EBITDA is negative.",
      ],
      fr: [
        "Une forte dette peut rendre le PER bas tout en laissant le VE/EBITDA élevé.",
        "Le ratio ne s'applique pas aux banques ni aux assureurs, où la dette fait partie du métier.",
        "L'EBITDA exclut les investissements (CAPEX) ; vérifiez le flux de trésorerie libre.",
        "Le multiple n'est pas défini lorsque l'EBITDA est négatif.",
      ],
    },
    methodology: {
      tr: "Son 12 ay (TTM) pozitif FAVÖK üreten sanayi ve hizmet şirketleri için hesaplanır; banka ve sigorta karşılaştırmalarında otomatik gizlenir.",
      en: "Computed for non-financial stocks with positive trailing 12-month EBITDA; hidden automatically in bank/insurer peer comparisons.",
      fr: "Calculé pour les sociétés non financières à EBITDA TTM positif ; masqué automatiquement pour les banques et assureurs.",
    },
    source: {
      tr: "KAP finansal tabloları ve TradingView TTM çarpanları",
      en: "KAP financial statements & TradingView TTM multiples",
      fr: "États financiers KAP et multiples TTM TradingView",
    },
    keywords: ["fd/favok", "fdfavok", "ev/ebitda", "evebitda", "favok", "ebitda", "firma degeri", "sanayi"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=low_ev_ebitda&view=fundamentals&sort=ev_ebitda&dir=asc",
        label: { tr: "Düşük FD/FAVÖK taraması (≤ 6)", en: "Low EV/EBITDA screen (≤ 6)", fr: "Filtre VE/EBITDA faible (≤ 6)" },
        description: { tr: "FD/FAVÖK oranı 6 ve altındaki BIST şirketleri.", en: "BIST stocks trading at EV/EBITDA ≤ 6.", fr: "Actions BIST avec VE/EBITDA ≤ 6." },
      },
      {
        kind: "index",
        href: "/endeks/bist-sinai",
        label: { tr: "BIST Sınai endeks sayfası", en: "BIST Industrials index page", fr: "Page indice BIST Industrie" },
        description: { tr: "Sanayi şirketlerinin medyan FD/FAVÖK ve kârlılık verileri.", en: "Industrial constituent EV/EBITDA and profitability medians.", fr: "Médianes VE/EBITDA et rentabilité de l'industrie." },
      },
    ],
    relatedSlugs: ["banka-ve-sanayi-oranlari", "fk-orani", "net-borc-favok"],
  },
  {
    slug: "roe-ozkaynak-karliligi",
    category: "profitability",
    badge: "ROE",
    title: {
      tr: "ROE (Özkaynak Kârlılığı)",
      en: "ROE (Return on Equity)",
      fr: "ROE (Rentabilité des capitaux propres)",
    },
    cardDesc: {
      tr: "Şirketin ortakların sermayesiyle ne kadar net kâr ürettiğini ölçen ana verimlilik oranı.",
      en: "Net income generated per unit of shareholders' equity — the headline capital efficiency metric.",
      fr: "Bénéfice net généré rapporté aux capitaux propres — mesure clé d'efficacité du capital.",
    },
    question: {
      tr: "ROE (Özkaynak Kârlılığı) nedir ve enflasyon ortamında nasıl okunmalıdır?",
      en: "What is ROE and how should it be evaluated under inflation?",
      fr: "Qu'est-ce que le ROE et comment l'évaluer face à l'inflation ?",
    },
    intro: {
      tr: "ROE (Return on Equity), şirketin son 12 aylık net kârını özkaynaklarına bölerek sermaye verimliliğini gösterir. Türkiye gibi yüksek faiz ve enflasyon dönemlerinde bir şirketin ROE'sinin yalnızca pozitif olması değil, enflasyon ve risksiz faiz oranıyla karşılaştırılması da önem taşır.",
      en: "ROE (Return on Equity) divides trailing 12-month net income by shareholders' equity. In a high-rate, high-inflation environment, evaluate ROE not just against zero, but relative to inflation, the risk-free yield and sector peers.",
      fr: "Le ROE rapporte le résultat net sur 12 mois aux capitaux propres. En période d'inflation et de taux élevés, comparez le ROE au taux sans risque, à l'inflation et aux pairs du secteur.",
    },
    formula: {
      tr: "ROE (%) = (Net Kâr (TTM) / Özkaynaklar) × 100",
      en: "ROE (%) = (Net Income (TTM) / Shareholders' Equity) × 100",
      fr: "ROE (%) = (Résultat net (TTM) / Capitaux propres) × 100",
    },
    points: {
      tr: [
        "Yüksek borçluluk özkaynağı küçülttüğü için ROE'yi yapay olarak yükseltebilir; bu yüzden ROE her zaman Net Borç / FAVÖK ve ROA ile birlikte okunmalıdır.",
        "DuPont ayrışması: ROE = Net Kâr Marjı × Aktif Devir Hızı × Finansal Kaldıraç.",
        "Bankalarda PD/DD ile ROE arasında güçlü bir ilişki vardır; sektör medyanının üstünde sürdürülebilir ROE daha yüksek PD/DD'yi destekler.",
      ],
      en: [
        "High financial leverage shrinks equity and can inflate ROE; always check Net Debt / EBITDA and ROA alongside ROE.",
        "DuPont identity: ROE = Net Margin × Asset Turnover × Financial Leverage.",
        "For banks, sustainable ROE above sector median directly supports higher P/B multiples.",
      ],
      fr: [
        "Un levier élevé peut gonfler artificiellement le ROE ; croisez-le toujours avec le ROA et l'endettement.",
        "Décomposition DuPont : ROE = Marge nette × Rotation de l'actif × Levier financier.",
        "Chez les banques, un ROE durablement supérieur à la médiane soutient un C/VC plus élevé.",
      ],
    },
    methodology: {
      tr: "Sektör medyanları tüm sonlu ROE gözlemleri (negatif değerler dahil) üzerinden hesaplanır; böylece kârlılık dağılımı olduğundan iyimser görünmez.",
      en: "Sector medians include all finite ROE values (including negative ones) so sector profitability is not biased upward.",
      fr: "Les médianes sectorielles incluent toutes les valeurs finies de ROE (y compris négatives) pour éviter tout biais optimiste.",
    },
    source: {
      tr: "KAP finansal tabloları ve TradingView kârlılık göstergeleri",
      en: "KAP financial statements & TradingView profitability feed",
      fr: "États financiers KAP et indicateurs de rentabilité TradingView",
    },
    keywords: ["roe", "ozkaynak karliligi", "return on equity", "karlilik", "verimlilik", "dupont"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=high_roe&view=fundamentals&sort=roe&dir=desc",
        label: { tr: "Yüksek ROE taraması (ROE ≥ %25)", en: "High ROE screen (ROE ≥ 25%)", fr: "Filtre ROE élevé (ROE ≥ 25 %)" },
        description: { tr: "Özkaynak kârlılığı %25 ve üzerindeki BIST hisseleri.", en: "BIST companies with ROE of 25% or higher.", fr: "Sociétés du BIST avec un ROE ≥ 25 %." },
      },
      {
        kind: "screener",
        href: "/tarama?screen=roe_above_sector&view=fundamentals&sort=roe&dir=desc",
        label: { tr: "ROE sektör medyanının üstündekiler", en: "ROE above KAP sector median", fr: "ROE au-dessus de la médiane sectorielle" },
        description: { tr: "Kendi KAP sektörünün medyanından daha kârlı şirketler.", en: "Companies earning higher ROE than their KAP sector median.", fr: "Sociétés plus rentables que la médiane de leur secteur." },
      },
    ],
    relatedSlugs: ["pddd-orani", "ttm-son-12-ay", "sektor-medyani"],
  },
  {
    slug: "temettu-verimi",
    category: "valuation",
    badge: "TEMETTÜ",
    title: {
      tr: "Temettü Verimi ve Toplam Getiri",
      en: "Dividend Yield & Total Return",
      fr: "Rendement du dividende et rendement total",
    },
    cardDesc: {
      tr: "Son 12 ayda hisse başına ödenen nakit temettünün güncel fiyata oranı ve yeniden yatırım etkisi.",
      en: "Trailing 12-month cash dividends per share divided by price, plus reinvestment impact.",
      fr: "Dividendes en numéraire versés sur 12 mois rapportés au cours, et effet de réinvestissement.",
    },
    question: {
      tr: "Temettü verimi nasıl hesaplanır ve temettü ödenince hisse fiyatı neden düşer?",
      en: "How is dividend yield calculated and why does the share price adjust on ex-date?",
      fr: "Comment calcule-t-on le rendement du dividende et pourquoi le cours s'ajuste-t-il au détachement ?",
    },
    intro: {
      tr: "Temettü verimi, şirketin son 12 ayda dağıttığı hisse başına brüt nakit temettünün güncel hisse fiyatına oranıdır. Hak kullanım (ex-dividend) tarihinde hisse teorik olarak temettü tutarı kadar aşağıdan açılır; bu yüzden uzun vadeli getiriyi ölçerken yalnızca fiyat grafiğine değil, temettülerin yeniden yatırıldığı toplam getiriye bakmak gerekir.",
      en: "Dividend yield measures trailing 12-month gross cash dividends per share as a percentage of the current share price. Because the share price adjusts downward by the dividend on ex-date, long-term performance should be measured with Total Return (dividends reinvested).",
      fr: "Le rendement du dividende rapporte les dividendes bruts versés sur 12 mois au cours actuel. Le cours s'ajustant à la baisse au détachement, le rendement total (dividendes réinvestis) reflète mieux la performance de long terme.",
    },
    formula: {
      tr: "Temettü Verimi (%) = (Son 12 Ay Hisse Başına Nakit Temettü / Hisse Fiyatı) × 100",
      en: "Dividend Yield (%) = (Trailing 12M Cash Dividends per Share / Share Price) × 100",
      fr: "Rendement (%) = (Dividendes en numéraire 12M / Cours) × 100",
    },
    points: {
      tr: [
        "Çok yüksek görünen temettü verimi bazen temettü artışı değil, hisse fiyatının sert düşmesi sonucu oluşur ('temettü tuzağı').",
        "Süreklilik için dağıtma oranı, serbest nakit akışı ve son 5 yıllık temettü geçmişi (Temel Analiz → Temettü Geçmişi) kontrol edilmelidir.",
        "Hisse Analizi fiyat grafiklerinde 'Toplam Getiri' seçeneği temettülerin hak kullanım gününde hisseye yeniden yatırıldığı eğriyi çizer.",
        "Sektör temettü verimi medyanı yalnızca temettü ödeyen şirketler üzerinden hesaplanır.",
      ],
      en: [
        "An unusually high yield can result from a sharp share-price drop rather than sustainable payouts (a dividend trap).",
        "Check payout sustainability, free cash flow and multi-year history in the Dividend History card.",
        "Price charts offer a Total Return overlay that reinvests each cash dividend on its ex-date.",
        "Sector dividend yield medians are computed across dividend payers only.",
      ],
      fr: [
        "Un rendement très élevé peut provenir d'une chute du cours plutôt que d'une hausse pérenne du dividende.",
        "Vérifiez l'historique pluriannuel et la génération de trésorerie dans la fiche dividende.",
        "Les graphiques proposent la courbe de rendement total (dividendes réinvestis au détachement).",
        "La médiane sectorielle de rendement ne compte que les sociétés distributrices.",
      ],
    },
    methodology: {
      tr: "Temettü verimi medyanında yalnızca pozitif verime sahip (temettü dağıtan) şirketler sayılır; grafiklerdeki toplam getiri serisi her hak kullanım gününde `1 + D / önceki kapanış` çarpanıyla güncellenir.",
      en: "Dividend yield medians count payers only (positive yield); chart total-return curves step up by `1 + D / prior close` on each ex-date.",
      fr: "Les médianes ne comptent que les payeurs ; la courbe de rendement total applique `1 + D / clôture précédente` à chaque date de détachement.",
    },
    source: {
      tr: "KAP temettü dağıtım bildirimleri ve TradingView temettü verisi",
      en: "KAP dividend disclosures & TradingView dividend dataset",
      fr: "Déclarations de dividendes KAP et données TradingView",
    },
    keywords: ["temettu", "temettu verimi", "dividend", "dividend yield", "toplam getiri", "total return", "nakit kar payi"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=high_dividend&view=fundamentals&sort=dividend_yield&dir=desc",
        label: { tr: "Yüksek temettü taraması (≥ %4)", en: "High dividend screen (≥ 4%)", fr: "Filtre dividende élevé (≥ 4 %)" },
        description: { tr: "Son 12 ay temettü verimi %4 ve üzerindeki BIST hisseleri.", en: "BIST stocks yielding 4% or more over the trailing 12 months.", fr: "Actions BIST offrant un rendement ≥ 4 %." },
      },
      {
        kind: "index",
        href: "/endeks/bist-temettu",
        label: { tr: "BIST Temettü endeks sayfası", en: "BIST Dividend index page", fr: "Page indice BIST Dividendes" },
        description: { tr: "BIST Temettü (XTMTU) endeksindeki şirketler ve medyan oranlar.", en: "Constituents and medians of the BIST Dividend index (XTMTU).", fr: "Composants et médianes de l'indice BIST Dividendes." },
      },
    ],
    relatedSlugs: ["reel-getiri", "fk-orani", "roe-ozkaynak-karliligi"],
  },
  {
    slug: "banka-ve-sanayi-oranlari",
    category: "sector",
    badge: "BANKA / SINAİ",
    title: {
      tr: "Banka ve Sanayi Şirketlerinde Oran Farkları",
      en: "Bank vs. Industrial Financial Ratios",
      fr: "Ratios : banques vs sociétés industrielles",
    },
    cardDesc: {
      tr: "Neden bankalarda FD/FAVÖK ve cari oran kullanılmaz, hangi oranlara odaklanılır?",
      en: "Why EV/EBITDA and current ratio do not apply to banks, and which metrics replace them.",
      fr: "Pourquoi VE/EBITDA et ratio de liquidité ne s'appliquent pas aux banques.",
    },
    question: {
      tr: "Banka bilançoları sanayi şirketlerinden nasıl ayrılır ve hangi oranlarla karşılaştırılır?",
      en: "How do bank balance sheets differ from industrials and which ratios matter?",
      fr: "En quoi les bilans bancaires diffèrent-ils de l'industrie ?",
    },
    intro: {
      tr: "Sanayi şirketlerinde borç, fabrikaları ve stokları finanse eden bir kaynaktır; bankalarda ise mevduat ve krediler işin kendisidir. Bu yapısal fark nedeniyle tüm BIST hisselerini tek bir şablonla puanlamak yanıltıcı olur: bankalar PD/DD, ROE, net faiz marjı ve sermaye yeterliliğiyle; sanayi şirketleri ise FD/FAVÖK, FAVÖK marjı, Net Borç/FAVÖK ve cari oranla değerlendirilir.",
      en: "For an industrial firm, debt funds factories and inventory; for a bank, deposits and loans are the product itself. Scoring both with identical weights misleads: analyze banks with P/B, ROE and capital adequacy, and industrials with EV/EBITDA, operating margins, Net Debt/EBITDA and current ratio.",
      fr: "Dans l'industrie, la dette finance l'outil de production ; dans une banque, dépôts et crédits sont le métier même. Analysez les banques via C/VC et ROE, et l'industrie via VE/EBITDA, marges et dette nette/EBITDA.",
    },
    points: {
      tr: [
        "Bankalarda brüt kâr marjı, FAVÖK, FD/FAVÖK ve cari oran muhasebe yapısı gereği anlamlı değildir.",
        "Banka analizinde birincil değerleme ikilisi PD/DD ve ROE (Özkaynak Kârlılığı) dengesidir.",
        "Sanayi, enerji, ulaştırma ve perakendede borçluluk farklarını görmek için F/K'nın yanında mutlaka FD/FAVÖK ve Net Borç/FAVÖK incelenir.",
        "Holdingler ve GYO'larda ise net aktif değer (NAD) iskontosu ve PD/DD ön plana çıkar.",
      ],
      en: [
        "Gross margin, EBITDA, EV/EBITDA and current ratio are structurally meaningless for banks.",
        "The core bank valuation pair is P/B relative to sustainable ROE.",
        "For industrials, energy, transport and retail, pair P/E with EV/EBITDA and Net Debt / EBITDA.",
        "Holdings and REITs are commonly evaluated via P/B and discount to net asset value (NAV).",
      ],
      fr: [
        "Marge brute, EBITDA, VE/EBITDA et ratio courant n'ont pas de sens pour une banque.",
        "L'évaluation bancaire repose d'abord sur le couple C/VC et ROE.",
        "Dans l'industrie et les services, associez PER, VE/EBITDA et Dette nette / EBITDA.",
        "Holdings et foncières s'analysent avant tout par le C/VC et la décote sur actif net.",
      ],
    },
    methodology: {
      tr: "Hisse Analizi emsal tabloları her şirketi yalnızca kendi KAP sektörüyle kıyaslar; bir sektörde anlamlı olmayan sütunları (ör. bankalarda FD/FAVÖK) otomatik olarak gizler.",
      en: "Hisse Analizi peer tables compare each stock exclusively within its KAP sector and automatically omit columns that do not apply (such as EV/EBITDA for banks).",
      fr: "Les tableaux de pairs comparent chaque action uniquement à son secteur KAP et masquent automatiquement les colonnes non pertinentes.",
    },
    source: {
      tr: "KAP sektör sınıflandırması (48 KAP sektörü) ve BDDK/TFRS finansal tabloları",
      en: "KAP sector classification (48 sectors) & TFRS/BRSA statements",
      fr: "Classification sectorielle KAP (48 secteurs) et états financiers",
    },
    keywords: ["banka", "sanayi", "banka oranlari", "finans", "holding", "gyo", "bddk", "sektor farki", "emsal"],
    actions: [
      {
        kind: "sector",
        href: "/sektor/bankalar",
        label: { tr: "Bankalar sektör sayfası", en: "Banks sector page", fr: "Page secteur Banques" },
        description: { tr: "Tüm BIST bankaları, PD/DD, F/K ve ROE medyanları.", en: "All BIST banks with P/B, P/E and ROE medians.", fr: "Toutes les banques BIST et leurs médianes." },
      },
      {
        kind: "index",
        href: "/endeks/bist-banka",
        label: { tr: "BIST Banka (XBANK) endeksi", en: "BIST Banks (XBANK) index", fr: "Indice BIST Banques (XBANK)" },
        description: { tr: "XBANK grafiği ve bileşen hisseleri.", en: "XBANK index chart and constituents.", fr: "Graphique et composants de XBANK." },
      },
      {
        kind: "index",
        href: "/endeks/bist-sinai",
        label: { tr: "BIST Sınai (XUSIN) endeksi", en: "BIST Industrials (XUSIN) index", fr: "Indice BIST Industrie (XUSIN)" },
        description: { tr: "Sanayi endeksi bileşenleri, medyan FD/FAVÖK ve kârlılık.", en: "Industrial index constituents and EV/EBITDA medians.", fr: "Composants et médianes de BIST Industrie." },
      },
    ],
    relatedSlugs: ["pddd-orani", "fd-favok", "sektor-medyani"],
  },
  {
    slug: "sma-kesisimleri",
    category: "technical",
    badge: "SMA 50/200",
    title: {
      tr: "SMA 50 / 200 ve Altın / Ölüm Kesişimi",
      en: "SMA 50 / 200 & Golden / Death Cross",
      fr: "MM 50 / 200 et croisements doré / mortel",
    },
    cardDesc: {
      tr: "Orta ve uzun vadeli trend filtresi; 50 günlük ortalamanın 200 günlük ortalamayı kesmesi.",
      en: "Medium- and long-term trend filter tracking how the 50-day average crosses the 200-day.",
      fr: "Filtre de tendance moyen/long terme suivant le croisement des moyennes mobiles 50 et 200 jours.",
    },
    question: {
      tr: "Altın kesişim (Golden Cross) ve ölüm kesişimi (Death Cross) nedir?",
      en: "What are Golden Cross and Death Cross signals?",
      fr: "Que signifient un croisement doré (Golden Cross) et un croisement mortel ?",
    },
    intro: {
      tr: "Basit hareketli ortalamalar (SMA 50 ve SMA 200), günlük fiyat gürültüsünü yumuşatarak ana trend yönünü gösterir. Fiyatın her iki ortalamanın üzerinde olması yükseliş eğilimine işaret eder; SMA 50'nin SMA 200'ü yukarı kesmesi Altın Kesişim (Golden Cross), aşağı kesmesi Ölüm Kesişimi (Death Cross) olarak adlandırılır.",
      en: "Simple Moving Averages (SMA 50 and SMA 200) smooth daily noise to expose the primary trend. Price above both signals an uptrend; SMA 50 crossing above SMA 200 is a Golden Cross, while crossing below is a Death Cross.",
      fr: "Les moyennes mobiles simples (MM 50 et MM 200) lissent le bruit quotidien pour dégager la tendance de fond. Le passage de la MM 50 au-dessus de la MM 200 forme un Golden Cross ; au-dessous, un Death Cross.",
    },
    formula: {
      tr: "SMA(n) = Son n günlük kapanış fiyatlarının aritmetik ortalaması",
      en: "SMA(n) = Arithmetic mean of the last n daily closing prices",
      fr: "MM(n) = Moyenne arithmétique des n derniers cours de clôture journaliers",
    },
    points: {
      tr: [
        "Hareketli ortalamalar gecikmeli (lagging) göstergelerdir; dip veya tepeyi yakalamaktan çok trend teyidi için kullanılır.",
        "Yatay (bant içi) piyasalarda kesişimler sık sık yanlış sinyal (whipsaw) üretebilir.",
        "Hisse Analizi'nde fiyatın SMA 50 ve SMA 200'e yüzde uzaklığı hem teknik taramada hem hisse sayfasında gösterilir.",
      ],
      en: [
        "Moving averages are lagging indicators designed to confirm trends rather than call exact tops or bottoms.",
        "Sideways, range-bound markets frequently produce false whipsaw crosses.",
        "Hisse Analizi tracks percentage distance to both SMA 50 and SMA 200 in the screener and technical cards.",
      ],
      fr: [
        "Les moyennes mobiles sont des indicateurs retardés utiles pour confirmer une tendance plutôt que saisir un retournement exact.",
        "En marché sans tendance, les croisements génèrent souvent de faux signaux.",
        "L'écart en pourcentage aux MM 50 et MM 200 est disponible dans le filtre et l'analyse technique.",
      ],
    },
    methodology: {
      tr: "Tarama ekranındaki 'Altın Kesişim' ve 'Ölüm Kesişimi' filtreleri son günlük barda SMA 50 ve SMA 200'ün yön değiştirdiği hisseleri yakalar; 'Yükseliş trendi' ise fiyatın her iki ortalamanın üzerinde olmasını arar.",
      en: "Screener cross filters detect SMA 50 / SMA 200 crossovers on the latest daily bar, while the Uptrend screen requires price above both averages.",
      fr: "Les filtres de croisement détectent le passage MM 50 / MM 200 sur la dernière séance ; le filtre Tendance haussière exige un cours au-dessus des deux moyennes.",
    },
    source: {
      tr: "BIST günlük kapanış serileri ve TradingView SMA hesaplaması",
      en: "BIST daily closes & TradingView SMA calculation",
      fr: "Clôtures journalières BIST et calcul MM TradingView",
    },
    keywords: ["sma", "ema", "hareketli ortalama", "altin kesisim", "golden cross", "death cross", "trend", "teknik"],
    actions: [
      {
        kind: "screener",
        href: "/tarama?screen=uptrend&view=technical&sort=sma200_dist&dir=desc",
        label: { tr: "Yükseliş trendi taraması (Fiyat > SMA 50 & 200)", en: "Uptrend screen (Price > SMA 50 & 200)", fr: "Filtre tendance haussière (Cours > MM 50 & 200)" },
        description: { tr: "Hem 50 hem 200 günlük ortalamasının üzerindeki hisseler.", en: "Stocks trading above both 50-day and 200-day moving averages.", fr: "Actions au-dessus de leurs MM 50 et MM 200." },
      },
      {
        kind: "screener",
        href: "/tarama?screen=golden_cross&view=technical",
        label: { tr: "Altın kesişim (Golden Cross) taraması", en: "Golden Cross screen", fr: "Filtre Golden Cross" },
        description: { tr: "Son günlük barda SMA 50'nin SMA 200'ü yukarı kestiği hisseler.", en: "Stocks printing a fresh SMA 50 / SMA 200 golden cross.", fr: "Actions affichant un Golden Cross sur la dernière séance." },
      },
    ],
    relatedSlugs: ["rsi", "reel-getiri"],
  },
  {
    slug: "sektor-medyani",
    category: "sector",
    badge: "MEDYAN",
    title: {
      tr: "Sektör Medyanı ve Emsal Karşılaştırması",
      en: "Sector Median & Peer Comparison",
      fr: "Médiane sectorielle et comparaison aux pairs",
    },
    cardDesc: {
      tr: "Aritmetik ortalama yerine neden medyan kullanılır ve KAP sektör eşiği (en az 3 şirket) nasıl işler?",
      en: "Why medians outperform arithmetic averages for multiples and how the 3-company KAP rule works.",
      fr: "Pourquoi la médiane surpasse la moyenne arithmétique pour les multiples financiers.",
    },
    question: {
      tr: "Sektör karşılaştırmasında aritmetik ortalama yerine neden medyan kullanılır?",
      en: "Why use sector medians instead of simple averages when comparing stocks?",
      fr: "Pourquoi privilégier la médiane à la moyenne dans les comparaisons sectorielles ?",
    },
    intro: {
      tr: "Finansal çarpanlarda tek bir şirketin çok düşük kâr nedeniyle 250x F/K'ya çıkması, sektörün aritmetik ortalamasını tamamen bozar. Medyan (ortanca değer), şirketleri küçükten büyüğe sıralayıp ortadaki değeri aldığı için uç değerlere karşı dayanıklıdır ve tipik emsal şirketin seviyesini yansıtır.",
      en: "A single company with tiny earnings and a 250x P/E distorts an arithmetic sector average beyond usefulness. The median — the middle value of the sorted peers — is robust to outliers and represents the typical peer in the sector.",
      fr: "Une seule entreprise affichant un PER de 250x fausse complètement la moyenne arithmétique d'un secteur. La médiane résiste aux valeurs extrêmes et reflète le niveau typique des pairs.",
    },
    points: {
      tr: [
        "Hisse Analizi'nde bir KAP sektöründe en az 3 geçerli şirket yoksa medyan üretilmez (küçük örneklem gürültüsünü önlemek için).",
        "F/K, PD/DD ve FD/FAVÖK medyanlarına yalnızca pozitif değerli şirketler girer; temettü verimi medyanı ise yalnızca temettü ödeyenleri sayar.",
        "ROE, net kâr marjı ve fiyat performans medyanlarına negatif değerler de dahil edilir.",
        "Tarama ekranındaki 'sektör ortalamasının altında/üstünde' filtreleri her zaman tüm BIST evrenindeki sektör medyanını referans alır; başka filtre ekleseniz de kıstas kaymaz.",
      ],
      en: [
        "Hisse Analizi requires at least 3 valid companies in a KAP sector before reporting a median.",
        "P/E, P/B and EV/EBITDA medians count positive multiples only; dividend yield medians count payers only.",
        "ROE, net margin and return medians include negative values so sector health is not overstated.",
        "Relative screener presets always benchmark against the full-universe KAP sector median, even when combined with other filters.",
      ],
      fr: [
        "Hisse Analizi exige au moins 3 sociétés valides dans un secteur KAP avant d'afficher une médiane.",
        "Les médianes de PER, C/VC et VE/EBITDA ne comptent que les valeurs positives ; le rendement ne compte que les payeurs.",
        "Les médianes de ROE, marge nette et performance incluent les valeurs négatives.",
        "Les filtres relatifs comparent toujours à la médiane complète du secteur KAP.",
      ],
    },
    methodology: {
      tr: "Tüm sektör sayfaları, hisse sayfaları ve taramadaki göreli filtreler aynı KAP sektör anahtarlarını ve aynı medyan kurallarını (`MIN_SECTOR_COMPANIES = 3`) paylaşır.",
      en: "Sector discovery pages, stock peer cards and screener relative filters all share the exact same KAP sector keys and `MIN_SECTOR_COMPANIES = 3` median rules.",
      fr: "Les pages secteurs, fiches valeurs et filtres relatifs partagent les mêmes clés KAP et la règle `MIN_SECTOR_COMPANIES = 3`.",
    },
    source: {
      tr: "KAP resmi sektör sınıflandırması ve BIST tarama evreni",
      en: "Official KAP sector registry & BIST screener universe",
      fr: "Référentiel sectoriel officiel KAP et univers BIST",
    },
    keywords: ["medyan", "sektor medyani", "emsal", "karsilastirma", "kap sektor", "peer", "median", "uc deger"],
    actions: [
      {
        kind: "sector",
        href: "/sektor",
        label: { tr: "Tüm KAP sektörlerini keşfet", en: "Browse all KAP sectors", fr: "Explorer tous les secteurs KAP" },
        description: { tr: "48 KAP sektörünün şirket sayısı ve canlı medyan çarpanları.", en: "Company counts and live median multiples across all KAP sectors.", fr: "Nombre de sociétés et médianes de tous les secteurs KAP." },
      },
      {
        kind: "screener",
        href: "/tarama?screen=pe_below_sector&view=fundamentals&sort=pe&dir=asc",
        label: { tr: "Sektör medyanının altında F/K taraması", en: "Screen P/E below sector median", fr: "Filtrer PER sous la médiane sectorielle" },
        description: { tr: "Kendi sektörünün ortanca F/K'sından ucuz işlem gören hisseler.", en: "Stocks trading below their own sector's median P/E.", fr: "Actions sous le PER médian de leur secteur." },
      },
    ],
    relatedSlugs: ["banka-ve-sanayi-oranlari", "fk-orani", "pddd-orani"],
  },
  {
    slug: "net-borc-favok",
    category: "profitability",
    badge: "BORÇ / FAVÖK",
    title: {
      tr: "Net Borç / FAVÖK ve Cari Oran",
      en: "Net Debt / EBITDA & Current Ratio",
      fr: "Dette nette / EBITDA et ratio de liquidité",
    },
    cardDesc: {
      tr: "Şirketin borcunu operasyonel kârıyla kaç yılda ödeyebileceği ve kısa vadeli ödeme gücü.",
      en: "How many years of operating cash earnings it takes to repay net debt, plus short-term liquidity.",
      fr: "Nombre d'années d'EBITDA nécessaires pour rembourser la dette nette, et liquidité à court terme.",
    },
    question: {
      tr: "Net Borç / FAVÖK ve Cari Oran bir şirketin finansal sağlığını nasıl gösterir?",
      en: "How do Net Debt / EBITDA and Current Ratio measure balance-sheet health?",
      fr: "Comment la Dette nette / EBITDA et le ratio courant mesurent-ils la solidité financière ?",
    },
    intro: {
      tr: "Yüksek faiz ortamında bilanço dayanıklılığı en az büyüme kadar kritiktir. Net Borç / FAVÖK, finansal borçlardan nakit ve benzerlerini çıkardıktan sonra kalan net borcun son 12 aylık FAVÖK'e oranını verir; Cari Oran ise dönen varlıkların kısa vadeli yükümlülükleri karşılama gücünü ölçer.",
      en: "In a high-interest-rate environment, balance-sheet resilience matters as much as growth. Net Debt / EBITDA shows how many years of EBITDA equal net financial debt, while Current Ratio measures short-term assets covering short-term liabilities.",
      fr: "En période de taux élevés, la solidité du bilan est décisive. La Dette nette / EBITDA mesure le levier opérationnel, tandis que le ratio courant mesure la couverture des dettes à court terme.",
    },
    formula: {
      tr: "Net Borç / FAVÖK = (Finansal Borçlar − Nakit) / FAVÖK (TTM)   ·   Cari Oran = Dönen Varlıklar / Kısa Vadeli Yükümlülükler",
      en: "Net Debt / EBITDA = (Total Debt − Cash) / EBITDA (TTM)   ·   Current Ratio = Current Assets / Current Liabilities",
      fr: "Dette nette / EBITDA = (Dettes financières − Trésorerie) / EBITDA (TTM)   ·   Ratio courant = Actif circulant / Passif circulant",
    },
    points: {
      tr: [
        "Net Borç / FAVÖK'ün negatif olması şirketin borcundan fazla nakdi (net nakit pozisyonu) olduğunu gösterir.",
        "Sanayi şirketlerinde genellikle 3x üzeri kaldıraç yakından izlenir; ancak uzun vadeli döviz/enerji proje finansmanı olan şirketlerde sektör medyanına bakılmalıdır.",
        "Perakende gibi negatif işletme sermayesiyle (nakit satış + vadeli tedarikçi ödemesi) çalışan sektörlerde Cari Oran 1'in altında olsa bile nakit döngüsü sağlıklı olabilir.",
        "Bankalar ve finans kurumları için bu iki oran kullanılmaz.",
      ],
      en: [
        "A negative Net Debt / EBITDA indicates a net-cash balance sheet (cash exceeds financial debt).",
        "Above 3x warrants closer inspection in industrials, though project-financed utilities often carry higher structural leverage.",
        "Cash-generative retailers with negative working capital can operate comfortably with a Current Ratio below 1.",
        "Neither metric applies to banks or insurance companies.",
      ],
      fr: [
        "Un ratio Dette nette / EBITDA négatif indique une position de trésorerie nette excédentaire.",
        "Au-delà de 3x, le levier mérite attention dans l'industrie, à nuancer selon la médiane sectorielle.",
        "Dans la grande distribution, un ratio courant inférieur à 1 peut rester sain grâce au BFR négatif.",
        "Ces deux ratios ne s'appliquent pas aux banques ni aux assureurs.",
      ],
    },
    methodology: {
      tr: "Temel analiz sayfasındaki Finansal Sağlık kartı ve sektör karşılaştırması, KAP bilanço ve gelir tablosu kalemlerinden hesaplanan son dönem oranlarını gösterir.",
      en: "The Financial Health scorecard and peer comparison on stock pages report latest-period leverage and liquidity metrics derived from KAP statements.",
      fr: "La fiche de santé financière et la comparaison sectorielle présentent ces ratios calculés sur les derniers états KAP.",
    },
    source: {
      tr: "KAP bilanço ve gelir tablosu verileri",
      en: "KAP balance sheet & income statement filings",
      fr: "Bilans et comptes de résultat publiés sur KAP",
    },
    keywords: ["net borc", "net borc favok", "cari oran", "kaldirac", "borcluluk", "likidite", "net debt", "current ratio", "finansal saglik"],
    actions: [
      {
        kind: "chart",
        href: "/temel/THYAO",
        label: { tr: "Finansal sağlık kartı: THYAO", en: "Financial health scorecard: THYAO", fr: "Santé financière : THYAO" },
        description: { tr: "Net Borç/FAVÖK, cari oran ve borç/özkaynak özetini inceleyin.", en: "Inspect Net Debt/EBITDA, current ratio and debt-to-equity.", fr: "Consultez dette nette/EBITDA et ratio courant." },
      },
      {
        kind: "screener",
        href: "/tarama?view=fundamentals",
        label: { tr: "Temel analiz tarama görünümü", en: "Fundamental screener view", fr: "Vue fondamentale du filtre" },
        description: { tr: "Tüm BIST hisselerini değerleme ve kârlılık sütunlarıyla sıralayın.", en: "Sort all BIST listings across valuation and profitability metrics.", fr: "Triez les actions BIST selon valorisation et rentabilité." },
      },
    ],
    relatedSlugs: ["fd-favok", "banka-ve-sanayi-oranlari", "ttm-son-12-ay"],
  },
];

export interface AtlasFaqItem {
  question: LocalizedText;
  answer: LocalizedText;
}

export const ATLAS_FAQS: readonly AtlasFaqItem[] = [
  {
    question: {
      tr: "Kavram atlasındaki oranlar hangi veri kaynaklarına dayanır?",
      en: "Which data sources back the metrics in the concept atlas?",
      fr: "Sur quelles sources de données reposent les indicateurs de l'atlas ?",
    },
    answer: {
      tr: "Finansal tablolar ve sektör sınıflandırmaları KAP'tan, gecikmeli fiyat ve teknik/TTM tarama göstergeleri TradingView ve İş Yatırım'dan, enflasyon ve faiz verileri ise TCMB/TÜİK kaynaklarından derlenir.",
      en: "Financial statements and sector classifications come from KAP, delayed price and technical/TTM metrics from TradingView and İş Yatırım, and inflation/policy rates from CBRT and TurkStat.",
      fr: "Les états financiers et secteurs proviennent du KAP, les cours différés et indicateurs TTM/techniques de TradingView et İş Yatırım, et les données macro de la BCRT et TurkStat.",
    },
  },
  {
    question: {
      tr: "Zarar eden şirketlerin F/K oranı neden boş görünür?",
      en: "Why is the P/E ratio blank for loss-making companies?",
      fr: "Pourquoi le PER est-il vide pour les sociétés en perte ?",
    },
    answer: {
      tr: "Negatif kârla bölünen fiyat anlamlı bir geri ödeme süresi vermez ve sıralamaları bozar. Bu yüzden son 12 ayı zararla kapatan hisseler 'Zararda' olarak işaretlenir ve düşük F/K taramaları ile sektör medyanına dahil edilmez.",
      en: "Dividing price by negative earnings does not produce a meaningful payback multiple and distorts sorting. Loss-making companies over the trailing 12 months are marked accordingly and excluded from low-P/E screens and sector medians.",
      fr: "Diviser un cours par une perte ne produit pas un multiple exploitable et fausse les classements. Les sociétés déficitaires sur 12 mois sont exclues des filtres de PER faible et des médianes sectorielles.",
    },
  },
  {
    question: {
      tr: "Atlas kavramlarından doğrudan ilgili grafik veya taramaya geçilebilir mi?",
      en: "Can I jump straight from a concept page to a live chart or screener?",
      fr: "Puis-je accéder directement à un graphique ou filtre depuis une fiche concept ?",
    },
    answer: {
      tr: "Evet. Her kavram sayfasında o kavramla ilişkili hazır Hisse Tarama filtreleri, örnek temel/teknik grafik ekranları ve ilgili endeks veya sektör sayfalarına doğrudan bağlantılar bulunur.",
      en: "Yes. Every concept page links directly to matching Stock Screener presets, live fundamental/technical charts, and relevant index or sector discovery pages.",
      fr: "Oui. Chaque fiche concept renvoie directement vers les filtres prédéfinis, graphiques techniques/fondamentaux et pages indices ou secteurs correspondantes.",
    },
  },
];

const CONCEPT_BY_SLUG: ReadonlyMap<string, AtlasConcept> = new Map(
  ATLAS_CONCEPTS.map((concept) => [concept.slug, concept]),
);

export function atlasHref(slug?: string): string {
  return slug ? `/atlas/${slug}` : "/atlas";
}

export function getAtlasConcept(slug: string): AtlasConcept | null {
  const key = slug.trim().toLowerCase();
  return CONCEPT_BY_SLUG.get(key) ?? null;
}

export function getRelatedConcepts(concept: AtlasConcept): AtlasConcept[] {
  return concept.relatedSlugs
    .map((slug) => CONCEPT_BY_SLUG.get(slug))
    .filter((item): item is AtlasConcept => item !== undefined);
}

/**
 * Matches Atlas concepts against a user search query (Turkish-folded).
 * Used both inside /atlas and in the site-wide header search bar.
 */
export function searchAtlasConcepts(
  query: string,
  locale: Locale,
  limit = 4,
): AtlasConcept[] {
  const needle = foldTr(query);
  if (!needle) return [];
  const tokens = needle.split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: Array<{ concept: AtlasConcept; score: number }> = [];
  for (const concept of ATLAS_CONCEPTS) {
    const badge = foldTr(concept.badge);
    const title = foldTr(concept.title[locale]);
    const titleTr = foldTr(concept.title.tr);
    const desc = foldTr(concept.cardDesc[locale]);
    const keywords = concept.keywords.map(foldTr);
    const haystack = `${badge} ${title} ${titleTr} ${desc} ${keywords.join(" ")}`;

    if (!tokens.every((token) => haystack.includes(token))) continue;

    let score = 4;
    if (badge === needle || keywords.some((kw) => kw === needle)) score = 0;
    else if (badge.startsWith(needle) || title.startsWith(needle) || titleTr.startsWith(needle)) score = 1;
    else if (keywords.some((kw) => kw.startsWith(needle))) score = 2;
    else if (tokens.every((token) => title.includes(token) || keywords.some((kw) => kw.includes(token)))) score = 3;

    scored.push({ concept, score });
  }

  scored.sort((a, b) => a.score - b.score || a.concept.title[locale].localeCompare(b.concept.title[locale], locale));
  return scored.slice(0, limit).map((item) => item.concept);
}
