import { cn } from "@/lib/utils"

/** Placeholder block with a moving highlight (static under prefers-reduced-motion). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton-shimmer rounded-sm bg-muted/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
