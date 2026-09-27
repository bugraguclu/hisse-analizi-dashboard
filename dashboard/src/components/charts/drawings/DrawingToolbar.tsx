"use client";

import {
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Popover } from "@base-ui/react/popover";
import { Eye, EyeOff, Magnet, MousePointer2, Ruler, Trash2, Undo2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolbarDivider, ToolButton } from "../controls";
import { isApplePlatform } from "../use-coarse-pointer";
import { useDrawingI18n, type DrawingI18nKey } from "./i18n";
import { FibonacciIcon, HorizontalLineIcon, RayIcon, RectangleIcon, TrendIcon, VerticalLineIcon } from "./icons";
import type { DrawingTool } from "./types";

/**
 * Alt + key → tool, by `KeyboardEvent.code` (layout independent; on a Mac,
 * Option + letter types a symbol, so `key` is useless). Alt+R stays the
 * chart's reset, hence J for the ray and B ("box") for the rectangle.
 * Escape returns to the cursor through the drawing layer.
 */
export const DRAWING_SHORTCUTS: Readonly<Record<string, DrawingTool>> = {
  KeyT: "trend",
  KeyJ: "ray",
  KeyH: "hline",
  KeyV: "vline",
  KeyB: "rect",
  KeyF: "fib",
  KeyM: "measure",
};

/** The tool an Alt + key press picks, or null — for the chart's key handler. */
export function drawingShortcut(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string }): DrawingTool | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  return DRAWING_SHORTCUTS[event.code] ?? null;
}

const TOOLS: ReadonlyArray<{ tool: DrawingTool; label: DrawingI18nKey; icon: ReactNode }> = [
  { tool: "cursor", label: "tool.cursor", icon: <MousePointer2 /> },
  { tool: "trend", label: "tool.trend", icon: <TrendIcon /> },
  { tool: "ray", label: "tool.ray", icon: <RayIcon /> },
  { tool: "hline", label: "tool.hline", icon: <HorizontalLineIcon /> },
  { tool: "vline", label: "tool.vline", icon: <VerticalLineIcon /> },
  { tool: "rect", label: "tool.rect", icon: <RectangleIcon /> },
  { tool: "fib", label: "tool.fib", icon: <FibonacciIcon /> },
  { tool: "measure", label: "tool.measure", icon: <Ruler /> },
];

const SHORTCUT_KEY: Partial<Record<DrawingTool, string>> = Object.fromEntries(
  Object.entries(DRAWING_SHORTCUTS).map(([code, tool]) => [tool, code.slice(3)]),
);

const noSubscription = () => () => {};

/** Mac keyboards say ⌥ where others say Alt (server render and hydration: Alt). */
function useAppleKeys(): boolean {
  return useSyncExternalStore(noSubscription, isApplePlatform, () => false);
}

export interface DrawingToolbarProps {
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  /** "vertical": the full-screen rail; "horizontal": a strip in the card. */
  orientation: "vertical" | "horizontal";
  /** Drawings on the chart (clearing is disabled at 0). */
  count: number;
  hidden: boolean;
  onHiddenChange: (hidden: boolean) => void;
  magnet: boolean;
  onMagnetChange: (on: boolean) => void;
  onClearAll: () => void;
  onUndo?: () => void;
  canUndo?: boolean;
  className?: string;
}

/**
 * Drawing tools (cursor, trend, ray, horizontal/vertical line, rectangle,
 * Fibonacci, measure) and their switches (magnet, hide, undo, clear all).
 * One tab stop; arrow keys move between the buttons (WAI-ARIA toolbar).
 */
export function DrawingToolbar({
  tool,
  onToolChange,
  orientation,
  count,
  hidden,
  onHiddenChange,
  magnet,
  onMagnetChange,
  onClearAll,
  onUndo,
  canUndo = false,
  className,
}: DrawingToolbarProps) {
  const { t } = useDrawingI18n();
  const apple = useAppleKeys();
  const [focusIndex, setFocusIndex] = useState(-1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const vertical = orientation === "vertical";
  const size = vertical ? "md" : "sm";

  const shortcut = (target: DrawingTool) => {
    if (target === "cursor") return "Esc";
    const key = SHORTCUT_KEY[target];
    return key ? (apple ? `⌥${key}` : `Alt+${key}`) : null;
  };
  const toolLabel = (target: DrawingTool, label: DrawingI18nKey) => {
    const key = shortcut(target);
    return key ? t("tool.shortcut", { label: t(label), key }) : t(label);
  };

  // Roving tab stop: the last focused button, else the active tool.
  const undoIndex = TOOLS.length + 2;
  const clearIndex = onUndo ? TOOLS.length + 3 : TOOLS.length + 2;
  const disabledIndexes = new Set<number>();
  if (onUndo && !canUndo) disabledIndexes.add(undoIndex);
  if (count === 0) disabledIndexes.add(clearIndex);
  const activeIndex = Math.max(0, TOOLS.findIndex((entry) => entry.tool === tool));
  const tabStop = focusIndex >= 0 && focusIndex <= clearIndex && !disabledIndexes.has(focusIndex) ? focusIndex : activeIndex;
  const item = (index: number) => ({ "data-toolbar-index": index, tabIndex: index === tabStop ? 0 : -1 });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = vertical ? "ArrowDown" : "ArrowRight";
    if (![previousKey, nextKey, "Home", "End"].includes(event.key)) return;
    // Keys from the confirmation popup bubble here through the React portal: not toolbar navigation.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-toolbar-index]:not(:disabled)"));
    if (buttons.length === 0) return;
    const current = buttons.findIndex((button) => button === document.activeElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === nextKey) next = (current + 1) % buttons.length;
    else next = (current - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const index = Number((event.target as HTMLElement).dataset.toolbarIndex);
    if (Number.isInteger(index)) setFocusIndex(index);
  };

  return (
    <div
      role="toolbar"
      aria-label={t("toolbar")}
      aria-orientation={orientation}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn("flex items-center gap-0.5", vertical && "flex-col", className)}
    >
      {TOOLS.map((entry, index) => (
        <ToolButton
          key={entry.tool}
          {...item(index)}
          size={size}
          label={toolLabel(entry.tool, entry.label)}
          pressed={tool === entry.tool}
          // Picking the active drawing tool again goes back to the cursor.
          onClick={() => onToolChange(tool === entry.tool && entry.tool !== "cursor" ? "cursor" : entry.tool)}
        >
          {entry.icon}
        </ToolButton>
      ))}
      <ToolbarDivider vertical={vertical} />
      <ToolButton
        {...item(TOOLS.length)}
        size={size}
        label={t("magnet")}
        title={t("magnet.title")}
        pressed={magnet}
        onClick={() => onMagnetChange(!magnet)}
      >
        <Magnet />
      </ToolButton>
      <ToolButton
        {...item(TOOLS.length + 1)}
        size={size}
        label={hidden ? t("show") : t("hide")}
        pressed={hidden}
        onClick={() => onHiddenChange(!hidden)}
      >
        {hidden ? <EyeOff /> : <Eye />}
      </ToolButton>
      {onUndo ? (
        <ToolButton {...item(undoIndex)} size={size} label={`${t("undo")} (${apple ? "⌘Z" : "Ctrl+Z"})`} disabled={!canUndo} onClick={onUndo}>
          <Undo2 />
        </ToolButton>
      ) : null}
      <Popover.Root open={confirmOpen && count > 0} onOpenChange={setConfirmOpen}>
        <Popover.Trigger
          disabled={count === 0}
          render={
            <ToolButton {...item(clearIndex)} size={size} label={t("clearAll")}>
              <Trash2 />
            </ToolButton>
          }
        />
        <Popover.Portal>
          {/* Above the full-screen chart dialog (z-80). */}
          <Popover.Positioner side={vertical ? "right" : "bottom"} align="start" sideOffset={6} collisionPadding={8} className="z-[90]">
            <Popover.Popup
              initialFocus={cancelRef}
              // Escape closes the confirmation only, not the full-screen chart around it.
              onKeyDown={(event) => {
                if (event.key === "Escape") event.preventDefault();
              }}
              className="w-max max-w-[16rem] rounded-md border border-border bg-popover p-2.5 text-[11px] leading-4 text-popover-foreground outline-none"
            >
              <Popover.Title className="text-xs font-medium text-foreground">{t("clearAll.confirm")}</Popover.Title>
              <Popover.Description className="mt-0.5 text-muted-foreground">{t("clearAll.count", { n: count })}</Popover.Description>
              <div className="mt-2 flex justify-end gap-1.5">
                <Popover.Close ref={cancelRef} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("clearAll.no")}
                </Popover.Close>
                <button
                  type="button"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-destructive hover:bg-destructive/10 hover:text-destructive")}
                  onClick={() => {
                    setConfirmOpen(false);
                    onClearAll();
                  }}
                >
                  {t("clearAll.yes")}
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
