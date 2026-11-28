"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Buttons shared by the chart toolbars (main toolbar, drawing rail, menus).
 * Quiet by default, a muted fill with a hairline ring when pressed — never a
 * primary-filled selected state (see the dashboard design notes).
 */

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40";

export interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name and tooltip. */
  label: string;
  pressed?: boolean;
  /** `data-chart-action` hook (e.g. focus returns to the full-screen button). */
  action?: string;
  /** "sm": 28 px (toolbars); "md": 32 px (drawing rail, touch). */
  size?: "sm" | "md";
  children: ReactNode;
}

/** Square icon button; `aria-pressed` only when `pressed` is given (toggle). */
export const ToolButton = forwardRef<HTMLButtonElement, ToolButtonProps>(function ToolButton(
  { label, pressed, action, size = "sm", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-chart-action={action}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md motion-press-subtle",
        size === "sm"
          ? "h-7 w-7 pointer-coarse:h-11 pointer-coarse:w-11 [&>svg]:h-3.5 [&>svg]:w-3.5"
          : "h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 [&>svg]:h-4 [&>svg]:w-4",
        FOCUS,
        pressed
          ? "bg-muted text-foreground ring-1 ring-inset ring-border"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface ChipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pressed?: boolean;
}

/** Text button with an optional leading icon/key (toolbar menus and toggles). */
export const ChipButton = forwardRef<HTMLButtonElement, ChipButtonProps>(function ChipButton(
  { pressed, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium whitespace-nowrap motion-press-subtle pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
        FOCUS,
        pressed
          ? "border-foreground/30 bg-muted text-foreground"
          : "border-border bg-card text-foreground/85 hover:border-foreground/25 hover:bg-muted/60 hover:text-foreground data-[popup-open]:border-foreground/30 data-[popup-open]:bg-muted data-[popup-open]:text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Hairline divider between toolbar groups. */
export function ToolbarDivider({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return <span aria-hidden className={cn("shrink-0 bg-border", vertical ? "mx-1.5 h-px w-5" : "mx-1 h-4 w-px", className)} />;
}

/** Popup surface shared by the chart kit's menus and popovers. */
export const POPUP_CLASS =
  "rounded-md border border-border bg-popover text-popover-foreground shadow-[var(--shadow-popover)] outline-none";

/** Row of a Base UI menu (highlight follows pointer and arrows alike). */
export const MENU_ITEM_CLASS =
  "flex min-h-8 cursor-default select-none items-center gap-2.5 rounded-md px-2 py-1 text-[12px] text-foreground outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-muted";

export const MENU_GROUP_LABEL_CLASS = "px-2 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border",
        checked ? "border-foreground bg-foreground text-background" : "border-border",
      )}
    >
      {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
    </span>
  );
}

export function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-border">
      {checked ? <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> : null}
    </span>
  );
}
