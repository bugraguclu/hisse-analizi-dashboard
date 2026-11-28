"use client";

import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
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
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { cn } from "@/lib/utils";
import styles from "./refresh-button.module.css";

const GALLERY_ORDER: readonly WidgetCategory[] = ["macro", "market", "stock", "general"];

function RefreshButton() {
  const { t } = useMakroI18n();
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: MACRO_QUERY_ROOT }) > 0;
  const motionAllowed = useMotionAllowed();
  const [refreshing, setRefreshing] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const busy = fetching || refreshing;

  useEffect(() => {
    if (busy || motionAllowed || !spinning) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSpinning(false);
    });
    return () => {
      cancelled = true;
    };
  }, [busy, motionAllowed, spinning]);

  async function refresh() {
    setRefreshing(true);
    if (motionAllowed) setSpinning(true);
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
      className={cn(
        buttonVariants({ variant: "ghost", size: "md" }),
        "border border-border bg-card text-xs text-foreground disabled:cursor-wait disabled:opacity-70 pointer-coarse:min-h-11",
      )}
    >
      <RefreshCw
        className={cn("h-3.5 w-3.5", styles.refreshIcon)}
        data-refreshing={(busy || (motionAllowed && spinning)) || undefined}
        onAnimationStart={() => {
          if (motionAllowed) setSpinning(true);
        }}
        onAnimationIteration={() => {
          if (!busy) setSpinning(false);
        }}
        aria-hidden
      />
      {busy ? t("page.refreshing") : t("page.refresh")}
    </button>
  );
}

/** In-page links to the layout's headings that carry an anchor (the default layout's sections). */
function SectionNav({ layout }: { layout: Layout }) {
  const { t } = useMakroI18n();
  const { t: tw } = useWidgetI18n();
  const navRef = useRef<HTMLElement>(null);
  const sections = widgetsInOrder(layout).flatMap((widget) => {
    const anchor = widget.type === "general.heading" ? widget.options?.anchor : undefined;
    return typeof anchor === "string" && anchor ? [{ id: anchor, title: headingLabel(widget.options, tw) }] : [];
  });

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline", "scroll()")) {
      el.removeAttribute("data-fade-start");
      el.removeAttribute("data-fade-end");
      return;
    }
    const update = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 2) {
        el.dataset.fadeStart = "false";
        el.dataset.fadeEnd = "false";
        return;
      }
      const left = Math.abs(el.scrollLeft);
      el.dataset.fadeStart = left > 4 ? "true" : "false";
      el.dataset.fadeEnd = maxScroll - left > 4 ? "true" : "false";
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => el.removeEventListener("scroll", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [sections.length]);

  if (sections.length === 0) return null;
  return (
    <nav ref={navRef} aria-label={t("page.sections")} className="-mx-1 overflow-x-auto scrollbar-none scroll-fade-x">
      <ul className="flex w-max gap-1 px-1">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "px-2.5 text-xs pointer-coarse:min-h-11",
              )}
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
          className="[&_h1]:font-display [&_h1]:font-normal"
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
