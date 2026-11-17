"use client";

import { useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Hourglass, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMakroI18n } from "@/components/makro/i18n";
import { MACRO_QUERY_ROOT } from "@/components/makro/queries";
import { headingLabel } from "@/components/widgets/basic";
import type { WidgetCategory } from "@/components/widgets/catalog";
import { EditLayoutButton } from "@/components/widgets/EditBar";
import { useWidgetI18n } from "@/components/widgets/i18n";
import { widgetsInOrder, type Layout } from "@/components/widgets/model";
import { useSitePageEditor } from "@/components/widgets/use-site-page";
import { MACRO_WIDGETS } from "@/components/widgets/macro-widgets";
import { WidgetBoard } from "@/components/widgets/WidgetBoard";
import styles from "./refresh-button.module.css";

const GALLERY_ORDER: readonly WidgetCategory[] = ["macro", "market", "stock", "general"];

function RefreshButton() {
  const { t } = useMakroI18n();
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: MACRO_QUERY_ROOT }) > 0;
  const [refreshing, setRefreshing] = useState(false);
  const busy = fetching || refreshing;

  async function refresh() {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: MACRO_QUERY_ROOT });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={busy}
      aria-busy={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {fetching && !refreshing ? (
        <Hourglass className="h-3.5 w-3.5 skeleton-pulse" aria-hidden />
      ) : (
        <RefreshCw className={`h-3.5 w-3.5 ${styles.refreshIcon}`} data-refreshing={refreshing || undefined} aria-hidden />
      )}
      {busy ? t("page.refreshing") : t("page.refresh")}
    </button>
  );
}

/** In-page links to the layout's headings that carry an anchor (the default layout's sections). */
function SectionNav({ layout }: { layout: Layout }) {
  const { t } = useMakroI18n();
  const { t: tw } = useWidgetI18n();
  const sections = widgetsInOrder(layout).flatMap((widget) => {
    const anchor = widget.type === "general.heading" ? widget.options?.anchor : undefined;
    return typeof anchor === "string" && anchor ? [{ id: anchor, title: headingLabel(widget.options, tw) }] : [];
  });
  if (sections.length === 0) return null;
  return (
    <nav aria-label={t("page.sections")} className="-mx-1 overflow-x-auto scrollbar-none">
      <ul className="flex w-max gap-1 px-1">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Page order, most important for an investor first: the policy rate and
 * inflation drive valuations, markets and the release calendar move every day,
 * growth and the external balance change slowly (the default layout in
 * components/widgets/defaults.ts; "Customize" makes it the visitor's own).
 */
export default function MakroPage() {
  const { t } = useMakroI18n();
  const editor = useSitePageEditor("macro");

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-6">
      <div className="space-y-3">
        <PageHeader
          eyebrow={t("page.eyebrow")}
          title={t("page.title")}
          actions={
            <>
              <RefreshButton />
              <EditLayoutButton editor={editor} />
            </>
          }
        />
        <SectionNav layout={editor.layout} />
      </div>

      {/* Nothing waits to mount here: /makro?piyasa=… scrolls to the markets chart on arrival. */}
      <WidgetBoard
        editor={editor}
        context={{ ticker: null, tickerOverrides: true }}
        components={MACRO_WIDGETS}
        galleryCategories={GALLERY_ORDER}
        lazyFromRow={Infinity}
      />
    </div>
  );
}
