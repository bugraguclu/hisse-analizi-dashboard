"use client";

import { useCallback } from "react";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

/** UI strings of the drawing tools (tr is the source language). */
const DICT = {
  "toolbar": { tr: "Çizim araçları", en: "Drawing tools", fr: "Outils de dessin" },
  "tool.cursor": { tr: "İmleç", en: "Cursor", fr: "Curseur" },
  "tool.trend": { tr: "Trend çizgisi", en: "Trend line", fr: "Ligne de tendance" },
  "tool.ray": { tr: "Işın", en: "Ray", fr: "Rayon" },
  "tool.hline": { tr: "Yatay çizgi", en: "Horizontal line", fr: "Ligne horizontale" },
  "tool.vline": { tr: "Dikey çizgi", en: "Vertical line", fr: "Ligne verticale" },
  "tool.rect": { tr: "Dikdörtgen", en: "Rectangle", fr: "Rectangle" },
  "tool.fib": { tr: "Fibonacci düzeltmesi", en: "Fibonacci retracement", fr: "Retracement de Fibonacci" },
  "tool.measure": { tr: "Ölçüm", en: "Measure", fr: "Mesure" },
  "tool.shortcut": { tr: "{label} ({key})", en: "{label} ({key})", fr: "{label} ({key})" },

  "magnet": { tr: "Mıknatıs", en: "Magnet", fr: "Aimant" },
  "magnet.title": {
    tr: "Mıknatıs — noktaları açılış/yüksek/düşük/kapanışa yapıştırır (Ctrl/⌘ ile geçici olarak tersine çevirin)",
    en: "Magnet — snaps points to open/high/low/close (hold Ctrl/⌘ to flip it while drawing)",
    fr: "Aimant — colle les points à l'ouverture/haut/bas/clôture (maintenez Ctrl/⌘ pour l'inverser)",
  },
  "hide": { tr: "Çizimleri gizle", en: "Hide drawings", fr: "Masquer les dessins" },
  "show": { tr: "Çizimleri göster", en: "Show drawings", fr: "Afficher les dessins" },
  "clearAll": { tr: "Tüm çizimleri sil", en: "Remove all drawings", fr: "Supprimer tous les dessins" },
  "clearAll.confirm": { tr: "Emin misiniz?", en: "Are you sure?", fr: "Êtes-vous sûr ?" },
  "clearAll.count": { tr: "{n} çizim silinecek.", en: "{n} drawings will be removed.", fr: "{n} dessins seront supprimés." },
  "clearAll.yes": { tr: "Sil", en: "Remove", fr: "Supprimer" },
  "clearAll.no": { tr: "Vazgeç", en: "Cancel", fr: "Annuler" },
  "undo": { tr: "Geri al", en: "Undo", fr: "Annuler" },

  "edit.label": { tr: "Çizimi düzenle", en: "Edit drawing", fr: "Modifier le dessin" },
  "edit.color": { tr: "Rengi değiştir", en: "Change colour", fr: "Changer la couleur" },
  "edit.dashed": { tr: "Kesikli çizgi", en: "Dashed line", fr: "Ligne pointillée" },
  "edit.delete": { tr: "Çizimi sil", en: "Remove drawing", fr: "Supprimer le dessin" },
  "color.-1": { tr: "Nötr", en: "Neutral", fr: "Neutre" },
  "color.0": { tr: "Mavi", en: "Blue", fr: "Bleu" },
  "color.1": { tr: "Hardal", en: "Ochre", fr: "Ocre" },
  "color.2": { tr: "Mor", en: "Plum", fr: "Prune" },
  "color.3": { tr: "Camgöbeği", en: "Teal", fr: "Sarcelle" },
  "color.4": { tr: "Gri", en: "Grey", fr: "Gris" },

  "hint.second": { tr: "İkinci noktayı seçin · Esc iptal", en: "Pick the second point · Esc to cancel", fr: "Choisissez le second point · Échap pour annuler" },
  "hint.secondTouch": { tr: "İkinci noktaya dokunun", en: "Tap the second point", fr: "Touchez le second point" },
} as const satisfies Record<string, Record<Locale, string>>;

export type DrawingI18nKey = keyof typeof DICT;
export type DrawingI18nVars = Record<string, string | number>;

export function drawingText(key: DrawingI18nKey, locale: Locale, vars?: DrawingI18nVars): string {
  const template: string = DICT[key][locale] ?? DICT[key].tr;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** `t(key, vars)` for the drawing tools, bound to the active UI locale. */
export function useDrawingI18n() {
  const { locale } = useLocale();
  const t = useCallback((key: DrawingI18nKey, vars?: DrawingI18nVars) => drawingText(key, locale, vars), [locale]);
  return { t, locale };
}
