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
      <button type="button" onClick={() => editor.setEditing(false)} className={cn(buttonVariants({ variant: "default", size: "md" }), className)}>
        <Check aria-hidden />
        {label(t("edit.done"))}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => editor.setEditing(true)}
      title={t("edit.buttonLabel")}
      className={cn(buttonVariants({ variant: "outline", size: "md" }), className)}
    >
      <LayoutGrid aria-hidden />
      {label(t("edit.button"))}
      {editor.customized ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
      {editor.customized ? <span className="sr-only">({t("edit.customized")})</span> : null}
    </button>
  );
}

const BAR_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/**
 * Floating toolbar while a page is being edited (bottom centre, clear of the
 * scroll-linked header): add, undo/redo, reset, done.
 */
export function EditBar({ editor, widgets, onAdd, hint }: { editor: LayoutEditor; widgets: number; onAdd: () => void; hint: string }) {
  const { t } = useWidgetI18n();
  return (
    <div
      role="toolbar"
      aria-label={t("edit.toolbar")}
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-max items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_16px_40px_-16px_rgb(0_0_0/0.45)] scrollbar-none md:bottom-5"
    >
      <div className="hidden min-w-0 items-center gap-2 pl-2 pr-3 lg:flex">
        <span className="flex flex-col leading-tight">
          <span className="text-[12px] font-semibold text-foreground">
            {t("edit.mode")} <span className="font-normal text-muted-foreground">· {t("edit.count", { count: widgets })}</span>
          </span>
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        </span>
      </div>
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
        className={cn(BAR_BUTTON, "w-8 px-0 text-muted-foreground hover:bg-muted hover:text-foreground")}
      >
        <Undo2 aria-hidden />
      </button>
      <button
        type="button"
        onClick={editor.redo}
        disabled={!editor.canRedo}
        aria-label={t("edit.redo")}
        title={`${t("edit.redo")} (⇧⌘Z)`}
        className={cn(BAR_BUTTON, "w-8 px-0 text-muted-foreground hover:bg-muted hover:text-foreground")}
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
      <button type="button" onClick={() => editor.setEditing(false)} className={cn(BAR_BUTTON, "bg-foreground px-3 text-background hover:bg-foreground/85")}>
        <Check aria-hidden />
        {t("edit.done")}
      </button>
    </div>
  );
}
