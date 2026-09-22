import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function Breadcrumb({ ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="breadcrumb" {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn("flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
}

/** Client-side navigation link (a plain <a> would force a full page reload). */
function BreadcrumbLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="breadcrumb-link"
      className={cn("truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring", className)}
      {...props}
    />
  );
}

/** Non-navigable crumb (current page or a section without an index page). */
function BreadcrumbText({ className, ...props }: React.ComponentProps<"span">) {
  return <span data-slot="breadcrumb-text" className={cn("truncate", className)} {...props} />;
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      aria-current="page"
      className={cn("truncate font-medium text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:h-3.5 [&>svg]:w-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight className="rtl:rotate-180" />}
    </li>
  );
}

export { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbText };
