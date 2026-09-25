/**
 * Locale-aware text for screener bounds, filter chips and quick-screen rules.
 * Cell formatting uses lib/format.ts directly (it follows the UI language set by
 * LocaleProvider).
 */
import type { Locale } from "@/lib/i18n";
import { getIntlLocale } from "@/lib/format";
import { hasTaramaKey, taramaText, type TaramaKey, type TaramaVars } from "./i18n";
import { RANGE_BY_KEY, type Bounds, type PresetDef, type RangeFilterDef, type RangeKey, type RangeUnit } from "./model";

function plain(value: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: maxFractionDigits }).format(value);
}

/** An amount in ₺ billions / millions: "100 Mr ₺", "₺100 bn", "100 Md ₺". */
function withCurrencyUnit(amount: string, unit: "bn" | "mn", locale: Locale): string {
  if (unit === "bn") return locale === "en" ? `₺${amount} bn` : locale === "fr" ? `${amount} Md ₺` : `${amount} Mr ₺`;
  return locale === "en" ? `₺${amount} M` : locale === "fr" ? `${amount} M ₺` : `${amount} Mn ₺`;
}

/** One bound with its unit: "%4", "100 Mr ₺", "2x", "10". */
export function formatBoundValue(value: number, unit: RangeUnit, locale: Locale): string {
  switch (unit) {
    case "pct":
      return new Intl.NumberFormat(getIntlLocale(), { style: "percent", maximumFractionDigits: 2 }).format(value / 100);
    case "bn":
    case "mn":
      return withCurrencyUnit(plain(value), unit, locale);
    case "x":
      return `${plain(value)}x`;
    default:
      return plain(value);
  }
}

/** "≥ %4", "≤ 10", "20–100 Mr ₺", "%5 – %10". */
export function formatBounds(bounds: Bounds, unit: RangeUnit, locale: Locale): string {
  const { min, max } = bounds;
  if (min !== undefined && max !== undefined) {
    // One currency unit for the pair: "20–100 Mr ₺", not "20 Mr ₺ – 100 Mr ₺".
    if (unit === "bn" || unit === "mn") return withCurrencyUnit(`${plain(min)}–${plain(max)}`, unit, locale);
    return `${formatBoundValue(min, unit, locale)} – ${formatBoundValue(max, unit, locale)}`;
  }
  if (min !== undefined) return `≥ ${formatBoundValue(min, unit, locale)}`;
  if (max !== undefined) return `≤ ${formatBoundValue(max, unit, locale)}`;
  return "";
}

export function rangeChipLabel(def: RangeFilterDef, bounds: Bounds, locale: Locale): string {
  const label = taramaText(`range.${def.key}.short` as TaramaKey, locale);
  return `${label} ${formatBounds(bounds, def.unit, locale)}`;
}

/**
 * The rule a quick screen applies, written from its own definition ("F/K ≤ 10",
 * "Piyasa değeri 20–100 Mr ₺", "İş Yatırım önerisi: AL"), so the menu cannot drift
 * from the thresholds. A screen whose bounds read awkwardly as a formula has a
 * `preset.<id>.rule` sentence instead; its {placeholders} are the screen's own
 * bounds by range key, as amounts ("52H zirvenin en çok %5 altında").
 */
export function presetRule(preset: PresetDef, locale: Locale): string {
  const entries = Object.entries(preset.ranges ?? {}) as [RangeKey, Bounds][];
  const sentence = `preset.${preset.id}.rule`;
  if (hasTaramaKey(sentence)) {
    const vars: TaramaVars = {};
    for (const [key, bounds] of entries) {
      const def = RANGE_BY_KEY.get(key);
      const value = bounds.min ?? bounds.max;
      if (def && value !== undefined) vars[key] = formatBoundValue(Math.abs(value), def.unit, locale);
    }
    return taramaText(sentence, locale, vars);
  }
  const parts = entries.flatMap(([key, bounds]) => {
    const def = RANGE_BY_KEY.get(key);
    return def ? [rangeChipLabel(def, bounds, locale)] : [];
  });
  if (preset.cross) parts.push(taramaText(`rule.cross.${preset.cross}`, locale));
  if (preset.rec) parts.push(taramaText("rule.rec", locale, { rec: taramaText(`rec.${preset.rec}`, locale) }));
  if (preset.profitable) parts.push(taramaText("rule.profitable", locale));
  return parts.join(" · ");
}

/** A committed bound as editable text in the UI language ("1,5" in Turkish). */
export function boundInputText(value: number | undefined): string {
  if (value === undefined) return "";
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 6, useGrouping: false }).format(value);
}
