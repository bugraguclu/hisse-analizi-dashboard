"use client";

import { useCallback } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

type Entry = { tr: string; en: string; fr: string };

/**
 * Strings of the /tarama (stock screener) page. Kept next to the components so
 * the shared dictionary in lib/i18n.ts stays small; same {tr, en, fr} shape and
 * locale source. Placeholders use {name} syntax.
 */
const dict = {
  // Page
  "page.title": { tr: "Hisse Tarama", en: "Stock Screener", fr: "Filtrage d'actions" },
  "page.description": {
    tr: "Borsa İstanbul'daki tüm hisseleri değerleme, kârlılık, teknik ve analist verileriyle filtreleyin.",
    en: "Filter every Borsa Istanbul stock by valuation, profitability, technical and analyst data.",
    fr: "Filtrez toutes les actions de Borsa Istanbul selon la valorisation, la rentabilité, l'analyse technique et les analystes.",
  },

  // Filters panel
  "filters.title": { tr: "Filtreler", en: "Filters", fr: "Filtres" },
  "filters.search": { tr: "Hisse kodu veya şirket adı", en: "Ticker or company name", fr: "Code ou nom de la société" },
  "filters.searchLabel": { tr: "Hisse ara", en: "Search stocks", fr: "Rechercher une action" },
  "filters.clearSearch": { tr: "Aramayı temizle", en: "Clear search", fr: "Effacer la recherche" },
  "filters.universe": { tr: "Endeks", en: "Index", fr: "Indice" },
  "filters.allStocks": { tr: "Tüm hisseler", en: "All stocks", fr: "Toutes les actions" },
  "filters.sector": { tr: "Sektör", en: "Sector", fr: "Secteur" },
  "filters.allSectors": { tr: "Tüm sektörler", en: "All sectors", fr: "Tous les secteurs" },
  "filters.presets": { tr: "Hazır taramalar", en: "Quick screens", fr: "Filtres prédéfinis" },
  "filters.advanced": { tr: "Gelişmiş filtreler", en: "Advanced filters", fr: "Filtres avancés" },
  "filters.all": { tr: "Tümü", en: "All", fr: "Tous" },
  "filters.screens": { tr: "Taramalar", en: "Screens", fr: "Filtres" },
  "filters.criteria": { tr: "Kriterler", en: "Criteria", fr: "Critères" },
  "filters.show": { tr: "{count} hisseyi göster", en: "Show {count} stocks", fr: "Afficher {count} actions" },
  "filters.showOne": { tr: "{count} hisseyi göster", en: "Show {count} stock", fr: "Afficher {count} action" },
  "filters.showPlain": { tr: "Hisseleri göster", en: "Show stocks", fr: "Afficher les actions" },
  "filters.clearAll": { tr: "Tüm filtreleri temizle", en: "Clear all filters", fr: "Effacer tous les filtres" },
  "filters.min": { tr: "Min", en: "Min", fr: "Min" },
  "filters.max": { tr: "Maks", en: "Max", fr: "Max" },
  "filters.invalidNumber": { tr: "Geçerli bir sayı girin", en: "Enter a valid number", fr: "Saisissez un nombre valide" },
  "filters.invalidRange": {
    tr: "Alt sınır üst sınırdan büyük — sonuç çıkmaz",
    en: "Min is above max — nothing can match",
    fr: "Le minimum dépasse le maximum — aucun résultat possible",
  },
  "filters.cross": { tr: "SMA 50/200 kesişimi", en: "SMA 50/200 cross", fr: "Croisement MM 50/200" },
  "filters.recommendation": { tr: "Analist önerisi", en: "Analyst rating", fr: "Recommandation" },
  "filters.any": { tr: "Hepsi", en: "Any", fr: "Tous" },
  "filters.unitHint": {
    tr: "Ondalık için virgül veya nokta kullanabilirsiniz. Değeri olmayan hisseler aralık filtresine takılır.",
    en: "Use a comma or a dot for decimals. Stocks without a value are excluded by a range filter.",
    fr: "Virgule ou point pour les décimales. Les actions sans valeur sont exclues par un filtre d'intervalle.",
  },

  // Filter groups
  "group.valuation": { tr: "Değerleme", en: "Valuation", fr: "Valorisation" },
  "group.profitability": { tr: "Kârlılık", en: "Profitability", fr: "Rentabilité" },
  "group.scale": { tr: "Ölçek ve likidite", en: "Size & liquidity", fr: "Taille et liquidité" },
  "group.technical": { tr: "Teknik", en: "Technical", fr: "Technique" },
  "group.performance": { tr: "Performans", en: "Performance", fr: "Performance" },
  "group.analyst": { tr: "Analist", en: "Analysts", fr: "Analystes" },

  // Range filters (label with unit; `short` is used on active-filter chips)
  "range.mcap": { tr: "Piyasa değeri (Mr ₺)", en: "Market cap (bn ₺)", fr: "Capitalisation (Md ₺)" },
  "range.mcap.short": { tr: "Piyasa değeri", en: "Market cap", fr: "Capitalisation" },
  "range.vol": { tr: "Ort. günlük hacim (Mn ₺)", en: "Avg. daily turnover (M ₺)", fr: "Volume quotidien moyen (M ₺)" },
  "range.vol.short": { tr: "Ort. hacim", en: "Avg. turnover", fr: "Volume moyen" },
  "range.pe": { tr: "F/K", en: "P/E", fr: "PER" },
  "range.pe.short": { tr: "F/K", en: "P/E", fr: "PER" },
  "range.pb": { tr: "PD/DD", en: "P/B", fr: "C/VC" },
  "range.pb.short": { tr: "PD/DD", en: "P/B", fr: "C/VC" },
  "range.evebitda": { tr: "FD/FAVÖK", en: "EV/EBITDA", fr: "VE/EBITDA" },
  "range.evebitda.short": { tr: "FD/FAVÖK", en: "EV/EBITDA", fr: "VE/EBITDA" },
  "range.dy": { tr: "Temettü verimi (%)", en: "Dividend yield (%)", fr: "Rendement du dividende (%)" },
  "range.dy.short": { tr: "Temettü verimi", en: "Dividend yield", fr: "Rendement" },
  "range.roe": { tr: "Özkaynak kârlılığı – ROE (%)", en: "Return on equity – ROE (%)", fr: "Rentabilité des capitaux propres – ROE (%)" },
  "range.roe.short": { tr: "ROE", en: "ROE", fr: "ROE" },
  "range.nm": { tr: "Net kâr marjı (%)", en: "Net margin (%)", fr: "Marge nette (%)" },
  "range.nm.short": { tr: "Net marj", en: "Net margin", fr: "Marge nette" },
  "range.rsi": { tr: "RSI (14)", en: "RSI (14)", fr: "RSI (14)" },
  "range.rsi.short": { tr: "RSI", en: "RSI", fr: "RSI" },
  "range.sma50": { tr: "SMA 50'ye uzaklık (%)", en: "Distance to SMA 50 (%)", fr: "Écart à la MM 50 (%)" },
  "range.sma50.short": { tr: "SMA 50 farkı", en: "vs SMA 50", fr: "Écart MM 50" },
  "range.sma200": { tr: "SMA 200'e uzaklık (%)", en: "Distance to SMA 200 (%)", fr: "Écart à la MM 200 (%)" },
  "range.sma200.short": { tr: "SMA 200 farkı", en: "vs SMA 200", fr: "Écart MM 200" },
  "range.hi52": { tr: "52 hafta zirvesine uzaklık (%)", en: "Distance to 52-week high (%)", fr: "Écart au plus haut sur 52 sem. (%)" },
  "range.hi52.short": { tr: "52H zirveye", en: "vs 52w high", fr: "vs + haut 52 s." },
  "range.lo52": { tr: "52 hafta dibine uzaklık (%)", en: "Distance to 52-week low (%)", fr: "Écart au plus bas sur 52 sem. (%)" },
  "range.lo52.short": { tr: "52H dibe", en: "vs 52w low", fr: "vs + bas 52 s." },
  "range.rvol": { tr: "Göreli hacim (10 gün, x)", en: "Relative volume (10-day, x)", fr: "Volume relatif (10 j, x)" },
  "range.rvol.short": { tr: "Göreli hacim", en: "Rel. volume", fr: "Vol. relatif" },
  "range.chg": { tr: "Günlük değişim (%)", en: "Daily change (%)", fr: "Variation du jour (%)" },
  "range.chg.short": { tr: "Günlük", en: "Day", fr: "Jour" },
  "range.p1w": { tr: "1 hafta getiri (%)", en: "1-week return (%)", fr: "Performance 1 semaine (%)" },
  "range.p1w.short": { tr: "1 hafta", en: "1 week", fr: "1 semaine" },
  "range.p1m": { tr: "1 ay getiri (%)", en: "1-month return (%)", fr: "Performance 1 mois (%)" },
  "range.p1m.short": { tr: "1 ay", en: "1 month", fr: "1 mois" },
  "range.p3m": { tr: "3 ay getiri (%)", en: "3-month return (%)", fr: "Performance 3 mois (%)" },
  "range.p3m.short": { tr: "3 ay", en: "3 months", fr: "3 mois" },
  "range.pytd": { tr: "Yılbaşından beri (%)", en: "Year to date (%)", fr: "Depuis le 1er janvier (%)" },
  "range.pytd.short": { tr: "YBB", en: "YTD", fr: "YTD" },
  "range.p1y": { tr: "1 yıl getiri (%)", en: "1-year return (%)", fr: "Performance 1 an (%)" },
  "range.p1y.short": { tr: "1 yıl", en: "1 year", fr: "1 an" },
  "range.upside": { tr: "Hedef fiyata potansiyel (%)", en: "Upside to target (%)", fr: "Potentiel vs objectif (%)" },
  "range.upside.short": { tr: "Potansiyel", en: "Upside", fr: "Potentiel" },
  "range.foreign": { tr: "Yabancı oranı (%)", en: "Foreign ownership (%)", fr: "Détention étrangère (%)" },
  "range.foreign.short": { tr: "Yabancı oranı", en: "Foreign", fr: "Étrangers" },

  // Quick screens: name, `.rule` where the rule reads better as a sentence than as the
  // generated bound ("F/K ≤ 10"; {placeholders} are filled from the screen's own bounds,
  // so a threshold is never written twice), `.note` for the tooltip.
  "preset.low_pe": { tr: "Düşük F/K", en: "Low P/E", fr: "PER faible" },
  "preset.low_pe.note": {
    tr: "Zarar eden şirketlerin F/K'sı yoktur; bu tarama onları dışarıda bırakır.",
    en: "Loss makers have no P/E, so this screen leaves them out.",
    fr: "Les sociétés déficitaires n'ont pas de PER : ce filtre les exclut.",
  },
  "preset.low_pb": { tr: "Düşük PD/DD", en: "Low P/B", fr: "C/VC faible" },
  "preset.low_pb.note": { tr: "Defter değerinin altında işlem gören hisseler", en: "Trading at or below book value", fr: "Cotées sous leur valeur comptable" },
  "preset.low_ev_ebitda": { tr: "Düşük FD/FAVÖK", en: "Low EV/EBITDA", fr: "VE/EBITDA faible" },
  "preset.low_ev_ebitda.note": {
    tr: "Firma değeri / son 12 ay FAVÖK; FAVÖK'ü negatif olanlarda oran yoktur.",
    en: "Enterprise value / trailing 12-month EBITDA; undefined when EBITDA is negative.",
    fr: "Valeur d'entreprise / EBITDA sur 12 mois ; non défini si l'EBITDA est négatif.",
  },
  "preset.high_dividend": { tr: "Yüksek temettü", en: "High dividend", fr: "Dividende élevé" },
  "preset.high_dividend.note": { tr: "Son 12 ayda dağıtılan temettü / fiyat", en: "Dividends paid over the last 12 months / price", fr: "Dividendes versés sur 12 mois / cours" },
  "preset.profitable": { tr: "Kârlı şirketler", en: "Profitable companies", fr: "Sociétés bénéficiaires" },
  "preset.profitable.note": {
    tr: "Son 12 ayı net kârla kapatan, yani F/K'sı hesaplanabilen şirketler",
    en: "Net profit over the last 12 months, i.e. companies with a P/E",
    fr: "Bénéfice net sur 12 mois, c.-à-d. les sociétés qui ont un PER",
  },
  "preset.high_roe": { tr: "Yüksek ROE", en: "High ROE", fr: "ROE élevé" },
  "preset.high_roe.note": { tr: "Net kâr / özkaynak (son 12 ay)", en: "Net income / equity (trailing 12 months)", fr: "Résultat net / capitaux propres (12 mois)" },
  "preset.high_net_margin": { tr: "Yüksek net marj", en: "High net margin", fr: "Marge nette élevée" },
  "preset.high_net_margin.note": { tr: "Net kâr / hasılat (son 12 ay)", en: "Net income / revenue (trailing 12 months)", fr: "Résultat net / chiffre d'affaires (12 mois)" },
  "preset.large_cap": { tr: "Büyük ölçek", en: "Large cap", fr: "Grande capitalisation" },
  "preset.mid_cap": { tr: "Orta ölçek", en: "Mid cap", fr: "Capitalisation moyenne" },
  "preset.small_cap": { tr: "Küçük ölçek", en: "Small cap", fr: "Petite capitalisation" },
  "preset.liquid": { tr: "Yüksek likidite", en: "Highly liquid", fr: "Très liquide" },
  "preset.liquid.note": { tr: "Son 30 günün ortalama günlük işlem hacmi", en: "Average daily traded value over the last 30 days", fr: "Montant quotidien moyen échangé sur 30 jours" },
  "preset.uptrend": { tr: "Yükseliş trendi", en: "Uptrend", fr: "Tendance haussière" },
  "preset.uptrend.rule": { tr: "Fiyat SMA 50 ve SMA 200 üzerinde", en: "Price above SMA 50 and SMA 200", fr: "Cours au-dessus des MM 50 et MM 200" },
  "preset.golden_cross": { tr: "Golden cross", en: "Golden cross", fr: "Croisement doré" },
  "preset.golden_cross.note": {
    tr: "Yalnızca son işlem gününde kesişenler; çoğu gün 0–3 hisse çıkar.",
    en: "Only crosses on the latest session; most days that is 0–3 stocks.",
    fr: "Seulement les croisements de la dernière séance : 0 à 3 actions la plupart des jours.",
  },
  "preset.death_cross": { tr: "Death cross", en: "Death cross", fr: "Croisement de la mort" },
  "preset.death_cross.note": {
    tr: "Yalnızca son işlem gününde kesişenler; çoğu gün 0–3 hisse çıkar.",
    en: "Only crosses on the latest session; most days that is 0–3 stocks.",
    fr: "Seulement les croisements de la dernière séance : 0 à 3 actions la plupart des jours.",
  },
  "preset.near_high": { tr: "52H zirvesine yakın", en: "Near 52-week high", fr: "Proche du plus haut 52 sem." },
  "preset.near_high.rule": { tr: "52H zirvenin en çok {hi52} altında", en: "Within {hi52} of the 52-week high", fr: "À moins de {hi52} du plus haut 52 sem." },
  "preset.near_low": { tr: "52H dibine yakın", en: "Near 52-week low", fr: "Proche du plus bas 52 sem." },
  "preset.near_low.rule": { tr: "52H dibin en çok {lo52} üstünde", en: "Within {lo52} of the 52-week low", fr: "À moins de {lo52} du plus bas 52 sem." },
  "preset.rsi_oversold": { tr: "RSI aşırı satım", en: "RSI oversold", fr: "RSI survente" },
  "preset.rsi_oversold.note": { tr: "14 günlük göreli güç endeksi", en: "14-day relative strength index", fr: "Indice de force relative sur 14 jours" },
  "preset.rsi_overbought": { tr: "RSI aşırı alım", en: "RSI overbought", fr: "RSI surachat" },
  "preset.rsi_overbought.note": { tr: "14 günlük göreli güç endeksi", en: "14-day relative strength index", fr: "Indice de force relative sur 14 jours" },
  "preset.volume_spike": { tr: "Hacim artışı", en: "Volume spike", fr: "Pic de volume" },
  "preset.volume_spike.note": { tr: "Bugünkü hacim / 10 günlük ortalama hacim", en: "Today's volume / 10-day average volume", fr: "Volume du jour / volume moyen sur 10 jours" },
  "preset.day_gainers": { tr: "Günün yükselenleri", en: "Today's gainers", fr: "Hausses du jour" },
  "preset.day_gainers.note": { tr: "Önceki kapanışa göre değişim", en: "Change vs. the previous close", fr: "Variation vs. la clôture précédente" },
  "preset.day_losers": { tr: "Günün düşenleri", en: "Today's losers", fr: "Baisses du jour" },
  "preset.day_losers.note": { tr: "Önceki kapanışa göre değişim", en: "Change vs. the previous close", fr: "Variation vs. la clôture précédente" },
  "preset.week_gainers": { tr: "Haftanın yükselenleri", en: "Weekly gainers", fr: "Hausses de la semaine" },
  "preset.buy_rec": { tr: "AL önerisi", en: "Buy rating", fr: "Recommandation achat" },
  "preset.buy_rec.note": { tr: "Yalnızca İş Yatırım'ın araştırma kapsamındaki hisseler", en: "Only stocks covered by İş Yatırım research", fr: "Uniquement les actions suivies par İş Yatırım" },
  "preset.sell_rec": { tr: "SAT önerisi", en: "Sell rating", fr: "Recommandation vente" },
  "preset.sell_rec.note": { tr: "Yalnızca İş Yatırım'ın araştırma kapsamındaki hisseler", en: "Only stocks covered by İş Yatırım research", fr: "Uniquement les actions suivies par İş Yatırım" },
  "preset.high_upside": { tr: "Yüksek potansiyel", en: "High upside", fr: "Fort potentiel" },
  "preset.high_upside.note": { tr: "İş Yatırım hedef fiyatının son fiyata göre potansiyeli", en: "Upside of the İş Yatırım target vs. the last price", fr: "Potentiel de l'objectif İş Yatırım vs. le dernier cours" },
  "preset.high_foreign": { tr: "Yüksek yabancı payı", en: "High foreign ownership", fr: "Forte détention étrangère" },
  "preset.high_foreign.note": { tr: "Yabancı yatırımcıların payı (İş Yatırım verisi)", en: "Share held by foreign investors (İş Yatırım data)", fr: "Part des investisseurs étrangers (données İş Yatırım)" },
  // Rule parts shared by several screens.
  "rule.cross.golden": { tr: "SMA 50, SMA 200'ü yukarı kesti · son gün", en: "SMA 50 crossed above SMA 200 · last session", fr: "MM 50 passée au-dessus de la MM 200 · dernière séance" },
  "rule.cross.death": { tr: "SMA 50, SMA 200'ü aşağı kesti · son gün", en: "SMA 50 crossed below SMA 200 · last session", fr: "MM 50 passée sous la MM 200 · dernière séance" },
  "rule.rec": { tr: "İş Yatırım önerisi: {rec}", en: "İş Yatırım rating: {rec}", fr: "Recommandation İş Yatırım : {rec}" },
  "rule.profitable": { tr: "Son 12 ayda net kâr", en: "Net profit over the last 12 months", fr: "Bénéfice net sur 12 mois" },

  // Views
  "view.label": { tr: "Sütun görünümü", en: "Column view", fr: "Vue des colonnes" },
  "view.overview": { tr: "Genel", en: "Overview", fr: "Aperçu" },
  "view.fundamentals": { tr: "Temel", en: "Fundamentals", fr: "Fondamentaux" },
  "view.technical": { tr: "Teknik", en: "Technical", fr: "Technique" },
  "view.performance": { tr: "Performans", en: "Performance", fr: "Performance" },
  "view.analyst": { tr: "Analist", en: "Analysts", fr: "Analystes" },

  // Columns (header label; `.title` is the header tooltip)
  "col.symbol": { tr: "Hisse", en: "Stock", fr: "Action" },
  "col.sector": { tr: "Sektör", en: "Sector", fr: "Secteur" },
  "col.close": { tr: "Fiyat", en: "Price", fr: "Cours" },
  "col.close.title": { tr: "Son fiyat (₺, 15 dk gecikmeli)", en: "Last price (₺, 15-min delayed)", fr: "Dernier cours (₺, différé de 15 min)" },
  "col.change_pct": { tr: "Günlük", en: "Day", fr: "Jour" },
  "col.change_pct.title": { tr: "Önceki kapanışa göre değişim", en: "Change vs. previous close", fr: "Variation vs. clôture précédente" },
  "col.turnover": { tr: "Hacim", en: "Turnover", fr: "Volume" },
  "col.turnover.title": { tr: "Bugünkü işlem hacmi (₺)", en: "Today's traded value (₺)", fr: "Montant échangé aujourd'hui (₺)" },
  "col.avg_turnover": { tr: "Ort. hacim", en: "Avg. turnover", fr: "Volume moyen" },
  "col.avg_turnover.title": { tr: "Son 30 günün ortalama günlük işlem hacmi (₺, yaklaşık)", en: "30-day average daily traded value (₺, approx.)", fr: "Montant quotidien moyen sur 30 jours (₺, approx.)" },
  "col.market_cap": { tr: "Piyasa değeri", en: "Market cap", fr: "Capitalisation" },
  "col.market_cap.title": { tr: "Piyasa değeri (₺)", en: "Market capitalisation (₺)", fr: "Capitalisation boursière (₺)" },
  "col.pe": { tr: "F/K", en: "P/E", fr: "PER" },
  "col.pe.title": { tr: "Fiyat / son 12 ay hisse başına kâr", en: "Price / trailing 12-month earnings per share", fr: "Cours / bénéfice par action sur 12 mois" },
  "col.pb": { tr: "PD/DD", en: "P/B", fr: "C/VC" },
  "col.pb.title": { tr: "Piyasa değeri / defter değeri", en: "Price / book value", fr: "Cours / valeur comptable" },
  "col.ev_ebitda": { tr: "FD/FAVÖK", en: "EV/EBITDA", fr: "VE/EBITDA" },
  "col.ev_ebitda.title": { tr: "Firma değeri / son 12 ay FAVÖK", en: "Enterprise value / trailing 12-month EBITDA", fr: "Valeur d'entreprise / EBITDA sur 12 mois" },
  "col.dividend_yield": { tr: "Temettü", en: "Div. yield", fr: "Rdt div." },
  "col.dividend_yield.title": { tr: "Son 12 ayda dağıtılan temettü / fiyat", en: "Dividends paid over 12 months / price", fr: "Dividendes versés sur 12 mois / cours" },
  "col.roe": { tr: "ROE", en: "ROE", fr: "ROE" },
  "col.roe.title": { tr: "Özkaynak kârlılığı: net kâr / özkaynak", en: "Return on equity: net income / equity", fr: "Rentabilité des capitaux propres : résultat net / capitaux propres" },
  "col.net_margin": { tr: "Net marj", en: "Net margin", fr: "Marge nette" },
  "col.net_margin.title": { tr: "Net kâr / hasılat (son 12 ay)", en: "Net income / revenue (trailing 12 months)", fr: "Résultat net / chiffre d'affaires (12 mois)" },
  "col.rsi": { tr: "RSI", en: "RSI", fr: "RSI" },
  "col.rsi.title": { tr: "14 günlük göreli güç endeksi (30 altı aşırı satım, 70 üstü aşırı alım)", en: "14-day relative strength index (below 30 oversold, above 70 overbought)", fr: "RSI sur 14 jours (< 30 survente, > 70 surachat)" },
  "col.sma50_dist": { tr: "SMA 50", en: "SMA 50", fr: "MM 50" },
  "col.sma50_dist.title": { tr: "Fiyatın 50 günlük ortalamaya uzaklığı (%)", en: "Price vs. 50-day moving average (%)", fr: "Écart du cours à la moyenne mobile 50 jours (%)" },
  "col.sma200_dist": { tr: "SMA 200", en: "SMA 200", fr: "MM 200" },
  "col.sma200_dist.title": { tr: "Fiyatın 200 günlük ortalamaya uzaklığı (%)", en: "Price vs. 200-day moving average (%)", fr: "Écart du cours à la moyenne mobile 200 jours (%)" },
  "col.high_52w_dist": { tr: "52H zirve", en: "52w high", fr: "+ haut 52 s." },
  "col.high_52w_dist.title": { tr: "52 haftalık zirveye uzaklık (%)", en: "Distance to the 52-week high (%)", fr: "Écart au plus haut sur 52 semaines (%)" },
  "col.low_52w_dist": { tr: "52H dip", en: "52w low", fr: "+ bas 52 s." },
  "col.low_52w_dist.title": { tr: "52 haftalık dibe uzaklık (%)", en: "Distance to the 52-week low (%)", fr: "Écart au plus bas sur 52 semaines (%)" },
  "col.rel_volume": { tr: "Göreli hacim", en: "Rel. volume", fr: "Vol. relatif" },
  "col.rel_volume.title": { tr: "Bugünkü hacim / 10 günlük ortalama", en: "Today's volume / 10-day average", fr: "Volume du jour / moyenne 10 jours" },
  "col.tech_rating": { tr: "Teknik görünüm", en: "Technical rating", fr: "Note technique" },
  "col.tech_rating.title": { tr: "TradingView teknik özeti (hareketli ortalamalar ve osilatörler)", en: "TradingView technical summary (moving averages and oscillators)", fr: "Synthèse technique TradingView (moyennes mobiles et oscillateurs)" },
  "col.signals": { tr: "Sinyaller", en: "Signals", fr: "Signaux" },
  "col.perf_1w": { tr: "1 hafta", en: "1W", fr: "1 sem." },
  "col.perf_1m": { tr: "1 ay", en: "1M", fr: "1 mois" },
  "col.perf_3m": { tr: "3 ay", en: "3M", fr: "3 mois" },
  "col.perf_ytd": { tr: "YBB", en: "YTD", fr: "YTD" },
  "col.perf_ytd.title": { tr: "Yılbaşından beri getiri", en: "Year-to-date return", fr: "Performance depuis le 1er janvier" },
  "col.perf_1y": { tr: "1 yıl", en: "1Y", fr: "1 an" },
  "col.recommendation": { tr: "Öneri", en: "Rating", fr: "Reco." },
  "col.recommendation.title": { tr: "İş Yatırım araştırma önerisi", en: "İş Yatırım research rating", fr: "Recommandation de la recherche İş Yatırım" },
  "col.target_price": { tr: "Hedef fiyat", en: "Target", fr: "Objectif" },
  "col.target_price.title": { tr: "İş Yatırım hedef fiyatı (₺)", en: "İş Yatırım target price (₺)", fr: "Objectif de cours İş Yatırım (₺)" },
  "col.upside": { tr: "Potansiyel", en: "Upside", fr: "Potentiel" },
  "col.upside.title": { tr: "Hedef fiyatın son fiyata göre getiri potansiyeli", en: "Upside of the target price vs. the last price", fr: "Potentiel de l'objectif vs. le dernier cours" },
  "col.foreign_ratio": { tr: "Yabancı", en: "Foreign", fr: "Étrangers" },
  "col.foreign_ratio.title": { tr: "Yabancı yatırımcı payı (İş Yatırım)", en: "Foreign investor share (İş Yatırım)", fr: "Part des investisseurs étrangers (İş Yatırım)" },

  // Cell values
  "value.loss": { tr: "zarar", en: "loss", fr: "perte" },
  "value.lossTitle": {
    tr: "Son 12 ayda net zarar — F/K hesaplanamaz",
    en: "Net loss over the last 12 months — P/E is undefined",
    fr: "Perte nette sur 12 mois — PER non calculable",
  },
  "rating.strongBuy": { tr: "Güçlü al", en: "Strong buy", fr: "Achat fort" },
  "rating.buy": { tr: "Al", en: "Buy", fr: "Achat" },
  "rating.neutral": { tr: "Nötr", en: "Neutral", fr: "Neutre" },
  "rating.sell": { tr: "Sat", en: "Sell", fr: "Vente" },
  "rating.strongSell": { tr: "Güçlü sat", en: "Strong sell", fr: "Vente forte" },
  "rec.AL": { tr: "AL", en: "BUY", fr: "ACHAT" },
  "rec.TUT": { tr: "TUT", en: "HOLD", fr: "CONSERVER" },
  "rec.SAT": { tr: "SAT", en: "SELL", fr: "VENTE" },
  "signal.oversold": { tr: "Aşırı satım", en: "Oversold", fr: "Survente" },
  "signal.overbought": { tr: "Aşırı alım", en: "Overbought", fr: "Surachat" },
  "signal.golden": { tr: "Golden cross", en: "Golden cross", fr: "Croisement doré" },
  "signal.death": { tr: "Death cross", en: "Death cross", fr: "Croisement de la mort" },
  "signal.nearHigh": { tr: "52H zirvede", en: "At 52w high", fr: "Au + haut 52 s." },
  "signal.nearLow": { tr: "52H dipte", en: "At 52w low", fr: "Au + bas 52 s." },
  "signal.volumeSpike": { tr: "Hacim {x}x", en: "Volume {x}x", fr: "Volume {x}x" },

  // Results panel
  "results.title": { tr: "Sonuçlar", en: "Results", fr: "Résultats" },
  "results.count": { tr: "{total} hisseden {shown} tanesi", en: "{shown} of {total} stocks", fr: "{shown} actions sur {total}" },
  "results.countAll": { tr: "{total} hisse", en: "{total} stocks", fr: "{total} actions" },
  "results.breadth": { tr: "{up} yükselen · {down} düşen · {flat} yatay", en: "{up} up · {down} down · {flat} unchanged", fr: "{up} en hausse · {down} en baisse · {flat} inchangées" },
  "results.empty": { tr: "Filtrelere uyan hisse yok", en: "No stocks match these filters", fr: "Aucune action ne correspond à ces filtres" },
  "results.emptyHint": { tr: "Bir filtreyi kaldırmayı ya da aralığı genişletmeyi deneyin.", en: "Try removing a filter or widening a range.", fr: "Retirez un filtre ou élargissez un intervalle." },
  "results.sortedBy": { tr: "Sıralama: {column} ({direction})", en: "Sorted by {column} ({direction})", fr: "Tri : {column} ({direction})" },
  "results.asc": { tr: "artan", en: "ascending", fr: "croissant" },
  "results.desc": { tr: "azalan", en: "descending", fr: "décroissant" },
  "results.resetSort": { tr: "Varsayılana dön", en: "Reset", fr: "Réinitialiser" },
  "sort.label": { tr: "Sıralama", en: "Sort by", fr: "Trier par" },
  "sort.direction": { tr: "Yön", en: "Direction", fr: "Ordre" },
  "sort.asc": { tr: "Artan", en: "Ascending", fr: "Croissant" },
  "sort.desc": { tr: "Azalan", en: "Descending", fr: "Décroissant" },
  "results.export": { tr: "CSV", en: "CSV", fr: "CSV" },
  "results.exportTitle": { tr: "Filtrelenmiş tüm sonuçları CSV olarak indir", en: "Download all filtered results as CSV", fr: "Télécharger tous les résultats filtrés en CSV" },
  "results.pageSize": { tr: "Sayfa başına", en: "Per page", fr: "Par page" },
  "results.range": { tr: "{total} sonuçtan {from}–{to}", en: "{from}–{to} of {total}", fr: "{from}–{to} sur {total}" },
  "results.pagination": { tr: "Sayfalama", en: "Pagination", fr: "Pagination" },
  "results.prev": { tr: "Önceki sayfa", en: "Previous page", fr: "Page précédente" },
  "results.next": { tr: "Sonraki sayfa", en: "Next page", fr: "Page suivante" },
  "results.goToPage": { tr: "Sayfa {page}", en: "Page {page}", fr: "Page {page}" },
  "results.caption": { tr: "Hisse tarama sonuçları", en: "Stock screener results", fr: "Résultats du filtrage d'actions" },
  "results.refreshing": { tr: "Güncelleniyor…", en: "Updating…", fr: "Mise à jour…" },

  // Favorites
  "watch.add": { tr: "{ticker} hissesini favorilere ekle", en: "Add {ticker} to favorites", fr: "Ajouter {ticker} aux favoris" },
  "watch.remove": { tr: "{ticker} hissesini favorilerden çıkar", en: "Remove {ticker} from favorites", fr: "Retirer {ticker} des favoris" },
  "watch.added": { tr: "{ticker} favorilere eklendi", en: "{ticker} added to favorites", fr: "{ticker} ajouté aux favoris" },
  "watch.removed": { tr: "{ticker} favorilerden çıkarıldı", en: "{ticker} removed from favorites", fr: "{ticker} retiré des favoris" },
  "watch.full": { tr: "Favori listesi dolu (en fazla 40 hisse)", en: "The favorites list is full (40 stocks max)", fr: "La liste des favoris est pleine (40 actions max.)" },

  // Status, warnings, errors
  "status.updated": { tr: "Güncelleme {time}", en: "Updated {time}", fr: "Mis à jour {time}" },
  "status.delayed": { tr: "Fiyatlar {minutes} dk gecikmeli", en: "Prices delayed {minutes} min", fr: "Cours différés de {minutes} min" },
  "status.sources": { tr: "Kaynak: TradingView, İş Yatırım, Borsa İstanbul", en: "Sources: TradingView, İş Yatırım, Borsa Istanbul", fr: "Sources : TradingView, İş Yatırım, Borsa Istanbul" },
  "status.notAdvice": { tr: "Yatırım tavsiyesi değildir.", en: "Not investment advice.", fr: "Ceci n'est pas un conseil en investissement." },
  "warn.analyst": {
    tr: "İş Yatırım analist verileri şu an alınamıyor; öneri, hedef fiyat ve yabancı oranı eksik olabilir.",
    en: "İş Yatırım analyst data is unavailable right now; ratings, targets and foreign ownership may be missing.",
    fr: "Les données analystes d'İş Yatırım sont indisponibles ; recommandations, objectifs et détention étrangère peuvent manquer.",
  },
  "warn.indices": {
    tr: "Endeks üyelikleri şu an alınamıyor; endeks filtresi geçici olarak kullanılamaz.",
    en: "Index memberships are unavailable right now; the index filter is temporarily disabled.",
    fr: "Les compositions d'indices sont indisponibles ; le filtre d'indice est temporairement désactivé.",
  },
  "error.load": { tr: "Tarama verileri yüklenemedi", en: "Could not load the screener data", fr: "Impossible de charger les données du filtre" },
} as const satisfies Record<string, Entry>;

export type TaramaKey = keyof typeof dict;
export type TaramaVars = Record<string, string | number>;

function interpolate(template: string, vars?: TaramaVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function taramaText(key: TaramaKey, locale: Locale, vars?: TaramaVars): string {
  const entry: Entry = dict[key];
  return interpolate(entry[locale] ?? entry.tr, vars);
}

/** Whether an optional key (e.g. a column tooltip) exists. */
export function hasTaramaKey(key: string): key is TaramaKey {
  return Object.prototype.hasOwnProperty.call(dict, key);
}

/** `t(key, vars)` bound to the active UI locale. */
export function useTaramaI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: TaramaKey, vars?: TaramaVars) => taramaText(key, locale, vars), [locale]);
  return { t, locale };
}

/** Curated BIST indices offered as screening universes (codes match the backend). */
export const INDEX_LABELS: Record<string, Entry> = {
  XU030: { tr: "BIST 30", en: "BIST 30", fr: "BIST 30" },
  XU050: { tr: "BIST 50", en: "BIST 50", fr: "BIST 50" },
  XU100: { tr: "BIST 100", en: "BIST 100", fr: "BIST 100" },
  XKTUM: { tr: "BIST Katılım Tüm", en: "BIST Participation All", fr: "BIST Participation (tous)" },
  XK030: { tr: "BIST Katılım 30", en: "BIST Participation 30", fr: "BIST Participation 30" },
  XTMTU: { tr: "BIST Temettü", en: "BIST Dividend", fr: "BIST Dividendes" },
  XHARZ: { tr: "BIST Halka Arz", en: "BIST IPO", fr: "BIST Introductions en bourse" },
  XBANK: { tr: "BIST Banka", en: "BIST Banks", fr: "BIST Banques" },
  XUSIN: { tr: "BIST Sınai", en: "BIST Industrials", fr: "BIST Industrie" },
  XUHIZ: { tr: "BIST Hizmetler", en: "BIST Services", fr: "BIST Services" },
  XUMAL: { tr: "BIST Mali", en: "BIST Financials", fr: "BIST Finance" },
  XUTEK: { tr: "BIST Teknoloji", en: "BIST Technology", fr: "BIST Technologie" },
  XHOLD: { tr: "BIST Holding ve Yatırım", en: "BIST Holding & Investment", fr: "BIST Holdings et investissement" },
  XGMYO: { tr: "BIST GYO", en: "BIST REITs", fr: "BIST Foncières (SIIC)" },
};

export function indexLabel(code: string, locale: Locale): string {
  return INDEX_LABELS[code]?.[locale] ?? code;
}

/** French names of TradingView's sector keys (Turkish names come with the data; English is the key). */
const SECTOR_FR: Record<string, string> = {
  "Commercial Services": "Services commerciaux",
  Communications: "Communications",
  "Consumer Durables": "Biens de consommation durables",
  "Consumer Non-Durables": "Biens de consommation non durables",
  "Consumer Services": "Services aux consommateurs",
  "Distribution Services": "Services de distribution",
  "Electronic Technology": "Technologies électroniques",
  "Energy Minerals": "Minéraux énergétiques",
  Finance: "Finance",
  "Health Services": "Services de santé",
  "Health Technology": "Technologies de la santé",
  "Industrial Services": "Services industriels",
  Miscellaneous: "Divers",
  "Non-Energy Minerals": "Minéraux non énergétiques",
  "Process Industries": "Industries de transformation",
  "Producer Manufacturing": "Fabrication industrielle",
  "Retail Trade": "Commerce de détail",
  "Technology Services": "Services technologiques",
  Transportation: "Transport",
  Utilities: "Services publics",
  Government: "Administration publique",
};

/** Display name of a TradingView sector key in the UI language. */
export function sectorLabel(key: string, locale: Locale, turkish: ReadonlyMap<string, string>): string {
  if (locale === "tr") return turkish.get(key) ?? key;
  if (locale === "fr") return SECTOR_FR[key] ?? key;
  return key;
}
