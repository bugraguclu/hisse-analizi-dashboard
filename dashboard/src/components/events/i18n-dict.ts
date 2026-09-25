import type { Locale } from "@/lib/i18n";

type Entry = { tr: string; en: string; fr: string };

/**
 * Strings of the /events page ("KAP Haberleri"). Same {tr, en, fr} shape as
 * lib/i18n.ts; `{name}` placeholders. Category/severity labels live in
 * lib/i18n.ts (shared with SeverityBadge). Pure module — safe to import from
 * server components (app/events/layout.tsx metadata).
 */
const dict = {
  // Page / metadata
  "page.title": { tr: "KAP Haberleri", en: "KAP News", fr: "Actualités KAP" },
  "page.subtitle": {
    tr: "Borsa İstanbul şirketlerinin KAP bildirimleri — anlık akış",
    en: "KAP disclosures from Borsa Istanbul companies — live feed",
    fr: "Publications KAP des sociétés de Borsa Istanbul — flux en direct",
  },
  "page.metaDescription": {
    tr: "Borsa İstanbul şirketlerinin KAP bildirimleri: hisse, kategori, önem ve tarihe göre filtrelenebilir anlık akış.",
    en: "KAP disclosures from Borsa Istanbul companies: a live feed you can filter by stock, category, importance and date.",
    fr: "Publications KAP des sociétés de Borsa Istanbul : un flux en direct filtrable par action, catégorie, importance et date.",
  },

  // Feed status (header actions)
  "status.label": { tr: "KAP akış durumu", en: "KAP feed status", fr: "État du flux KAP" },
  "status.live": { tr: "Canlı", en: "Live", fr: "En direct" },
  "status.delayed": { tr: "Gecikmeli", en: "Delayed", fr: "En retard" },
  "status.unknown": { tr: "Akış durumu alınamadı", en: "Feed status unavailable", fr: "État du flux indisponible" },
  "status.updated": { tr: "{time} güncellendi", en: "updated {time}", fr: "mis à jour {time}" },
  "status.never": { tr: "henüz güncellenmedi", en: "not updated yet", fr: "pas encore mis à jour" },
  "status.lastSuccess": { tr: "Son başarılı tarama: {time}", en: "Last successful poll: {time}", fr: "Dernière collecte réussie : {time}" },
  "status.failures": { tr: "{count} ardışık hata", en: "{count} consecutive failures", fr: "{count} échecs consécutifs" },
  "status.interval": {
    tr: "KAP yaklaşık her {seconds} saniyede bir taranır",
    en: "KAP is polled about every {seconds} seconds",
    fr: "KAP est interrogé environ toutes les {seconds} secondes",
  },
  "action.refresh": { tr: "Yenile", en: "Refresh", fr: "Actualiser" },
  "action.refreshing": { tr: "Yenileniyor…", en: "Refreshing…", fr: "Actualisation…" },

  // Toolbar / search
  "toolbar.label": { tr: "Bildirimleri filtrele", en: "Filter disclosures", fr: "Filtrer les publications" },
  "search.label": { tr: "Bildirimlerde ara", en: "Search disclosures", fr: "Rechercher des publications" },
  "search.placeholder": {
    tr: "Hisse, şirket veya başlıkta ara…",
    en: "Search ticker, company or headline…",
    fr: "Action, société ou titre…",
  },
  "search.clear": { tr: "Aramayı temizle", en: "Clear search", fr: "Effacer la recherche" },
  "search.shortcut": { tr: "Aramak için / tuşuna basın", en: "Press / to search", fr: "Appuyez sur / pour rechercher" },
  "search.suggestions": { tr: "Şirket önerileri", en: "Company suggestions", fr: "Suggestions de sociétés" },
  "search.suggestionCount": {
    tr: "{count} şirket önerisi. Seçmek için ok tuşlarını ya da Tab'ı kullanın.",
    en: "{count} company suggestions. Use the arrow keys or Tab to choose.",
    fr: "{count} suggestions de sociétés. Utilisez les flèches ou Tab pour choisir.",
  },
  "search.noCompany": { tr: "Eşleşen takipli şirket yok", en: "No matching tracked company", fr: "Aucune société suivie ne correspond" },
  "search.textHint": { tr: "Enter: “{q}” metninde ara", en: "Enter: search text for “{q}”", fr: "Entrée : rechercher « {q} »" },
  "search.keysHint": { tr: "↑↓ / Tab gez · Enter seç · Esc kapat", en: "↑↓ / Tab navigate · Enter select · Esc close", fr: "↑↓ / Tab naviguer · Entrée choisir · Échap fermer" },
  "search.inFilter": { tr: "Filtrede", en: "In filter", fr: "Déjà filtrée" },
  "watchlist.toggle": { tr: "Takip listem", en: "My watchlist", fr: "Ma liste" },
  "watchlist.hint": {
    tr: "Yalnızca takip listemdeki {count} hisse",
    en: "Only the {count} stocks in my watchlist",
    fr: "Uniquement les {count} actions de ma liste",
  },

  // Filter bar
  "filters.label": { tr: "Bildirim filtreleri", en: "Disclosure filters", fr: "Filtres des publications" },
  "filters.tickers": { tr: "Hisse", en: "Stock", fr: "Action" },
  "filters.tickerHint": {
    tr: "Arama kutusundan hisse ekleyin; takip listenizdekiler burada da görünür.",
    en: "Add stocks from the search box; your watchlist's stocks show up here too.",
    fr: "Ajoutez des actions depuis la recherche ; celles de votre liste apparaissent aussi ici.",
  },
  "filters.showResults.one": { tr: "{count} bildirimi göster", en: "Show {count} disclosure", fr: "Afficher {count} publication" },
  "filters.showResults.other": { tr: "{count} bildirimi göster", en: "Show {count} disclosures", fr: "Afficher {count} publications" },
  "filters.showResultsPlain": { tr: "Bildirimleri göster", en: "Show disclosures", fr: "Afficher les publications" },
  "date.label": { tr: "Tarih", en: "Date", fr: "Date" },
  "date.all": { tr: "Tümü", en: "All", fr: "Tout" },
  "date.today": { tr: "Bugün", en: "Today", fr: "Aujourd'hui" },
  "date.yesterday": { tr: "Dün", en: "Yesterday", fr: "Hier" },
  "date.7d": { tr: "Son 7 gün", en: "Last 7 days", fr: "7 derniers jours" },
  "date.30d": { tr: "Son 30 gün", en: "Last 30 days", fr: "30 derniers jours" },
  "date.month": { tr: "Bu ay", en: "This month", fr: "Ce mois-ci" },
  "date.custom": { tr: "Özel aralık", en: "Custom range", fr: "Période personnalisée" },
  "date.customRange": { tr: "Tarih aralığı", en: "Date range", fr: "Période" },
  "date.from": { tr: "Başlangıç", en: "From", fr: "Du" },
  "date.to": { tr: "Bitiş", en: "To", fr: "Au" },
  "date.timezone": { tr: "Günler İstanbul saatine göredir", en: "Days follow Istanbul time", fr: "Jours à l'heure d'Istanbul" },
  "date.rangeChip": { tr: "{from} – {to}", en: "{from} – {to}", fr: "{from} – {to}" },
  "date.sinceChip": { tr: "{from} ve sonrası", en: "Since {from}", fr: "Depuis le {from}" },
  "date.untilChip": { tr: "{to} ve öncesi", en: "Until {to}", fr: "Jusqu'au {to}" },
  "severity.label": { tr: "Önem", en: "Importance", fr: "Niveau" },
  "category.label": { tr: "Kategori", en: "Category", fr: "Catégorie" },
  "sort.label": { tr: "Sıralama", en: "Sort", fr: "Tri" },
  "sort.newest": { tr: "En yeni", en: "Newest", fr: "Plus récentes" },
  "sort.oldest": { tr: "En eski", en: "Oldest", fr: "Plus anciennes" },
  "sort.severity": { tr: "Önce önemliler", en: "Most important first", fr: "Les plus importantes d'abord" },
  "sort.ticker": { tr: "Hisse A→Z", en: "Ticker A→Z", fr: "Action A→Z" },
  "size.label": { tr: "Sayfa başına", en: "Per page", fr: "Par page" },
  "active.clearAll": { tr: "Filtreleri temizle", en: "Clear filters", fr: "Effacer les filtres" },

  // Feed
  "feed.label": { tr: "Bildirim akışı", en: "Disclosure feed", fr: "Flux des publications" },
  "feed.count.one": { tr: "{count} bildirim", en: "{count} disclosure", fr: "{count} publication" },
  "feed.count.other": { tr: "{count} bildirim", en: "{count} disclosures", fr: "{count} publications" },
  "feed.today": { tr: "Bugün", en: "Today", fr: "Aujourd'hui" },
  "feed.yesterday": { tr: "Dün", en: "Yesterday", fr: "Hier" },
  "feed.loading": { tr: "Bildirimler yükleniyor…", en: "Loading disclosures…", fr: "Chargement des publications…" },
  "feed.updating": { tr: "Güncelleniyor…", en: "Updating…", fr: "Mise à jour…" },
  "feed.emptyFiltered": {
    tr: "Bu filtrelere uyan bildirim yok",
    en: "No disclosures match these filters",
    fr: "Aucune publication ne correspond à ces filtres",
  },
  "feed.emptyFilteredHint": {
    tr: "Filtreleri azaltmayı veya tarih aralığını genişletmeyi deneyin.",
    en: "Try removing a filter or widening the date range.",
    fr: "Essayez de retirer un filtre ou d'élargir la période.",
  },
  "feed.empty": { tr: "Henüz bildirim yok", en: "No disclosures yet", fr: "Aucune publication pour l'instant" },
  "feed.emptyPage": { tr: "Bu sayfada bildirim yok", en: "There are no disclosures on this page", fr: "Aucune publication sur cette page" },
  "feed.firstPage": { tr: "İlk sayfaya dön", en: "Go to the first page", fr: "Revenir à la première page" },
  "feed.error": { tr: "Bildirimler yüklenemedi", en: "Could not load the disclosures", fr: "Impossible de charger les publications" },

  // Row
  "row.new": { tr: "Yeni", en: "New", fr: "Nouveau" },
  "row.correction": { tr: "Düzeltme", en: "Correction", fr: "Rectificatif" },
  "row.attachments.one": { tr: "{count} ek", en: "{count} attachment", fr: "{count} pièce jointe" },
  "row.attachments.other": { tr: "{count} ek", en: "{count} attachments", fr: "{count} pièces jointes" },
  "row.addTicker": { tr: "{ticker} hissesini filtreye ekle", en: "Add {ticker} to the filter", fr: "Ajouter {ticker} au filtre" },
  "row.moreTickers": { tr: "{count} şirket daha: {list}", en: "{count} more companies: {list}", fr: "{count} autres sociétés : {list}" },
  "row.untitled": { tr: "Başlıksız bildirim", en: "Untitled disclosure", fr: "Publication sans titre" },

  // Pagination
  "pagination.label": { tr: "Sayfalar", en: "Pages", fr: "Pages" },
  "pagination.range": { tr: "{from}–{to} / {total}", en: "{from}–{to} of {total}", fr: "{from}–{to} sur {total}" },
  "pagination.first": { tr: "İlk sayfa", en: "First page", fr: "Première page" },
  "pagination.prev": { tr: "Önceki sayfa", en: "Previous page", fr: "Page précédente" },
  "pagination.next": { tr: "Sonraki sayfa", en: "Next page", fr: "Page suivante" },
  "pagination.last": { tr: "Son sayfa", en: "Last page", fr: "Dernière page" },
  "pagination.page": { tr: "Sayfa {page}", en: "Page {page}", fr: "Page {page}" },
  "pagination.pageOf": { tr: "{page} / {pages}", en: "{page} of {pages}", fr: "{page} sur {pages}" },

  // Detail drawer
  "drawer.label": { tr: "Bildirim ayrıntısı", en: "Disclosure details", fr: "Détails de la publication" },
  "drawer.close": { tr: "Kapat", en: "Close", fr: "Fermer" },
  "drawer.prev": { tr: "Önceki bildirim", en: "Previous disclosure", fr: "Publication précédente" },
  "drawer.next": { tr: "Sonraki bildirim", en: "Next disclosure", fr: "Publication suivante" },
  "drawer.position": { tr: "{index} / {count}", en: "{index} of {count}", fr: "{index} sur {count}" },
  "drawer.navAnnouncement": { tr: "{index} / {count}: {title}", en: "{index} of {count}: {title}", fr: "{index} sur {count} : {title}" },
  "drawer.keysHint": { tr: "j / k ile önceki–sonraki", en: "j / k for previous–next", fr: "j / k : précédente–suivante" },
  "drawer.companies": { tr: "Şirketler", en: "Companies", fr: "Sociétés" },
  "drawer.publisher": { tr: "Yayımlayan", en: "Publisher", fr: "Émetteur" },
  "drawer.openOnKap": { tr: "KAP'ta aç", en: "Open on KAP", fr: "Ouvrir sur KAP" },
  "drawer.stockPage": { tr: "Hisse sayfası", en: "Stock page", fr: "Page de l'action" },
  "drawer.copyLink": { tr: "Bağlantıyı kopyala", en: "Copy link", fr: "Copier le lien" },
  "drawer.copied": { tr: "Bağlantı kopyalandı", en: "Link copied", fr: "Lien copié" },
  "drawer.copyFailed": { tr: "Bağlantı kopyalanamadı", en: "Could not copy the link", fr: "Impossible de copier le lien" },
  "drawer.allForTicker": { tr: "{ticker} bildirimlerinin tümü", en: "All {ticker} disclosures", fr: "Toutes les publications de {ticker}" },
  "drawer.content": { tr: "Bildirim metni", en: "Disclosure text", fr: "Texte de la publication" },
  "drawer.contentLoading": { tr: "Bildirim metni KAP'tan alınıyor…", en: "Fetching the disclosure from KAP…", fr: "Récupération de la publication sur KAP…" },
  "drawer.contentUnavailable": {
    tr: "İçerik şu an KAP'tan alınamadı",
    en: "The text could not be retrieved from KAP right now",
    fr: "Le texte n'a pas pu être récupéré sur KAP pour le moment",
  },
  "drawer.contentUnavailableHint": {
    tr: "Bildirimi KAP'ta açabilir veya birazdan tekrar deneyebilirsiniz.",
    en: "You can open it on KAP or try again shortly.",
    fr: "Vous pouvez l'ouvrir sur KAP ou réessayer dans un instant.",
  },
  "drawer.contentMissing": {
    tr: "Bu bildirimin metni burada gösterilemiyor",
    en: "The text of this disclosure cannot be shown here",
    fr: "Le texte de cette publication ne peut pas être affiché ici",
  },
  "drawer.contentMissingHint": { tr: "Metni KAP'ta okuyabilirsiniz.", en: "You can read it on KAP.", fr: "Vous pouvez la lire sur KAP." },
  "drawer.contentEmpty": { tr: "Bu bildirimde metin bulunmuyor.", en: "This disclosure has no text.", fr: "Cette publication ne contient pas de texte." },
  "drawer.truncated": {
    tr: "Bildirim uzun olduğu için kısaltıldı — tamamı KAP'ta.",
    en: "This long disclosure is shortened here — the full text is on KAP.",
    fr: "Publication abrégée ici — le texte intégral est sur KAP.",
  },
  "drawer.table": { tr: "Tablo {index}", en: "Table {index}", fr: "Tableau {index}" },
  "drawer.attachments": { tr: "Ekler", en: "Attachments", fr: "Pièces jointes" },
  "drawer.attachmentsNote": { tr: "Ek dosyalar KAP'ta açılır.", en: "Attachments open on KAP.", fr: "Les pièces jointes s'ouvrent sur KAP." },
  "drawer.notFound": { tr: "Bildirim bulunamadı", en: "Disclosure not found", fr: "Publication introuvable" },
  "drawer.notFoundHint": {
    tr: "Bağlantı eski olabilir ya da bildirim kaldırılmış olabilir.",
    en: "The link may be outdated or the disclosure may have been removed.",
    fr: "Le lien est peut-être obsolète ou la publication a été retirée.",
  },
  "drawer.loadError": { tr: "Bildirim yüklenemedi", en: "Could not load the disclosure", fr: "Impossible de charger la publication" },

  // Common
  "common.retry": { tr: "Tekrar dene", en: "Retry", fr: "Réessayer" },
  "common.opensInNewTab": { tr: "(yeni sekmede açılır)", en: "(opens in a new tab)", fr: "(s'ouvre dans un nouvel onglet)" },
  "error.network": { tr: "Sunucuya ulaşılamadı", en: "Could not reach the server", fr: "Serveur injoignable" },
  "error.timeout": { tr: "Sunucu zamanında yanıt vermedi", en: "The server did not respond in time", fr: "Le serveur n'a pas répondu à temps" },
  "error.rateLimited": {
    tr: "Çok fazla istek — birazdan tekrar deneyin",
    en: "Too many requests — please try again shortly",
    fr: "Trop de requêtes — réessayez dans un instant",
  },
} satisfies Record<string, Entry>;

export type EventsKey = keyof typeof dict;
export type EventsVars = Record<string, string | number>;

/** Keys with `.one` / `.other` forms, addressed by their common prefix. */
export type EventsPluralKey = {
  [K in EventsKey]: K extends `${infer Base}.one` ? (`${Base}.other` extends EventsKey ? Base : never) : never;
}[EventsKey];

function interpolate(template: string, vars?: EventsVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function eventsText(key: EventsKey, locale: Locale, vars?: EventsVars): string {
  const entry: Entry = dict[key];
  return interpolate(entry[locale] ?? entry.tr, vars);
}

const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

/** `{base}.one` or `{base}.other` for `count` (CLDR rules of the locale). */
export function eventsPlural(base: EventsPluralKey, count: number, locale: Locale, vars?: EventsVars): string {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  const form = rules.select(count) === "one" ? "one" : "other";
  return eventsText(`${base}.${form}` as EventsKey, locale, vars);
}
