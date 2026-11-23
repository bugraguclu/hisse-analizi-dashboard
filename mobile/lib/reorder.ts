/** Pure list-ordering helpers shared by drag-to-reorder lists and persisted layouts. */

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(to, next.length - 1));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Where a dragged row should land, given every row's measured box and how far
 * the dragged row has moved. A row is passed once the dragged row's centre
 * reaches that row's centre, so a row pinned at the list edge still lands there.
 */
export function dropIndex(
  layouts: readonly { y: number; height: number }[],
  from: number,
  dy: number,
): number {
  const active = layouts[from];
  if (!active) return from;
  const centre = active.y + active.height / 2 + dy;
  let to = from;
  for (let i = from + 1; i < layouts.length; i += 1) {
    if (centre >= layouts[i].y + layouts[i].height / 2) to = i;
  }
  for (let i = from - 1; i >= 0; i -= 1) {
    if (centre <= layouts[i].y + layouts[i].height / 2) to = i;
  }
  return to;
}

// ---------------------------------------------------------------------------
// Home screen layout
// ---------------------------------------------------------------------------

export const HOME_SECTION_IDS = ["summary", "watchlist", "movers", "indices", "macro"] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

export interface HomeSectionPref {
  id: HomeSectionId;
  visible: boolean;
}

export const HOME_SECTION_LABELS: Record<HomeSectionId, { title: string; hint: string }> = {
  summary: { title: "BIST 100 özeti", hint: "Endeks, piyasa genişliği, alt endeksler" },
  watchlist: { title: "Takip listen", hint: "Takip ettiğin hisselerin fiyatı" },
  movers: { title: "Günün hareketlileri", hint: "Yükselen, düşen, en çok işlem gören" },
  indices: { title: "Endeksler", hint: "Tüm BIST endeksleri" },
  macro: { title: "Makroekonomi", hint: "Enflasyon, kur, faiz kısayolları" },
};

export const DEFAULT_HOME_SECTIONS: readonly HomeSectionPref[] = HOME_SECTION_IDS.map((id) => ({ id, visible: true }));

/**
 * Keeps the user's order and visibility, drops unknown or duplicate ids and
 * appends sections added in later versions so they are never lost.
 */
export function sanitizeHomeSections(raw: unknown): HomeSectionPref[] {
  const known = new Set<string>(HOME_SECTION_IDS);
  const seen = new Set<string>();
  const result: HomeSectionPref[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const { id, visible } = item as Record<string, unknown>;
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      result.push({ id: id as HomeSectionId, visible: visible !== false });
    }
  }
  for (const id of HOME_SECTION_IDS) {
    if (!seen.has(id)) result.push({ id, visible: true });
  }
  return result;
}
