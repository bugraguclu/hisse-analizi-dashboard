import { cn } from "@/lib/utils"

/** Static placeholder block. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-sm bg-muted/70", className)}
      {...props}
    />
  )
}

export { Skeleton }
