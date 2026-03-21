"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Sidebar as SidebarRoot,
  SidebarBody,
  SidebarLink,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Newspaper,
  BarChart3,
  TrendingUp,
  Building2,
  Globe,
  Search,
  ExternalLink,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/events", label: "Olaylar & KAP", icon: Newspaper },
  { href: "/hisse/THYAO", label: "Hisse Analizi", icon: BarChart3, match: "/hisse" },
  { href: "/teknik/THYAO", label: "Teknik Analiz", icon: TrendingUp, match: "/teknik" },
  { href: "/temel/THYAO", label: "Temel Analiz", icon: Building2, match: "/temel" },
  { href: "/makro", label: "Makro Ekonomi", icon: Globe },
  { href: "/tarama", label: "Hisse Tarama", icon: Search },
];

export function AppSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  function isActive(item: (typeof navItems)[0]) {
    if (item.match) return pathname.startsWith(item.match);
    return pathname === item.href;
  }

  return (
    <SidebarRoot open={open} setOpen={setOpen}>
      <SidebarBody className="justify-between gap-10">
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          {/* Logo */}
          {open ? <Logo /> : <LogoIcon />}

          {/* Navigation */}
          <div className="mt-8 flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <SidebarLink
                  key={item.href}
                  active={active}
                  link={{
                    label: item.label,
                    href: item.href,
                    icon: (
                      <Icon
                        className={`h-5 w-5 flex-shrink-0 ${
                          active
                            ? "text-sidebar-primary"
                            : "text-sidebar-foreground"
                        }`}
                      />
                    ),
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div>
          <SidebarLink
            link={{
              label: "API Docs",
              href: "/docs",
              icon: (
                <ExternalLink className="h-5 w-5 flex-shrink-0 text-sidebar-foreground opacity-60" />
              ),
            }}
          />
        </div>
      </SidebarBody>
    </SidebarRoot>
  );
}

const Logo = () => {
  return (
    <Link
      href="/"
      className="font-normal flex space-x-2 items-center text-sm py-1 relative z-20"
    >
      <div className="h-6 w-7 bg-primary rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="font-semibold text-foreground whitespace-pre"
      >
        Hisse Analizi
      </motion.span>
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-[10px] text-muted-foreground font-mono"
      >
        v0.5
      </motion.span>
    </Link>
  );
};

const LogoIcon = () => {
  return (
    <Link
      href="/"
      className="font-normal flex space-x-2 items-center text-sm py-1 relative z-20"
    >
      <div className="h-6 w-7 bg-primary rounded-br-lg rounded-tr-sm rounded-tl-lg rounded-bl-sm flex-shrink-0" />
    </Link>
  );
};
