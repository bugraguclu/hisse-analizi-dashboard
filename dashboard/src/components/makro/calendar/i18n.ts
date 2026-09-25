import { useCallback } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import type { CalendarTag, Importance, RangePreset, SortKey, StatusFilter } from "./types";

type Entry = Record<Locale, string>;

/** Economic-calendar UI strings (kept local so the shared dictionary isn't touched). */
const STRINGS = {
  // Header / toolbar
  updatedAt: { tr: "Güncellendi {time}", en: "Updated {time}", fr: "Mis à jour à {time}" },
  refresh: { tr: "Yenile", en: "Refresh", fr: "Actualiser" },
  updating: { tr: "Güncelleniyor…", en: "Updating…", fr: "Mise à jour…" },
  export: { tr: "Dışa aktar", en: "Export", fr: "Exporter" },
  exportCsv: { tr: "Listeyi CSV olarak indir", en: "Download list as CSV", fr: "Télécharger la liste en CSV" },
  exportIcs: {
    tr: "Yaklaşan olayları takvime ekle (.ics)",
    en: "Add upcoming events to your calendar (.ics)",
    fr: "Ajouter les événements à venir (.ics)",
  },
  nextKey: { tr: "Sıradaki önemli veri", en: "Next key release", fr: "Prochaine publication clé" },
  nextDecision: { tr: "Sıradaki faiz kararı", en: "Next rate decision", fr: "Prochaine décision de taux" },
  inTime: { tr: "{x} sonra", en: "in {x}", fr: "dans {x}" },
  agoTime: { tr: "{x} önce", en: "{x} ago", fr: "il y a {x}" },
  now: { tr: "Şimdi", en: "Now", fr: "Maintenant" },

  // Query bar
  searchLabel: { tr: "Takvimde ara", en: "Search the calendar", fr: "Rechercher dans le calendrier" },
  searchPlaceholder: {
    tr: "Olay veya ülke ara… (ör. enflasyon, faiz kararı, ABD)",
    en: "Search events or countries… (e.g. inflation, rate decision, US)",
    fr: "Rechercher un événement ou un pays… (ex. inflation, décision de taux)",
  },
  groupPopular: { tr: "Popüler aramalar", en: "Popular searches", fr: "Recherches populaires" },
  noResults: { tr: "“{q}” için sonuç bulunamadı.", en: "No results for “{q}”.", fr: "Aucun résultat pour « {q} »." },
  suggestionCount: { tr: "{n} öneri", en: "{n} suggestions", fr: "{n} suggestions" },
  nextShort: { tr: "Sonraki: {date}", en: "Next: {date}", fr: "Prochaine : {date}" },
  lastShort: { tr: "Son: {date}", en: "Last: {date}", fr: "Dernière : {date}" },
  clearSearch: { tr: "Aramayı temizle", en: "Clear search", fr: "Effacer la recherche" },
  addCountry: { tr: "Ülkeyi takvime ekle", en: "Add the country to the calendar", fr: "Ajouter le pays au calendrier" },

  // Filter bar
  filtersLabel: { tr: "Takvim filtreleri", en: "Calendar filters", fr: "Filtres du calendrier" },
  importance: { tr: "Önem", en: "Importance", fr: "Importance" },
  date: { tr: "Tarih", en: "Date", fr: "Date" },
  status: { tr: "Durum", en: "Status", fr: "Statut" },
  filterCountry: { tr: "Ülke", en: "Country", fr: "Pays" },
  filterTopic: { tr: "Konu", en: "Topic", fr: "Thème" },
  tags: { tr: "Etiketler", en: "Tags", fr: "Étiquettes" },
  lastCountry: {
    tr: "En az bir ülke seçili kalmalı",
    en: "Keep at least one country selected",
    fr: "Gardez au moins un pays sélectionné",
  },
  showEvents: { tr: "{n} olayı göster", en: "Show {n} events", fr: "Afficher {n} événements" },
  direction: { tr: "Yön", en: "Direction", fr: "Ordre" },
  clearFilters: { tr: "Filtreleri temizle", en: "Clear filters", fr: "Effacer les filtres" },
  eventFilter: { tr: "Olay: {name}", en: "Event: {name}", fr: "Événement : {name}" },
  remove: { tr: "Kaldır", en: "Remove", fr: "Retirer" },
  removeFilter: { tr: "Filtreyi kaldır: {name}", en: "Remove filter: {name}", fr: "Retirer le filtre : {name}" },
  resultCount: { tr: "{n} olay", en: "{n} events", fr: "{n} événements" },
  resultOf: { tr: "{n} / {total} olay", en: "{n} of {total} events", fr: "{n} sur {total} événements" },

  // Dates
  dateRange: { tr: "Tarih aralığı", en: "Date range", fr: "Période" },
  from: { tr: "Başlangıç", en: "From", fr: "Du" },
  to: { tr: "Bitiş", en: "To", fr: "Au" },
  prevRange: { tr: "Önceki dönem", en: "Previous period", fr: "Période précédente" },
  nextRange: { tr: "Sonraki dönem", en: "Next period", fr: "Période suivante" },
  outOfWindow: {
    tr: "Kaynak bu tarihleri yayınlamıyor",
    en: "The source doesn't publish these dates",
    fr: "La source ne publie pas ces dates",
  },
  rangeBeyondWindow: {
    tr: "Yalnızca {range} arası yüklendi",
    en: "Only {range} is loaded",
    fr: "Seule la période {range} est chargée",
  },
  horizonNote: {
    tr: "Kaynak takvimi {date} tarihine kadar yayınladı",
    en: "The source has published events up to {date}",
    fr: "La source a publié les événements jusqu'au {date}",
  },
  windowNote: {
    tr: "Yüklenen dönem: {range}",
    en: "Loaded period: {range}",
    fr: "Période chargée : {range}",
  },
  days: { tr: "Günler", en: "Days", fr: "Jours" },
  dayHint: {
    tr: "Güne tıkla · Shift+tık ile aralık seç",
    en: "Click a day · Shift+click to select a range",
    fr: "Cliquez un jour · Maj+clic pour une plage",
  },
  goToday: { tr: "Bugüne git", en: "Jump to today", fr: "Aller à aujourd'hui" },
  today: { tr: "Bugün", en: "Today", fr: "Aujourd'hui" },
  tomorrow: { tr: "Yarın", en: "Tomorrow", fr: "Demain" },

  // Table
  colTime: { tr: "Saat", en: "Time", fr: "Heure" },
  colDate: { tr: "Tarih", en: "Date", fr: "Date" },
  colCountry: { tr: "Ülke", en: "Country", fr: "Pays" },
  colImportance: { tr: "Önem", en: "Imp.", fr: "Imp." },
  colEvent: { tr: "Olay", en: "Event", fr: "Événement" },
  colActual: { tr: "Gerçekleşen", en: "Actual", fr: "Réel" },
  colForecast: { tr: "Tahmin", en: "Forecast", fr: "Prévision" },
  colPrevious: { tr: "Önceki", en: "Previous", fr: "Précédent" },
  sortBy: { tr: "Sırala: {col}", en: "Sort by {col}", fr: "Trier par {col}" },
  sort: { tr: "Sıralama", en: "Sort", fr: "Tri" },
  ascending: { tr: "Artan", en: "Ascending", fr: "Croissant" },
  descending: { tr: "Azalan", en: "Descending", fr: "Décroissant" },
  allDay: { tr: "Tüm gün", en: "All day", fr: "Journée" },
  keyEvent: { tr: "Faiz kararı", en: "Rate decision", fr: "Décision de taux" },
  soon: { tr: "Yakında", en: "Soon", fr: "Bientôt" },
  dayEvents: { tr: "{n} olay", en: "{n} events", fr: "{n} événements" },
  dayHigh: { tr: "{n} yüksek önem", en: "{n} high impact", fr: "{n} impact élevé" },
  changeVsPrevious: {
    tr: "Önceki döneme göre {value}",
    en: "{value} vs previous",
    fr: "{value} par rapport au précédent",
  },
  showMore: { tr: "Daha fazla göster ({n} kaldı)", en: "Show more ({n} left)", fr: "Afficher plus ({n} restants)" },
  colDetails: { tr: "Ayrıntılar", en: "Details", fr: "Détails" },
  tableCaption: {
    tr: "Ekonomik takvim — {n} olay",
    en: "Economic calendar — {n} events",
    fr: "Calendrier économique — {n} événements",
  },

  // Detail
  vsForecast: { tr: "Beklentiye göre", en: "Vs forecast", fr: "Écart à la prévision" },
  aboveForecast: { tr: "Beklentinin üzerinde", en: "Above forecast", fr: "Au-dessus de la prévision" },
  belowForecast: { tr: "Beklentinin altında", en: "Below forecast", fr: "En dessous de la prévision" },
  inLineForecast: { tr: "Beklentiyle aynı", en: "In line with forecast", fr: "Conforme à la prévision" },
  publishedBy: { tr: "Yayımlayan", en: "Published by", fr: "Publié par" },
  released: { tr: "Açıklandı", en: "Released", fr: "Publié" },
  pending: { tr: "Bekleniyor", en: "Pending", fr: "En attente" },
  awaitingValue: { tr: "Değer bekleniyor", en: "Awaiting value", fr: "Valeur en attente" },
  period: { tr: "Dönem", en: "Period", fr: "Période" },
  change: { tr: "Değişim", en: "Change", fr: "Variation" },
  nextRelease: { tr: "Sonraki açıklama", en: "Next release", fr: "Prochaine publication" },
  showInTable: { tr: "Takvimde göster", en: "Show in the calendar", fr: "Afficher dans le calendrier" },
  onlyThis: { tr: "Yalnızca bu olayı göster", en: "Show only this event", fr: "Afficher uniquement cet événement" },
  onlyCountry: { tr: "Yalnızca {country}", en: "Only {country}", fr: "Uniquement {country}" },
  addToCalendar: { tr: "Takvime ekle", en: "Add to calendar", fr: "Ajouter au calendrier" },
  copy: { tr: "Kopyala", en: "Copy", fr: "Copier" },
  copied: { tr: "Kopyalandı", en: "Copied", fr: "Copié" },
  istanbulTime: { tr: "İstanbul saati", en: "Istanbul time", fr: "heure d'Istanbul" },

  // States
  noCalendar: { tr: "Takvim verisi yok", en: "No calendar data", fr: "Aucune donnée de calendrier" },
  sourceDown: {
    tr: "Takvim kaynağına şu an ulaşılamıyor.",
    en: "The calendar source is unreachable right now.",
    fr: "La source du calendrier est injoignable pour le moment.",
  },
  partialFailure: {
    tr: "{countries} verisi alınamadı.",
    en: "Couldn't load {countries}.",
    fr: "Impossible de charger {countries}.",
  },
  monthsUnavailable: {
    tr: "{months} takvimi şu an alınamıyor.",
    en: "Couldn't load the calendar for {months}.",
    fr: "Impossible de charger le calendrier de {months}.",
  },
  fallbackNote: {
    tr: "Kaynağa ulaşılamadığı için bu ay doviz.com'dan gösteriliyor; beklenti değerleri yok.",
    en: "The source is unreachable, so this month comes from doviz.com, without forecasts.",
    fr: "Source injoignable : ce mois provient de doviz.com, sans prévisions.",
  },
  noMatch: {
    tr: "Bu filtrelerle eşleşen olay yok.",
    en: "No events match these filters.",
    fr: "Aucun événement ne correspond à ces filtres.",
  },
  searchAllDates: { tr: "Tüm tarihlerde ara", en: "Search all dates", fr: "Chercher sur toutes les dates" },
  sourceDoviz: { tr: "doviz.com ekonomik takvim", en: "doviz.com economic calendar", fr: "calendrier économique de doviz.com" },
  sourceTradingView: {
    tr: "TradingView ekonomik takvim",
    en: "TradingView economic calendar",
    fr: "calendrier économique TradingView",
  },
  sourceNote: {
    tr: "Saatler İstanbul saatidir. Beklenti, piyasanın ortalama tahminidir; Türkçe olay adları doviz.com'dan.",
    en: "Times are Istanbul time. Forecasts are the market consensus.",
    fr: "Heures d'Istanbul. Les prévisions sont le consensus du marché.",
  },
} satisfies Record<string, Entry>;

export type CalendarTextKey = keyof typeof STRINGS;
export type CalendarText = (key: CalendarTextKey, vars?: Record<string, string | number>) => string;

/**
 * Singular forms of the count strings, used when a numeric `n` is "one" under the
 * locale's plural rules (en: 1; fr: 0 and 1). Turkish nouns do not change after a
 * number, so it has none.
 */
const ONE: Partial<Record<CalendarTextKey, Partial<Entry>>> = {
  resultCount: { en: "{n} event", fr: "{n} événement" },
  dayEvents: { en: "{n} event", fr: "{n} événement" },
  tableCaption: { en: "Economic calendar — {n} event", fr: "Calendrier économique — {n} événement" },
  showMore: { fr: "Afficher plus ({n} restant)" },
  showEvents: { en: "Show {n} event", fr: "Afficher {n} événement" },
  suggestionCount: { en: "{n} suggestion", fr: "{n} suggestion" },
};

const pluralRules = new Map<Locale, Intl.PluralRules>();

function isOne(locale: Locale, n: string | number | undefined): boolean {
  if (typeof n !== "number") return false;
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(n) === "one";
}

export function calendarText(locale: Locale, key: CalendarTextKey, vars?: Record<string, string | number>): string {
  const one = isOne(locale, vars?.n) ? ONE[key]?.[locale] : undefined;
  let text: string = one ?? STRINGS[key][locale] ?? STRINGS[key].tr;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

export function useCalendarText(): CalendarText {
  const { locale } = useLocale();
  return useCallback((key, vars) => calendarText(locale, key, vars), [locale]);
}

export const IMPORTANCE_LABELS: Record<Importance, Entry> = {
  high: { tr: "Yüksek", en: "High", fr: "Élevée" },
  mid: { tr: "Orta", en: "Medium", fr: "Moyenne" },
  low: { tr: "Düşük", en: "Low", fr: "Faible" },
};

export const STATUS_LABELS: Record<StatusFilter, Entry> = {
  all: { tr: "Tümü", en: "All", fr: "Tous" },
  upcoming: { tr: "Yaklaşan", en: "Upcoming", fr: "À venir" },
  released: { tr: "Açıklanan", en: "Released", fr: "Publiés" },
};

export const RANGE_LABELS: Record<RangePreset, Entry> = {
  today: { tr: "Bugün", en: "Today", fr: "Aujourd'hui" },
  tomorrow: { tr: "Yarın", en: "Tomorrow", fr: "Demain" },
  thisWeek: { tr: "Bu hafta", en: "This week", fr: "Cette semaine" },
  nextWeek: { tr: "Gelecek hafta", en: "Next week", fr: "Semaine prochaine" },
  lastWeek: { tr: "Geçen hafta", en: "Last week", fr: "Semaine dernière" },
  thisMonth: { tr: "Bu ay", en: "This month", fr: "Ce mois-ci" },
  nextMonth: { tr: "Gelecek ay", en: "Next month", fr: "Mois prochain" },
  lastMonth: { tr: "Geçen ay", en: "Last month", fr: "Mois dernier" },
  all: { tr: "Tümü", en: "All dates", fr: "Toutes les dates" },
  custom: { tr: "Özel aralık", en: "Custom range", fr: "Plage personnalisée" },
};

export const SORT_LABELS: Record<SortKey, Entry> = {
  time: { tr: "Zaman", en: "Time", fr: "Heure" },
  importance: { tr: "Önem", en: "Importance", fr: "Importance" },
  country: { tr: "Ülke", en: "Country", fr: "Pays" },
  event: { tr: "Olay adı", en: "Event name", fr: "Nom" },
};

export const TAG_LABELS: Record<CalendarTag, { long: Entry; short: Entry }> = {
  rates: {
    long: { tr: "Faiz & Merkez Bankası", en: "Rates & Central Banks", fr: "Taux & banques centrales" },
    short: { tr: "Faiz", en: "Rates", fr: "Taux" },
  },
  inflation: {
    long: { tr: "Enflasyon", en: "Inflation", fr: "Inflation" },
    short: { tr: "Enflasyon", en: "Inflation", fr: "Inflation" },
  },
  labor: {
    long: { tr: "İstihdam", en: "Labor", fr: "Emploi" },
    short: { tr: "İstihdam", en: "Labor", fr: "Emploi" },
  },
  growth: {
    long: { tr: "Büyüme & Üretim", en: "Growth & Output", fr: "Croissance & production" },
    short: { tr: "Büyüme", en: "Growth", fr: "Croissance" },
  },
  surveys: {
    long: { tr: "PMI & Güven", en: "PMI & Sentiment", fr: "PMI & confiance" },
    short: { tr: "PMI & Güven", en: "PMI", fr: "PMI" },
  },
  consumer: {
    long: { tr: "Tüketim", en: "Consumer", fr: "Consommation" },
    short: { tr: "Tüketim", en: "Consumer", fr: "Conso." },
  },
  housing: {
    long: { tr: "Konut & İnşaat", en: "Housing & Construction", fr: "Immobilier & construction" },
    short: { tr: "Konut", en: "Housing", fr: "Immobilier" },
  },
  trade: {
    long: { tr: "Dış Ticaret & Akımlar", en: "Trade & Flows", fr: "Commerce & flux" },
    short: { tr: "Dış Ticaret", en: "Trade", fr: "Commerce" },
  },
  fiscal: {
    long: { tr: "Kamu Maliyesi", en: "Fiscal", fr: "Finances publiques" },
    short: { tr: "Maliye", en: "Fiscal", fr: "Budget" },
  },
  credit: {
    long: { tr: "Para & Kredi", en: "Money & Credit", fr: "Monnaie & crédit" },
    short: { tr: "Kredi", en: "Credit", fr: "Crédit" },
  },
  energy: {
    long: { tr: "Enerji & Emtia", en: "Energy & Commodities", fr: "Énergie & matières premières" },
    short: { tr: "Enerji", en: "Energy", fr: "Énergie" },
  },
  auction: {
    long: { tr: "Tahvil İhaleleri", en: "Bond Auctions", fr: "Adjudications" },
    short: { tr: "İhale", en: "Auction", fr: "Adjudication" },
  },
  speech: {
    long: { tr: "Konuşma & Tutanak", en: "Speeches & Minutes", fr: "Discours & comptes rendus" },
    short: { tr: "Konuşma", en: "Speech", fr: "Discours" },
  },
  holiday: {
    long: { tr: "Tatil", en: "Holiday", fr: "Jour férié" },
    short: { tr: "Tatil", en: "Holiday", fr: "Férié" },
  },
  other: {
    long: { tr: "Diğer", en: "Other", fr: "Autre" },
    short: { tr: "Diğer", en: "Other", fr: "Autre" },
  },
};

/**
 * English and French search words per topic, so "unemployment" or "taux directeur" also
 * finds the topic's releases whose (Turkish or English) names do not contain the word.
 */
const TAG_KEYWORDS: Record<CalendarTag, string> = {
  // Institution names (Fed, ECB …) are left out: titles carry them, and here they would match every bank.
  rates: "interest rate policy central bank monetary taux directeur banque centrale politique monétaire",
  inflation: "cpi ppi pce prices consumer producer core ipc prix consommation production sous-jacente",
  labor: "jobs employment unemployment jobless claims payrolls nfp wages earnings chômage emploi salaires inscriptions",
  growth: "gdp industrial production output manufacturing factory orders durable goods pib production industrielle commandes",
  surveys: "pmi sentiment confidence survey ism business climate confiance enquête climat des affaires",
  consumer: "retail sales consumer spending consumption ventes au détail dépenses consommation",
  housing: "housing home sales building permits starts construction mortgage logement immobilier permis de construire mises en chantier",
  trade: "trade balance exports imports current account flows balance commerciale exportations importations compte courant",
  fiscal: "budget government debt deficit treasury dette publique déficit",
  credit: "credit loans lending money supply crédit prêts masse monétaire",
  energy: "oil crude natural gas gasoline inventories rig count pétrole brut gaz naturel stocks",
  auction: "auction bond bill treasury adjudication obligation",
  speech: "speech speaks testimony minutes press conference discours compte rendu conférence de presse",
  holiday: "holiday bank holiday market closed jour férié marché fermé",
  other: "",
};

/** Extra search words for central-bank rate decisions (key events), so "rate decision" skips Fed speeches. */
export const KEY_EVENT_SEARCH = "rate decision interest rate decision décision de taux";

/** Every label and keyword of a topic, for the free-text haystack ("other" contributes nothing). */
export function tagSearchText(tag: CalendarTag): string {
  if (tag === "other") return "";
  const { long, short } = TAG_LABELS[tag];
  return [long.tr, long.en, long.fr, short.tr, short.en, short.fr, TAG_KEYWORDS[tag]].join(" ");
}

const COUNTRY_NAMES: Record<string, Entry> = {
  TR: { tr: "Türkiye", en: "Türkiye", fr: "Turquie" },
  US: { tr: "ABD", en: "United States", fr: "États-Unis" },
  EU: { tr: "Euro Bölgesi", en: "Euro Area", fr: "Zone euro" },
  DE: { tr: "Almanya", en: "Germany", fr: "Allemagne" },
  GB: { tr: "Birleşik Krallık", en: "United Kingdom", fr: "Royaume-Uni" },
  FR: { tr: "Fransa", en: "France", fr: "France" },
  IT: { tr: "İtalya", en: "Italy", fr: "Italie" },
  JP: { tr: "Japonya", en: "Japan", fr: "Japon" },
  CN: { tr: "Çin", en: "China", fr: "Chine" },
  CA: { tr: "Kanada", en: "Canada", fr: "Canada" },
  AU: { tr: "Avustralya", en: "Australia", fr: "Australie" },
  CH: { tr: "İsviçre", en: "Switzerland", fr: "Suisse" },
  KR: { tr: "Güney Kore", en: "South Korea", fr: "Corée du Sud" },
  IN: { tr: "Hindistan", en: "India", fr: "Inde" },
  BR: { tr: "Brezilya", en: "Brazil", fr: "Brésil" },
  RU: { tr: "Rusya", en: "Russia", fr: "Russie" },
};

export function countryLabel(code: string, locale: Locale, fallback?: string): string {
  return COUNTRY_NAMES[code]?.[locale] ?? fallback ?? code;
}

/** Every localized name of a country, for search matching ("ABD", "United States", "US"). */
export function countrySearchNames(code: string, fallback?: string): string[] {
  const names = COUNTRY_NAMES[code];
  return [code, fallback ?? "", ...(names ? Object.values(names) : [])].filter(Boolean);
}

/** Regional-indicator flag emoji ("TR" → 🇹🇷, "EU" → 🇪🇺). */
export function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/**
 * TradingView names the publishing agency generically ("Central Bank", "Statistical
 * Institute"); the Turkish UI names Türkiye's own and translates the generic ones.
 */
const TR_AGENCIES: Record<string, string> = {
  "TR|Statistical Institute": "TÜİK",
  "TR|Central Bank": "TCMB",
  "TR|Undersecretariat of Treasury": "Hazine ve Maliye Bakanlığı",
  "TR|Automotive Manufacturers Association (OSD)": "Otomotiv Sanayii Derneği (OSD)",
  "TR|Ministry of Culture and Tourism": "Kültür ve Turizm Bakanlığı",
  "TR|Istanbul Chamber of Industry": "İstanbul Sanayi Odası",
  "Central Bank": "Merkez Bankası",
  "Reserve Bank": "Merkez Bankası",
  "Statistical Institute": "İstatistik Kurumu",
  "National Bureau of Statistics": "Ulusal İstatistik Bürosu",
  "Ministry of Finance": "Maliye Bakanlığı",
  "European Central Bank": "Avrupa Merkez Bankası (ECB)",
  "Federal Reserve": "Fed",
};

export function agencyLabel(countryCode: string, name: string, locale: Locale): string {
  if (locale !== "tr") return name;
  return TR_AGENCIES[`${countryCode}|${name}`] ?? TR_AGENCIES[name] ?? name;
}

/**
 * The search's popular list, per UI language. Each one matches through the row haystack:
 * the Turkish or English name, or a topic keyword (TAG_KEYWORDS, KEY_EVENT_SEARCH).
 */
export const POPULAR_SEARCHES: Record<Locale, string[]> = {
  tr: ["Faiz Kararı", "Enflasyon", "İşsizlik", "PMI", "GSYH", "Tarım Dışı İstihdam", "Perakende Satışlar"],
  en: ["Rate decision", "Inflation", "Unemployment", "PMI", "GDP", "Non Farm Payrolls", "Retail Sales"],
  fr: ["Décision de taux", "Inflation", "Chômage", "PMI", "PIB", "Non Farm Payrolls", "Ventes au détail"],
};
