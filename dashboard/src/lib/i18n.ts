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
  "common.records": { tr: "kayıt", en: "records", fr: "enregistrements" },
  "common.stock": { tr: "hisse", en: "stock", fr: "action" },
  "common.stocks": { tr: "hisse", en: "stocks", fr: "actions" },
  "common.search": { tr: "Hisse ara... (THYAO, GARAN)", en: "Search stock... (THYAO, GARAN)", fr: "Rechercher... (THYAO, GARAN)" },

  // Navigation / Breadcrumbs
  "nav.dashboard": { tr: "Dashboard", en: "Dashboard", fr: "Tableau de bord" },
  "nav.events": { tr: "Olaylar & KAP", en: "Events & KAP", fr: "Événements & KAP" },
  "nav.stockAnalysis": { tr: "Hisse Analizi", en: "Stock Analysis", fr: "Analyse d'actions" },
  "nav.technicalAnalysis": { tr: "Teknik Analiz", en: "Technical Analysis", fr: "Analyse technique" },
  "nav.fundamentalAnalysis": { tr: "Temel Analiz", en: "Fundamental Analysis", fr: "Analyse fondamentale" },
  "nav.macroEconomy": { tr: "Makro Ekonomi", en: "Macro Economy", fr: "Macro-économie" },
  "nav.screening": { tr: "Hisse Tarama", en: "Stock Screening", fr: "Filtrage d'actions" },
  "nav.technical": { tr: "Teknik", en: "Technical", fr: "Technique" },
  "nav.fundamental": { tr: "Fundamental", en: "Fundamental", fr: "Fondamental" },

  // Dashboard
  "dashboard.marketOverview": { tr: "Piyasa Özeti", en: "Market Overview", fr: "Aperçu du marché" },
  "dashboard.marketOpen": { tr: "Piyasa Açık", en: "Market Open", fr: "Marché ouvert" },
  "dashboard.marketClosed": { tr: "Piyasa Kapalı", en: "Market Closed", fr: "Marché fermé" },
  "dashboard.systemStatus": { tr: "Sistem Durumu", en: "System Status", fr: "État du système" },
  "dashboard.active": { tr: "Aktif", en: "Active", fr: "Actif" },
  "dashboard.eventsProcessed": { tr: "olay işlendi", en: "events processed", fr: "événements traités" },
  "dashboard.priceRecords": { tr: "Fiyat Kaydı", en: "Price Records", fr: "Enregistrements de prix" },
  "dashboard.rawEvents": { tr: "Ham Olay", en: "Raw Events", fr: "Événements bruts" },
  "dashboard.pending": { tr: "Bekleyen", en: "Pending", fr: "En attente" },
  "dashboard.marketPulse": { tr: "Piyasa Nabzı", en: "Market Pulse", fr: "Pouls du marché" },
  "dashboard.latestDevelopments": { tr: "Son Gelişmeler", en: "Latest Developments", fr: "Dernières nouvelles" },
  "dashboard.allReports": { tr: "Tüm raporlar", en: "All reports", fr: "Tous les rapports" },
  "dashboard.noEventsYet": { tr: "Henüz olay kaydedilmemiş", en: "No events recorded yet", fr: "Aucun événement enregistré" },
  "dashboard.watchlist": { tr: "Takip Listesi", en: "Watchlist", fr: "Liste de suivi" },
  "dashboard.chartNoData": { tr: "Grafik verisi bulunamadı", en: "No chart data found", fr: "Aucune donnée graphique" },
  "dashboard.detailedAnalysis": { tr: "Detaylı hisse analizi", en: "Detailed stock analysis", fr: "Analyse détaillée des actions" },

  // Quick actions
  "quick.stockAnalysis": { tr: "Hisse Analizi", en: "Stock Analysis", fr: "Analyse d'actions" },
  "quick.technicalAnalysis": { tr: "Teknik Analiz", en: "Technical Analysis", fr: "Analyse technique" },
  "quick.screening": { tr: "Hisse Tarama", en: "Stock Screening", fr: "Filtrage d'actions" },
  "quick.rsiMacdBollinger": { tr: "RSI, MACD, Bollinger", en: "RSI, MACD, Bollinger", fr: "RSI, MACD, Bollinger" },
  "quick.filteredScreening": { tr: "Filtreli tarama", en: "Filtered screening", fr: "Filtrage avancé" },

  // BIST 100 / Index Chart
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
  "index.close": { tr: "Kapanış", en: "Close", fr: "Clôture" },
  "index.volume": { tr: "Hacim", en: "Volume", fr: "Volume" },
  "index.periodHigh": { tr: "Dönem Yüksek", en: "Period High", fr: "Plus haut de la période" },
  "index.periodLow": { tr: "Dönem Düşük", en: "Period Low", fr: "Plus bas de la période" },
  "index.52wHigh": { tr: "52H Yüksek", en: "52W High", fr: "Plus haut 52S" },
  "index.52wLow": { tr: "52H Düşük", en: "52W Low", fr: "Plus bas 52S" },

  // Hisse (Stock Analysis) Page
  "hisse.priceChart": { tr: "Fiyat Grafiği", en: "Price Chart", fr: "Graphique des prix" },
  "hisse.noPriceData": { tr: "Fiyat verisi bulunamadı", en: "No price data found", fr: "Aucune donnée de prix trouvée" },
  "hisse.financialRatios": { tr: "Finansal Oranlar", en: "Financial Ratios", fr: "Ratios financiers" },
  "hisse.ratiosLoadError": { tr: "Finansal oranlar yüklenemedi", en: "Failed to load financial ratios", fr: "Échec du chargement des ratios" },
  "hisse.noRatios": { tr: "Bu hisse için finansal oran verisi henüz yok", en: "No financial ratio data for this stock yet", fr: "Pas encore de ratios financiers pour cette action" },
  "hisse.someRatiosMissing": { tr: "Bazı oranlar bu hisse için hesaplanamamıştır", en: "Some ratios could not be calculated for this stock", fr: "Certains ratios n'ont pas pu être calculés" },
  "hisse.recentEvents": { tr: "Son Olaylar", en: "Recent Events", fr: "Événements récents" },
  "hisse.noEvents": { tr: "Bu hisse için henüz olay kaydedilmemiş", en: "No events recorded for this stock yet", fr: "Aucun événement enregistré pour cette action" },
  "hisse.grossMargin": { tr: "Brüt Kâr Marjı", en: "Gross Margin", fr: "Marge brute" },
  "hisse.ebitdaMargin": { tr: "FAVÖK Marjı", en: "EBITDA Margin", fr: "Marge EBITDA" },
  "hisse.netMargin": { tr: "Net Kâr Marjı", en: "Net Margin", fr: "Marge nette" },
  "hisse.currentRatio": { tr: "Cari Oran", en: "Current Ratio", fr: "Ratio courant" },
  "hisse.netDebtEbitda": { tr: "Net Borç/FAVÖK", en: "Net Debt/EBITDA", fr: "Dette nette/EBITDA" },
  "hisse.debtToEquity": { tr: "Borç/Özsermaye", en: "Debt/Equity", fr: "Dette/Fonds propres" },
  "hisse.peRatio": { tr: "F/K", en: "P/E", fr: "PER" },

  // Temel (Fundamental) Page
  "temel.companyInfo": { tr: "Şirket Bilgileri", en: "Company Information", fr: "Informations sur l'entreprise" },
  "temel.noCompanyInfo": { tr: "Şirket bilgisi bulunamadı — bu hisse için veri mevcut olmayabilir", en: "Company info not found — data may not be available for this stock", fr: "Informations introuvables — les données peuvent ne pas être disponibles" },
  "temel.name": { tr: "İsim", en: "Name", fr: "Nom" },
  "temel.sector": { tr: "Sektör", en: "Sector", fr: "Secteur" },
  "temel.marketCap": { tr: "Piyasa Değeri", en: "Market Cap", fr: "Capitalisation boursière" },
  "temel.dividendYield": { tr: "Temettü Verimi", en: "Dividend Yield", fr: "Rendement du dividende" },
  "temel.lastPrice": { tr: "Son Fiyat", en: "Last Price", fr: "Dernier prix" },
  "temel.52wHighLow": { tr: "52H Yüksek/Düşük", en: "52W High/Low", fr: "52S Haut/Bas" },
  "temel.employees": { tr: "Çalışan", en: "Employees", fr: "Employés" },
  "temel.website": { tr: "Web", en: "Website", fr: "Site web" },
  "temel.priceTarget": { tr: "Hedef Fiyat", en: "Price Target", fr: "Objectif de cours" },
  "temel.noPriceTarget": { tr: "Hedef fiyat yok", en: "No price target", fr: "Pas d'objectif de cours" },
  "temel.currentPrice": { tr: "Mevcut Fiyat", en: "Current Price", fr: "Prix actuel" },
  "temel.lowTarget": { tr: "Düşük Hedef", en: "Low Target", fr: "Objectif bas" },
  "temel.avgTarget": { tr: "Ortalama Hedef", en: "Average Target", fr: "Objectif moyen" },
  "temel.medianTarget": { tr: "Medyan Hedef", en: "Median Target", fr: "Objectif médian" },
  "temel.highTarget": { tr: "Yüksek Hedef", en: "High Target", fr: "Objectif haut" },
  "temel.analystCount": { tr: "Analist Sayısı", en: "Analyst Count", fr: "Nombre d'analystes" },
  "temel.majorHolders": { tr: "Büyük Ortaklar", en: "Major Holders", fr: "Principaux actionnaires" },
  "temel.noHolders": { tr: "Ortaklık verisi yok", en: "No holders data", fr: "Aucune donnée" },

  // Teknik (Technical) Page
  "teknik.signalNoData": { tr: "Sinyal verisi alınamadı", en: "Could not fetch signal data", fr: "Impossible de récupérer les signaux" },
  "teknik.overbought": { tr: "Aşırı Alım", en: "Overbought", fr: "Surachat" },
  "teknik.oversold": { tr: "Aşırı Satım", en: "Oversold", fr: "Survente" },
  "teknik.neutral": { tr: "Nötr", en: "Neutral", fr: "Neutre" },
  "teknik.normalZone": { tr: "Normal Bölge", en: "Normal Zone", fr: "Zone normale" },
  "teknik.overboughtZone": { tr: "Aşırı Alım Bölgesi", en: "Overbought Zone", fr: "Zone de surachat" },
  "teknik.oversoldZone": { tr: "Aşırı Satım Bölgesi", en: "Oversold Zone", fr: "Zone de survente" },
  "teknik.rsiIndicator": { tr: "RSI Göstergesi", en: "RSI Indicator", fr: "Indicateur RSI" },
  "teknik.bollingerBands": { tr: "Bollinger Bantları", en: "Bollinger Bands", fr: "Bandes de Bollinger" },
  "teknik.upper": { tr: "Üst", en: "Upper", fr: "Supérieure" },
  "teknik.middle": { tr: "Orta", en: "Middle", fr: "Médiane" },
  "teknik.lower": { tr: "Alt", en: "Lower", fr: "Inférieure" },
  "teknik.signals": { tr: "Sinyaller", en: "Signals", fr: "Signaux" },
  "teknik.up": { tr: "YUKARI", en: "UP", fr: "HAUT" },
  "teknik.down": { tr: "AŞAĞI", en: "DOWN", fr: "BAS" },
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
  "events.news": { tr: "Haberler", en: "News", fr: "Actualités" },

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
  "analiz.combined": { tr: "Kombine Analiz", en: "Combined Analysis", fr: "Analyse combinée" },
  "analiz.sideBySide": { tr: "Yan Yana", en: "Side by Side", fr: "Côte à côte" },
  "analiz.noCompanyInfo": { tr: "Şirket bilgisi yok", en: "No company info", fr: "Aucune info" },

  // Watchlist
  "watchlist.title": { tr: "Takip Listesi", en: "Watchlist", fr: "Liste de suivi" },
  "watchlist.newList": { tr: "Yeni Liste", en: "New List", fr: "Nouvelle liste" },
  "watchlist.editLists": { tr: "Listeleri Duzenle", en: "Edit Lists", fr: "Modifier les listes" },
  "watchlist.addStock": { tr: "Hisse Ekle", en: "Add Stock", fr: "Ajouter une action" },
  "watchlist.listName": { tr: "Liste Adi", en: "List Name", fr: "Nom de la liste" },
  "watchlist.deleteList": { tr: "Listeyi Sil", en: "Delete List", fr: "Supprimer la liste" },
  "watchlist.emptyList": { tr: "Bu listede hisse yok", en: "No stocks in this list", fr: "Aucune action dans cette liste" },
  "watchlist.favorites": { tr: "Favoriler", en: "Favorites", fr: "Favoris" },
  "watchlist.potential": { tr: "Potansiyel Yukselis", en: "Potential Rise", fr: "Hausse potentielle" },

  // AI Report
  "ai.reportButton": { tr: "AI Analiz Raporu", en: "AI Analysis Report", fr: "Rapport d'analyse IA" },
  "ai.reportDesc": { tr: "Yapay zeka destekli detayli finansal analiz raporu", en: "AI-powered detailed financial analysis report", fr: "Rapport d'analyse financière détaillé par IA" },
  "ai.generating": { tr: "Rapor hazirlaniyor...", en: "Generating report...", fr: "Génération du rapport..." },
  "ai.reportTitle": { tr: "AI Finansal Analiz Raporu", en: "AI Financial Analysis Report", fr: "Rapport d'analyse financière IA" },

  // Events summary
  "events.summary": { tr: "Ozet", en: "Summary", fr: "Résumé" },

  // Tarama pagination
  "tarama.page": { tr: "Sayfa", en: "Page", fr: "Page" },
  "tarama.perPage": { tr: "hisse/sayfa", en: "stocks/page", fr: "actions/page" },

  // Signal labels
  "signal.buy": { tr: "AL", en: "BUY", fr: "ACHAT" },
  "signal.sell": { tr: "SAT", en: "SELL", fr: "VENTE" },
  "signal.neutral": { tr: "NÖTR", en: "NEUTRAL", fr: "NEUTRE" },
  "signal.strongBuy": { tr: "Güçlü Al", en: "Strong Buy", fr: "Achat fort" },
  "signal.strongSell": { tr: "Güçlü Sat", en: "Strong Sell", fr: "Vente forte" },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, locale: Locale): string {
  const entry = translations[key];
  if (!entry) return key;
  return entry[locale] ?? entry.tr;
}

export default translations;
