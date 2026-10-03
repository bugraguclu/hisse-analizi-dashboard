"use client";

import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import { POPUP_CLASS } from "@/components/charts/controls";
import { TickerSearch } from "@/components/shared/TickerSearch";
import { cn } from "@/lib/utils";

/** A button showing a stock symbol that opens the stock search to pick another. */
export function TickerPicker({
  value,
  onChange,
  label,
  children,
  className,
}: {
  value: string;
  onChange: (ticker: string) => void;
  /** Accessible name of the button ("Change the page's stock"). */
  label: string;
  /** Optional text before the symbol. */
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`${label}: ${value}`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[popup-open]:bg-muted",
          className,
        )}
      >
        {children}
        <span className="font-mono font-semibold">{value}</span>
        <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[95]">
          <Popover.Popup className={cn(POPUP_CLASS, "w-[min(22rem,calc(100vw-2rem))] p-2")}>
            <TickerSearch
              variant="overlay"
              autoFocus
              onSelect={(ticker) => {
                onChange(ticker);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
