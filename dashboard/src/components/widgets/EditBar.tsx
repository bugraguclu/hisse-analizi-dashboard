"use client";

import { Check, LayoutGrid, Plus, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWidgetI18n } from "./i18n";
import type { LayoutEditor } from "./use-layout-editor";

/** "Customize" in a page header; while editing it reads "Done". */
export function EditLayoutButton({ editor, compact = false, className }: { editor: LayoutEditor; /** Icon only below sm. */ compact?: boolean; className?: string }) {
  const { t } = useWidgetI18n();
  const label = (text: string) => (compact ? <span className="max-sm:sr-only">{text}</span> : text);
  if (editor.editing) {
    return (
      <button
        type="button"
        disabled={editor.pending}
        onClick={() => editor.setEditing(false)}
        className={cn(buttonVariants({ variant: "default", size: "md" }), "pointer-coarse:min-h-11", className)}
      >
        <Check aria-hidden />
        {label(t("edit.done"))}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={editor.pending}
      onClick={() => editor.setEditing(true)}
      title={t("edit.buttonLabel")}
      className={cn(buttonVariants({ variant: "outline", size: "md" }), "pointer-coarse:min-h-11", className)}
    >
      <LayoutGrid aria-hidden />
      {label(t("edit.button"))}
      {editor.customized ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
      {editor.customized ? <span className="sr-only">({t("edit.customized")})</span> : null}
    </button>
  );
}

const BAR_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors motion-press-subtle focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:min-w-11 [&_svg]:size-4";

/**
 * In-flow editing toolbar docked above the widget board so it never obscures
 * cards, links, or dialogs: add, undo/redo, reset, done.
 */
export function EditBar({ editor, widgets, onAdd, hint }: { editor: LayoutEditor; widgets: number; onAdd: () => void; hint: string }) {
  const { t } = useWidgetI18n();
  return (
    <div
      role="toolbar"
      aria-label={t("edit.toolbar")}
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-foreground pointer-coarse:gap-2.5"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-semibold text-foreground">
            {t("edit.mode")} <span className="font-normal text-muted-foreground">· {t("edit.count", { count: widgets })}</span>
          </span>
          <span className="hidden text-[11px] text-muted-foreground sm:block">{hint}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 pointer-coarse:gap-1.5">
        <button type="button" onClick={onAdd} className={cn(BAR_BUTTON, "bg-muted text-foreground hover:bg-muted/70")}>
          <Plus aria-hidden />
          {t("edit.add")}
        </button>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={editor.undo}
          disabled={!editor.canUndo}
          aria-label={t("edit.undo")}
          title={`${t("edit.undo")} (⌘Z)`}
          className={cn(BAR_BUTTON, "w-8 px-0 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:w-11")}
        >
          <Undo2 aria-hidden />
        </button>
        <button
          type="button"
          onClick={editor.redo}
          disabled={!editor.canRedo}
          aria-label={t("edit.redo")}
          title={`${t("edit.redo")} (⇧⌘Z)`}
          className={cn(BAR_BUTTON, "w-8 px-0 text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:w-11")}
        >
          <Redo2 aria-hidden />
        </button>
        {editor.reset ? (
          <button
            type="button"
            onClick={editor.reset}
            disabled={!editor.customized}
            className={cn(BAR_BUTTON, "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            <RotateCcw aria-hidden />
            <span className="hidden sm:inline">{t("edit.reset")}</span>
          </button>
        ) : null}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
        <button type="button" onClick={() => editor.setEditing(false)} className={cn(BAR_BUTTON, "motion-press bg-foreground px-3 text-background hover:bg-foreground/85")}>
          <Check aria-hidden />
          {t("edit.done")}
        </button>
      </div>
    </div>
  );
}
