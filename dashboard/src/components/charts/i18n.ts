"use client";

import { useCallback } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

/** UI strings of the interactive chart kit (tr is the source language). */
const DICT = {
  "type.label": { tr: "Grafik türü", en: "Chart type", fr: "Type de graphique" },
  "type.area": { tr: "Alan", en: "Area", fr: "Aire" },
  "type.line": { tr: "Çizgi", en: "Line", fr: "Ligne" },
  "type.candles": { tr: "Mum", en: "Candles", fr: "Bougies" },
  "type.area.title": { tr: "Alan grafiği", en: "Area chart", fr: "Graphique en aire" },
  "type.line.title": { tr: "Çizgi grafiği", en: "Line chart", fr: "Graphique linéaire" },
  "type.candles.title": { tr: "Mum grafiği (açılış/yüksek/düşük/kapanış)", en: "Candlestick chart (open/high/low/close)", fr: "Chandeliers (ouverture/haut/bas/clôture)" },

  "ind.label": { tr: "Göstergeler", en: "Indicators", fr: "Indicateurs" },
  "ind.volume": { tr: "Hacim", en: "Volume", fr: "Volume" },
  "ind.ma20": { tr: "SMA 20", en: "SMA 20", fr: "SMA 20" },
  "ind.ma50": { tr: "SMA 50", en: "SMA 50", fr: "SMA 50" },
  "ind.ma200": { tr: "SMA 200", en: "SMA 200", fr: "SMA 200" },
  "ind.bb": { tr: "Bollinger", en: "Bollinger", fr: "Bollinger" },
  "ind.rsi": { tr: "RSI", en: "RSI", fr: "RSI" },
  "ind.macd": { tr: "MACD", en: "MACD", fr: "MACD" },
  "ind.stoch": { tr: "Stokastik", en: "Stochastic", fr: "Stochastique" },
  "ind.ma.title": { tr: "{n} periyotluk basit hareketli ortalama", en: "{n}-period simple moving average", fr: "Moyenne mobile simple sur {n} périodes" },
  "ind.bb.title": { tr: "Bollinger bantları (20, 2σ)", en: "Bollinger bands (20, 2σ)", fr: "Bandes de Bollinger (20, 2σ)" },
  "ind.volume.title": { tr: "İşlem hacmi (yeşil: yükselen, kırmızı: düşen bar)", en: "Volume (green: up bar, red: down bar)", fr: "Volume (vert : barre haussière, rouge : baissière)" },
  "ind.rsi.title": { tr: "Göreceli güç endeksi (14) — 70 üstü aşırı alım, 30 altı aşırı satım", en: "Relative strength index (14) — above 70 overbought, below 30 oversold", fr: "Indice de force relative (14) — au-dessus de 70 suracheté, sous 30 survendu" },
  "ind.macd.title": { tr: "MACD (12, 26, 9) — çizgi, sinyal ve histogram", en: "MACD (12, 26, 9) — line, signal and histogram", fr: "MACD (12, 26, 9) — ligne, signal et histogramme" },
  "ind.stoch.title": { tr: "Stokastik (14, 3, 3) — 80 üstü aşırı alım, 20 altı aşırı satım", en: "Stochastic (14, 3, 3) — above 80 overbought, below 20 oversold", fr: "Stochastique (14, 3, 3) — au-dessus de 80 suracheté, sous 20 survendu" },
  "ind.disabledInCompare": { tr: "Karşılaştırma modunda kapalı", en: "Off while comparing", fr: "Désactivé en mode comparaison" },
  "compare.label": { tr: "XU100 ile kıyasla", en: "Compare with XU100", fr: "Comparer à XU100" },
  "compare.title": { tr: "Hisseyi BIST 100 ile yüzde getiri olarak karşılaştır", en: "Compare the stock with BIST 100 as percentage return", fr: "Comparer l'action au BIST 100 en rendement (%)" },

  "action.zoomIn": { tr: "Yakınlaştır", en: "Zoom in", fr: "Zoom avant" },
  "action.zoomOut": { tr: "Uzaklaştır", en: "Zoom out", fr: "Zoom arrière" },
  "action.reset": { tr: "Görünümü sıfırla", en: "Reset view", fr: "Réinitialiser la vue" },
  "action.measure": { tr: "Ölç — iki nokta arasında sürükleyin (kısayol: Shift + sürükle)", en: "Measure — drag between two points (shortcut: Shift + drag)", fr: "Mesurer — glissez entre deux points (raccourci : Maj + glisser)" },
  "action.measureOn": { tr: "Ölçüm modunu kapat", en: "Turn off measure mode", fr: "Désactiver la mesure" },
  "action.fullscreen": { tr: "Tam ekran", en: "Full screen", fr: "Plein écran" },
  "action.exitFullscreen": { tr: "Tam ekrandan çık (Esc)", en: "Exit full screen (Esc)", fr: "Quitter le plein écran (Échap)" },
  "action.download": { tr: "PNG olarak indir", en: "Download as PNG", fr: "Télécharger en PNG" },
  "action.table": { tr: "Veri tablosu", en: "Data table", fr: "Tableau de données" },
  "action.hideTable": { tr: "Tabloyu gizle", en: "Hide table", fr: "Masquer le tableau" },
  "action.toolbar": { tr: "Grafik araçları", en: "Chart tools", fr: "Outils du graphique" },

  "legend.open": { tr: "A", en: "O", fr: "O" },
  "legend.high": { tr: "Y", en: "H", fr: "H" },
  "legend.low": { tr: "D", en: "L", fr: "B" },
  "legend.close": { tr: "K", en: "C", fr: "C" },
  "legend.openLong": { tr: "Açılış", en: "Open", fr: "Ouverture" },
  "legend.highLong": { tr: "Yüksek", en: "High", fr: "Haut" },
  "legend.lowLong": { tr: "Düşük", en: "Low", fr: "Bas" },
  "legend.closeLong": { tr: "Kapanış", en: "Close", fr: "Clôture" },
  "legend.volume": { tr: "Hac", en: "Vol", fr: "Vol" },
  "legend.volumeLong": { tr: "Hacim", en: "Volume", fr: "Volume" },
  "legend.change": { tr: "Değişim", en: "Change", fr: "Variation" },
  "legend.value": { tr: "Değer", en: "Value", fr: "Valeur" },
  "legend.signal": { tr: "Sinyal", en: "Signal", fr: "Signal" },
  "legend.histogram": { tr: "Histogram", en: "Histogram", fr: "Histogramme" },
  "legend.bbUpper": { tr: "Üst", en: "Upper", fr: "Haute" },
  "legend.bbMiddle": { tr: "Orta", en: "Middle", fr: "Médiane" },
  "legend.bbLower": { tr: "Alt", en: "Lower", fr: "Basse" },

  "baseline.prevClose": { tr: "Önceki kapanış", en: "Previous close", fr: "Clôture précédente" },
  "baseline.periodStart": { tr: "Dönem başı", en: "Period start", fr: "Début de période" },

  "hint.wheel": { tr: "Yakınlaştırmak için {key} + kaydırın · kaydırmak için sürükleyin", en: "Use {key} + scroll to zoom · drag to pan", fr: "{key} + molette pour zoomer · glissez pour défiler" },
  "hint.measure": { tr: "Ölçmek için grafikte sürükleyin · Esc ile kapatın", en: "Drag on the chart to measure · Esc to close", fr: "Glissez sur le graphique pour mesurer · Échap pour fermer" },
  "hint.touch": { tr: "İki parmakla yakınlaştırın · yana sürükleyin", en: "Pinch to zoom · swipe sideways to pan", fr: "Pincez pour zoomer · glissez sur le côté" },
  "hint.measureTouch": { tr: "Ölçmek için grafikte sürükleyin", en: "Drag across the chart to measure", fr: "Glissez sur le graphique pour mesurer" },
  "hint.keyboard": {
    tr: "Klavye: ← → çubuklar arasında gezinir (Shift ile 10), Home/End başa/sona gider, + ve − yakınlaştırır, 0 görünümü sıfırlar, Esc imleci kaldırır.",
    en: "Keyboard: ← → move between bars (Shift for 10), Home/End jump to the ends, + and − zoom, 0 resets the view, Esc clears the cursor.",
    fr: "Clavier : ← → parcourent les barres (Maj pour 10), Début/Fin vont aux extrémités, + et − zooment, 0 réinitialise la vue, Échap efface le curseur.",
  },
  "chart.roleDescription": { tr: "etkileşimli grafik", en: "interactive chart", fr: "graphique interactif" },
  "chart.loading": { tr: "Grafik yükleniyor", en: "Loading chart", fr: "Chargement du graphique" },
  "chart.error": { tr: "Grafik verisi yüklenemedi", en: "Could not load the chart data", fr: "Impossible de charger les données du graphique" },
  "chart.updating": { tr: "Güncelleniyor", en: "Updating", fr: "Mise à jour" },
  "chart.live": { tr: "Canlı", en: "Live", fr: "En direct" },
  "chart.visibleRange": { tr: "Görünen aralık", en: "Visible range", fr: "Plage affichée" },
  "chart.rangeLabel": { tr: "{from} – {to}", en: "{from} – {to}", fr: "{from} – {to}" },
  "chart.sinceStart": { tr: "{date} itibarıyla", en: "since {date}", fr: "depuis le {date}" },
  "chart.rangeHighLow": { tr: "Aralık", en: "Range", fr: "Plage" },
  "chart.bars": { tr: "{n} bar", en: "{n} bars", fr: "{n} barres" },
  "chart.announce": { tr: "{date}: kapanış {close}, {change}", en: "{date}: close {close}, {change}", fr: "{date} : clôture {close}, {change}" },

  "measure.bars": { tr: "{n} bar", en: "{n} bars", fr: "{n} barres" },
  "span.minutes": { tr: "{n} dk", en: "{n} min", fr: "{n} min" },
  "span.hours": { tr: "{n} sa", en: "{n} h", fr: "{n} h" },
  "span.days": { tr: "{n} gün", en: "{n} days", fr: "{n} jours" },
  "span.months": { tr: "{n} ay", en: "{n} mo", fr: "{n} mois" },
  "span.years": { tr: "{n} yıl", en: "{n} yr", fr: "{n} ans" },

  "table.caption": { tr: "{symbol} fiyat verileri — görünen aralık, en yeni üstte", en: "{symbol} price data — visible range, newest first", fr: "Données de prix {symbol} — plage affichée, plus récent en haut" },
  "table.date": { tr: "Tarih", en: "Date", fr: "Date" },
  "table.truncated": { tr: "Son {n} satır gösteriliyor", en: "Showing the latest {n} rows", fr: "Affichage des {n} dernières lignes" },

  "attribution": { tr: "Grafik: TradingView Lightweight Charts™", en: "Charts: TradingView Lightweight Charts™", fr: "Graphiques : TradingView Lightweight Charts™" },
} as const satisfies Record<string, Record<Locale, string>>;

export type ChartKey = keyof typeof DICT;
export type ChartVars = Record<string, string | number>;

export function chartText(key: ChartKey, locale: Locale, vars?: ChartVars): string {
  const template: string = DICT[key][locale] ?? DICT[key].tr;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** `t(key, vars)` for the chart kit, bound to the active UI locale. */
export function useChartI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: ChartKey, vars?: ChartVars) => chartText(key, locale, vars), [locale]);
  return { t, locale };
}
