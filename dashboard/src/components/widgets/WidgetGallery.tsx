"use client";

import { useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, Search, X } from "lucide-react";
import { foldTr } from "@/components/shared/search/fold";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { CATEGORIES, WIDGETS, type WidgetCategory } from "./catalog";
import { useWidgetI18n } from "./i18n";
import type { WidgetKey } from "./i18n-dict";

/**
 * The widget catalogue as a dialog: search, a category filter and a grid of
 * cards — one click adds the widget (where the visitor clicked "+", else at
 * the end of the page). Cards already on the page say so.
 */
export function WidgetGallery({
  open,
  onClose,
  onPick,
  counts,
  categories = CATEGORIES,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (type: string) => void;
  /** How many of each widget type the page already has. */
  counts: ReadonlyMap<string, number>;
  /** Categories offered first; the rest stay reachable under "All". */
  categories?: readonly WidgetCategory[];
}) {
  const { t } = useWidgetI18n();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<WidgetCategory | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);

  const order = useMemo(() => [...categories, ...CATEGORIES.filter((c) => !categories.includes(c))], [categories]);
  const results = useMemo(() => {
    const needle = foldTr(query.trim());
    return WIDGETS.filter((meta) => category === "all" || meta.category === category)
      .filter(
        (meta) =>
          !needle ||
          foldTr(`${t(meta.name)} ${t(meta.description)} ${t(`category.${meta.category}` as WidgetKey)} ${meta.keywords ?? ""}`).includes(needle),
      )
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  }, [query, category, order, t]);

  const grouped = useMemo(() => order.map((c) => ({ category: c, items: results.filter((meta) => meta.category === c) })).filter((group) => group.items.length > 0), [order, results]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setQuery("");
          setCategory("all");
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-(--motion-fade) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          initialFocus={searchRef}
          className={cn(
            "fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col rounded-t-xl border border-border bg-card text-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)] outline-none",
            "motion-panel motion-panel-slide [--motion-panel-offset:0_1.5rem]",
            "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-[8vh] md:max-h-[84vh] md:w-[min(56rem,calc(100vw-3rem))] md:transform-[translateX(-50%)] md:rounded-xl",
          )}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 pb-3 pt-4">
            <div className="min-w-0 grow">
              <Dialog.Title className="text-[17px] font-semibold">{t("gallery.title")}</Dialog.Title>
              <Dialog.Description className="sr-only">{t("gallery.subtitle")}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("settings.close")}
              className="-mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
            <label className="relative min-w-48 grow">
              <span className="sr-only">{t("gallery.search")}</span>
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("gallery.search")}
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>
            <SegmentedControl
              label={t("gallery.categories")}
              size="sm"
              value={category}
              onChange={setCategory}
              className="max-w-full overflow-x-auto scrollbar-none"
              options={[{ value: "all" as const, label: t("category.all") }, ...order.map((c) => ({ value: c, label: t(`category.${c}` as WidgetKey) }))]}
            />
          </div>

          <div className="min-h-0 grow overflow-y-auto overscroll-contain px-5 pb-6 pt-2 scrollbar-thin">
            {grouped.length === 0 ? <p className="py-10 text-center text-[13px] text-muted-foreground">{t("gallery.empty")}</p> : null}
            {grouped.map((group) => (
              <section key={group.category} aria-labelledby={`gallery-${group.category}`} className="pt-3">
                <h3 id={`gallery-${group.category}`} className="pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t(`category.${group.category}` as WidgetKey)}
                </h3>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((meta) => {
                    const Icon = meta.icon;
                    const count = counts.get(meta.type) ?? 0;
                    return (
                      <li key={meta.type} className="flex">
                        <button
                          type="button"
                          onClick={() => onPick(meta.type)}
                          className="group flex w-full items-start gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                        >
                          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground [&_svg]:size-4">
                            <Icon />
                          </span>
                          <span className="min-w-0 grow">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-semibold text-foreground">{t(meta.name)}</span>
                              {count > 0 ? (
                                <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] font-medium text-muted-foreground">{t("gallery.onPage", { count })}</span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted-foreground">{t(meta.description)}</span>
                          </span>
                          <Plus aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
