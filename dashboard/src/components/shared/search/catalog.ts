import { getAtlasConcept, atlasHref } from "../../../lib/atlas.ts";
import type { Locale } from "@/lib/i18n";
import { marketHref } from "../../makro/links.ts";
import { presetHref, type PresetId } from "../../tarama/model.ts";
import { foldTr } from "./fold.ts";
import { searchTickers, type TickerEntry, type TickerOption } from "./ticker-index.ts";

const DEFAULT_TICKER = "THYAO";
const TICKER_SECTIONS: ReadonlySet<string> = new Set(["hisse", "teknik", "temel", "analiz"]);

function resolveTickerHref(pathname: string, ticker: string): string {
  const section = pathname.split("/")[1] ?? "";
  const target = TICKER_SECTIONS.has(section) ? section : "hisse";
  return `/${target}/${encodeURIComponent(ticker.trim().toUpperCase())}`;
}

export type LocalizedText = Readonly<Record<Locale, string>>;

export type SearchResultKind = "stock" | "tool" | "screen" | "concept";

/**
 * Shared cross-platform navigation contract (Web + future iOS).
 * Each search hit resolves to a canonical route/params target plus a web `href`.
 */
export interface SearchTarget {
  readonly route: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly hash?: string;
  readonly href: string;
}

export interface UnifiedSearchItem {
  readonly id: string;
  readonly kind: SearchResultKind;
  readonly code: string;
  readonly title: string;
  readonly subtitle: string;
  readonly ticker?: string;
  readonly href: string;
  readonly target: SearchTarget;
}

export type GuideCategory = "valuation" | "technical" | "macro" | "usage";

export interface GuideEntry {
  readonly id: string;
  readonly code: string;
  readonly category: GuideCategory;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly explanation: LocalizedText;
  readonly formula?: LocalizedText;
  readonly methodology: LocalizedText;
  readonly aliases: readonly string[];
  readonly actionLabel: LocalizedText;
  readonly actionHref: (ticker: string) => string;
}

export const ATLAS_GUIDE_SLUGS: Readonly<Record<string, string>> = {
  fk: "fk-orani", pddd: "pddd-orani", "fd-favok": "fd-favok", ttm: "ttm-son-12-ay",
  roe: "roe-ozkaynak-karliligi", temettu: "temettu-verimi", rsi: "rsi", "reel-getiri": "reel-getiri",
};

// Legacy guide IDs remain valid; the Atlas owns their prose, formulas and search metadata.
const atlasGuides: GuideEntry[] = Object.entries(ATLAS_GUIDE_SLUGS).map(([id, slug]) => {
  const concept = getAtlasConcept(slug);
  if (!concept) throw new Error(`Guide references unknown Atlas concept: ${slug}`);
  const action = concept.actions[0];
  return {
    id, code: concept.badge,
    category: concept.category === "profitability" || concept.category === "sector" ? "valuation" : concept.category,
    title: concept.title, summary: concept.cardDesc, explanation: concept.intro,
    formula: concept.formula, methodology: concept.methodology,
    aliases: [...concept.keywords, `${concept.badge} aciklamasi`, "rehber"],
    actionLabel: action.label, actionHref: () => action.href,
  };
});

export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  ...atlasGuides,
  {
    id: "enflasyon",
    code: "TÜFE",
    category: "macro",
    title: { tr: "Enflasyon (TÜFE)", en: "Inflation (CPI)", fr: "Inflation (IPC)" },
    summary: {
      tr: "Aylık ve yıllık tüketici fiyat endeksi değişimleri.",
      en: "Monthly and annual Consumer Price Index changes.",
      fr: "Variations mensuelles et annuelles de l'indice des prix à la consommation.",
    },
    explanation: {
      tr: "Makro Ekonomi sayfasındaki Enflasyon bölümünde yıllık ve aylık TÜFE trendi, politika faiziyle karşılaştırmalı olarak izlenir.",
      en: "Track annual and monthly CPI trends alongside the CBRT policy rate in the Macroeconomy inflation section.",
      fr: "Suivez les tendances annuelles et mensuelles de l'IPC face au taux directeur dans la page Macro-économie.",
    },
    methodology: {
      tr: "Kaynak: TÜİK ve TCMB EVDS tüketici fiyat endeksi serileri.",
      en: "Source: TurkStat and CBRT EVDS consumer price series.",
      fr: "Source : séries IPC TÜİK et BCRT EVDS.",
    },
    aliases: ["enflasyon", "tufe", "cpi", "inflation", "ipc", "fiyat endeksi", "tuik"],
    actionLabel: { tr: "Enflasyon verilerini gör", en: "View inflation data", fr: "Voir les données d'inflation" },
    actionHref: () => "/makro#enflasyon",
  },
  {
    id: "politika-faizi",
    code: "PPK",
    category: "macro",
    title: { tr: "Politika Faizi (TCMB Haftalık Repo)", en: "Policy Rate (CBRT Weekly Repo)", fr: "Taux directeur (Repo 1 semaine BCRT)" },
    summary: {
      tr: "TCMB Para Politikası Kurulu (PPK) 1 hafta vadeli repo ihale faiz oranı.",
      en: "CBRT Monetary Policy Committee one-week repo auction rate.",
      fr: "Taux de prise en pension à une semaine du comité de politique monétaire de la BCRT.",
    },
    explanation: {
      tr: "Piyasadaki borçlanma maliyetlerinin, mevduat getirisinin ve şirket iskonto oranlarının ana referansıdır. Faiz koridoru ve son PPK karar takvimi Makro sayfasında yer alır.",
      en: "Primary benchmark for funding costs, deposit yields and equity discount rates. See the rate corridor and MPC schedule on the Macro page.",
      fr: "Référence principale pour le coût de financement et les taux d'actualisation ; corridor et calendrier disponibles sur la page Macro.",
    },
    methodology: {
      tr: "Kaynak: TCMB Para Politikası Kurulu duyuruları ve faiz koridoru verileri.",
      en: "Source: CBRT Monetary Policy Committee decisions and rate corridor data.",
      fr: "Source : décisions du comité de politique monétaire de la BCRT.",
    },
    aliases: ["politika faizi", "faiz", "ppk", "tcmb", "repo", "haftalik repo", "policy rate", "cbrt", "para politikasi", "koridor"],
    actionLabel: { tr: "Para politikası bölümünü aç", en: "Open monetary policy", fr: "Ouvrir politique monétaire" },
    actionHref: () => "/makro#para-politikasi",
  },
  {
    id: "kap",
    code: "KAP",
    category: "usage",
    title: { tr: "KAP Bildirimleri ve Önem Seviyesi", en: "KAP Disclosures & Severity", fr: "Publications KAP et gravité" },
    summary: {
      tr: "Kamuyu Aydınlatma Platformu bildirimlerinin kategori ve önem derecesi kuralları.",
      en: "Category and severity classification rules for Public Disclosure Platform filings.",
      fr: "Règles de catégorisation et de gravité des publications KAP.",
    },
    explanation: {
      tr: "Temettü, sermaye artırımı, finansal sonuçlar ve pay geri alımı gibi kritik bildirimler Yüksek önemle işaretlenir. KAP sayfasında hisse, kategori, tarih ve serbest metinle filtreleme yapılabilir.",
      en: "Dividends, capital increases, financial results and buybacks are highlighted as High severity. Filter by ticker, category, date and text on the KAP feed.",
      fr: "Dividendes, augmentations de capital, résultats et rachats sont classés gravité Élevée sur le flux KAP.",
    },
    methodology: {
      tr: "Kaynak: Kamuyu Aydınlatma Platformu (KAP) bildirim akışı.",
      en: "Source: Public Disclosure Platform (KAP) disclosure feed.",
      fr: "Source : flux officiel de la plateforme KAP.",
    },
    aliases: ["kap", "bildirim", "haber", "duyuru", "disclosure", "onem seviyesi", "temettu bildirimi"],
    actionLabel: { tr: "KAP akışını aç", en: "Open KAP feed", fr: "Ouvrir le flux KAP" },
    actionHref: () => "/events",
  },
  {
    id: "seans",
    code: "BIST",
    category: "usage",
    title: { tr: "Seans Saatleri ve Veri Gecikmesi", en: "Session Hours & Data Delay", fr: "Horaires de séance et délai" },
    summary: {
      tr: "BIST pay piyasası hafta içi 10:00–18:00 (İstanbul) açıktır; ücretsiz fiyatlar ~15 dk gecikmelidir.",
      en: "BIST equity trading runs 10:00–18:00 Istanbul time on weekdays; free quotes are ~15 min delayed.",
      fr: "La séance BIST est ouverte de 10h00 à 18h00 (Istanbul) en semaine ; les cours gratuits sont différés d'environ 15 min.",
    },
    explanation: {
      tr: "Sağlayıcıya geçici olarak ulaşılamadığında sistem son kayıtlı geçerli veriyi tarih ve gecikme uyarısıyla birlikte sunar; hiçbir veri sessizce gizlenmez.",
      en: "When an upstream provider is temporarily unreachable, the dashboard shows the last saved valid snapshot with an explicit timestamp and stale notice.",
      fr: "En cas d'indisponibilité temporaire du fournisseur, la dernière copie valide est affichée avec sa date et un avertissement.",
    },
    methodology: {
      tr: "Kaynak: Borsa İstanbul seans takvimi ve veri tazelik katmanı.",
      en: "Source: Borsa Istanbul trading schedule and data freshness metadata.",
      fr: "Source : calendrier Borsa Istanbul et métadonnées de fraîcheur.",
    },
    aliases: ["seans", "saat", "gecikme", "piyasa acik", "piyasa kapali", "eski fiyat", "stale", "session", "delay"],
    actionLabel: { tr: "Piyasa özetine dön", en: "Go to market overview", fr: "Retour au marché" },
    actionHref: () => "/",
  },
  {
    id: "kisayollar",
    code: "⌘K",
    category: "usage",
    title: { tr: "Arama, Klavye Kısayolları ve Sayfa Düzeni", en: "Search, Shortcuts & Workspace Layout", fr: "Recherche, raccourcis et disposition" },
    summary: {
      tr: "⌘K / Ctrl+K veya / ile her yerden arama açın; Özelleştir ile kartları sürükleyip boyutlandırın.",
      en: "Open search anywhere with ⌘K / Ctrl+K or /; use Customize to drag and resize page cards.",
      fr: "Ouvrez la recherche partout avec ⌘K / Ctrl+K ou / ; utilisez Personnaliser pour réorganiser les cartes.",
    },
    explanation: {
      tr: "Tek arama kutusu hisseleri, hazır taramaları, makro bölümleri, teknik göstergeleri ve kavram rehberini birlikte bulur. Geniş ekranda «Özelleştir» düğmesiyle kart düzeninizi kaydedebilirsiniz.",
      en: "One search bar finds stocks, screener presets, macro sections, indicators and concept guides. On desktop, click «Customize» to arrange and save card layouts.",
      fr: "Une seule barre de recherche trouve actions, filtres, sections macro, indicateurs et guides. Sur grand écran, « Personnaliser » permet d'enregistrer votre disposition.",
    },
    methodology: {
      tr: "Kişisel takip listeleri ve kart düzenleri tarayıcınızda saklanır; geri alma çakışma kontrollüdür.",
      en: "Personal watchlists and layouts persist in your browser with conflict-checked undo.",
      fr: "Listes de suivi et dispositions sont stockées localement avec annulation contrôlée.",
    },
    aliases: ["kisayol", "klavye", "ozellestir", "yeni sayfa", "pano", "duzen", "layout", "yardim", "help", "nasil", "shortcut"],
    actionLabel: { tr: "Piyasa özetini aç", en: "Open market overview", fr: "Ouvrir l'aperçu du marché" },
    actionHref: () => "/",
  },
];

export const GUIDE_BY_ID: ReadonlyMap<string, GuideEntry> = new Map(GUIDE_ENTRIES.map((entry) => [entry.id, entry]));

interface ToolSpec {
  readonly id: string;
  readonly kind: "tool" | "screen";
  readonly code: string;
  readonly title: LocalizedText;
  readonly subtitle: LocalizedText;
  readonly aliases: readonly string[];
  readonly quickDefault?: boolean;
  readonly buildTarget: (ticker: string) => SearchTarget;
}

function makeTarget(route: string, options?: { params?: Record<string, string>; hash?: string; href?: string }): SearchTarget {
  const qs = options?.params ? new URLSearchParams(options.params).toString() : "";
  const hash = options?.hash ? `#${options.hash}` : "";
  const href = options?.href ?? `${route}${qs ? `?${qs}` : ""}${hash}`;
  return { route, params: options?.params, hash: options?.hash, href };
}

function screenTool(
  presetId: PresetId,
  code: string,
  title: LocalizedText,
  subtitle: LocalizedText,
  aliases: readonly string[],
  quickDefault = false,
): ToolSpec {
  return {
    id: `screen:${presetId}`,
    kind: "screen",
    code,
    title,
    subtitle,
    aliases,
    quickDefault,
    buildTarget: () => {
      const href = presetHref(presetId);
      const queryPart = href.split("?")[1] ?? "";
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(queryPart)) params[k] = v;
      return makeTarget("/tarama", { params, href });
    },
  };
}

const TOOL_SPECS: readonly ToolSpec[] = [
  // Primary pages & workspace
  {
    id: "tool:markets",
    kind: "tool",
    code: "BIST",
    title: { tr: "Piyasa Özeti", en: "Market Overview", fr: "Aperçu du marché" },
    subtitle: { tr: "BIST 100, takip listesi, yükselenler ve son gelişmeler", en: "BIST 100, watchlist, movers and latest events", fr: "BIST 100, liste de suivi, variations et actualités" },
    aliases: ["piyasa", "ozet", "ana sayfa", "bist 100", "xu100", "dashboard", "takip listesi", "yeni sayfa", "ozellestir"],
    buildTarget: () => makeTarget("/"),
  },
  {
    id: "tool:screener",
    kind: "tool",
    code: "TARA",
    title: { tr: "Hisse Tarama", en: "Stock Screener", fr: "Filtrage d'actions" },
    subtitle: { tr: "F/K, PD/DD, temettü, RSI ve sektör kriterleriyle BIST taraması", en: "Screen BIST stocks by P/E, P/B, dividends, RSI and sector", fr: "Filtrez le BIST par PER, dividendes, RSI et secteur" },
    aliases: ["tarama", "hisse tarama", "filtre", "screener", "kriter", "sektor tarama"],
    buildTarget: () => makeTarget("/tarama"),
  },
  {
    id: "tool:events",
    kind: "tool",
    code: "KAP",
    title: { tr: "KAP Haberleri ve Bildirimler", en: "KAP News & Disclosures", fr: "Actualités et avis KAP" },
    subtitle: { tr: "Tüm KAP bildirimleri, kategori ve önem filtreleri", en: "All KAP disclosures with category and severity filters", fr: "Toutes les déclarations KAP par catégorie et gravité" },
    aliases: ["kap", "haberler", "bildirimler", "events", "disclosures", "duyuru"],
    buildTarget: () => makeTarget("/events"),
  },
  {
    id: "tool:macro",
    kind: "tool",
    code: "MAKRO",
    title: { tr: "Makro Ekonomi", en: "Macroeconomy", fr: "Macro-économie" },
    subtitle: { tr: "TCMB faiz, enflasyon, döviz, tahvil ve ekonomik takvim", en: "CBRT rate, inflation, FX, bonds and economic calendar", fr: "Taux BCRT, inflation, devises, obligations et calendrier" },
    aliases: ["makro", "ekonomi", "macro", "tcmb", "ekonomik veriler"],
    buildTarget: () => makeTarget("/makro"),
  },
  {
    id: "tool:guide",
    kind: "tool",
    code: "REHBER",
    title: { tr: "Kavram Rehberi ve Yardım", en: "Concept Guide & Help", fr: "Guide des notions et aide" },
    subtitle: { tr: "F/K, TTM, RSI, reel getiri, seans saatleri ve kısayollar", en: "P/E, TTM, RSI, real return, session hours and shortcuts", fr: "PER, TTM, RSI, rendement réel, horaires et raccourcis" },
    aliases: ["rehber", "yardim", "kilavuz", "sozluk", "kavram", "help", "guide", "glossary", "faq", "sss"],
    quickDefault: true,
    buildTarget: () => makeTarget("/rehber"),
  },

  // Macro deep-links
  {
    id: "tool:macro-inflation",
    kind: "tool",
    code: "TÜFE",
    title: { tr: "Enflasyon (TÜFE)", en: "Inflation (CPI)", fr: "Inflation (IPC)" },
    subtitle: { tr: "Yıllık ve aylık TÜFE trendi · Makro Ekonomi", en: "Annual and monthly CPI trend · Macroeconomy", fr: "Tendance annuelle et mensuelle de l'IPC · Macro" },
    aliases: ["enflasyon", "tufe", "cpi", "inflation", "ipc", "aylik enflasyon", "yillik enflasyon", "reel getiri"],
    quickDefault: true,
    buildTarget: () => makeTarget("/makro", { hash: "enflasyon" }),
  },
  {
    id: "tool:macro-policy-rate",
    kind: "tool",
    code: "PPK",
    title: { tr: "Politika Faizi (TCMB)", en: "Policy Rate (CBRT)", fr: "Taux directeur (BCRT)" },
    subtitle: { tr: "Haftalık repo, faiz koridoru ve PPK kararları · Makro Ekonomi", en: "Weekly repo, rate corridor and MPC decisions · Macroeconomy", fr: "Repo hebdomadaire, corridor et décisions · Macro" },
    aliases: ["politika faizi", "faiz", "tcmb", "ppk", "haftalik repo", "para politikasi", "policy rate", "cbrt", "faiz koridoru"],
    quickDefault: true,
    buildTarget: () => makeTarget("/makro", { hash: "para-politikasi" }),
  },
  {
    id: "tool:macro-calendar",
    kind: "tool",
    code: "TAKVİM",
    title: { tr: "Ekonomik Takvim", en: "Economic Calendar", fr: "Calendrier économique" },
    subtitle: { tr: "Yaklaşan TR ve ABD veri açıklamaları, PPK ve Fed tarihleri", en: "Upcoming TR & US data releases, CBRT and Fed dates", fr: "Publications économiques TR/US, BCRT et Fed" },
    aliases: ["ekonomik takvim", "takvim", "calendar", "ppk tarihi", "fed", "veri takvimi"],
    buildTarget: () => makeTarget("/makro", { hash: "takvim" }),
  },
  {
    id: "tool:macro-usdtry",
    kind: "tool",
    code: "USD",
    title: { tr: "USD/TRY Kuru", en: "USD/TRY Exchange Rate", fr: "Taux USD/TRY" },
    subtitle: { tr: "Dolar/TL grafiği ve TCMB döviz bülteni · Makro Ekonomi", en: "USD/TRY chart and CBRT FX bulletin · Macroeconomy", fr: "Graphique USD/TRY et bulletin BCRT · Macro" },
    aliases: ["dolar", "usd", "usdtry", "doviz", "kur", "fx", "exchange rate"],
    buildTarget: () => makeTarget("/makro", { params: { piyasa: "usdtry" }, href: marketHref("usdtry") }),
  },
  {
    id: "tool:macro-gold",
    kind: "tool",
    code: "ALTIN",
    title: { tr: "Gram Altın ve Emtia", en: "Gold & Commodities", fr: "Or et matières premières" },
    subtitle: { tr: "Gram altın, ons altın ve Brent petrol · Makro Ekonomi", en: "Gram gold, ounce gold and Brent crude · Macroeconomy", fr: "Or/g, or/once et pétrole Brent · Macro" },
    aliases: ["altin", "gram altin", "ons altin", "gold", "xau", "emtia", "brent", "petrol"],
    buildTarget: () => makeTarget("/makro", { params: { piyasa: "gram_altin" }, href: marketHref("gram_altin") }),
  },

  // Technical indicator shortcuts (open current/default ticker's technical analysis)
  {
    id: "tool:indicator-rsi",
    kind: "tool",
    code: "RSI",
    title: { tr: "RSI ve Teknik Göstergeler", en: "RSI & Technical Indicators", fr: "RSI et indicateurs techniques" },
    subtitle: { tr: "RSI (14), osilatörler ve çoklu zaman dilimi sinyalleri", en: "RSI (14), oscillators and multi-timeframe signals", fr: "RSI (14), oscillateurs et signaux multi-horizons" },
    aliases: ["rsi", "gosterge", "indikator", "teknik analiz", "osilator", "momentum", "technical"],
    buildTarget: (ticker) => makeTarget(`/teknik/${encodeURIComponent(ticker)}`),
  },
  {
    id: "tool:indicator-macd",
    kind: "tool",
    code: "MACD",
    title: { tr: "MACD ve Hareketli Ortalamalar", en: "MACD & Moving Averages", fr: "MACD et moyennes mobiles" },
    subtitle: { tr: "MACD, SMA/EMA, Bollinger ve pivot seviyeleri", en: "MACD, SMA/EMA, Bollinger bands and pivot levels", fr: "MACD, MM, bandes de Bollinger et pivots" },
    aliases: ["macd", "bollinger", "sma", "ema", "supertrend", "stokastik", "stochastic", "pivot", "hareketli ortalama", "vwap", "atr"],
    buildTarget: (ticker) => makeTarget(`/teknik/${encodeURIComponent(ticker)}`),
  },
  {
    id: "tool:fundamentals",
    kind: "tool",
    code: "TEMEL",
    title: { tr: "Temel Analiz ve Bilanço", en: "Fundamental Analysis & Financials", fr: "Analyse fondamentale et bilans" },
    subtitle: { tr: "Bilanço, gelir tablosu, nakit akışı, oranlar ve sektör karşılaştırması", en: "Balance sheet, income statement, cash flow, ratios and peers", fr: "Bilan, compte de résultat, flux, ratios et secteur" },
    aliases: ["temel analiz", "bilanco", "gelir tablosu", "nakit akisi", "oranlar", "sektor karsilastirma", "fundamentals", "balance sheet"],
    buildTarget: (ticker) => makeTarget(`/temel/${encodeURIComponent(ticker)}`),
  },

  // Screener presets (ready-made screens)
  screenTool(
    "high_dividend",
    "TARAMA",
    { tr: "Temettü Taraması", en: "Dividend Screen", fr: "Filtre dividendes" },
    { tr: "Temettü verimi %4 ve üzeri BIST hisseleri", en: "BIST stocks with dividend yield ≥ 4%", fr: "Actions BIST avec rendement du dividende ≥ 4 %" },
    ["temettu taramasi", "temettu", "yuksek temettu", "dividend", "dividend screen", "kar payi"],
    true,
  ),
  screenTool(
    "low_pe",
    "TARAMA",
    { tr: "Düşük F/K Taraması", en: "Low P/E Screen", fr: "Filtre PER faible" },
    { tr: "F/K ≤ 10 olan kârlı şirketler", en: "Profitable stocks with P/E ≤ 10", fr: "Sociétés rentables avec PER ≤ 10" },
    ["dusuk fk", "dusuk f/k", "fk taramasi", "ucuz hisseler", "low pe", "value screen"],
  ),
  screenTool(
    "pe_below_sector",
    "TARAMA",
    { tr: "Sektörüne Göre Ucuz (F/K)", en: "Cheaper Than Sector (P/E)", fr: "PER sous la médiane sectorielle" },
    { tr: "F/K oranı kendi KAP sektör medyanının altında olan hisseler", en: "Stocks trading below their KAP sector median P/E", fr: "Actions sous le PER médian de leur secteur KAP" },
    ["sektor medyani", "sektore gore ucuz", "sektor fk", "relative pe", "peer valuation"],
  ),
  screenTool(
    "rsi_oversold",
    "TARAMA",
    { tr: "RSI Aşırı Satım Taraması", en: "RSI Oversold Screen", fr: "Filtre RSI survente" },
    { tr: "RSI (14) ≤ 30 bölgesindeki hisseler", en: "Stocks with RSI (14) ≤ 30", fr: "Actions avec RSI (14) ≤ 30" },
    ["rsi", "rsi asiri satim", "asiri satim", "rsi taramasi", "oversold", "rsi 30"],
  ),
  screenTool(
    "rsi_overbought",
    "TARAMA",
    { tr: "RSI Aşırı Alım Taraması", en: "RSI Overbought Screen", fr: "Filtre RSI surachat" },
    { tr: "RSI (14) ≥ 70 bölgesindeki hisseler", en: "Stocks with RSI (14) ≥ 70", fr: "Actions avec RSI (14) ≥ 70" },
    ["rsi", "rsi asiri alim", "asiri alim", "overbought", "rsi 70"],
  ),
  screenTool(
    "golden_cross",
    "TARAMA",
    { tr: "Golden Cross Taraması", en: "Golden Cross Screen", fr: "Filtre Golden Cross" },
    { tr: "SMA 50'nin SMA 200'ü yukarı kestiği hisseler", en: "Stocks where SMA 50 crossed above SMA 200", fr: "Actions où la MM 50 croise la MM 200 à la hausse" },
    ["golden cross", "altin kesisim", "sma 50", "sma 200", "kesisim"],
  ),
  screenTool(
    "high_roe",
    "TARAMA",
    { tr: "Yüksek Özkaynak Kârlılığı (ROE)", en: "High Return on Equity (ROE)", fr: "ROE élevé" },
    { tr: "ROE ≥ %25 olan hisseler", en: "Stocks with ROE ≥ 25%", fr: "Actions avec ROE ≥ 25 %" },
    ["yuksek roe", "roe taramasi", "ozkaynak karliligi", "high roe", "karli hisseler"],
  ),
  screenTool(
    "buy_rec",
    "TARAMA",
    { tr: "Analist AL Önerisi Olanlar", en: "Analyst Buy Consensus", fr: "Consensus d'achat analystes" },
    { tr: "Analist tavsiyesi AL olan ve hedef potansiyeli yüksek hisseler", en: "Stocks with analyst Buy rating sorted by upside", fr: "Actions recommandées à l'achat triées par potentiel" },
    ["analist", "hedef fiyat", "al onerisi", "buy recommendation", "upside", "potansiyel"],
  ),
];

function wordStarts(text: string, token: string): boolean {
  return text.startsWith(token) || text.includes(` ${token}`) || text.includes(`(${token}`) || text.includes(`/${token}`);
}

/**
 * Matches tools, screens and guide entries using the same Turkish-insensitive
 * folding as stock search. Exact title/code/alias matches outrank loose matches,
 * while exact ticker matches always rank first in `searchUnified`.
 */
function scoreCatalogItem(
  needle: string,
  tokens: readonly string[],
  code: string,
  title: string,
  subtitle: string,
  aliases: readonly string[],
): number | null {
  const fCode = foldTr(code);
  const fTitle = foldTr(title);
  const fSub = foldTr(subtitle);
  const fAliases = aliases.map(foldTr);
  const haystack = `${fCode} ${fTitle} ${fAliases.join(" ")} ${fSub}`;

  // Single-character queries are too noisy for non-stock catalog matches.
  if (needle.replace(/\s/g, "").length < 2) return null;
  if (!tokens.every((token) => haystack.includes(token))) return null;

  if (fCode === needle || fTitle === needle || fAliases.some((alias) => alias === needle)) return 1.5;
  if (fTitle.startsWith(needle) || fAliases.some((alias) => alias.startsWith(needle))) return 2.5;
  if (tokens.every((token) => wordStarts(fTitle, token) || fAliases.some((alias) => wordStarts(alias, token)))) return 3.2;
  return 4.2;
}

export function stockToUnifiedItem(option: TickerOption, pathname: string): UnifiedSearchItem {
  const href = resolveTickerHref(pathname, option.ticker);
  const section = href.split("/")[1] ?? "hisse";
  return {
    id: `stock:${option.ticker}`,
    kind: "stock",
    code: option.ticker,
    title: option.ticker,
    subtitle: option.name,
    ticker: option.ticker,
    href,
    target: makeTarget(`/${section}/[ticker]`, { params: { ticker: option.ticker }, href }),
  };
}

export function getQuickAccessItems(locale: Locale, activeTicker = DEFAULT_TICKER): UnifiedSearchItem[] {
  const ticker = activeTicker || DEFAULT_TICKER;
  return TOOL_SPECS.filter((spec) => spec.quickDefault).map((spec) => {
    const target = spec.buildTarget(ticker);
    return {
      id: spec.id,
      kind: spec.kind,
      code: spec.code,
      title: spec.title[locale],
      subtitle: spec.subtitle[locale],
      href: target.href,
      target,
    };
  });
}

export interface UnifiedSearchInput {
  query: string;
  locale: Locale;
  stocks: readonly TickerEntry[];
  pathname?: string;
  activeTicker?: string;
  limit?: number;
}

/**
 * Unified local search across BIST stocks, analytical tools, ready-made screens
 * and concept/help guides.
 *
 * Ranking priority:
 *  0.0  Exact ASCII ticker match ("THYAO", "SISE") — always first
 *  1.0  Ticker prefix match ("THY" → THYAO)
 *  1.5  Exact tool/screen/concept code, title or alias ("RSI", "enflasyon", "temettü taraması", "F/K")
 *  2.0  Company name prefix match
 *  2.5  Tool/screen/concept prefix match
 *  3.0  Company word-start match
 *  3.2  Tool/screen/concept word-start match
 *  4.0  Company substring match
 *  4.2  Tool/screen/concept substring match
 */
export function searchUnified({
  query,
  locale,
  stocks,
  pathname = "/",
  activeTicker = DEFAULT_TICKER,
  limit = 10,
}: UnifiedSearchInput): UnifiedSearchItem[] {
  const needle = foldTr(query);
  if (!needle) return [];
  const tokens = needle.split(" ").filter(Boolean);
  const compact = needle.replace(/\s/g, "");
  const tickerLike = !/[^\x00-\x7F]/.test(query);
  const ticker = activeTicker || DEFAULT_TICKER;

  const ranked: Array<{ item: UnifiedSearchItem; score: number; cap: number; order: number }> = [];
  let order = 0;

  // 1. Stocks — use exact same matching rules as searchTickers, preserving score tiers.
  const stockHits = searchTickers(stocks, query, limit);
  const entryByTicker = new Map(stocks.map((entry) => [entry.ticker, entry]));
  for (const hit of stockHits) {
    const entry = entryByTicker.get(hit.ticker);
    let score = 4;
    if (entry) {
      if (tickerLike && entry.t === compact) score = 0;
      else if (tickerLike && entry.t.startsWith(compact)) score = 1;
      else if (entry.n.startsWith(needle)) score = 2;
      else if (tokens.every((token) => entry.t.startsWith(token) || wordStarts(entry.n, token))) score = 3;
      else score = 4;
    }
    ranked.push({
      item: stockToUnifiedItem(hit, pathname),
      score,
      cap: entry?.cap ?? 0,
      order: order++,
    });
  }

  // 2. Tools & ready-made screens
  for (const spec of TOOL_SPECS) {
    const title = spec.title[locale];
    const subtitle = spec.subtitle[locale];
    const score = scoreCatalogItem(needle, tokens, spec.code, title, subtitle, [
      ...spec.aliases,
      spec.title.tr,
      spec.title.en,
    ]);
    if (score === null) continue;
    const target = spec.buildTarget(ticker);
    ranked.push({
      item: {
        id: spec.id,
        kind: spec.kind,
        code: spec.code,
        title,
        subtitle,
        href: target.href,
        target,
      },
      score,
      cap: 0,
      order: order++,
    });
  }

  // 3. Concepts & Help guides
  for (const entry of GUIDE_ENTRIES) {
    const title = entry.title[locale];
    const subtitle = entry.summary[locale];
    const score = scoreCatalogItem(needle, tokens, entry.code, title, subtitle, [
      ...entry.aliases,
      entry.title.tr,
      entry.title.en,
    ]);
    if (score === null) continue;
    // Slight tie-breaker (+0.15) so an actionable screen/tool with an identical exact match
    // appears right next to its concept explanation rather than hiding it.
    const canonicalSlug = ATLAS_GUIDE_SLUGS[entry.id];
    const target = canonicalSlug ? makeTarget(atlasHref(canonicalSlug)) : makeTarget("/rehber", { params: { konu: entry.id } });
    ranked.push({
      item: {
        id: `concept:${entry.id}`,
        kind: "concept",
        code: entry.code,
        title,
        subtitle,
        href: target.href,
        target,
      },
      score: score + 0.15,
      cap: 0,
      order: order++,
    });
  }

  ranked.sort((a, b) => a.score - b.score || b.cap - a.cap || a.order - b.order);
  return ranked.slice(0, limit).map((entry) => entry.item);
}
