"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { buttonVariants } from "@/components/ui/button";
import { SEVERITY_RULE_CLASS, type SeverityKey } from "@/components/shared/SeverityBadge";
import { cn } from "@/lib/utils";

/** Same focus treatment as components/ui/button.tsx. */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** Neutral pressed/selected state (primary is reserved for links and focus). */
export const SELECTED_CLASS = "border-foreground bg-muted text-foreground";
export const UNSELECTED_CLASS = "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground";

/** Secondary action (bordered), for <button>, <a> and <Link>. */
export const ACTION_CLASS = buttonVariants({ variant: "outline", size: "md" });

/** Square icon-only button; always give it an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function IconButton(
  { className, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant: "ghost", size: "md" }), "w-8 px-0", className)} {...props} />;
});

/** 2px vertical marker echoing the row-edge severity rule (INFO gets a neutral one). */
export function SeverityMarker({ level, className }: { level: SeverityKey; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-3 w-0.5 shrink-0", SEVERITY_RULE_CLASS[level] ?? "bg-muted-foreground/40", className)} />;
}
