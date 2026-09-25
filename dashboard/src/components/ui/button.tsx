import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button styles for <button> and <Link> alike: `className={buttonVariants({ variant, size })}`.
 * Primary actions are solid ink (foreground), not a brand colour.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-foreground text-background hover:bg-foreground/85",
        outline: "border border-border bg-card text-foreground hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-[13px] [&_svg]:size-4",
        lg: "h-9 px-4 text-sm [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & ButtonVariantProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
