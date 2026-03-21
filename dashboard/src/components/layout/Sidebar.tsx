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
      <SidebarBody className="justify-between gap-8">
        <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
          {open ? <Logo /> : <LogoIcon />}

          <div className="mt-6 flex flex-col gap-0.5">
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
                        className={`h-[18px] w-[18px] flex-shrink-0 transition-colors ${
                          active
                            ? "text-sidebar-primary"
                            : "text-sidebar-foreground/70"
                        }`}
                      />
                    ),
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-sidebar-border/40">
          <SidebarLink
            link={{
              label: "API Docs",
              href: "/docs",
              icon: (
                <ExternalLink className="h-[18px] w-[18px] flex-shrink-0 text-sidebar-foreground/50" />
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
      className="flex items-center gap-2.5 py-1.5 px-1 relative z-20"
    >
      <div className="h-7 w-7 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex-shrink-0 flex items-center justify-center shadow-sm shadow-primary/20">
        <span className="text-[10px] font-black text-primary-foreground">HA</span>
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col"
      >
        <span className="text-sm font-bold text-foreground leading-tight">Hisse Analizi</span>
        <span className="text-[10px] text-muted-foreground font-mono leading-tight">v0.5 BIST Dashboard</span>
      </motion.div>
    </Link>
  );
};

const LogoIcon = () => {
  return (
    <Link
      href="/"
      className="flex items-center justify-center py-1.5 relative z-20"
    >
      <div className="h-7 w-7 bg-gradient-to-br from-primary to-primary/70 rounded-lg flex-shrink-0 flex items-center justify-center shadow-sm shadow-primary/20">
        <span className="text-[10px] font-black text-primary-foreground">HA</span>
      </div>
    </Link>
  );
};
