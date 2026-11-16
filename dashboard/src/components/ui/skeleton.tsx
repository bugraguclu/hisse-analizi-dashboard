import { cn } from "@/lib/utils";

type SkeletonProps = React.ComponentPropsWithoutRef<"div"> & { as?: "div" | "span" };

function Skeleton({ as: Element = "div", className, ...props }: SkeletonProps) {
  return (
    <Element
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("block rounded-sm bg-skeleton skeleton-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
