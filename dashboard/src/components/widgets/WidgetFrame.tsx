"use client";

import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, Ellipsis, GripVertical, MoveVertical, Settings2, StretchHorizontal, Trash2, X } from "lucide-react";
import { MENU_ITEM_CLASS, POPUP_CLASS, RadioMark } from "@/components/charts/controls";
import { cn } from "@/lib/utils";
import { useWidgetI18n } from "./i18n";
import type { WidgetKey } from "./i18n-dict";
import type { MoveDirection } from "./model";

export const WIDTH_PRESETS = [3, 4, 6, 8, 9, 12] as const;
export const HEIGHT_PRESETS = [240, 320, 400, 480, 560, 640, 800] as const;

const KEY_DIRECTIONS: Record<string, MoveDirection> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const MOVES: ReadonlyArray<{ direction: MoveDirection; label: WidgetKey; icon: typeof ArrowUp }> = [
  { direction: "up", label: "move.up", icon: ArrowUp },
  { direction: "down", label: "move.down", icon: ArrowDown },
  { direction: "left", label: "move.left", icon: ArrowLeft },
  { direction: "right", label: "move.right", icon: ArrowRight },
];

const TOOL_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[popup-open]:bg-muted data-[popup-open]:text-foreground [&_svg]:size-4";

function MenuPopup({ children, side = "bottom" }: { children: ReactNode; side?: "bottom" | "inline-end" }) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} align={side === "bottom" ? "end" : "start"} sideOffset={side === "bottom" ? 6 : 2} collisionPadding={12} className="z-[90]">
        <Menu.Popup className={cn(POPUP_CLASS, "min-w-48 p-1")}>{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function Submenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={cn(MENU_ITEM_CLASS, "pr-1.5 data-[popup-open]:bg-muted")}>
        <span className="flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <span className="grow">{label}</span>
        <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
      </Menu.SubmenuTrigger>
      <MenuPopup side="inline-end">{children}</MenuPopup>
    </Menu.SubmenuRoot>
  );
}

/**
 * Edit-mode chrome over one widget: the surface (drag it to move — mouse and
 * pen; touch drags from the grip so the page still scrolls), a toolbar with
 * the grip (arrow keys move the widget), its name, the options menu (width,
 * height, move, settings) and remove.
 */
export function WidgetFrame({
  widgetId,
  name,
  icon,
  columnWidth,
  height,
  interactive,
  dragging,
  highlighted,
  canMove,
  hasSettings,
  onPointerDownSurface,
  onPointerDownGrip,
  onMove,
  onWidth,
  onHeight,
  onSettings,
  onRemove,
}: {
  widgetId: string;
  name: string;
  icon: ReactNode;
  columnWidth: number;
  height: number | undefined;
  /** Drag and resize available (wide screens). */
  interactive: boolean;
  dragging: boolean;
  highlighted: boolean;
  canMove: (direction: MoveDirection) => boolean;
  hasSettings: boolean;
  onPointerDownSurface: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDownGrip: (event: ReactPointerEvent<HTMLElement>) => void;
  onMove: (direction: MoveDirection) => void;
  onWidth: (width: number) => void;
  onHeight: (height: number | null) => void;
  onSettings: () => void;
  onRemove: () => void;
}) {
  const { t } = useWidgetI18n();
  const heightValue = height === undefined ? "auto" : String(height);
  const heights: number[] = [...HEIGHT_PRESETS];
  if (height !== undefined && !heights.includes(height)) heights.push(height);
  heights.sort((a, b) => a - b);

  const onGripKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault();
    if (canMove(direction)) onMove(direction);
  };

  return (
    <div
      data-widget-frame={widgetId}
      onPointerDown={interactive ? onPointerDownSurface : undefined}
      className={cn(
        "absolute inset-0 z-10 rounded-2xl ring-inset transition-[box-shadow,background-color] duration-150",
        interactive && "cursor-grab active:cursor-grabbing",
        dragging
          ? "bg-background/60 ring-2 ring-dashed ring-primary/50"
          : highlighted
            ? "bg-primary/[0.06] ring-2 ring-primary"
            : "ring-1 ring-primary/25 hover:bg-primary/[0.035] hover:ring-primary/60 has-[:focus-visible]:ring-primary/60",
      )}
    >
      <div
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-2 top-2 flex max-w-[calc(100%-1rem)] cursor-default items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)]"
      >
        <button
          type="button"
          data-grip={widgetId}
          aria-label={t("widget.drag", { name })}
          title={t("widget.drag", { name })}
          onPointerDown={onPointerDownGrip}
          onKeyDown={onGripKeyDown}
          className={cn(TOOL_BUTTON, "touch-none", interactive ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
        >
          <GripVertical aria-hidden />
        </button>
        <span className="flex min-w-0 items-center gap-1.5 px-1 text-[11px] font-medium text-foreground">
          <span aria-hidden className="text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
          <span className="truncate">{name}</span>
        </span>
        <Menu.Root>
          <Menu.Trigger aria-label={t("widget.menu", { name })} title={t("widget.menu", { name })} className={TOOL_BUTTON}>
            <Ellipsis aria-hidden />
          </Menu.Trigger>
          <MenuPopup>
            <Submenu label={t("widget.width")} icon={<StretchHorizontal />}>
              <Menu.RadioGroup value={String(columnWidth)} onValueChange={(value: string) => onWidth(Number(value))}>
                {WIDTH_PRESETS.map((width) => (
                  <Menu.RadioItem key={width} value={String(width)} className={MENU_ITEM_CLASS} closeOnClick>
                    <RadioMark checked={columnWidth === width} />
                    <span className="grow">{t(`width.${width}` as WidgetKey)}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Submenu>
            <Submenu label={t("widget.height")} icon={<MoveVertical />}>
              <Menu.RadioGroup value={heightValue} onValueChange={(value: string) => onHeight(value === "auto" ? null : Number(value))}>
                <Menu.RadioItem value="auto" className={MENU_ITEM_CLASS} closeOnClick>
                  <RadioMark checked={heightValue === "auto"} />
                  {t("height.auto")}
                </Menu.RadioItem>
                {heights.map((px) => (
                  <Menu.RadioItem key={px} value={String(px)} className={MENU_ITEM_CLASS} closeOnClick>
                    <RadioMark checked={heightValue === String(px)} />
                    <span className="font-mono tabular-nums">{t("height.px", { px })}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Submenu>
            <Submenu label={t("widget.move")} icon={<GripVertical />}>
              {MOVES.map(({ direction, label, icon: Icon }) => (
                <Menu.Item key={direction} className={MENU_ITEM_CLASS} disabled={!canMove(direction)} onClick={() => onMove(direction)} closeOnClick={false}>
                  <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                  {t(label)}
                </Menu.Item>
              ))}
            </Submenu>
            <Menu.Separator className="my-1 h-px bg-border" />
            {hasSettings ? (
              <Menu.Item className={MENU_ITEM_CLASS} onClick={onSettings}>
                <Settings2 aria-hidden className="size-4 text-muted-foreground" />
                {t("widget.settings")}
              </Menu.Item>
            ) : null}
            <Menu.Item className={cn(MENU_ITEM_CLASS, "text-destructive")} onClick={onRemove}>
              <Trash2 aria-hidden className="size-4" />
              {t("widget.remove")}
            </Menu.Item>
          </MenuPopup>
        </Menu.Root>
        <button type="button" aria-label={t("widget.removeNamed", { name })} title={t("widget.remove")} onClick={onRemove} className={cn(TOOL_BUTTON, "hover:text-destructive")}>
          <X aria-hidden />
        </button>
      </div>
    </div>
  );
}
