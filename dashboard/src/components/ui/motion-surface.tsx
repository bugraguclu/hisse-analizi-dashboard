"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import { staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

type ReleaseMenuProps = Pick<ComponentProps<typeof Menu.Root>, "onOpenChange" | "onOpenChangeComplete"> & {
  children: ReactNode;
  trigger: NonNullable<ComponentProps<typeof Menu.Trigger>["render"]>;
};

/** Keep Base UI's focus and keyboard behavior, and open pointer triggers on click. */
export function ReleaseMenu({ trigger, children, onOpenChange, onOpenChangeComplete }: ReleaseMenuProps) {
  const [handle] = useState(() => Menu.createHandle());
  const triggerId = useId();

  return (
    <Menu.Root handle={handle} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
      <Menu.Trigger
        id={triggerId}
        handle={handle}
        render={trigger}
        onMouseDown={(event) => event.preventBaseUIHandler()}
        onClick={(event) => {
          if (event.detail === 0) return;
          event.preventBaseUIHandler();
          if (handle.isOpen) handle.close();
          else handle.open(triggerId);
        }}
      />
      {children}
    </Menu.Root>
  );
}

const MENU_ROWS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-motion-menu-row]';

/** Keep the origin on the trigger corner even when the popup shifts to fit. */
function attachPopupMotion(popup: HTMLDivElement | null) {
  if (!popup) return;
  const positioner = popup.parentElement;
  if (!positioner) return;

  const update = () => {
    const side = popup.dataset.side;
    const vertical = side === "top" || side === "bottom";
    const triggerId = popup.getAttribute("aria-labelledby");
    const labelledTrigger = triggerId && document.getElementById(triggerId);
    const control = popup.id && document.querySelector(`[aria-controls="${CSS.escape(popup.id)}"]`);
    const trigger = labelledTrigger || control;
    if (trigger && side && popup.hasAttribute("data-open")) {
      const anchor = trigger.getBoundingClientRect();
      const surface = positioner.getBoundingClientRect();
      const alignStart = popup.dataset.align !== "end";
      const left = getComputedStyle(trigger).direction === "rtl" ? !alignStart : alignStart;
      const x = vertical ? (left ? anchor.left : anchor.right) : side === "left" ? anchor.left : anchor.right;
      const y = vertical ? (side === "top" ? anchor.top : anchor.bottom) : alignStart ? anchor.top : anchor.bottom;
      popup.style.setProperty("--motion-anchor-origin", `${x - surface.left}px ${y - surface.top}px`);
    }

    if (!popup.hasAttribute("data-starting-style")) return;
    const rows = Array.from(popup.querySelectorAll<HTMLElement>(MENU_ROWS));
    if (side === "top") rows.reverse();
    rows.forEach((row, index) => row.style.setProperty("--motion-row-delay", `${staggerDelay(index)}ms`));
  };

  update();
  const observer = new MutationObserver(update);
  observer.observe(popup, { attributes: true, attributeFilter: ["data-side", "data-align", "data-starting-style"] });
  observer.observe(positioner, { attributes: true, attributeFilter: ["style"] });
  return () => observer.disconnect();
}

export function MotionMenuPopup({ className, ...props }: ComponentProps<typeof Menu.Popup>) {
  return <Menu.Popup {...props} ref={attachPopupMotion} className={cn("motion-popover", className)} />;
}

export function MotionPopoverPopup({ className, ...props }: ComponentProps<typeof Popover.Popup>) {
  return <Popover.Popup {...props} ref={attachPopupMotion} className={cn("motion-popover", className)} />;
}
