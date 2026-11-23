import type { Locale } from "@/lib/i18n";

type Entry = { tr: string; en: string; fr: string };

/**
 * Strings of the widget system: the widget catalogue (names, one-line
 * descriptions), the layout editor and the custom pages (/sayfalarim). Same
 * {tr, en, fr} shape and {name} placeholders as the other dictionaries.
 */
const dict = {
  // Categories
  "category.all": { tr: "Tümü", en: "All", fr: "Tous" },
  "category.stock": { tr: "Hisse", en: "Stock", fr: "Action" },
  "category.market": { tr: "Piyasa", en: "Markets", fr: "Marchés" },
  "category.macro": { tr: "Makro", en: "Macro", fr: "Macro" },
  "category.general": { tr: "Genel", en: "General", fr: "Général" },

  // A widget's data scope, separate from its subject category.
  "scope.label": { tr: "Widget türü", en: "Widget scope", fr: "Type de widget" },
  "scope.stock": { tr: "Hisseye bağlı", en: "Stock-specific", fr: "Liés à une action" },
  "scope.general": { tr: "Genel widget'lar", en: "General widgets", fr: "Widgets généraux" },
  "scope.stockHint": { tr: "Fiyat, grafik, bilanço ve temettü gibi kartlar seçtiğiniz hisseye göre değişir. Her karta ayrı hisse de seçebilirsiniz.", en: "Prices, charts, statements and dividends follow the selected stock. Each card can also follow its own stock.", fr: "Cours, graphiques, comptes et dividendes suivent l'action choisie. Chaque carte peut aussi suivre sa propre action." },
  "scope.generalHint": { tr: "Piyasa, makro ekonomi, takvim, başlık ve notlar hisse seçiminden etkilenmez.", en: "Market, macro, calendar, heading and note widgets are independent of the selected stock.", fr: "Marchés, macroéconomie, calendrier, titres et notes ne dépendent pas de l'action choisie." },
  "scope.stockAdd": { tr: "Hisse widget'ı ekle", en: "Add stock widget", fr: "Ajouter un widget d'action" },
  "scope.generalAdd": { tr: "Genel widget ekle", en: "Add general widget", fr: "Ajouter un widget général" },

  // Stock widgets
  "w.stock.quote": { tr: "Fiyat özeti", en: "Key figures", fr: "Chiffres clés" },
  "w.stock.quote.desc": { tr: "Son fiyat, gün aralığı, hacim, piyasa değeri ve çarpanlar", en: "Last price, day range, volume, market cap and multiples", fr: "Dernier cours, fourchette, volume, capitalisation et multiples" },
  "w.stock.chart": { tr: "Fiyat grafiği", en: "Price chart", fr: "Graphique des cours" },
  "w.stock.chart.desc": { tr: "İndikatörler, çizimler ve karşılaştırma ile etkileşimli grafik", en: "Interactive chart with indicators, drawings and comparison", fr: "Graphique interactif avec indicateurs, tracés et comparaison" },
  "w.stock.scorecard": { tr: "Analiz karnesi", en: "Scorecard", fr: "Bulletin" },
  "w.stock.scorecard.desc": { tr: "Karlılık, büyüme, borçluluk ve değerlemenin özet notu", en: "Summary grade for profitability, growth, leverage and valuation", fr: "Note de synthèse : rentabilité, croissance, endettement, valorisation" },
  "w.stock.analysts": { tr: "Analist görüşleri", en: "Analyst views", fr: "Avis des analystes" },
  "w.stock.analysts.desc": { tr: "Al/tut/sat dağılımı ve hedef fiyatlar", en: "Buy/hold/sell split and price targets", fr: "Répartition achat/conserver/vente et objectifs de cours" },
  "w.stock.kap": { tr: "KAP bildirimleri", en: "KAP disclosures", fr: "Publications KAP" },
  "w.stock.kap.desc": { tr: "Şirketin son KAP açıklamaları", en: "The company's latest KAP filings", fr: "Dernières publications KAP de la société" },
  "w.stock.news": { tr: "Haberler", en: "News", fr: "Actualités" },
  "w.stock.news.desc": { tr: "Şirketle ilgili son haberler", en: "Latest news about the company", fr: "Dernières actualités sur la société" },
  "w.stock.ratios": { tr: "Finansal oranlar", en: "Financial ratios", fr: "Ratios financiers" },
  "w.stock.ratios.desc": { tr: "F/K, PD/DD, marjlar, ROE ve borçluluk oranları", en: "P/E, P/B, margins, ROE and leverage ratios", fr: "PER, C/VC, marges, ROE et ratios d'endettement" },
  "w.stock.signals": { tr: "Zaman dilimi sinyalleri", en: "Signals by timeframe", fr: "Signaux par horizon" },
  "w.stock.signals.desc": { tr: "Saatlikten aylığa teknik al/sat sinyalleri", en: "Technical buy/sell signals from hourly to monthly", fr: "Signaux techniques de l'horaire au mensuel" },
  "w.stock.sector": { tr: "Sektör karşılaştırması", en: "Sector comparison", fr: "Comparaison sectorielle" },
  "w.stock.similar": { tr: "Benzer şirketler", en: "Similar companies", fr: "Sociétés comparables" },
  "w.stock.similar.desc": { tr: "Alt sektör, büyüklük ve marjlara göre en yakın şirketler ve seçilme nedenleri", en: "Closest companies by sub-sector, size and margins, with the reason for each pick", fr: "Sociétés les plus proches par sous-secteur, taille et marges, avec la raison de chaque choix" },
  "w.stock.sector.desc": { tr: "Hissenin çarpanları sektör medyanına karşı", en: "The stock's multiples against the sector median", fr: "Les multiples de l'action face à la médiane du secteur" },
  "w.stock.dividends": { tr: "Temettü geçmişi", en: "Dividend history", fr: "Historique des dividendes" },
  "w.stock.dividends.desc": { tr: "Yıllara göre temettü dağıtımı ve verim", en: "Dividends paid by year and yield", fr: "Dividendes versés par année et rendement" },
  "w.stock.earnings": { tr: "Rapor takvimi", en: "Earnings calendar", fr: "Calendrier des résultats" },
  "w.stock.earnings.desc": { tr: "Geçmiş ve beklenen finansal rapor tarihleri", en: "Past and expected report dates", fr: "Dates de publication passées et attendues" },
  "w.stock.statements": { tr: "Finansal tablolar", en: "Financial statements", fr: "États financiers" },
  "w.stock.statements.desc": { tr: "Bilanço, gelir tablosu ve nakit akışı", en: "Balance sheet, income statement and cash flow", fr: "Bilan, compte de résultat et flux de trésorerie" },
  "w.stock.profile": { tr: "Şirket profili", en: "Company profile", fr: "Profil de la société" },
  "w.stock.profile.desc": { tr: "Faaliyet alanı, sektör ve iletişim bilgileri", en: "Business, sector and contact details", fr: "Activité, secteur et coordonnées" },
  "w.stock.holders": { tr: "Ortaklık yapısı", en: "Shareholders", fr: "Actionnariat" },
  "w.stock.holders.desc": { tr: "Büyük ortaklar ve halka açıklık oranı", en: "Major holders and free float", fr: "Principaux actionnaires et flottant" },
  "w.stock.technicalSummary": { tr: "Teknik özet", en: "Technical summary", fr: "Synthèse technique" },
  "w.stock.technicalSummary.desc": { tr: "Osilatör ve ortalamaların günlük ortak kararı", en: "Daily verdict of oscillators and moving averages", fr: "Verdict quotidien des oscillateurs et moyennes" },
  "w.stock.movingAverages": { tr: "Hareketli ortalamalar", en: "Moving averages", fr: "Moyennes mobiles" },
  "w.stock.movingAverages.desc": { tr: "SMA ve EMA seviyeleri ile sinyalleri", en: "SMA and EMA levels with their signals", fr: "Niveaux SMA et EMA avec leurs signaux" },
  "w.stock.indicators": { tr: "Teknik göstergeler", en: "Technical indicators", fr: "Indicateurs techniques" },
  "w.stock.indicators.desc": { tr: "RSI, MACD, stokastik ve diğer osilatörler", en: "RSI, MACD, stochastics and other oscillators", fr: "RSI, MACD, stochastique et autres oscillateurs" },
  "w.stock.pivots": { tr: "Pivot seviyeleri", en: "Pivot levels", fr: "Points pivots" },
  "w.stock.pivots.desc": { tr: "Klasik destek ve direnç seviyeleri", en: "Classic support and resistance levels", fr: "Supports et résistances classiques" },

  // Market widgets
  "w.market.index": { tr: "BIST 100 grafiği", en: "BIST 100 chart", fr: "Graphique du BIST 100" },
  "w.market.index.desc": { tr: "Endeksin canlı seviyesi ve dönem grafiği", en: "Live index level and period chart", fr: "Niveau en direct et graphique de la période" },
  "w.market.watchlist": { tr: "Takip listesi", en: "Watchlist", fr: "Liste de suivi" },
  "w.market.watchlist.desc": { tr: "Takip ettiğiniz hisselerin fiyatları", en: "Prices of the stocks you follow", fr: "Cours des actions que vous suivez" },
  "w.market.breadth": { tr: "Piyasa genişliği", en: "Market breadth", fr: "Largeur du marché" },
  "w.market.breadth.desc": { tr: "Yükselen/düşen dağılımı ve günün hareketlileri", en: "Advancers vs decliners and the day's movers", fr: "Hausses/baisses et plus fortes variations du jour" },
  "w.market.events": { tr: "Son KAP bildirimleri", en: "Latest KAP disclosures", fr: "Dernières publications KAP" },
  "w.market.events.desc": { tr: "Tüm şirketlerden en yeni açıklamalar", en: "The newest filings from every company", fr: "Les publications les plus récentes de toutes les sociétés" },

  // Macro widgets
  "w.macro.kpis": { tr: "Makro göstergeler şeridi", en: "Macro headline figures", fr: "Chiffres macro clés" },
  "w.macro.kpis.desc": { tr: "Politika faizi, enflasyon, kur ve tahvil özeti", en: "Policy rate, inflation, FX and bond summary", fr: "Taux directeur, inflation, change et obligations" },
  "w.macro.corridor": { tr: "Faiz koridoru", en: "Rate corridor", fr: "Corridor de taux" },
  "w.macro.corridor.desc": { tr: "TCMB politika faizi ve koridor oranları", en: "CBRT policy rate and corridor rates", fr: "Taux directeur et corridor de la CBRT" },
  "w.macro.policyInflation": { tr: "Faiz ve enflasyon", en: "Rates and inflation", fr: "Taux et inflation" },
  "w.macro.policyInflation.desc": { tr: "Politika faizi, enflasyon ve reel faiz grafiği", en: "Policy rate, inflation and real rate chart", fr: "Taux directeur, inflation et taux réel" },
  "w.macro.inflationTiles": { tr: "Enflasyon özeti", en: "Inflation summary", fr: "Synthèse de l'inflation" },
  "w.macro.inflationTiles.desc": { tr: "TÜFE ve ÜFE'nin yıllık ve aylık değerleri", en: "Annual and monthly CPI and PPI", fr: "IPC et IPP annuels et mensuels" },
  "w.macro.inflationTrend": { tr: "Enflasyon eğilimi", en: "Inflation trend", fr: "Tendance de l'inflation" },
  "w.macro.inflationTrend.desc": { tr: "Yıllık TÜFE ve ÜFE grafiği", en: "Annual CPI and PPI chart", fr: "Graphique IPC et IPP annuels" },
  "w.macro.monthlyCpi": { tr: "Aylık TÜFE", en: "Monthly CPI", fr: "IPC mensuel" },
  "w.macro.monthlyCpi.desc": { tr: "Aylık fiyat değişimleri", en: "Month-on-month price changes", fr: "Variations mensuelles des prix" },
  "w.macro.markets": { tr: "Döviz, altın ve tahvil", en: "FX, gold and bonds", fr: "Change, or et obligations" },
  "w.macro.markets.desc": { tr: "Kur ve emtia panosu, grafik ve getiri eğrisi", en: "FX and commodities board, chart and yield curve", fr: "Tableau change et matières, graphique et courbe des taux" },
  "w.macro.fxBulletin": { tr: "TCMB gösterge kurları", en: "CBRT indicative rates", fr: "Cours indicatifs de la CBRT" },
  "w.macro.fxBulletin.desc": { tr: "Günlük döviz alış/satış bülteni", en: "Daily FX buying/selling bulletin", fr: "Bulletin quotidien des cours d'achat/vente" },
  "w.macro.calendar": { tr: "Ekonomik takvim", en: "Economic calendar", fr: "Calendrier économique" },
  "w.macro.calendar.desc": { tr: "Beklenen veri açıklamaları ve sonuçlar", en: "Upcoming releases and results", fr: "Publications à venir et résultats" },
  "w.macro.activity": { tr: "Büyüme ve istihdam", en: "Growth and labour", fr: "Croissance et emploi" },
  "w.macro.activity.desc": { tr: "GSYH, sanayi üretimi, işsizlik ve güven endeksleri", en: "GDP, industrial output, unemployment and confidence", fr: "PIB, production, chômage et confiance" },
  "w.macro.external": { tr: "Dış denge ve maliye", en: "External balance and fiscal", fr: "Équilibre extérieur et finances" },
  "w.macro.external.desc": { tr: "Cari denge, rezervler, dış ticaret ve bütçe", en: "Current account, reserves, trade and budget", fr: "Compte courant, réserves, commerce et budget" },

  // General widgets
  "w.general.heading": { tr: "Başlık", en: "Heading", fr: "Titre" },
  "w.general.heading.desc": { tr: "Sayfayı bölümlere ayıran başlık", en: "A heading that splits the page into sections", fr: "Un titre qui découpe la page en sections" },
  "w.general.note": { tr: "Not", en: "Note", fr: "Note" },
  "w.general.note.desc": { tr: "Kendi notlarınız, hedefleriniz, hatırlatmalarınız", en: "Your own notes, targets and reminders", fr: "Vos notes, objectifs et rappels" },
  "heading.placeholder": { tr: "Başlık", en: "Heading", fr: "Titre" },
  "heading.fundamental": { tr: "Temel Analiz", en: "Fundamentals", fr: "Fondamentaux" },
  "heading.technical": { tr: "Teknik Analiz", en: "Technical", fr: "Technique" },
  "heading.monetary": { tr: "Para politikası", en: "Monetary policy", fr: "Politique monétaire" },
  "heading.inflation": { tr: "Enflasyon", en: "Inflation", fr: "Inflation" },
  "heading.markets": { tr: "Piyasalar", en: "Markets", fr: "Marchés" },
  "heading.calendar": { tr: "Ekonomik takvim", en: "Economic calendar", fr: "Calendrier économique" },
  "heading.activity": { tr: "Büyüme ve istihdam", en: "Growth and labour", fr: "Croissance et emploi" },
  "heading.external": { tr: "Dış denge, rezervler ve maliye", en: "External balance, reserves and fiscal", fr: "Équilibre extérieur, réserves et finances publiques" },
  "note.title": { tr: "Not", en: "Note", fr: "Note" },
  "note.empty": { tr: "Boş not. Düzenleme modunda widget menüsünden “Ayarlar” ile metin ekleyin.", en: "Empty note. In edit mode, add text from the widget menu's “Settings”.", fr: "Note vide. En mode édition, ajoutez du texte via « Réglages » dans le menu du widget." },

  // Widget options
  "opt.view": { tr: "Görünüm", en: "View", fr: "Vue" },
  "opt.view.overview": { tr: "Genel", en: "Overview", fr: "Vue d'ensemble" },
  "opt.view.technical": { tr: "Teknik (daha yüksek grafik)", en: "Technical (taller chart)", fr: "Technique (graphique plus haut)" },
  "opt.compact": { tr: "Kompakt görünüm", en: "Compact view", fr: "Vue compacte" },
  "opt.style": { tr: "Stil", en: "Style", fr: "Style" },
  "opt.style.section": { tr: "Bölüm başlığı", en: "Section title", fr: "Titre de section" },
  "opt.style.caps": { tr: "Küçük etiket", en: "Small label", fr: "Petite étiquette" },
  "opt.text": { tr: "Metin", en: "Text", fr: "Texte" },
  "opt.title": { tr: "Başlık", en: "Title", fr: "Titre" },

  // Editor
  "edit.button": { tr: "Düzenle", en: "Customize", fr: "Personnaliser" },
  "edit.buttonLabel": { tr: "Sayfa düzenini kişiselleştir", en: "Customize this page's layout", fr: "Personnaliser la mise en page" },
  "edit.done": { tr: "Bitti", en: "Done", fr: "Terminé" },
  "edit.mode": { tr: "Düzenleme modu", en: "Editing layout", fr: "Mode édition" },
  "edit.hint": { tr: "Kartları sürükleyin, kenarlarından boyutlandırın", en: "Drag cards to move them, pull an edge to resize", fr: "Glissez les cartes, tirez un bord pour redimensionner" },
  "edit.hintMobile": { tr: "Taşımak ve boyutlandırmak için kart menüsünü kullanın", en: "Use a card's menu to move or resize it", fr: "Utilisez le menu d'une carte pour la déplacer ou la redimensionner" },
  "edit.add": { tr: "Widget ekle", en: "Add widget", fr: "Ajouter un widget" },
  "edit.undo": { tr: "Geri al", en: "Undo", fr: "Annuler" },
  "edit.redo": { tr: "Yinele", en: "Redo", fr: "Rétablir" },
  "edit.reset": { tr: "Varsayılana dön", en: "Reset to default", fr: "Rétablir par défaut" },
  "edit.resetDone": { tr: "Varsayılan düzen geri yüklendi", en: "Default layout restored", fr: "Mise en page par défaut rétablie" },
  "edit.customized": { tr: "Kişisel düzen", en: "Custom layout", fr: "Mise en page perso" },
  "edit.toolbar": { tr: "Düzenleme araçları", en: "Layout tools", fr: "Outils de mise en page" },
  "edit.count": { tr: "{count} widget", en: "{count} widgets", fr: "{count} widgets" },

  // Widget frame (edit mode)
  "widget.drag": { tr: "{name}: taşımak için sürükleyin ya da ok tuşlarını kullanın", en: "{name}: drag to move, or use the arrow keys", fr: "{name} : glissez pour déplacer, ou utilisez les flèches" },
  "widget.menu": { tr: "{name} seçenekleri", en: "{name} options", fr: "Options de {name}" },
  "widget.remove": { tr: "Kaldır", en: "Remove", fr: "Retirer" },
  "widget.removeNamed": { tr: "{name} widget'ını kaldır", en: "Remove the {name} widget", fr: "Retirer le widget {name}" },
  "widget.removed": { tr: "{name} kaldırıldı", en: "{name} removed", fr: "{name} retiré" },
  "widget.width": { tr: "Genişlik", en: "Width", fr: "Largeur" },
  "widget.height": { tr: "Yükseklik", en: "Height", fr: "Hauteur" },
  "widget.move": { tr: "Taşı", en: "Move", fr: "Déplacer" },
  "widget.settings": { tr: "Ayarlar…", en: "Settings…", fr: "Réglages…" },
  "widget.settingsTitle": { tr: "{name} ayarları", en: "{name} settings", fr: "Réglages de {name}" },
  "widget.unknown": { tr: "Bu widget artık mevcut değil", en: "This widget is no longer available", fr: "Ce widget n'est plus disponible" },
  "width.3": { tr: "Çeyrek (1/4)", en: "Quarter (1/4)", fr: "Quart (1/4)" },
  "width.4": { tr: "Üçte bir (1/3)", en: "Third (1/3)", fr: "Tiers (1/3)" },
  "width.6": { tr: "Yarım (1/2)", en: "Half (1/2)", fr: "Moitié (1/2)" },
  "width.8": { tr: "Üçte iki (2/3)", en: "Two thirds (2/3)", fr: "Deux tiers (2/3)" },
  "width.9": { tr: "Dörtte üç (3/4)", en: "Three quarters (3/4)", fr: "Trois quarts (3/4)" },
  "width.12": { tr: "Tam genişlik", en: "Full width", fr: "Pleine largeur" },
  "width.value": { tr: "{span}/12 sütun", en: "{span}/12 columns", fr: "{span}/12 colonnes" },
  "height.auto": { tr: "Otomatik (içeriğe göre)", en: "Auto (fits content)", fr: "Auto (selon le contenu)" },
  "height.autoShort": { tr: "Otomatik", en: "Auto", fr: "Auto" },
  "height.px": { tr: "{px} px", en: "{px} px", fr: "{px} px" },
  "move.up": { tr: "Yukarı taşı", en: "Move up", fr: "Monter" },
  "move.down": { tr: "Aşağı taşı", en: "Move down", fr: "Descendre" },
  "move.left": { tr: "Sola taşı", en: "Move left", fr: "Vers la gauche" },
  "move.right": { tr: "Sağa taşı", en: "Move right", fr: "Vers la droite" },
  "resize.width": { tr: "{name} genişliği", en: "{name} width", fr: "Largeur de {name}" },
  "resize.height": { tr: "{name} yüksekliği (çift tıklayınca otomatik)", en: "{name} height (double-click for auto)", fr: "Hauteur de {name} (double-clic : auto)" },
  "drop.newRow": { tr: "Yeni satır", en: "New row", fr: "Nouvelle ligne" },
  "slot.add": { tr: "Buraya ekle", en: "Add here", fr: "Ajouter ici" },
  "slot.addRow": { tr: "Satır ekle", en: "Add a row", fr: "Ajouter une ligne" },
  "announce.moved": { tr: "{name} taşındı", en: "{name} moved", fr: "{name} déplacé" },
  "announce.width": { tr: "{name}: {span}/12 sütun", en: "{name}: {span}/12 columns", fr: "{name} : {span}/12 colonnes" },
  "announce.height": { tr: "{name}: {height}", en: "{name}: {height}", fr: "{name} : {height}" },
  "board.empty": { tr: "Bu sayfada henüz widget yok", en: "No widgets on this page yet", fr: "Aucun widget sur cette page" },
  "board.emptyHint": { tr: "Hisseye bağlı kartlar veya genel widget'larla başlayın; ikisini aynı sayfada kullanabilirsiniz.", en: "Start with stock-specific or general widgets; you can use both on the same page.", fr: "Commencez par des widgets liés à une action ou généraux ; vous pouvez les combiner sur la même page." },
  "board.stockFor": { tr: "{ticker} için", en: "for {ticker}", fr: "pour {ticker}" },
  "board.noData": { tr: "Bu hisse için veri yok", en: "No data for this stock", fr: "Aucune donnée pour cette action" },

  // Settings
  "settings.ticker": { tr: "Hisse", en: "Stock", fr: "Action" },
  "settings.tickerPage": { tr: "Sayfanın hissesi ({ticker})", en: "The page's stock ({ticker})", fr: "L'action de la page ({ticker})" },
  "settings.tickerDefault": { tr: "Varsayılan hisse ({ticker})", en: "Default stock ({ticker})", fr: "Action par défaut ({ticker})" },
  "settings.tickerPick": { tr: "Başka bir hisse seçin", en: "Pick another stock", fr: "Choisir une autre action" },
  "settings.tickerHint": { tr: "Bu kart sayfanın hissesi yerine seçtiğiniz hisseyi gösterir.", en: "This card shows the stock you pick instead of the page's.", fr: "Cette carte affiche l'action choisie au lieu de celle de la page." },
  "settings.generalHint": { tr: "Bu genel widget hisse seçiminden etkilenmez.", en: "This general widget is independent of the selected stock.", fr: "Ce widget général ne dépend pas de l'action choisie." },
  "settings.none": { tr: "Bu widget'ın ayarı yok.", en: "This widget has no settings.", fr: "Ce widget n'a pas de réglages." },
  "settings.close": { tr: "Kapat", en: "Close", fr: "Fermer" },
  "ticker.notFound": { tr: "{ticker} bulunamadı", en: "{ticker} not found", fr: "{ticker} introuvable" },

  // Gallery
  "gallery.title": { tr: "Widget ekle", en: "Add a widget", fr: "Ajouter un widget" },
  "gallery.subtitle": { tr: "Bir karta tıklayın; sayfaya eklenir, sonra sürükleyip boyutlandırabilirsiniz.", en: "Click a card to add it, then drag and resize it on the page.", fr: "Cliquez sur une carte pour l'ajouter, puis déplacez-la et redimensionnez-la." },
  "gallery.search": { tr: "Widget ara…", en: "Search widgets…", fr: "Rechercher un widget…" },
  "gallery.empty": { tr: "Eşleşen widget yok", en: "No matching widget", fr: "Aucun widget correspondant" },
  "gallery.onPage": { tr: "Sayfada ×{count}", en: "On page ×{count}", fr: "Sur la page ×{count}" },
  "gallery.added": { tr: "{name} eklendi", en: "{name} added", fr: "{name} ajouté" },
  "gallery.full": { tr: "Bir sayfada en fazla {max} widget olabilir", en: "A page holds at most {max} widgets", fr: "Une page contient au plus {max} widgets" },
  "gallery.categories": { tr: "Kategoriler", en: "Categories", fr: "Catégories" },

  // Custom pages
  "pages.title": { tr: "Sayfalarım", en: "My pages", fr: "Mes pages" },
  "pages.eyebrow": { tr: "Kişisel sayfa", en: "Personal page", fr: "Page personnelle" },
  "pages.tabs": { tr: "Kişisel sayfalar", en: "Personal pages", fr: "Pages personnelles" },
  "pages.new": { tr: "Yeni sayfa", en: "New page", fr: "Nouvelle page" },
  "pages.defaultName": { tr: "Sayfam {n}", en: "My page {n}", fr: "Ma page {n}" },
  "pages.introTitle": { tr: "Kendi sayfanızı oluşturun", en: "Build your own page", fr: "Créez votre propre page" },
  "pages.startBlank": { tr: "Boş sayfa", en: "Blank page", fr: "Page vierge" },
  "pages.startBlankDesc": { tr: "Hisseye bağlı ve genel widget'ları kendiniz seçin", en: "Choose your stock-specific and general widgets", fr: "Choisissez vos widgets liés à une action et généraux" },
  "pages.templates": { tr: "ya da bir şablonla başlayın", en: "or start from a template", fr: "ou partez d'un modèle" },
  "pages.template.overview": { tr: "Hisse özeti", en: "Stock overview", fr: "Vue d'ensemble de l'action" },
  "pages.template.fundamental": { tr: "Temel analiz", en: "Fundamentals", fr: "Fondamentaux" },
  "pages.template.technical": { tr: "Teknik analiz", en: "Technical analysis", fr: "Analyse technique" },
  "pages.template.home": { tr: "Piyasa özeti", en: "Market overview", fr: "Aperçu du marché" },
  "pages.template.macro": { tr: "Makro ekonomi", en: "Macroeconomy", fr: "Macro-économie" },
  "pages.template.dividend": { tr: "Temettü ve bilanço", en: "Dividends and statements", fr: "Dividendes et états financiers" },
  "pages.templateWidgets": { tr: "{count} widget", en: "{count} widgets", fr: "{count} widgets" },
  "pages.menu": { tr: "Sayfa işlemleri", en: "Page actions", fr: "Actions de la page" },
  "pages.rename": { tr: "Yeniden adlandır", en: "Rename", fr: "Renommer" },
  "pages.duplicate": { tr: "Çoğalt", en: "Duplicate", fr: "Dupliquer" },
  "pages.delete": { tr: "Sayfayı sil", en: "Delete page", fr: "Supprimer la page" },
  "pages.deleted": { tr: "“{name}” silindi", en: "“{name}” deleted", fr: "« {name} » supprimée" },
  "pages.name": { tr: "Sayfa adı", en: "Page name", fr: "Nom de la page" },
  "pages.save": { tr: "Kaydet", en: "Save", fr: "Enregistrer" },
  "pages.cancel": { tr: "Vazgeç", en: "Cancel", fr: "Annuler" },
  "pages.copyName": { tr: "{name} (kopya)", en: "{name} (copy)", fr: "{name} (copie)" },
  "pages.limit": { tr: "En fazla {max} sayfa oluşturabilirsiniz", en: "You can create up to {max} pages", fr: "Vous pouvez créer jusqu'à {max} pages" },
  "pages.stock": { tr: "Hisse", en: "Stock", fr: "Action" },
  "pages.stockNotFound": { tr: "“{ticker}” Borsa İstanbul'da bulunamadı, bu yüzden hisseye bağlı kartlar veri gösteremiyor. Sayfanın hissesini yukarıdan değiştirin.", en: "“{ticker}” wasn't found on Borsa Istanbul, so stock-specific cards can't show data. Change the page's stock above.", fr: "« {ticker} » est introuvable à la Bourse d'Istanbul : les cartes liées à une action ne peuvent rien afficher. Changez l'action de la page ci-dessus." },
  "pages.stockHint": { tr: "Sayfanın hissesi yalnızca hisseye bağlı widget'ları değiştirir. Her karta ayarlarından ayrı hisse seçebilirsiniz; genel widget'lar bu seçimden etkilenmez.", en: "The page's stock only changes stock-specific widgets. Each card can follow its own stock in settings; general widgets stay independent.", fr: "L'action de la page modifie uniquement les widgets liés à une action. Chaque carte peut suivre sa propre action dans ses réglages ; les widgets généraux restent indépendants." },
  "pages.changeStock": { tr: "Sayfanın hissesini değiştir", en: "Change the page's stock", fr: "Changer l'action de la page" },
  "pages.storageNote": { tr: "Sayfalar yalnızca bu tarayıcıda saklanır.", en: "Pages are stored in this browser only.", fr: "Les pages sont stockées dans ce navigateur uniquement." },
  "pages.loading": { tr: "Sayfalar yükleniyor…", en: "Loading pages…", fr: "Chargement des pages…" },
} satisfies Record<string, Entry>;

export type WidgetKey = keyof typeof dict;
export type WidgetVars = Record<string, string | number>;

function interpolate(template: string, vars?: WidgetVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function widgetText(key: WidgetKey, locale: Locale, vars?: WidgetVars): string {
  const entry: Entry = dict[key];
  return interpolate(entry[locale] ?? entry.tr, vars);
}

export function isWidgetKey(key: string): key is WidgetKey {
  return key in dict;
}
