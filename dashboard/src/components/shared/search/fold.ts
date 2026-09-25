const FOLD_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/**
 * Turkish-insensitive search key: "İŞ BANKASI" → "is bankasi", "Türk" → "turk".
 * Lower-cased with the Turkish rules first, so "I" folds to "i" rather than
 * staying a dotless "ı", and "ORİJİNAL" finds "orijinal".
 */
export function foldTr(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşüâîû]/g, (char) => FOLD_MAP[char] ?? char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
