export type Locale = "tr" | "en" | "fr";

export const localeLabels: Record<Locale, string> = {
  tr: "TR",
  en: "EN",
  fr: "FR",
};

const translations = {
  // Common
  "common.loading": { tr: "Yükleniyor...", en: "Loading...", fr: "Chargement..." },
  "common.noData": { tr: "Veri bulunamadı", en: "No data found", fr: "Aucune donnée trouvée" },
  "common.retry": { tr: "Tekrar Dene", en: "Retry", fr: "Réessayer" },
  "common.all": { tr: "Tümü", en: "All", fr: "Tous" },
  "common.previous": { tr: "Önceki", en: "Previous", fr: "Précédent" },
  "common.next": { tr: "Sonraki", en: "Next", fr: "Suivant" },
  "common.close": { tr: "Kapat", en: "Close", fr: "Fermer" },
  "common.records": { tr: "kayıt", en: "records", fr: "enregistrements" },
  "common.stocks": { tr: "hisse", en: "stocks", fr: "actions" },
  "common.search": { tr: "Hisse ara... (THYAO, GARAN)", en: "Search stock... (THYAO, GARAN)", fr: "Rechercher... (THYAO, GARAN)" },
  "common.reset": { tr: "Sıfırla", en: "Reset", fr: "Réinitialiser" },
  "common.loadError": { tr: "Veri yüklenemedi", en: "Failed to load", fr: "Échec du chargement" },
  "common.min": { tr: "Min", en: "Min", fr: "Min" },
  "common.max": { tr: "Maks", en: "Max", fr: "Max" },

  // Navigation / Breadcrumbs
  "nav.dashboard": { tr: "Dashboard", en: "Dashboard", fr: "Tableau de bord" },
  "nav.events": { tr: "Olaylar & KAP", en: "Events & KAP", fr: "Événements & KAP" },
  "nav.stockAnalysis": { tr: "Hisse Analizi", en: "Stock Analysis", fr: "Analyse d'actions" },
  "nav.technicalAnalysis": { tr: "Teknik Analiz", en: "Technical Analysis", fr: "Analyse technique" },
  "nav.fundamentalAnalysis": { tr: "Temel Analiz", en: "Fundamental Analysis", fr: "Analyse fondamentale" },
  "nav.combinedAnalysis": { tr: "Kombine Analiz", en: "Combined Analysis", fr: "Analyse combinée" },
  "nav.macroEconomy": { tr: "Makro Ekonomi", en: "Macro Economy", fr: "Macro-économie" },
  "nav.screening": { tr: "Hisse Tarama", en: "Stock Screening", fr: "Filtrage d'actions" },

  // Dashboard
  "dashboard.marketOverview": { tr: "Piyasa Özeti", en: "Market Overview", fr: "Aperçu du marché" },
  "dashboard.marketOpen": { tr: "Piyasa Açık", en: "Market Open", fr: "Marché ouvert" },
  "dashboard.marketClosed": { tr: "Piyasa Kapalı", en: "Market Closed", fr: "Marché fermé" },
  "dashboard.latestDevelopments": { tr: "Son Gelişmeler", en: "Latest Developments", fr: "Dernières nouvelles" },
  "dashboard.noEventsYet": { tr: "Henüz olay kaydedilmemiş", en: "No events recorded yet", fr: "Aucun événement enregistré" },
  "dashboard.watchlist": { tr: "Takip Listesi", en: "Watchlist", fr: "Liste de suivi" },
  "dashboard.chartNoData": { tr: "Grafik verisi bulunamadı", en: "No chart data found", fr: "Aucune donnée graphique" },
  "dashboard.breadth": { tr: "Piyasa genişliği", en: "Market breadth", fr: "Largeur du marché" },
  "dashboard.advancers": { tr: "yükselen", en: "advancing", fr: "en hausse" },
  "dashboard.decliners": { tr: "düşen", en: "declining", fr: "en baisse" },
  "dashboard.unchanged": { tr: "yatay", en: "unchanged", fr: "inchangées" },
  "dashboard.topGainers": { tr: "En çok yükselenler", en: "Top gainers", fr: "Plus fortes hausses" },
  "dashboard.topLosers": { tr: "En çok düşenler", en: "Top losers", fr: "Plus fortes baisses" },
  "dashboard.universeBist100": { tr: "BIST 100 hisseleri", en: "BIST 100 stocks", fr: "Actions du BIST 100" },
  "dashboard.universeAll": { tr: "Tüm BIST hisseleri", en: "All BIST stocks", fr: "Toutes les actions BIST" },
  "dashboard.moversUnavailable": { tr: "Hisse hareketleri şu an alınamıyor", en: "Stock movers are unavailable right now", fr: "Mouvements des actions indisponibles pour le moment" },
  "dashboard.updatedAt": { tr: "Son güncelleme {time}", en: "Updated {time}", fr: "Mis à jour à {time}" },
  "dashboard.sessionHours": { tr: "Seans 10:00–18:00 (İstanbul)", en: "Session 10:00–18:00 (Istanbul)", fr: "Séance 10:00–18:00 (Istanbul)" },
  "market.preOpen": { tr: "Açılış 10:00", en: "Opens 10:00", fr: "Ouverture 10:00" },
  "market.afterClose": { tr: "Seans kapandı", en: "Session closed", fr: "Séance terminée" },
  "market.weekend": { tr: "Hafta sonu", en: "Weekend", fr: "Week-end" },
  "market.noTrading": { tr: "Bugün işlem yok", en: "No trading today", fr: "Pas de séance aujourd'hui" },
  "chart.periodSelect": { tr: "Grafik dönemi", en: "Chart period", fr: "Période du graphique" },
  "chart.lastSession": { tr: "Son seans", en: "Last session", fr: "Dernière séance" },
  "chart.ariaLabel": { tr: "BIST 100 fiyat grafiği", en: "BIST 100 price chart", fr: "Graphique du BIST 100" },
  "chart.loadError": { tr: "BIST 100 grafiği yüklenemedi", en: "Could not load the BIST 100 chart", fr: "Impossible de charger le graphique du BIST 100" },
  "period.1d": { tr: "1G", en: "1D", fr: "1J" },
  "period.5d": { tr: "5G", en: "5D", fr: "5J" },
  "period.1mo": { tr: "1A", en: "1M", fr: "1M" },
  "period.3mo": { tr: "3A", en: "3M", fr: "3M" },
  "period.6mo": { tr: "6A", en: "6M", fr: "6M" },
  "period.ytd": { tr: "YBB", en: "YTD", fr: "YTD" },
  "period.1y": { tr: "1Y", en: "1Y", fr: "1A" },
  "period.5y": { tr: "5Y", en: "5Y", fr: "5A" },
  "period.max": { tr: "Maks.", en: "Max", fr: "Max" },
  "index.periodReturn": { tr: "Dönem getirisi", en: "Period return", fr: "Rendement de la période" },
  "indices.loadError": { tr: "Endeks verileri yüklenemedi", en: "Could not load index data", fr: "Impossible de charger les indices" },
  "watchlist.done": { tr: "Bitti", en: "Done", fr: "Terminé" },
  "watchlist.remove": { tr: "{ticker} hissesini listeden çıkar", en: "Remove {ticker} from the list", fr: "Retirer {ticker} de la liste" },
  "watchlist.addHint": { tr: "Listeye eklemek için hisse arayın", en: "Search for a stock to add it", fr: "Recherchez une action à ajouter" },
  "watchlist.alreadyInList": { tr: "{ticker} zaten bu listede", en: "{ticker} is already in this list", fr: "{ticker} est déjà dans cette liste" },
  "watchlist.deleteConfirm": { tr: "“{name}” listesi silinsin mi?", en: "Delete the list “{name}”?", fr: "Supprimer la liste « {name} » ?" },
  "watchlist.quoteError": { tr: "Takip listesi fiyatları yüklenemedi", en: "Could not load watchlist prices", fr: "Impossible de charger les cours de la liste" },
  "watchlist.dayRange": { tr: "Gün aralığı", en: "Day range", fr: "Fourchette du jour" },
  "watchlist.lists": { tr: "Takip listeleri", en: "Watchlists", fr: "Listes de suivi" },
  "events.loadError": { tr: "Son gelişmeler yüklenemedi", en: "Could not load the latest developments", fr: "Impossible de charger les dernières nouvelles" },
  "events.staleBadge": { tr: "Güncel değil", en: "Outdated", fr: "Pas à jour" },
  "events.staleHint": { tr: "En yeni bildirim {time}. KAP akışı şu an güncellenmiyor olabilir.", en: "Newest disclosure {time}. The KAP feed may not be updating.", fr: "Dernière publication {time}. Le flux KAP n'est peut-être pas à jour." },
  "common.viewAll": { tr: "Tümünü gör", en: "View all", fr: "Tout voir" },
  "common.dataLoadError": { tr: "Veri yüklenemedi", en: "Could not load data", fr: "Impossible de charger les données" },
  "common.searching": { tr: "Aranıyor…", en: "Searching…", fr: "Recherche…" },
  "search.label": { tr: "Hisse ara", en: "Search stocks", fr: "Rechercher une action" },
  "search.noResults": { tr: "Eşleşen hisse bulunamadı", en: "No matching stock found", fr: "Aucune action correspondante" },
  "search.unavailable": { tr: "Arama geçici olarak kullanılamıyor", en: "Search is temporarily unavailable", fr: "La recherche est temporairement indisponible" },
  "search.hint": { tr: "{count} sonuç · ↑↓ gez · Enter seç · Esc kapat", en: "{count} results · ↑↓ navigate · Enter select · Esc close", fr: "{count} résultats · ↑↓ naviguer · Entrée choisir · Échap fermer" },
  "shell.openMenu": { tr: "Menüyü aç", en: "Open menu", fr: "Ouvrir le menu" },
  "shell.closeMenu": { tr: "Menüyü kapat", en: "Close menu", fr: "Fermer le menu" },
  "shell.mainNav": { tr: "Ana menü", en: "Main navigation", fr: "Navigation principale" },
  "shell.home": { tr: "Hisse Analizi ana sayfa", en: "Hisse Analizi home", fr: "Accueil Hisse Analizi" },
  "shell.tagline": { tr: "BIST piyasa analizi", en: "BIST market analytics", fr: "Analyse du marché BIST" },
  "shell.openSearch": { tr: "Hisse ara", en: "Search stocks", fr: "Rechercher une action" },
  "shell.closeSearch": { tr: "Aramayı kapat", en: "Close search", fr: "Fermer la recherche" },
  "shell.breadcrumb": { tr: "Sayfa konumu", en: "Breadcrumb", fr: "Fil d'Ariane" },
  "shell.skipToContent": { tr: "İçeriğe geç", en: "Skip to content", fr: "Aller au contenu" },
  "shell.language": { tr: "Dil", en: "Language", fr: "Langue" },
  "shell.theme": { tr: "Tema", en: "Theme", fr: "Thème" },
  "theme.toLight": { tr: "Açık temaya geç", en: "Switch to light theme", fr: "Passer au thème clair" },
  "theme.toDark": { tr: "Koyu temaya geç", en: "Switch to dark theme", fr: "Passer au thème sombre" },
  "status.title": { tr: "Veri durumu", en: "Data status", fr: "État des données" },
  "status.fresh": { tr: "Veriler güncel", en: "Data is up to date", fr: "Données à jour" },
  "status.stale": { tr: "Veri akışı gecikmede", en: "Data feed delayed", fr: "Flux de données en retard" },
  "status.unknown": { tr: "Veri durumu alınamadı", en: "Data status unavailable", fr: "État des données indisponible" },
  "status.never": { tr: "henüz çalışmadı", en: "never ran", fr: "jamais exécuté" },
  "status.failures": { tr: "{count} ardışık hata", en: "{count} consecutive failures", fr: "{count} échecs consécutifs" },
  "status.source.kap": { tr: "KAP bildirimleri", en: "KAP disclosures", fr: "Publications KAP" },
  "status.source.price": { tr: "Fiyat kayıtları", en: "Price records", fr: "Historique des prix" },
  "status.source.financials": { tr: "Finansal tablolar", en: "Financial statements", fr: "États financiers" },
  "status.totals": { tr: "{events} olay · {prices} fiyat kaydı", en: "{events} events · {prices} price records", fr: "{events} événements · {prices} cours enregistrés" },
  "error.title": { tr: "Beklenmeyen bir hata oluştu", en: "Something went wrong", fr: "Une erreur inattendue s'est produite" },
  "error.description": { tr: "Bu ekran yüklenirken bir sorun oluştu. İşlemi güvenle yeniden deneyebilirsiniz.", en: "This screen failed to load. You can safely try again.", fr: "Cet écran n'a pas pu se charger. Vous pouvez réessayer sans risque." },
  "error.appTitle": { tr: "Uygulama yüklenemedi", en: "The app failed to load", fr: "L'application n'a pas pu se charger" },
  "error.appDescription": { tr: "Beklenmeyen bir sorun oluştu. Verileriniz etkilenmedi; sayfayı yeniden deneyebilirsiniz.", en: "An unexpected problem occurred. Your data is safe; you can reload the page.", fr: "Un problème inattendu est survenu. Vos données sont intactes ; vous pouvez recharger la page." },
  "error.code": { tr: "Hata kodu", en: "Error code", fr: "Code d'erreur" },
  "error.backHome": { tr: "Piyasa özetine dön", en: "Back to market overview", fr: "Retour à l'aperçu du marché" },
  "notFound.title": { tr: "Sayfa bulunamadı", en: "Page not found", fr: "Page introuvable" },
  "notFound.description": { tr: "Aradığınız sayfa taşınmış veya kaldırılmış olabilir.", en: "The page you are looking for may have been moved or removed.", fr: "La page que vous cherchez a peut-être été déplacée ou supprimée." },
  "meta.title": { tr: "Hisse Analizi — BIST piyasa analizi", en: "Hisse Analizi — BIST market analytics", fr: "Hisse Analizi — analyse du marché BIST" },
  "meta.description": { tr: "Borsa İstanbul hisseleri için piyasa özeti, teknik ve temel analiz, makro veriler ve KAP bildirimleri.", en: "Market overview, technical and fundamental analysis, macro data and KAP disclosures for Borsa Istanbul stocks.", fr: "Aperçu du marché, analyses technique et fondamentale, données macro et publications KAP pour les actions de Borsa Istanbul." },

  // Quick actions

  // BIST 100 / Index Chart
  "index.periodStart": { tr: "Dönem başı", en: "Period start", fr: "Début de période" },
  "index.today": { tr: "bugün", en: "today", fr: "aujourd'hui" },
  "index.5days": { tr: "5 gün", en: "5 days", fr: "5 jours" },
  "index.1month": { tr: "1 ay", en: "1 month", fr: "1 mois" },
  "index.3months": { tr: "3 ay", en: "3 months", fr: "3 mois" },
  "index.6months": { tr: "6 ay", en: "6 months", fr: "6 mois" },
  "index.ytd": { tr: "yıl başından", en: "year to date", fr: "depuis le début de l'année" },
  "index.1year": { tr: "1 yıl", en: "1 year", fr: "1 an" },
  "index.5years": { tr: "5 yıl", en: "5 years", fr: "5 ans" },
  "index.allTime": { tr: "tüm zamanlar", en: "all time", fr: "depuis le début" },
  "index.prevClose": { tr: "Önceki kapanış", en: "Previous close", fr: "Clôture précédente" },
  "index.open": { tr: "Açılış", en: "Open", fr: "Ouverture" },
  "index.high": { tr: "Yüksek", en: "High", fr: "Haut" },
  "index.low": { tr: "Düşük", en: "Low", fr: "Bas" },
  "index.volume": { tr: "Hacim", en: "Volume", fr: "Volume" },
  "index.periodHigh": { tr: "Dönem Yüksek", en: "Period High", fr: "Plus haut de la période" },
  "index.periodLow": { tr: "Dönem Düşük", en: "Period Low", fr: "Plus bas de la période" },
  "index.52wHigh": { tr: "52H Yüksek", en: "52W High", fr: "Plus haut 52S" },
  "index.52wLow": { tr: "52H Düşük", en: "52W Low", fr: "Plus bas 52S" },

  // Hisse (Stock Analysis) Page

  // Temel (Fundamental) Page
  "temel.marketCap": { tr: "Piyasa Değeri", en: "Market Cap", fr: "Capitalisation boursière" },

  // Teknik (Technical) Page
  "teknik.value": { tr: "Değer", en: "Value", fr: "Valeur" },

  // Events Page
  "events.title": { tr: "Olaylar & KAP Bildirimleri", en: "Events & KAP Disclosures", fr: "Événements & Déclarations KAP" },
  "events.subtitle": { tr: "Tüm KAP bildirimleri, haberler ve fiyat olayları", en: "All KAP disclosures, news, and price events", fr: "Toutes les déclarations KAP, actualités et événements" },
  "events.detail": { tr: "Olay Detayı", en: "Event Detail", fr: "Détail de l'événement" },
  "events.detailNotFound": { tr: "Olay detayı bulunamadı", en: "Event detail not found", fr: "Détail introuvable" },
  "events.untitled": { tr: "Başlıksız", en: "Untitled", fr: "Sans titre" },
  "events.goToSource": { tr: "Kaynağa git", en: "Go to source", fr: "Aller à la source" },
  "events.additionalInfo": { tr: "Ek Bilgiler", en: "Additional Info", fr: "Informations supplémentaires" },
  "events.noEventsForTicker": { tr: "için olay bulunamadı — daha kısa bir arama deneyin", en: "no events found — try a shorter search", fr: "aucun événement trouvé — essayez une recherche plus courte" },
  "events.noEventsFiltered": { tr: "Filtreye uygun olay bulunamadı", en: "No events match the filter", fr: "Aucun événement correspondant" },
  "events.searchTicker": { tr: "Ticker ara (örn: THY, GAR...)", en: "Search ticker (e.g., THY, GAR...)", fr: "Rechercher (ex: THY, GAR...)" },
  "events.date": { tr: "Tarih", en: "Date", fr: "Date" },
  "events.ticker": { tr: "Ticker", en: "Ticker", fr: "Ticker" },
  "events.source": { tr: "Kaynak", en: "Source", fr: "Source" },
  "events.heading": { tr: "Başlık", en: "Title", fr: "Titre" },
  "events.category": { tr: "Kategori", en: "Category", fr: "Catégorie" },
  "events.severity": { tr: "Önem", en: "Severity", fr: "Gravité" },
  "events.dateFrom": { tr: "Başlangıç", en: "From", fr: "Du" },
  "events.dateTo": { tr: "Bitiş", en: "To", fr: "Au" },

  // Tarama (Screening) Page
  "tarama.results": { tr: "Hisse Tarama Sonuçları", en: "Stock Screening Results", fr: "Résultats du filtrage" },
  "tarama.noResults": { tr: "Sonuç yok", en: "No results", fr: "Aucun résultat" },
  "tarama.change": { tr: "Değişim", en: "Change", fr: "Variation" },
  "tarama.price": { tr: "Fiyat", en: "Price", fr: "Prix" },
  "tarama.signalScanning": { tr: "Teknik Sinyal Tarama", en: "Technical Signal Scanning", fr: "Analyse des signaux techniques" },
  "tarama.rsiOversold": { tr: "RSI Aşırı Satım", en: "RSI Oversold", fr: "RSI Survente" },
  "tarama.rsiOverbought": { tr: "RSI Aşırı Alım", en: "RSI Overbought", fr: "RSI Surachat" },
  "tarama.scanNoResults": { tr: "Tarama sonucu yok", en: "No scan results", fr: "Aucun résultat d'analyse" },
  "tarama.signal": { tr: "Sinyal", en: "Signal", fr: "Signal" },
  "tarama.screenerDesc": { tr: "Screener, sinyal tarama ve endeks verileri", en: "Screener, signal scanning, and index data", fr: "Screener, analyse de signaux et données d'indices" },
  "tarama.bistIndices": { tr: "BIST Endeksleri", en: "BIST Indices", fr: "Indices BIST" },

  // Makro Page
  "makro.tcmbFx": { tr: "TCMB, enflasyon, döviz kurları, ekonomik takvim", en: "CBRT, inflation, exchange rates, economic calendar", fr: "CBRT, inflation, taux de change, calendrier économique" },
  "makro.policyRate": { tr: "Politika Faizi", en: "Policy Rate", fr: "Taux directeur" },
  "makro.weeklyRepo": { tr: "TCMB Haftalık Repo", en: "CBRT Weekly Repo", fr: "Repo hebdomadaire CBRT" },
  "makro.inflation": { tr: "Enflasyon (TÜFE)", en: "Inflation (CPI)", fr: "Inflation (IPC)" },
  "makro.yearlyCpi": { tr: "Yıllık TÜFE", en: "Yearly CPI", fr: "IPC annuel" },
  "makro.monthly": { tr: "Aylık:", en: "Monthly:", fr: "Mensuel:" },
  "makro.calendar": { tr: "Ekonomik Takvim", en: "Economic Calendar", fr: "Calendrier économique" },
  "makro.noCalendar": { tr: "Takvim verisi yok", en: "No calendar data", fr: "Aucune donnée de calendrier" },
  "makro.noData": { tr: "Veri yok", en: "No data", fr: "Pas de données" },
  "makro.lastDecisionDate": { tr: "Son karar tarihi", en: "Last decision date", fr: "Date de dernière décision" },

  // Severity
  "severity.high": { tr: "Yüksek", en: "High", fr: "Élevé" },
  "severity.medium": { tr: "Orta", en: "Medium", fr: "Moyen" },
  "severity.info": { tr: "Bilgi", en: "Info", fr: "Info" },

  // Category
  "category.dividend": { tr: "Temettü", en: "Dividend", fr: "Dividende" },
  "category.capitalIncrease": { tr: "Sermaye Artırımı", en: "Capital Increase", fr: "Augmentation de capital" },
  "category.legal": { tr: "Hukuki", en: "Legal", fr: "Juridique" },
  "category.management": { tr: "Yönetim", en: "Management", fr: "Direction" },
  "category.financial": { tr: "Finansal", en: "Financial", fr: "Financier" },
  "category.newBusiness": { tr: "Yeni İş", en: "New Business", fr: "Nouvelle activité" },
  "category.other": { tr: "Diğer", en: "Other", fr: "Autre" },

  // Analiz (Combined) page

  // Watchlist
  "watchlist.newList": { tr: "Yeni Liste", en: "New List", fr: "Nouvelle liste" },
  "watchlist.editLists": { tr: "Listeleri Düzenle", en: "Edit Lists", fr: "Modifier les listes" },
  "watchlist.listName": { tr: "Liste Adı", en: "List Name", fr: "Nom de la liste" },
  "watchlist.deleteList": { tr: "Listeyi Sil", en: "Delete List", fr: "Supprimer la liste" },
  "watchlist.emptyList": { tr: "Bu listede hisse yok", en: "No stocks in this list", fr: "Aucune action dans cette liste" },
  "watchlist.favorites": { tr: "Favoriler", en: "Favorites", fr: "Favoris" },

  // Events summary
  "events.summary": { tr: "Ozet", en: "Summary", fr: "Résumé" },

  // Tarama pagination
  "tarama.page": { tr: "Sayfa", en: "Page", fr: "Page" },

  // Signal labels
  "signal.buy": { tr: "AL", en: "BUY", fr: "ACHAT" },
  "signal.sell": { tr: "SAT", en: "SELL", fr: "VENTE" },
  "signal.neutral": { tr: "NÖTR", en: "NEUTRAL", fr: "NEUTRE" },
  "signal.strongBuy": { tr: "Güçlü Al", en: "Strong Buy", fr: "Achat fort" },
  "signal.strongSell": { tr: "Güçlü Sat", en: "Strong Sell", fr: "Vente forte" },

  // Risk badges

  // Moving Averages & Pivots
  "ma.title": { tr: "Hareketli Ortalamalar (SMA & EMA)", en: "Moving Averages (SMA & EMA)", fr: "Moyennes mobiles (SMA & EMA)" },
  "ma.period": { tr: "Periyot", en: "Period", fr: "Période" },
  "pivots.title": { tr: "Klasik Pivot Destek ve Direnç Seviyeleri", en: "Classic Pivot Support & Resistance Levels", fr: "Niveaux de support & résistance pivot classique" },
  "pivots.support": { tr: "Destek Seviyeleri", en: "Support Levels", fr: "Niveaux de support" },
  "pivots.resistance": { tr: "Direnç Seviyeleri", en: "Resistance Levels", fr: "Niveaux de résistance" },

  // Scorecard
} as const;

export type TranslationKey = keyof typeof translations;

/** Values for `{name}` placeholders in a translation. */
export type TranslationVars = Record<string, string | number>;

export function t(key: TranslationKey, locale: Locale, vars?: TranslationVars): string {
  const entry = translations[key];
  if (!entry) return key;
  const text: string = entry[locale] ?? entry.tr;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Native language names for the language switcher. */
export const localeNames: Record<Locale, string> = {
  tr: "Türkçe",
  en: "English",
  fr: "Français",
};

export const LOCALES: readonly Locale[] = ["tr", "en", "fr"];

/** Narrow an arbitrary string (cookie, storage) to a supported locale. */
export function parseLocale(value: unknown): Locale | null {
  return value === "tr" || value === "en" || value === "fr" ? value : null;
}

/** Cookie that carries the UI language so the server renders the right one. */
export const LOCALE_COOKIE = "locale";

export default translations;
