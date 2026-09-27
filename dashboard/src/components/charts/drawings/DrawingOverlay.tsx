"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SERIES_CSS_VAR } from "../colors";
import { ToolbarDivider, ToolButton } from "../controls";
import { useDrawingI18n, type DrawingI18nKey } from "./i18n";
import { DashedLineIcon } from "./icons";
import { DRAWING_COLORS } from "./model";
import type { DrawingAnchor } from "./primitive";
import type { Drawing } from "./types";

/** Overlay elements carry `data-drawing-overlay`: the layer's plot listeners leave their pointer events alone. */
export const OVERLAY_SELECTOR = "[data-drawing-overlay]";

const COLOR_NAMES: Readonly<Record<string, DrawingI18nKey>> = {
  "-1": "color.-1",
  "0": "color.0",
  "1": "color.1",
  "2": "color.2",
  "3": "color.3",
  "4": "color.4",
};

/** Gap between the drawing and its edit bar, and the inset from the pane edges (px). */
const GAP = 10;
const EDGE = 4;

function swatchColor(color: number): string {
  return color >= 0 ? (SERIES_CSS_VAR[color] ?? "var(--foreground)") : "var(--foreground)";
}

export interface DrawingOverlayProps {
  /** Selected drawing and where it sits; null hides the edit bar. */
  edit: { drawing: Drawing; anchor: DrawingAnchor } | null;
  /** One-line hint over the time axis (second point of a two-point tool). */
  hint: string | null;
  coarse: boolean;
  onColor: (color: number) => void;
  onDashedToggle: () => void;
  onDelete: () => void;
}

/**
 * HTML rendered inside the chart's plot element: the floating edit bar of the
 * selected drawing (colour, dashed, delete) and the placement hint.
 */
export function DrawingOverlay({ edit, hint, coarse, onColor, onDashedToggle, onDelete }: DrawingOverlayProps) {
  return (
    <>
      {edit ? (
        <EditBar drawing={edit.drawing} anchor={edit.anchor} coarse={coarse} onColor={onColor} onDashedToggle={onDashedToggle} onDelete={onDelete} />
      ) : null}
      {hint ? (
        // Over the time axis, like the chart's own gesture hints: the top of the plot holds the legend.
        <div className="pointer-events-none absolute inset-x-0 bottom-0.5 z-[3] flex justify-center px-2">
          <span
            role="status"
            className="animate-fade rounded-md border border-border bg-popover px-2.5 py-1 text-center text-[11px] font-medium leading-4 text-popover-foreground"
          >
            {hint}
          </span>
        </div>
      ) : null}
    </>
  );
}

function EditBar({
  drawing,
  anchor,
  coarse,
  onColor,
  onDashedToggle,
  onDelete,
}: {
  drawing: Drawing;
  anchor: DrawingAnchor;
  coarse: boolean;
  onColor: (color: number) => void;
  onDashedToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useDrawingI18n();
  const barHeight = coarse ? 38 : 34;
  // Above the drawing's top-most point; below it when that would leave the pane, else pinned to the top.
  let top: number;
  let above = false;
  if (anchor.top - GAP - barHeight >= EDGE) {
    top = anchor.top - GAP;
    above = true;
  } else if (anchor.bottom + GAP + barHeight <= anchor.paneHeight - EDGE) {
    top = anchor.bottom + GAP;
  } else {
    top = EDGE;
  }
  // Horizontal clamp in CSS: the bar's own width resolves the percentages.
  const translateX = `clamp(${EDGE}px, calc(${anchor.x.toFixed(1)}px - 50%), calc(${(anchor.paneWidth - EDGE).toFixed(1)}px - 100%))`;
  const size = coarse ? "md" : "sm";

  return (
    <div
      data-drawing-overlay=""
      role="toolbar"
      aria-label={t("edit.label")}
      className="absolute left-0 z-[4] flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 text-[11px] text-popover-foreground"
      style={{ top, transform: `translate(${translateX}, ${above ? "-100%" : "0"})` }}
    >
      <div role="group" aria-label={t("edit.color")} className="flex items-center">
        {DRAWING_COLORS.map((color) => {
          const name = t(COLOR_NAMES[String(color)] ?? "color.-1");
          const current = color === drawing.color;
          return (
            <button
              key={color}
              type="button"
              title={`${t("edit.color")}: ${name}`}
              aria-label={name}
              aria-pressed={current}
              onClick={() => onColor(color)}
              className={cn(
                "inline-flex items-center justify-center rounded-md outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60",
                coarse ? "h-8 w-8" : "h-7 w-6",
              )}
            >
              <span
                aria-hidden
                className={cn("h-3.5 w-3.5 rounded-[3px]", current && "ring-1 ring-foreground/70 ring-offset-1 ring-offset-popover")}
                style={{ background: swatchColor(color) }}
              />
            </button>
          );
        })}
      </div>
      <ToolbarDivider />
      <ToolButton size={size} label={t("edit.dashed")} pressed={drawing.dashed === true} onClick={onDashedToggle}>
        <DashedLineIcon />
      </ToolButton>
      <ToolButton size={size} label={t("edit.delete")} onClick={onDelete}>
        <Trash2 />
      </ToolButton>
    </div>
  );
}
