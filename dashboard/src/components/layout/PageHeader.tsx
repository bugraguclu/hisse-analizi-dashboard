import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page title block shared by every section: optional eyebrow line (date, section),
 * serif title, one-line description and right-aligned actions, closed by a rule.
 * No icon tiles — the typography carries the hierarchy.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-border pb-4", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="text-xs text-muted-foreground first-letter:uppercase">{eyebrow}</p> : null}
        <h1 className="text-[28px] font-semibold leading-tight text-foreground md:text-[32px]">{title}</h1>
        {description ? <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
